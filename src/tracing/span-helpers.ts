import { trace, context, TraceFlags, type Span } from '@opentelemetry/api';
import { propagation } from '@opentelemetry/api';
import { filterDataRecursive } from '../data-filters';
import { ensureTracingInitialized, setComponentTag as setRuntimeComponentTag } from './runtime';
import { startSpan } from './spans';
import { toAttributeValue } from './attribute-values';

/**
 * The span to annotate: the one passed in, else the active span.
 *
 * Passing it explicitly is the only option where there is no context manager - a
 * browser or an MV3 service worker - because nothing there is ever "active".
 */
function targetSpan(span?: Span | null): Span | undefined {
	return span ?? trace.getActiveSpan();
}

export function setSpanAttribute(attributeName: string, attributeValue: any, span?: Span | null): boolean {
	const target = targetSpan(span);
	if (target) {
		target.setAttribute(attributeName, toAttributeValue(filterDataRecursive(attributeValue)));
		return true;
	}
	return false;
}

export function getActiveSpan() {
	ensureTracingInitialized();
	return trace.getActiveSpan();
}

export function setConversationId(conversationId: string, span?: Span | null): boolean {
	return setSpanAttribute('gen_ai.conversation.id', conversationId, span);
}

export function setTokenUsage(inputTokens?: number | null, outputTokens?: number | null, totalTokens?: number | null, targetSpanOrNull?: Span | null): boolean {
	const span = targetSpan(targetSpanOrNull);
	if (!span) {
		return false;
	}
	let setCount = 0;
	try {
		if (inputTokens != null) {
			span.setAttribute('gen_ai.usage.input_tokens', Number(inputTokens));
			setCount++;
		}
		if (outputTokens != null) {
			span.setAttribute('gen_ai.usage.output_tokens', Number(outputTokens));
			setCount++;
		}
		if (totalTokens != null) {
			span.setAttribute('gen_ai.usage.total_tokens', Number(totalTokens));
			setCount++;
		}
	} catch (e) {
		console.warn('AIQA: Failed to set token usage attributes:', e);
		return false;
	}
	return setCount > 0;
}

export function setProviderAndModel(provider?: string | null, model?: string | null, targetSpanOrNull?: Span | null): boolean {
	const span = targetSpan(targetSpanOrNull);
	if (!span) {
		return false;
	}
	let setCount = 0;
	try {
		if (provider) {
			span.setAttribute('gen_ai.provider.name', String(provider));
			setCount++;
		}
		if (model) {
			span.setAttribute('gen_ai.request.model', String(model));
			setCount++;
		}
	} catch (e) {
		console.warn('AIQA: Failed to set provider/model attributes:', e);
		return false;
	}
	return setCount > 0;
}

export function setComponentTag(tag: string): void {
	setRuntimeComponentTag(tag);
}

export function getTraceId(span?: Span | null): string | undefined {
	ensureTracingInitialized();
	const target = targetSpan(span);
	if (target) {
		const spanContext = target.spanContext();
		if (spanContext.traceId && spanContext.traceId !== '00000000000000000000000000000000') {
			return spanContext.traceId;
		}
	}
	return undefined;
}

export function getSpanId(span?: Span | null): string | undefined {
	ensureTracingInitialized();
	const target = targetSpan(span);
	if (target) {
		const spanContext = target.spanContext();
		if (spanContext.spanId && spanContext.spanId !== '0000000000000000') {
			return spanContext.spanId;
		}
	}
	return undefined;
}

/**
 * Continue a trace from ids carried across a boundary that cannot pass context - a
 * message queue, or a `chrome.runtime` message. For a parent span object you already
 * hold, use `startSpan(name, { parent })` instead.
 */
export function createSpanFromTraceId(traceId: string, parentSpanId?: string, spanName: string = 'continued_span') {
	return startSpan(spanName, {
		parent: {
			traceId,
			spanId: parentSpanId || '0000000000000000',
			traceFlags: TraceFlags.SAMPLED,
			isRemote: true,
		},
	});
}

export function injectTraceContext(carrier: Record<string, string>): void {
	try {
		propagation.inject(context.active(), carrier);
	} catch (error) {
		console.warn('AIQA: Error injecting trace context:', error);
	}
}

export function extractTraceContext(carrier: Record<string, string>) {
	try {
		return propagation.extract(context.active(), carrier);
	} catch (error) {
		console.warn('AIQA: Error extracting trace context:', error);
		return context.active();
	}
}
