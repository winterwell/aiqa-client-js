/**
 * Public tracing facade.
 * Internal implementation is split into focused modules for DRY/KISS maintainability.
 */

export {
	getAIQAClient,
	flushSpans,
	shutdownTracing,
	getProvider,
	getExporter,
	isTracingEnabled,
} from './tracing/runtime';

export { withTracing, withTracingAsync } from './tracing/wrappers';
export type { TracingOptions } from './tracing/wrappers';

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
} from './tracing/span-helpers';

export { getSpan, submitFeedback, getOrganisation, getAPIKeyInfo } from './tracing/http';
