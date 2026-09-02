/**
 * Explicit span creation.
 *
 * `withTracing` nests spans implicitly, via the OpenTelemetry context manager. That
 * needs a context manager that survives `await`, which a browser or an MV3 service
 * worker does not have: `context.active()` there never carries the current span, so
 * implicit nesting silently produces a flat trace of orphan spans.
 *
 * `startSpan` is the way out - pass the parent yourself:
 *
 *   const page = startSpan('analyse_page');
 *   const chunk = startSpan('chunk_page', { parent: page, startTime: chunkedAt });
 *   chunk.end();
 *   page.end();
 *   await flushSpans();
 *
 * `parent` also accepts a SpanContext (so you can continue a trace from ids passed
 * across a message boundary) or a whole Context, and `startTime`/`endTime` let you
 * replay work that was timed somewhere else - a content script, say.
 */

import {
	context,
	trace,
	INVALID_SPAN_CONTEXT,
	TraceFlags,
	type Attributes,
	type Context,
	type Link,
	type Span,
	type SpanContext,
	type SpanKind,
	type TimeInput,
} from '@opentelemetry/api';
import { filterDataRecursive } from '../data-filters';
import { toAttributeValue } from './attribute-values';
import { ensureTracingInitialized, getComponentTag, getTracer, isTracingEnabled } from './runtime';

/** What `startSpan` accepts as a parent. `null` means "start a new trace". */
export type SpanParent = Span | SpanContext | Context | null;

export interface StartSpanOptions {
	/**
	 * The parent span, its SpanContext, or a Context. Omit to use the active context
	 * (which only works where a context manager is installed, i.e. on Node). Pass
	 * `null` to start a new trace.
	 */
	parent?: SpanParent;
	/** Attributes to set on the span. Run through the data filters like any other. */
	attributes?: Attributes | Record<string, any>;
	/** Span start time. Defaults to now. Useful for replaying work timed elsewhere. */
	startTime?: TimeInput;
	kind?: SpanKind;
	links?: Link[];
	/**
	 * Sample this span at the given rate, 0-1, independently of the global
	 * `AIQA_SAMPLING_RATE`. The decision is local to this call: if the span is dropped
	 * it is non-recording, and so is any span created with it as an explicit `parent`.
	 */
	samplingRate?: number;
	/** Force a new trace even if there is an active or explicit parent. */
	root?: boolean;
}

/**
 * Spans dropped by a per-call-site `samplingRate`. Tracked so their children are
 * dropped too, which is what makes per-call-site sampling useful: sampling out a page
 * analysis should sample out the whole subtree, not just its root.
 */
const droppedSpans = new WeakSet<object>();

function isSpan(value: any): value is Span {
	return !!value && typeof value.spanContext === 'function';
}

function isContext(value: any): value is Context {
	return !!value && typeof value.getValue === 'function' && typeof value.setValue === 'function';
}

function isSpanContext(value: any): value is SpanContext {
	return !!value && typeof value.traceId === 'string' && typeof value.spanId === 'string';
}

/** Resolve any accepted parent form to the Context the tracer should start under. */
function resolveParentContext(parent: SpanParent | undefined): Context {
	const active = context.active();
	if (parent === undefined || parent === null) {
		return active;
	}
	if (isSpan(parent)) {
		return trace.setSpan(active, parent);
	}
	if (isContext(parent)) {
		return parent;
	}
	if (isSpanContext(parent)) {
		return trace.setSpanContext(active, parent);
	}
	return active;
}

/**
 * A span that records nothing. Keeps the parent's trace id where there is one, so
 * `getTraceId()` and context propagation still line up for the dropped subtree.
 */
function nonRecordingSpan(parentContext: Context): Span {
	const parentSpanContext = trace.getSpanContext(parentContext);
	const spanContext: SpanContext = parentSpanContext
		? { ...parentSpanContext, traceFlags: TraceFlags.NONE }
		: INVALID_SPAN_CONTEXT;
	return trace.wrapSpanContext(spanContext);
}

/** Decide a per-call-site sampling rate. No rate given means "leave it to the sampler". */
export function passesLocalSampling(samplingRate?: number): boolean {
	if (samplingRate == null || isNaN(samplingRate) || samplingRate >= 1) {
		return true;
	}
	if (samplingRate <= 0) {
		return false;
	}
	return Math.random() < samplingRate;
}

/** True if this span was dropped by a per-call-site sampling decision. */
export function isSpanDropped(span: unknown): boolean {
	return !!span && typeof span === 'object' && droppedSpans.has(span as object);
}

/** Mark a span as dropped, so spans explicitly parented to it are dropped too. */
export function markSpanDropped(span: Span): Span {
	droppedSpans.add(span as unknown as object);
	return span;
}

/**
 * Start a span, with the parent given explicitly rather than taken from the ambient
 * context. Always returns a Span - a non-recording one when tracing is disabled or the
 * span was sampled out - so callers never have to null-check. Call `span.end()`
 * yourself, then `flushSpans()` if the runtime may be suspended.
 */
export function startSpan(name: string, options: StartSpanOptions = {}): Span {
	ensureTracingInitialized();
	const parentContext = resolveParentContext(options.parent);
	const tracer = getTracer();
	const dropped = isSpanDropped(options.parent) || !passesLocalSampling(options.samplingRate);
	if (!isTracingEnabled() || !tracer || dropped) {
		return markSpanDropped(nonRecordingSpan(parentContext));
	}

	const attributes: Attributes = {};
	const componentTag = getComponentTag();
	if (componentTag) {
		attributes['gen_ai.component.id'] = componentTag;
	}
	if (options.attributes) {
		for (const [key, value] of Object.entries(filterDataRecursive(options.attributes))) {
			attributes[key] = toAttributeValue(value);
		}
	}

	return tracer.startSpan(
		name,
		{
			kind: options.kind,
			links: options.links,
			startTime: options.startTime,
			root: options.root === true || options.parent === null ? true : undefined,
			attributes,
		},
		parentContext,
	);
}
