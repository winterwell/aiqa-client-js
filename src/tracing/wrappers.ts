import { trace, context, SpanStatusCode, type Span } from '@opentelemetry/api';
import { ensureTracingInitialized, getTracer, isTracingEnabled } from './runtime';
import { passesLocalSampling, startSpan, type SpanParent } from './spans';
import { setSpanAttribute } from './span-helpers';
import { prepareInputForSpan, prepareOutputForSpan, IgnorePatterns } from './filters';
import { extractAndSetTokenUsage, extractAndSetProviderAndModel, isAttributeSet } from './llm-attrs';

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

const TIME_TO_FIRST_TOKEN = 'gen_ai.server.time_to_first_output_token';

function isThenable(value: any): value is PromiseLike<any> {
	return value != null && typeof value.then === 'function';
}

function isAsyncIterable(value: any): value is AsyncIterable<any> {
	return value != null && typeof value[Symbol.asyncIterator] === 'function';
}

/**
 * A one-shot iterator such as a generator - not an array, string, Map or Set, which are
 * iterable too but are ordinary return values that must be handed back unchanged.
 */
function isIterator(value: any): value is IterableIterator<any> {
	return value != null && typeof value.next === 'function' && typeof value[Symbol.iterator] === 'function';
}

function recordError(span: Span, exception: unknown): Error {
	const error = exception instanceof Error ? exception : new Error(String(exception));
	span.recordException(error);
	span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
	return error;
}

function setOutput(span: Span, output: any, options: TracingOptions): void {
	const prepared = prepareOutputForSpan(output, options.filterOutput, options.ignoreOutput);
	extractAndSetTokenUsage(span, prepared);
	extractAndSetProviderAndModel(span, prepared);
	setSpanAttribute('output', prepared, span);
}

/**
 * Keep the span open until a stream is exhausted, abandoned (`break` calls `return()`)
 * or fails. Works for sync and async iterators alike: every step is awaited only if it
 * is a promise, so a sync iterator stays sync.
 */
function traceStream(span: Span, it: any, startedAtMs: number, isAsync: boolean): any {
	let yieldedCount = 0;
	let lastValue: any = null;
	let ended = false;
	const end = (error?: unknown) => {
		if (ended) return;
		ended = true;
		if (error !== undefined) {
			recordError(span, error);
		} else {
			extractAndSetTokenUsage(span, lastValue);
			extractAndSetProviderAndModel(span, lastValue);
			setSpanAttribute('output', { type: isAsync ? 'async_iterable' : 'iterable', yielded_count: yieldedCount }, span);
			span.setStatus({ code: SpanStatusCode.OK });
		}
		span.end();
	};
	const onStep = (step: IteratorResult<any>) => {
		if (step.done) {
			end();
		} else {
			if (yieldedCount === 0 && !isAttributeSet(span, TIME_TO_FIRST_TOKEN)) {
				span.setAttribute(TIME_TO_FIRST_TOKEN, Math.max(0, (Date.now() - startedAtMs) / 1000));
			}
			yieldedCount++;
			lastValue = step.value;
		}
		return step;
	};
	const onError = (exception: unknown) => {
		end(exception);
		throw exception;
	};
	const call = (method: string, arg?: any) => {
		let step: any;
		try {
			step = context.with(trace.setSpan(context.active(), span), () => it[method](arg));
		} catch (exception) {
			return onError(exception);
		}
		return isThenable(step) ? Promise.resolve(step).then(onStep, onError) : onStep(step);
	};
	const wrapped: any = {
		next: (arg?: any) => call('next', arg),
		// Early exit from a for-of / for-await: close the span rather than leak it.
		return: (value?: any) => {
			if (typeof it.return === 'function') {
				const result = call('return', value);
				end();
				return result;
			}
			end();
			return isAsync ? Promise.resolve({ done: true, value }) : { done: true, value };
		},
	};
	if (typeof it.throw === 'function') {
		wrapped.throw = (error?: any) => call('throw', error);
	}
	wrapped[isAsync ? Symbol.asyncIterator : Symbol.iterator] = () => wrapped;
	return wrapped;
}

/**
 * Trace one call. Handles every result shape: a plain value, a promise, a generator, and
 * an async iterable (possibly behind a promise) - the span ends when the value, promise
 * or stream is done with, not when `fn` returns.
 */
function tracedCall(fn: Function, fnName: string, options: TracingOptions, args: any[], isAsync: boolean): any {
	ensureTracingInitialized();
	if (!isTracingEnabled() || !getTracer() || !passesLocalSampling(options.samplingRate)) {
		return fn(...args);
	}
	const span = startSpan(fnName, { parent: options.parent });
	const startedAtMs = Date.now();
	const input = prepareInputForSpan(args, options.filterInput, options.ignoreInput);
	if (input != null) {
		setSpanAttribute('input', input, span);
	}
	const finish = (result: any): any => {
		if (isAsyncIterable(result)) {
			return traceStream(span, result[Symbol.asyncIterator](), startedAtMs, true);
		}
		if (isIterator(result)) {
			return traceStream(span, result, startedAtMs, false);
		}
		try {
			setOutput(span, result, options);
		} finally {
			span.end();
		}
		return result;
	};
	const fail = (exception: unknown): never => {
		const error = recordError(span, exception);
		span.end();
		throw error;
	};
	let result: any;
	try {
		result = context.with(trace.setSpan(context.active(), span), () => fn(...args));
	} catch (exception) {
		return fail(exception);
	}
	// withTracingAsync awaits any thenable, as `await` would. withTracing only waits on a
	// real Promise: calling `then` on a lazy thenable (a query builder, say) would run it.
	const pending = isAsync ? isThenable(result) : result instanceof Promise;
	return pending ? Promise.resolve(result).then(finish, fail) : finish(result);
}

function wrap(fn: Function, options: TracingOptions, makeAsync: boolean): (...args: any[]) => any {
	const fnName = options.name || fn.name || '_';
	if ((fn as any)._isTraced) {
		console.warn('AIQA: Function ' + fnName + ' is already traced, skipping tracing again');
		return fn as (...args: any[]) => any;
	}
	const tracedFn = makeAsync
		? async (...args: any[]) => tracedCall(fn, fnName, options, args, true)
		: (...args: any[]) => tracedCall(fn, fnName, options, args, false);
	(tracedFn as any)._isTraced = true;
	return tracedFn;
}

/**
 * Wrap `fn` so each call is recorded as a span. Returns what `fn` returns: if that is a
 * promise, the span ends when it settles; if it is a generator or async iterable, the span
 * stays open until the stream is exhausted.
 */
export function withTracing(fn: Function, options: TracingOptions = {}): (...args: any[]) => any {
	return wrap(fn, options, false);
}

/** As `withTracing`, but the wrapped function always returns a promise. */
export function withTracingAsync(fn: Function, options: TracingOptions = {}): (...args: any[]) => Promise<any> {
	return wrap(fn, options, true);
}
