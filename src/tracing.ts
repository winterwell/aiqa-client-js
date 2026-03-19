/**
 * OpenTelemetry tracing setup and utilities. Initializes tracer provider on import.
 * Provides withTracingAsync and withTracing decorators to automatically trace function calls.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { trace, context, SpanStatusCode, SpanContext, TraceFlags } from '@opentelemetry/api';
import { propagation } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { ATTR_CODE_FUNCTION_NAME, SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { AIQASpanExporter } from './aiqa-exporter';
import { filterDataRecursive } from './data-filters';

const GEN_AI_OPERATION_NAME = 'gen_ai.operation.name';

// Load environment variables from .env file in client-js directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Get sampling rate from environment (default: 1.0 = sample all)
let samplingRate = 1.0;
if (process.env.AIQA_SAMPLING_RATE) {
	const rate = parseFloat(process.env.AIQA_SAMPLING_RATE);
	if (!isNaN(rate)) {
		samplingRate = Math.max(0, Math.min(1, rate)); // Clamp to [0, 1]
	}
}

// Component tag to add to all spans (can be set via AIQA_COMPONENT_TAG env var or programmatically)
let componentTag: string = process.env.AIQA_COMPONENT_TAG || "";


// Lazy initialization state
let initialized = false;
let provider: NodeTracerProvider | null = null;
let exporter: AIQASpanExporter | null = null;
let tracer: trace.Tracer | null = null;
let tracingEnabled: boolean = true; // Whether tracing is enabled (set to false if env vars missing)

/**
 * Get or initialize the AIQA client singleton.
 * This function is called automatically when withTracing/withTracingAsync is first used, so you typically
 * don't need to call it explicitly. However, you can call it manually if you want to:
 * - Initialize before the first withTracing usage
 * - Access the client state for advanced usage
 *
 * The function loads environment variables (AIQA_SERVER_URL, AIQA_API_KEY, AIQA_COMPONENT_TAG)
 * and initializes the tracing system.
 *
 * The function is idempotent - calling it multiple times is safe and will only initialize once.
 */
export function getAIQAClient(): void {
	if (initialized) {
		return;
	}
	
	ensureTracingInitialized();
}

/**
 * Ensure tracing is initialized (lazy initialization)
 * Thread-safe: uses a flag to ensure initialization only happens once
 */
function ensureTracingInitialized(): void {
	if (initialized) {
		return;
	}
	
	initialized = true;
	
	const aiqaServerUrl = process.env.AIQA_SERVER_URL || 'https://server-aiqa.winterwell.com';
	const aiqaApiKey = process.env.AIQA_API_KEY || '';
	
	// Gracefully disable if required environment variables are not set
	if (!aiqaApiKey) {
		console.warn('AIQA: WARNING: Tracing is disabled: missing required environment variables: AIQA_API_KEY');
		console.warn('AIQA: Your application will continue to run without tracing.');
		tracingEnabled = false;
		tracer = null;
		provider = null;
		exporter = null;
		return;
	}
	
	tracingEnabled = true;
	exporter = new AIQASpanExporter(aiqaServerUrl, aiqaApiKey);

	// Check if a TracerProvider is already registered
	const existingProvider = trace.getTracerProvider();

	// Check if it's a real SDK provider (has addSpanProcessor method) or just the default NoOp provider
	const isRealProvider = existingProvider && typeof (existingProvider as any).addSpanProcessor === 'function';

	if (!isRealProvider) {
		// No real provider exists, create a new one
		provider = new NodeTracerProvider({
			resource: new Resource({
				[SEMRESATTRS_SERVICE_NAME]: 'example-service',
			}),
			sampler: new TraceIdRatioBasedSampler(samplingRate),
		});
		
		provider.addSpanProcessor(new BatchSpanProcessor(exporter));
		provider.register();
	} else {
		// Real provider already exists, just add our span processor to it
		// Check if we've already added our processor to avoid duplicates
		provider = existingProvider as NodeTracerProvider;
		let processorAlreadyAdded = false;
		
		// Try to check if our exporter is already in the processor list
		// Note: This is a best-effort check since we can't easily inspect internal processors
		try {
			const processors = (provider as any)._spanProcessors;
			if (processors) {
				for (const proc of processors) {
					if (proc && proc._exporter === exporter) {
						processorAlreadyAdded = true;
						break;
					}
				}
			}
		} catch (e) {
			// If we can't check, assume it's not added and proceed
		}
		
		if (!processorAlreadyAdded) {
			provider.addSpanProcessor(new BatchSpanProcessor(exporter));
		}
	}

	// Getting a tracer with the same name ('aiqa-tracer') simply returns a tracer instance;
	// it does NOT link spans automatically within the same trace.
	// Each time you start a new root span (span without a parent), a new trace-id is generated.
	// Spans only share a trace-id if they are started as children of the same trace context.

	tracer = trace.getTracer('aiqa-tracer');
}

