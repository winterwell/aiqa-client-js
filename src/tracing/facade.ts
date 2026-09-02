/**
 * Platform-neutral tracing facade. Nothing reachable from here imports a Node built-in,
 * so this is what the browser entry point (src/browser.ts) is built from.
 *
 * The Node facade is src/tracing.ts: the same surface, plus the Node platform setup.
 */

export {
	initTracing,
	getAIQAClient,
	flushSpans,
	shutdownTracing,
	getProvider,
	getExporter,
	isTracingEnabled,
	getTracingConfig,
} from './runtime';
export type { AIQAConfig, InitTracingOptions } from './config';

export { withTracing, withTracingAsync } from './wrappers';
export type { TracingOptions } from './wrappers';

export { startSpan } from './spans';
export type { StartSpanOptions, SpanParent } from './spans';

export {
	setSpanAttribute,
	getActiveSpan,
	setConversationId,
	setTokenUsage,
	setProviderAndModel,
	setComponentTag,
	getTraceId,
	getSpanId,
	createSpanFromTraceId,
	injectTraceContext,
	extractTraceContext,
} from './span-helpers';

export { getSpan, submitFeedback, getOrganisation, getAPIKeyInfo } from './http';
