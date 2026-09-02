import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { ensureTracingInitialized, getTracer, isTracingEnabled } from './runtime';
import { passesLocalSampling, startSpan, type SpanParent } from './spans';
import { setSpanAttribute } from './span-helpers';
import { prepareInputForSpan, prepareOutputForSpan, IgnorePatterns } from './filters';
import { extractAndSetTokenUsage, extractAndSetProviderAndModel } from './llm-attrs';

export interface TracingOptions {
	name?: string;
	ignoreInput?: IgnorePatterns;
	ignoreOutput?: IgnorePatterns;
	filterInput?: (input: any) => any;
	filterOutput?: (output: any) => any;
	/**
	 * Parent for the spans this wrapper creates. Omit to use the active context, which
	 * is what you want on Node; in a browser or an MV3 service worker there is no
	 * context manager, so pass the parent explicitly - or use `startSpan` directly.
	 */
	parent?: SpanParent;
	/**
	 * Sample calls to this function at the given rate, 0-1, independently of the global
	 * `AIQA_SAMPLING_RATE`. Unsampled calls run untraced, with no span created.
	 */
	samplingRate?: number;
}

function isAsyncIterable(value: any): value is AsyncIterable<any> {
	return value != null && typeof value[Symbol.asyncIterator] === 'function';
}

function isIterable(value: any): value is Iterable<any> {
	return value != null && typeof value !== 'string' && typeof value[Symbol.iterator] === 'function';
}

function isAttributeSet(span: any, attributeName: string): boolean {
	try {
		if (!span || !span.isRecording || !span.isRecording()) {
			return false;
		}
		if (span.attributes) {
			return attributeName in span.attributes;
		}
		if (span._attributes) {
			return attributeName in span._attributes;
		}
		return false;
	} catch (_e) {
		return false;
	}
}

function setTimeToFirstOutputTokenIfNeeded(span: any, startedAtMs: number, alreadyRecorded: boolean): boolean {
	if (alreadyRecorded) {
		return true;
	}
	if (!isAttributeSet(span, 'gen_ai.server.time_to_first_output_token')) {
		span.setAttribute('gen_ai.server.time_to_first_output_token', Math.max(0, (Date.now() - startedAtMs) / 1000));
	}
	return true;
}

export function withTracingAsync(fn: Function, options: TracingOptions = {}) {
	const { name, ignoreInput, ignoreOutput, filterInput, filterOutput, parent, samplingRate } = options;
	const fnName = name || fn.name || '_';
	if ((fn as any)._isTraced) {
		console.warn('AIQA: Function ' + fnName + ' is already traced, skipping tracing again');
		return fn;
	}
	const tracedFn = async (...args: any[]) => {
		ensureTracingInitialized();
		const tracer = getTracer();
		if (!isTracingEnabled() || !tracer || !passesLocalSampling(samplingRate)) {
			return await fn(...args);
		}
		const span = startSpan(fnName, { parent });
		const startedAtMs = Date.now();
		const input = prepareInputForSpan(args, filterInput, ignoreInput);
		if (input != null) {
			setSpanAttribute('input', input, span);
		}
		let spanOwnedByStream = false;
		try {
			const result = await context.with(trace.setSpan(context.active(), span), () => fn(...args));
			if (isAsyncIterable(result)) {
				spanOwnedByStream = true;
				let firstRecorded = false;
				let yieldedCount = 0;
				let lastValue: any = null;
				const base = result;
				return {
					[Symbol.asyncIterator]() {
						const it = base[Symbol.asyncIterator]();
						return {
							async next() {
								try {
									const step = await context.with(trace.setSpan(context.active(), span), () => it.next());
									if (step.done) {
										extractAndSetTokenUsage(span, lastValue);
										extractAndSetProviderAndModel(span, lastValue);
										setSpanAttribute('output', { type: 'async_iterable', yielded_count: yieldedCount }, span);
										span.setStatus({ code: SpanStatusCode.OK });
										span.end();
										return step;
									}
									firstRecorded = setTimeToFirstOutputTokenIfNeeded(span, startedAtMs, firstRecorded);
									yieldedCount++;
									lastValue = step.value;
									return step;
								} catch (exception) {
									const error = exception instanceof Error ? exception : new Error(String(exception));
									span.recordException(error);
									span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
									span.end();
									throw error;
								}
							}
						};
					}
				};
			}
			const output = prepareOutputForSpan(result, filterOutput, ignoreOutput);
			extractAndSetTokenUsage(span, output);
			extractAndSetProviderAndModel(span, output);
			setSpanAttribute('output', output, span);
			return result;
		} catch (exception) {
			const error = exception instanceof Error ? exception : new Error(String(exception));
			span.recordException(error);
			span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
			throw error;
		} finally {
			if (!spanOwnedByStream) {
				span.end();
			}
		}
	};
	(tracedFn as any)._isTraced = true;
	return tracedFn;
}

export function withTracing(fn: Function, options: TracingOptions = {}) {
	const { name, ignoreInput, ignoreOutput, filterInput, filterOutput, parent, samplingRate } = options;
	const fnName = name || fn.name || '_';
	if ((fn as any)._isTraced) {
		console.warn('AIQA: Function ' + fnName + ' is already traced, skipping tracing again');
		return fn;
	}
	const tracedFn = (...args: any[]) => {
		ensureTracingInitialized();
		const tracer = getTracer();
		if (!isTracingEnabled() || !tracer || !passesLocalSampling(samplingRate)) {
			return fn(...args);
		}
		const span = startSpan(fnName, { parent });
		const startedAtMs = Date.now();
		const input = prepareInputForSpan(args, filterInput, ignoreInput);
		if (input != null) {
			setSpanAttribute('input', input, span);
		}
		let spanOwnedByStream = false;
		try {
			const result = context.with(trace.setSpan(context.active(), span), () => fn(...args));
			if (isIterable(result)) {
				spanOwnedByStream = true;
				let firstRecorded = false;
				let yieldedCount = 0;
				let lastValue: any = null;
				const base = result;
				return {
					[Symbol.iterator]() {
						const it = base[Symbol.iterator]();
						return {
							next() {
								try {
									const step = context.with(trace.setSpan(context.active(), span), () => it.next());
									if (step.done) {
										extractAndSetTokenUsage(span, lastValue);
										extractAndSetProviderAndModel(span, lastValue);
										setSpanAttribute('output', { type: 'iterable', yielded_count: yieldedCount }, span);
										span.setStatus({ code: SpanStatusCode.OK });
										span.end();
										return step;
									}
									firstRecorded = setTimeToFirstOutputTokenIfNeeded(span, startedAtMs, firstRecorded);
									yieldedCount++;
									lastValue = step.value;
									return step;
								} catch (exception) {
									const error = exception instanceof Error ? exception : new Error(String(exception));
									span.recordException(error);
									span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
									span.end();
									throw error;
								}
							}
						};
					}
				};
			}
			const output = prepareOutputForSpan(result, filterOutput, ignoreOutput);
			extractAndSetTokenUsage(span, output);
			extractAndSetProviderAndModel(span, output);
			setSpanAttribute('output', output, span);
			return result;
		} catch (exception) {
			const error = exception instanceof Error ? exception : new Error(String(exception));
			span.recordException(error);
			span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
			throw error;
		} finally {
			if (!spanOwnedByStream) {
				span.end();
			}
		}
	};
	(tracedFn as any)._isTraced = true;
	return tracedFn;
}