/**
 * Flush all pending spans to the server.
 * Flushes also happen automatically every few seconds. So you only need to call this function 
 * if you want to flush immediately, e.g. before exiting a process.
 * 
 * This flushes both the BatchSpanProcessor and the exporter buffer.
 * 
 */
export async function flushSpans(): Promise<void> {
	ensureTracingInitialized();
	if (provider) {
		await provider.forceFlush();
	}
	if (exporter) {
		await exporter.flush();
	}
}

/**
 * Shutdown the tracer provider and exporter. 
 * It is not necessary to call this function.
 * Note: If using with an existing TracerProvider, this will shutdown the entire provider,
 * which may affect other tracing systems. Use with caution.
 */
export async function shutdownTracing(): Promise<void> {
	ensureTracingInitialized();
	// Disable tracing to prevent attempts to use shut-down system
	tracingEnabled = false;
	if (provider) {
		await provider.shutdown();
	}
	if (exporter) {
		await exporter.shutdown();
	}
	tracer = null;
}

// Export provider and exporter for advanced usage (lazy getters)
export function getProvider(): NodeTracerProvider | null {
	ensureTracingInitialized();
	return provider;
}

export function getExporter(): AIQASpanExporter | null {
	ensureTracingInitialized();
	return exporter;
}

/**
 * Check if tracing is currently enabled.
 * Tracing is disabled if AIQA_API_KEY is not set.
 * 
 * @returns True if tracing is enabled, false otherwise
 */
export function isTracingEnabled(): boolean {
	ensureTracingInitialized();
	return tracingEnabled;
}

/**
 * Options for withTracing and withTracingAsync functions
 */
export interface TracingOptions {
	name?: string;
	ignoreInput?: any;
	ignoreOutput?: any;
	filterInput?: (input: any) => any;
	filterOutput?: (output: any) => any;
}

function normalizeIgnorePatterns(ignorePatterns?: string | string[]): string[] {
	if (!ignorePatterns) {
		return [];
	}
	if (Array.isArray(ignorePatterns)) {
		return ignorePatterns.filter((pattern) => typeof pattern === 'string' && pattern.length > 0);
	}
	if (typeof ignorePatterns === 'string') {
		return [ignorePatterns];
	}
	return [];
}

function matchIgnorePattern(key: string, pattern: string): boolean {
	if (pattern === key) {
		return true;
	}
	if (!pattern.includes('*') && !pattern.includes('?')) {
		return false;
	}
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '.*')
		.replace(/\?/g, '.');
	const regex = new RegExp(`^${escaped}$`);
	return regex.test(key);
}

function applyIgnorePatterns(value: any, ignorePatterns?: string | string[]): any {
	const patterns = normalizeIgnorePatterns(ignorePatterns);
	if (!patterns.length || value == null || typeof value !== 'object') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => applyIgnorePatterns(item, patterns));
	}
	const input = value as Record<string, any>;
	const output: Record<string, any> = {};
	for (const [key, childValue] of Object.entries(input)) {
		const shouldIgnore = patterns.some((pattern) => matchIgnorePattern(key, pattern));
		if (shouldIgnore) {
			continue;
		}
		output[key] = applyIgnorePatterns(childValue, patterns);
	}
	return output;
}

function prepareInputForSpan(args: any[], filterInput?: (input: any) => any, ignoreInput?: string | string[]): any {
	let input: any = args;
	if (args.length === 0) {
		input = null;
	} else if (args.length === 1) {
		input = args[0];
	}
	if (filterInput) {
		input = filterInput(input);
	}
	return applyIgnorePatterns(input, ignoreInput);
}

function prepareOutputForSpan(output: any, filterOutput?: (output: any) => any, ignoreOutput?: string | string[]): any {
	let outputForSpan = output;
	if (filterOutput) {
		outputForSpan = filterOutput(outputForSpan);
	}
	return applyIgnorePatterns(outputForSpan, ignoreOutput);
}

function isAsyncIterable(value: any): value is AsyncIterable<any> {
	return value != null && typeof value[Symbol.asyncIterator] === 'function';
}

function isIterable(value: any): value is Iterable<any> {
	// Exclude strings: they're iterable but not stream payloads.
	return value != null && typeof value !== 'string' && typeof value[Symbol.iterator] === 'function';
}

function setTimeToFirstOutputTokenIfNeeded(span: any, startedAtMs: number, alreadyRecorded: boolean): boolean {
	if (alreadyRecorded) {
		return true;
	}
	if (!isAttributeSet(span, 'gen_ai.server.time_to_first_output_token')) {
		const elapsedSeconds = Math.max(0, (Date.now() - startedAtMs) / 1000);
		span.setAttribute('gen_ai.server.time_to_first_output_token', elapsedSeconds);
	}
	return true;
}

/**
 * Wrap async function to automatically create spans. Records input/output as span attributes.
 * Spans are automatically linked via OpenTelemetry context.
 */
