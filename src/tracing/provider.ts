/**
 * How the TracerProvider gets built - the one thing that differs between Node and the
 * browser.
 *
 * The default here is deliberately the browser-safe one: `BasicTracerProvider` from
 * `@opentelemetry/sdk-trace-base`, which has no Node built-in dependencies. The Node
 * entry point (src/platform/node.ts) calls `setProviderFactory` to swap in
 * `NodeTracerProvider`, which additionally installs the async-hooks context manager
 * that `withTracing`'s implicit span nesting relies on.
 *
 * It has to be an injected factory rather than a conditional import: bundlers resolve
 * both branches of a `require` regardless of which one can run, so any static reference
 * to `@opentelemetry/sdk-trace-node` from a module the browser build reaches would drag
 * `async_hooks` and `events` into the bundle and fail to resolve.
 */

import { BasicTracerProvider, BatchSpanProcessor, TraceIdRatioBasedSampler, type SpanExporter, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { SERVICE_NAME_ATTRIBUTE } from './constants';

export interface ProviderOptions {
	serviceName: string;
	/** Fraction of traces to sample, 0-1. */
	samplingRate: number;
	/** Processors to install on the provider, passed to the constructor. */
	spanProcessors: SpanProcessor[];
}

export type ProviderFactory = (options: ProviderOptions) => BasicTracerProvider;

/**
 * Browser-safe default. Note that `BasicTracerProvider.register()` does not install a
 * context manager, so `context.active()` never carries a span: in a browser or an MV3
 * service worker, pass parents explicitly with `startSpan(name, { parent })`.
 */
export function createBasicProvider(options: ProviderOptions): BasicTracerProvider {
	return new BasicTracerProvider({
		resource: new Resource({ [SERVICE_NAME_ATTRIBUTE]: options.serviceName }),
		sampler: new TraceIdRatioBasedSampler(options.samplingRate),
		spanProcessors: options.spanProcessors,
	});
}

/** The processor wiring is the same on every platform. */
export function createBatchProcessor(exporter: SpanExporter): SpanProcessor {
	return new BatchSpanProcessor(exporter);
}

/**
 * True if `value` is an OpenTelemetry SDK TracerProvider, rather than the
 * ProxyTracerProvider or NoopTracerProvider the API returns when nothing is registered.
 *
 * Probed by shape, not `instanceof`: the host application resolves its own copy of
 * `@opentelemetry/sdk-trace-base`, and `instanceof` across two copies is false. The probe
 * is `register`/`forceFlush`/`shutdown`, which both SDK 1.x and 2.x have. It used to be
 * `addSpanProcessor`, which is 1.x only - so a 2.x host provider went undetected and got
 * quietly clobbered, which is the thing this detection exists to prevent.
 */
export function isSdkTracerProvider(value: any): value is BasicTracerProvider {
	return !!value
		&& typeof value.register === 'function'
		&& typeof value.forceFlush === 'function'
		&& typeof value.shutdown === 'function';
}

/**
 * Add `processor` to a provider this client did not build. Returns false if that could
 * not be done, which the caller must report rather than work around.
 *
 * SDK 1.x has `addSpanProcessor`. SDK 2.x removed it - processors are constructor-only
 * there, with no post-construction replacement - so a 2.x host provider cannot be
 * extended after the fact. Registering our own provider over theirs is not an out: that
 * breaks the host's instrumentation and splits context propagation across two providers,
 * which is worse than not exporting to AIQA.
 */
export function attachSpanProcessor(provider: BasicTracerProvider, processor: SpanProcessor): boolean {
	const asAny = provider as any;
	if (typeof asAny.addSpanProcessor !== 'function') {
		return false;
	}
	try {
		asAny.addSpanProcessor(processor);
		return true;
	} catch (e) {
		console.warn('AIQA: Error adding the AIQA span processor to the existing TracerProvider:', e);
		return false;
	}
}

let factory: ProviderFactory = createBasicProvider;

/** Replace the provider factory. Called by src/platform/node.ts at import time. */
export function setProviderFactory(next: ProviderFactory): void {
	factory = next;
}

export function getProviderFactory(): ProviderFactory {
	return factory;
}
