/**
 * Public entry point for the aiqa-client package.
 *
 * This file defines the package's supported surface. It is also the build entry
 * point (see tsconfig.build.json): only modules reachable from here are compiled
 * and shipped, which keeps the unused parts of the vendored src/common out of the
 * published tarball.
 */

// Tracing facade - see src/tracing.ts
export {
	getAIQAClient,
	flushSpans,
	shutdownTracing,
	getProvider,
	getExporter,
	isTracingEnabled,
	withTracing,
	withTracingAsync,
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
	getSpan,
	submitFeedback,
	getOrganisation,
	getAPIKeyInfo,
} from './tracing';
export type { TracingOptions } from './tracing';

// Span exporter, for callers wiring up their own OpenTelemetry provider
export { AIQASpanExporter } from './aiqa-exporter';

// Experiments and local metric scoring
export { ExperimentRunner } from './ExperimentRunner';
export type { ExperimentRunnerOptions, ScoreResult } from './ExperimentRunner';
export { scoreMetric, scoreAllMetrics } from './localScoring';

// Shared AIQA types that appear in the signatures above, so callers can type
// their own code against them. Canonical source is aiqa/server/src/common -
// see CLAUDE.md; do not edit src/common.
export type { default as Example } from './common/types/Example';
export type { default as Dataset } from './common/types/Dataset';
export type { default as Metric } from './common/types/Metric';
export type { default as Experiment, MetricStats } from './common/types/Experiment';
export type { default as Span } from './common/types/Span';