export function withTracingAsync(fn: Function, options: TracingOptions = {}) {
	const { name, ignoreInput, ignoreOutput, filterInput, filterOutput } = options;
	let fnName = name || fn.name || "_";
	if ((fn as any)._isTraced) {
		console.warn('AIQA: Function ' + fnName + ' is already traced, skipping tracing again');
		return fn;
	}
	const tracedFn = async (...args: any[]) => {
		// Lazy initialization: ensure tracing is initialized before creating spans
		// This is called lazily when the function runs, not at decorator definition time
		ensureTracingInitialized();
		
		if (!tracingEnabled || !tracer) {
			// Tracing not initialized or disabled, just execute the function
			return await fn(...args);
		}
		
		const span = tracer.startSpan(fnName);
		const startedAtMs = Date.now();
		
		// Set component tag if configured
		if (componentTag) {
			span.setAttribute('gen_ai.component.id', componentTag);
		}
		
		// Trace inputs using input. attributes
		const input = prepareInputForSpan(args, filterInput, ignoreInput);
		if (input != null) {
			const filteredInput = filterDataRecursive(input);
			span.setAttribute('input', filteredInput);
		}
		let spanOwnedByStream = false;
		try {
			const curriedFn = () => fn(...args);
			const result = await context.with(trace.setSpan(context.active(), span), curriedFn);
			if (isAsyncIterable(result)) {
				spanOwnedByStream = true;
				let firstRecorded = false;
				let yieldedCount = 0;
				let lastValue: any = null;
				const base = result;
				const wrapped = {
					[Symbol.asyncIterator]() {
						const it = base[Symbol.asyncIterator]();
						return {
							async next() {
								try {
									const step = await context.with(trace.setSpan(context.active(), span), () => it.next());
									if (step.done) {
										extractAndSetTokenUsage(span, lastValue);
										extractAndSetProviderAndModel(span, lastValue);
										span.setAttribute('output', filterDataRecursive({
											type: 'async_iterable',
											yielded_count: yieldedCount,
										}));
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
				return wrapped;
			}
			// Trace output
			const output = prepareOutputForSpan(result, filterOutput, ignoreOutput);
			// Extract and set token usage before setting output
			extractAndSetTokenUsage(span, output);
			// Extract and set provider/model before setting output
			extractAndSetProviderAndModel(span, output);
			const filteredOutput = filterDataRecursive(output);
			span.setAttribute('output', filteredOutput);

			return result;
		} catch (exception) {
			const error = exception instanceof Error ? exception : new Error(String(exception));
			span.recordException(error);
			span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
			throw error; // Re-throw to maintain error propagation		  
		} finally {
			if (!spanOwnedByStream) {
				span.end();
			}
		}
	};
	tracedFn._isTraced = true; // avoid double wrapping
	return tracedFn;
}


/**
 * Wrap synchronous function to automatically create spans. Records input/output as span attributes.
 * Spans are automatically linked via OpenTelemetry context.
 */
export function withTracing(fn: Function, options: TracingOptions = {}) {	
	const { name, ignoreInput, ignoreOutput, filterInput, filterOutput } = options;
	let fnName = name || fn.name || "_";
	if ((fn as any)._isTraced) {
		console.warn('AIQA: Function ' + fnName + ' is already traced, skipping tracing again');
		return fn;
	}
	const tracedFn = (...args: any[]) => {
		// Lazy initialization: ensure tracing is initialized before creating spans
		// This is called lazily when the function runs, not at decorator definition time
		ensureTracingInitialized();
		
		if (!tracingEnabled || !tracer) {
			// Tracing not initialized or disabled, just execute the function
			return fn(...args);
		}
		
		const span = tracer.startSpan(fnName);
		const startedAtMs = Date.now();
		
		// Set component tag if configured
		if (componentTag) {
			span.setAttribute('gen_ai.component.id', componentTag);
		}
		
		// Trace inputs using input. attributes
		const input = prepareInputForSpan(args, filterInput, ignoreInput);
		if (input != null) {
			const filteredInput = filterDataRecursive(input);
			span.setAttribute('input', filteredInput);
		}
		let spanOwnedByStream = false;
		try {
			const curriedFn = () => fn(...args);
			const result = context.with(trace.setSpan(context.active(), span), curriedFn);
			if (isIterable(result)) {
				spanOwnedByStream = true;
				let firstRecorded = false;
				let yieldedCount = 0;
				let lastValue: any = null;
				const base = result;
				const wrapped = {
					[Symbol.iterator]() {
						const it = base[Symbol.iterator]();
						return {
							next() {
								try {
									const step = context.with(trace.setSpan(context.active(), span), () => it.next());
									if (step.done) {
										extractAndSetTokenUsage(span, lastValue);
										extractAndSetProviderAndModel(span, lastValue);
										span.setAttribute('output', filterDataRecursive({
											type: 'iterable',
											yielded_count: yieldedCount,
										}));
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
				return wrapped;
			}
			// Trace output
			const output = prepareOutputForSpan(result, filterOutput, ignoreOutput);
			// Extract and set token usage before setting output
			extractAndSetTokenUsage(span, output);
			// Extract and set provider/model before setting output
			extractAndSetProviderAndModel(span, output);
			const filteredOutput = filterDataRecursive(output);
			span.setAttribute('output', filteredOutput);

			return result;
		} catch (exception) {
			const error = exception instanceof Error ? exception : new Error(String(exception));
			span.recordException(error);
			span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
			throw error; // Re-throw to maintain error propagation		  
		} finally {
			if (!spanOwnedByStream) {
				span.end();
			}
		}
	};
	tracedFn._isTraced = true; // avoid double wrapping
	return tracedFn;
}



export function setSpanAttribute(attributeName: string, attributeValue: any) {
	let span = trace.getActiveSpan();
	if (span) {
		const filteredValue = filterDataRecursive(attributeValue);
		span.setAttribute(attributeName, filteredValue);
		return true;
	}
	return false; // no span found
}

/**
 * Check if an attribute is already set on a span.
 * Returns true if the attribute exists, false otherwise.
 * Safe against exceptions.
 */
function isAttributeSet(span: any, attributeName: string): boolean {
	try {
		// Check if span is recording first
		if (!span || !span.isRecording || !span.isRecording()) {
			return false;
		}
		
		// Try to access span attributes if available
		if (span.attributes) {
			return attributeName in span.attributes;
		}
		
		// Try private _attributes (common in OpenTelemetry SDK)
		if (span._attributes) {
			return attributeName in span._attributes;
		}
		
		// Fallback: check if span has a way to get attributes
		// OpenTelemetry spans don't expose a direct getter, so we return false
		// to allow setting (conservative approach)
		return false;
	} catch (e) {
		// If anything goes wrong, assume not set (conservative approach)
		return false;
	}
}

/**
 * Extract OpenAI API style token usage from result and add to span attributes
 * using OpenTelemetry semantic conventions for gen_ai.
 * Only sets attributes that are not already set.
 * 
 * This function detects token usage from OpenAI API response patterns:
 * - OpenAI Chat Completions API: The 'usage' object contains 'prompt_tokens', 'completion_tokens', and 'total_tokens'.
 *   See https://platform.openai.com/docs/api-reference/chat/object (usage field)
 * - OpenAI Completions API: The 'usage' object contains 'prompt_tokens', 'completion_tokens', and 'total_tokens'.
 *   See https://platform.openai.com/docs/api-reference/completions/object (usage field)
 * 
 * This function is safe against exceptions and will not derail tracing or program execution.
 */
function extractAndSetTokenUsage(span: any, result: any): void {
	try {
		if (!span || !span.isRecording || !span.isRecording()) {
			return;
		}
		
		let usage: any = null;
		if (typeof result === 'string') {
			try {
				result = JSON.parse(result);
			} catch (_e) {
				// Leave result as-is if not JSON.
			}
		}
		
		// Check if result is an object with 'usage' key
		try {
			if (result && typeof result === 'object') {
				if ('usage' in result) {
					usage = result.usage;
				} else if ('Usage' in result) {
					usage = result.Usage;
				} else {
					// Check if result itself is a usage dict (OpenAI format)
					if ('prompt_tokens' in result && 'completion_tokens' in result && 'total_tokens' in result) {
						usage = result;
					} else if ('PromptTokens' in result && 'CompletionTokens' in result && 'TotalTokens' in result) {
						usage = result;
					} else if ('input_tokens' in result && 'output_tokens' in result) {
						// Bedrock format
						usage = result;
					} else if ('InputTokens' in result && 'OutputTokens' in result) {
						// Bedrock format (capitalized)
						usage = result;
					}
				}
			}
		} catch (e) {
			// If accessing result properties fails, just return silently
			return;
		}
		
		// Extract token usage if found
		if (usage && typeof usage === 'object') {
			try {
				// Support both OpenAI format (prompt_tokens/completion_tokens) and Bedrock format (input_tokens/output_tokens)
				let promptTokens = usage.prompt_tokens ?? usage.PromptTokens;
				let completionTokens = usage.completion_tokens ?? usage.CompletionTokens;
				const inputTokens = usage.input_tokens ?? usage.InputTokens;
				const outputTokens = usage.output_tokens ?? usage.OutputTokens;
				let totalTokens = usage.total_tokens ?? usage.TotalTokens;
				const cacheReadTokens = usage.cache_read_input_tokens ?? usage.CacheReadInputTokens;
				const cacheWriteTokens = usage.cache_creation_input_tokens ?? usage.cache_write_input_tokens ?? usage.CacheCreationInputTokens ?? usage.CacheWriteInputTokens;
				
				// Use Bedrock format if OpenAI format not available
				if (promptTokens == null) {
					promptTokens = inputTokens;
				}
				if (completionTokens == null) {
					completionTokens = outputTokens;
				}
				
				// Calculate total_tokens if not provided but we have input and output
				if (totalTokens == null && promptTokens != null && completionTokens != null) {
					totalTokens = Number(promptTokens) + Number(completionTokens);
				}
				
				// Only set attributes that are not already set
				if (promptTokens != null && !isAttributeSet(span, 'gen_ai.usage.input_tokens')) {
					span.setAttribute('gen_ai.usage.input_tokens', Number(promptTokens));
				}
				if (completionTokens != null && !isAttributeSet(span, 'gen_ai.usage.output_tokens')) {
					span.setAttribute('gen_ai.usage.output_tokens', Number(completionTokens));
				}
				if (totalTokens != null && !isAttributeSet(span, 'gen_ai.usage.total_tokens')) {
					span.setAttribute('gen_ai.usage.total_tokens', Number(totalTokens));
				}
				if (cacheReadTokens != null && !isAttributeSet(span, 'gen_ai.usage.cache_read.input_tokens')) {
					span.setAttribute('gen_ai.usage.cache_read.input_tokens', Number(cacheReadTokens));
				}
				if (cacheWriteTokens != null && !isAttributeSet(span, 'gen_ai.usage.cache_creation.input_tokens')) {
					span.setAttribute('gen_ai.usage.cache_creation.input_tokens', Number(cacheWriteTokens));
				}
			} catch (e) {
				// If setting attributes fails, log but don't raise
				console.debug('AIQA: Failed to set token usage attributes on span', e);
			}
		}
	} catch (e) {
		// Catch any other exceptions to ensure this never derails tracing
		console.debug('AIQA: Error in extractAndSetTokenUsage', e);
	}
}

/**
 * Extract provider and model information from result and add to span attributes
 * using OpenTelemetry semantic conventions for gen_ai.
 * Only sets attributes that are not already set.
 * 
 * This function detects model information from common API response patterns:
 * - OpenAI Chat Completions API: The 'model' field is at the top level of the response.
 *   See https://platform.openai.com/docs/api-reference/chat/object
 * - OpenAI Completions API: The 'model' field is at the top level of the response.
 *   See https://platform.openai.com/docs/api-reference/completions/object
 * 
 * This function is safe against exceptions and will not derail tracing or program execution.
 */
function extractAndSetProviderAndModel(span: any, result: any): void {
	try {
		if (!span || !span.isRecording || !span.isRecording()) {
			return;
		}
		
		let model: any = null;
		let provider: any = null;
		
		// Check if result is an object
		try {
			if (result && typeof result === 'object') {
				model = result.model ?? result.Model;
				provider = result.provider ?? result.Provider ?? result.provider_name ?? result.providerName;
				
				// Check nested structures (e.g., response.data.model)
				if (model == null && result.data) {
					const data = result.data;
					if (typeof data === 'object') {
						model = data.model ?? data.Model;
					}
				}
				
				// Check for model in choices (OpenAI pattern)
				if (model == null && Array.isArray(result.choices) && result.choices.length > 0) {
					const firstChoice = result.choices[0];
					if (firstChoice && typeof firstChoice === 'object') {
						model = firstChoice.model ?? firstChoice.Model;
					}
				}
			}
		} catch (e) {
			// If accessing result properties fails, just return silently
			return;
		}
		
		// Set attributes if found and not already set
		if (model != null && !isAttributeSet(span, 'gen_ai.request.model')) {
			try {
				const modelStr = String(model);
				if (modelStr) {
					span.setAttribute('gen_ai.request.model', modelStr);
				}
			} catch (e) {
				console.debug('AIQA: Failed to set model attribute on span', e);
			}
		}
		
		if (provider != null && !isAttributeSet(span, 'gen_ai.provider.name')) {
			try {
				const providerStr = String(provider);
				if (providerStr) {
					span.setAttribute('gen_ai.provider.name', providerStr);
				}
			} catch (e) {
				console.debug('AIQA: Failed to set provider attribute on span', e);
			}
		}
	} catch (e) {
		// Catch any other exceptions to ensure this never derails tracing
		console.debug('AIQA: Error in extractAndSetProviderAndModel', e);
	}
}

export function getActiveSpan() {
	ensureTracingInitialized();
	return trace.getActiveSpan();
}

/**
 * Set the gen_ai.conversation.id attribute on the active span.
 * This allows you to group multiple traces together that are part of the same conversation.
 * See https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/ for more details.
 * 
 * @param conversationId - A unique identifier for the conversation (e.g., user session ID, chat ID, etc.)
 * @returns True if gen_ai.conversation.id was set, False if no active span found
 * 
 * @example
 * ```typescript
 * import { withTracing, setConversationId } from './src/tracing';
 * 
 * const tracedFn = withTracing(function handleUserRequest(userId: string, request: any) {
 *   // Set conversation ID to group all traces for this user session
 *   setConversationId(`user_${userId}_session_${request.sessionId}`);
 *   // ... rest of function
 * });
 * ```
 */
export function setConversationId(conversationId: string): boolean {
	return setSpanAttribute('gen_ai.conversation.id', conversationId);
}

/**
 * Set token usage attributes on the active span using OpenTelemetry semantic conventions for gen_ai.
 * This allows you to explicitly record token usage information.
 * See https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/ for more details.
 * 
 * @param inputTokens - Number of input tokens used (maps to gen_ai.usage.input_tokens)
 * @param outputTokens - Number of output tokens generated (maps to gen_ai.usage.output_tokens)
 * @param totalTokens - Total number of tokens used (maps to gen_ai.usage.total_tokens)
 * @returns True if at least one token usage attribute was set, False if no active span found
 * 
 * @example
 * ```typescript
 * import { withTracing, setTokenUsage } from './src/tracing';
 * 
 * const tracedFn = withTracing(function callLLM(prompt: string) {
 *   const response = await openaiClient.chat.completions.create(...);
 *   // Explicitly set token usage
 *   setTokenUsage(
 *     response.usage.prompt_tokens,
 *     response.usage.completion_tokens,
 *     response.usage.total_tokens
 *   );
 *   return response;
 * });
 * ```
 */
export function setTokenUsage(
	inputTokens?: number | null,
	outputTokens?: number | null,
	totalTokens?: number | null
): boolean {
	const span = trace.getActiveSpan();
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

/**
 * Set provider and model attributes on the active span using OpenTelemetry semantic conventions for gen_ai.
 * This allows you to explicitly record provider and model information.
 * See https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/ for more details.
 * 
 * @param provider - Name of the AI provider (e.g., "openai", "anthropic", "google") (maps to gen_ai.provider.name)
 * @param model - Name of the model used (e.g., "gpt-4", "claude-3-5-sonnet") (maps to gen_ai.request.model)
 * @returns True if at least one attribute was set, False if no active span found
 * 
 * @example
 * ```typescript
 * import { withTracing, setProviderAndModel } from './src/tracing';
 * 
 * const tracedFn = withTracing(function callLLM(prompt: string) {
 *   const response = await openaiClient.chat.completions.create(...);
 *   // Explicitly set provider and model
 *   setProviderAndModel("openai", response.model);
 *   return response;
 * });
 * ```
 */
export function setProviderAndModel(
	provider?: string | null,
	model?: string | null
): boolean {
	const span = trace.getActiveSpan();
	if (!span) {
		return false;
	}
	
	let setCount = 0;
	try {
		if (provider != null && provider !== '') {
			span.setAttribute('gen_ai.provider.name', String(provider));
			setCount++;
		}
		if (model != null && model !== '') {
			span.setAttribute('gen_ai.request.model', String(model));
			setCount++;
		}
	} catch (e) {
		console.warn('AIQA: Failed to set provider/model attributes:', e);
		return false;
	}
	
	return setCount > 0;
}

/**
 * Set the component tag that will be added to all spans created by AIQA.
 * This can also be set via the AIQA_COMPONENT_TAG environment variable.
 * The component tag allows you to identify which component/system generated the spans.
 * 
 * @param tag - A component identifier (e.g., "mynamespace.mysystem", "backend.api", etc.)
 * 
 * @example
 * ```typescript
 * import { setComponentTag } from './src/tracing';
 * 
 * // Set component tag programmatically
 * setComponentTag("mynamespace.mysystem");
 * 
 * // Or set via environment variable:
 * // export AIQA_COMPONENT_TAG="mynamespace.mysystem"
 * ```
 */
export function setComponentTag(tag: string): void {
	componentTag = tag;
}

/**
 * Get the current trace ID as a hexadecimal string (32 characters).
 * 
 * @returns The trace ID as a hex string, or undefined if no active span exists.
 * 
 * @example
 * ```typescript
 * const traceId = getTraceId();
 * // Pass traceId to another service/agent
 * // e.g., include in HTTP headers, message queue metadata, etc.
 * ```
 */
export function getTraceId(): string | undefined {
	ensureTracingInitialized();
	const span = trace.getActiveSpan();
	if (span) {
		const spanContext = span.spanContext();
		if (spanContext.traceId && spanContext.traceId !== '00000000000000000000000000000000') {
			return spanContext.traceId;
		}
	}
	return undefined;
}

/**
 * Get the current span ID as a hexadecimal string (16 characters).
 * 
 * @returns The span ID as a hex string, or undefined if no active span exists.
 * 
 * @example
 * ```typescript
 * const spanId = getSpanId();
 * // Can be used to create child spans in other services
 * ```
 */
export function getSpanId(): string | undefined {
	ensureTracingInitialized();
	const span = trace.getActiveSpan();
	if (span) {
		const spanContext = span.spanContext();
		if (spanContext.spanId && spanContext.spanId !== '0000000000000000') {
			return spanContext.spanId;
		}
	}
	return undefined;
}

/**
 * Create a new span that continues from an existing trace ID.
 * This is useful for linking traces across different services or agents.
 * 
 * @param traceId - The trace ID as a hexadecimal string (32 characters)
 * @param parentSpanId - Optional parent span ID as a hexadecimal string (16 characters).
 *   If provided, the new span will be a child of this span.
 * @param spanName - Name for the new span (default: "continued_span")
 * @returns A new span that continues the trace. Use it in a context manager or call end() manually.
 * 
 * @example
 * ```typescript
 * // In service A: get trace ID
 * const traceId = getTraceId();
 * const spanId = getSpanId();
 * 
 * // Send to service B (e.g., via HTTP, message queue, etc.)
 * // ...
 * 
 * // In service B: continue the trace
 * const span = createSpanFromTraceId(traceId, parentSpanId, "service_b_operation");
 * context.with(trace.setSpan(context.active(), span), () => {
 *   // Your code here
 *   span.end();
 * });
 * ```
 */
export function createSpanFromTraceId(
	traceId: string,
	parentSpanId?: string,
	spanName: string = "continued_span"
) {
	ensureTracingInitialized();
		if (!tracer) {
			// Fallback: create a basic span if tracer not available
			const span = trace.getTracer('aiqa-tracer').startSpan(spanName);
			if (componentTag) {
				span.setAttribute('gen_ai.component.id', componentTag);
			}
			return span;
		}
	
	try {
		// Create a parent span context
		const parentSpanContext: SpanContext = {
			traceId: traceId,
			spanId: parentSpanId || '0000000000000000',
			traceFlags: TraceFlags.SAMPLED,
			isRemote: true,
		};
		
		// Create a context with this span context as the parent
		const parentContext = trace.setSpanContext(context.active(), parentSpanContext);
		
		// Start a new span in this context (it will be a child of the parent span)
		const span = tracer.startSpan(spanName, { root: false }, parentContext);
		
		// Set component tag if configured
		if (componentTag) {
			span.setAttribute('gen_ai.component.id', componentTag);
		}
		
		return span;
	} catch (error) {
		console.error('AIQA: Error creating span from trace_id:', error instanceof Error ? error.message : String(error));
		// Fallback: new root span (not linked to requested trace). Do not mutate module-level tracer.
		const fallbackTracer = tracer ?? trace.getTracer('aiqa-tracer');
		const span = fallbackTracer.startSpan(spanName);
		if (componentTag) {
			span.setAttribute('gen_ai.component.id', componentTag);
		}
		return span;
	}
}

/**
 * Inject the current trace context into a carrier (e.g., HTTP headers).
 * This allows you to pass trace context to another service.
 * 
 * @param carrier - Object to inject trace context into (e.g., HTTP headers object)
 * 
 * @example
 * ```typescript
 * import axios from 'axios';
 * 
 * const headers: Record<string, string> = {};
 * injectTraceContext(headers);
 * const response = await axios.get("http://other-service/api", { headers });
 * ```
 */
export function injectTraceContext(carrier: Record<string, string>): void {
	try {
		propagation.inject(context.active(), carrier);
	} catch (error) {
		console.warn('AIQA: Error injecting trace context:', error);
	}
}

/**
 * Extract trace context from a carrier (e.g., HTTP headers).
 * Use this to continue a trace that was started in another service.
 * 
 * @param carrier - Object containing trace context (e.g., HTTP headers object)
 * @returns A context object that can be used with trace.setSpan() or tracer.startSpan()
 * 
 * @example
 * ```typescript
 * // Extract context from incoming request headers
 * const ctx = extractTraceContext(request.headers);
 * 
 * // Use the context to create a span
 * const span = tracer.startSpan("operation", {}, ctx);
 * context.with(trace.setSpan(ctx, span), () => {
 *   // Your code here
 *   span.end();
 * });
 * ```
 */
export function extractTraceContext(carrier: Record<string, string>) {
	try {
		return propagation.extract(context.active(), carrier);
	} catch (error) {
		console.warn('AIQA: Error extracting trace context:', error);
		return context.active();
	}
}

function resolveServerUrl(serverUrl?: string): string {
	return (serverUrl || process.env.AIQA_SERVER_URL || 'https://server-aiqa.winterwell.com').replace(/\/$/, '');
}

function buildApiHeaders(apiKey?: string): Record<string, string> {
	const key = apiKey || process.env.AIQA_API_KEY || '';
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'Accept-Encoding': 'gzip, deflate, br',
	};
	if (key) {
		headers['Authorization'] = `ApiKey ${key}`;
	}
	return headers;
}

/**
 * Get a span by its ID from the AIQA server.
 * 
 * @param spanId - The span ID as a hexadecimal string (16 characters) or client span ID
 * @param organisationId - Optional. When using API key auth the server derives organisation from the key.
 *   Pass this (or set AIQA_ORGANISATION_ID) only when the server expects it (e.g. some JWT flows).
 * @returns Promise that resolves to the span data, or undefined if not found
 * 
 * @example
 * ```typescript
 * import { getSpan } from './src/tracing';
 * 
 * const span = await getSpan('abc123...');
 * if (span) {
 *   console.log('Found span:', span.name);
 * }
 * ```
 */
export async function getSpan(spanId: string, organisationId?: string): Promise<any | undefined> {
	const serverUrl = resolveServerUrl();
	const orgId = organisationId || process.env.AIQA_ORGANISATION_ID || '';

	if (!serverUrl) {
		console.warn('AIQA: AIQA_SERVER_URL is not set. Cannot retrieve span.');
		return undefined;
	}

	// Server uses GET /span?q=id:xxx (search). For API key auth, organisation is derived from the key.
	const queryParams = new URLSearchParams({ q: `id:${spanId}` });
	if (orgId) {
		queryParams.set('organisation', orgId);
	}
	const url = `${serverUrl}/span?${queryParams.toString()}`;

	const response = await fetch(url, { method: 'GET', headers: buildApiHeaders() });

	if (response.status === 200) {
		const result = await response.json();
		const hits = result.hits || [];
		if (hits.length > 0) {
			return hits[0];
		}
	} else if (response.status === 404) {
		return undefined;
	} else {
		const errorText = await response.text().catch(() => 'Unknown error');
		console.warn(`AIQA: Failed to get span: ${response.status} - ${errorText.substring(0, 200)}`);
	}

	return undefined;
}

/**
 * Submit feedback for a trace by creating a new span with the same trace ID.
 * This allows you to add feedback (thumbs-up, thumbs-down, comment) to a trace after it has completed.
 * 
 * @param thumbsUp - true -> value:positive, false -> value:negative, undefined -> value:neutral
 * @param traceId - The trace ID as a hexadecimal string (32 characters)
 * @param feedback - Feedback object with:
 *   - thumbsUp: true for positive feedback, false for negative feedback, undefined for neutral
 *   - comment: Optional text comment
 * @returns Promise that resolves when the feedback span has been created and flushed
 * 
 * @example
 * ```typescript
 * import { submitFeedback } from './src/tracing';
 * 
 * // Submit positive feedback
 * await submitFeedback('abc123...', { thumbsUp: true, comment: 'Great response!' });
 * 
 * // Submit negative feedback
 * await submitFeedback('abc123...', { thumbsUp: false, comment: 'Incorrect answer' });
 * ```
 */
export async function submitFeedback(
	traceId: string,
	feedback: { thumbsUp?: boolean; comment?: string }
): Promise<void> {
	if (!traceId || traceId.length !== 32) {
		throw new Error('Invalid trace ID: must be 32 hexadecimal characters');
	}

	// Create a span for feedback with the same trace ID
	const span = createSpanFromTraceId(traceId, undefined, 'feedback');
	
	// Use the span in context
	return context.with(trace.setSpan(context.active(), span), async () => {
		try {
			// Set feedback attributes
			if (feedback.thumbsUp !== undefined) {
				span.setAttribute('feedback.value', feedback.thumbsUp ? 'positive' : 'negative');
			} else {
				span.setAttribute('feedback.value', 'neutral');
			}
			
			if (feedback.comment) {
				span.setAttribute('feedback.comment', feedback.comment);
			}
			
			// Mark as feedback span
			span.setAttribute(GEN_AI_OPERATION_NAME, 'feedback');
			
			// End the span
			span.end();
			
			// Flush to ensure it's sent immediately
			await flushSpans();
		} catch (error) {
			span.end();
			throw error;
		}
	});
}

/**
 * Get organisation information based on API key via an API call.
 * 
 * @param organisationId - ID of the organisation to retrieve
 * @param serverUrl - Optional server URL (defaults to AIQA_SERVER_URL env var)
 * @param apiKey - Optional API key (defaults to AIQA_API_KEY env var)
 * @returns Promise that resolves to the organisation object
 * 
 * @example
 * ```typescript
 * import { getOrganisation } from './src/tracing';
 * 
 * const org = await getOrganisation('org-123');
 * console.log('Organisation:', org.name);
 * ```
 */
export async function getOrganisation(
	organisationId: string,
	serverUrl?: string,
	apiKey?: string
): Promise<any> {
	const url = resolveServerUrl(serverUrl);
	
	const response = await fetch(`${url}/organisation/${organisationId}`, {
		method: 'GET',
		headers: buildApiHeaders(apiKey),
	});
	
	if (!response.ok) {
		const errorText = await response.text().catch(() => 'Unknown error');
		throw new Error(`Failed to get organisation: ${response.status} ${response.statusText} - ${errorText}`);
	}
	
	return await response.json();
}

/**
 * Get API key information via an API call.
 * 
 * @param apiKeyId - ID of the API key to retrieve
 * @param serverUrl - Optional server URL (defaults to AIQA_SERVER_URL env var)
 * @param apiKey - Optional API key (defaults to AIQA_API_KEY env var)
 * @returns Promise that resolves to the API key object
 * 
 * @example
 * ```typescript
 * import { getAPIKeyInfo } from './src/tracing';
 * 
 * const keyInfo = await getAPIKeyInfo('key-123');
 * console.log('API Key:', keyInfo.name);
 * ```
 */
export async function getAPIKeyInfo(
	apiKeyId: string,
	serverUrl?: string,
	apiKey?: string
): Promise<any> {
	const url = resolveServerUrl(serverUrl);
	
	const response = await fetch(`${url}/api-key/${apiKeyId}`, {
		method: 'GET',
		headers: buildApiHeaders(apiKey),
	});
	
	if (!response.ok) {
		const errorText = await response.text().catch(() => 'Unknown error');
		throw new Error(`Failed to get api key info: ${response.status} ${response.statusText} - ${errorText}`);
	}
	
	return await response.json();
}
