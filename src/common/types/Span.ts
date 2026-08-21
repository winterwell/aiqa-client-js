// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.

import { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type EmbeddingMeta from './EmbeddingMeta.js';

/**
 * Stored on spans as attributes.feedback.{value,comment}
 */
export interface Feedback {
  value: 'positive' | 'negative' | 'neutral';
  comment?: string;
}

/** aggregate stats for a span and its children 
 */
export interface SpanStats {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationTokens?: number;
  totalTokens?: number;
  /** USD */
  cost?: number;
  /**
   * Time to first output token in seconds.
   * This is derived from `gen_ai.server.time_to_first_output_token` and propagated up the span tree
   * so ancestor spans can expose the outermost agent-call value.
   */
  timeToFirstOutputToken?: number;
  /** sum(child error counts) || 1 if this span has an error status 
   * This is an estimate at distinct errors, where we assume that errors normally get passed up the tree in code.
  */
  errors?: number;
  /** how many spans below this one in the tree? */
  descendants?: number;
  /** duration in milliseconds (we could derive this from start/end, but storing it here allows for easier aggregation, including within ES)*/
  duration?: number;
}
/**
 * Span type extending OpenTelemetry's ReadableSpan interface.
 * Represents a completed span that can be read and exported.
 * AIQA defines some special attributes: see constants_otel.ts
 */
export default interface Span extends Omit<ReadableSpan, 'startTime' | 'endTime' | 'parentSpanId'> {
  /** Span ID (OpenTelemetry span ID as hex string) */
  id: string;
  /** Trace ID */
  trace: string;
  /** Parent span ID */
  parent?: string;
  organisation: string;
  /** Example.id Only set if (a) an Example is created from this Span, or (b) this Span is created during an experiment running an Example 
   * @deprecated Use attributes['aiqa.example'] instead
  */
  example?: string;
  /** Client-set annotations for the span (for things more complex than a tag) */
  annotations?: Record<string, any>;
  /** token usage etc computed from this + descendants */
  stats?: SpanStats;
  /**
   * Track child stats for non-leaf spans to avoid double-counting.
   */
  _childStats?: Record<string, SpanStats>;
  /** Hash of the input for looking up same-input spans */
  inputHash?: string;
  /** Start time in epoch milliseconds (overrides ReadableSpan's HrTime format) */
  start: number;
  /** End time in epoch milliseconds (overrides ReadableSpan's HrTime format) */
  end: number;
  /** Primary cached embedding (default slot). Omitted from default GET /span responses. */
  embedding_1?: number[];
  embeddingMeta_1?: EmbeddingMeta;
  /** Secondary embedding slot. Omitted from default GET responses. */
  embedding_2?: number[];
  embeddingMeta_2?: EmbeddingMeta;
}

export function getSpanInput(span: Span) {
  return span.attributes?.input;
}
export function getSpanOutput(span: Span) {
  return span.attributes?.output;
}

// Utility functions for fields with non-standard names (to modularise that logic and keep it in one place)
/** Span ID. Use our id field only (which is different from the OpenTelemetry spanId field). */
export const getSpanId = (span: Span): string | undefined => (span as any)?.id;

/** Trace ID. Use our trace field only (which is different from the OpenTelemetry traceId field). */
export const getTraceId = (span: Span): string | undefined => (span as any)?.trace;

/** Parent span ID. Use our parent field only (which is different from the OpenTelemetry parentSpanId field). */
export const getParentSpanId = (span: Span): string | null => span.parent ?? null;

