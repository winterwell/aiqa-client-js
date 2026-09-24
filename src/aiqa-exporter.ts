/**
 * OpenTelemetry span exporter that sends spans to the AIQA server's OTLP endpoint
 * (`POST /v1/traces`, JSON encoding - see otlp-json.ts for why we serialise it here
 * rather than using OpenTelemetry's OTLP exporter).
 * Buffers spans and flushes them periodically or on shutdown.
 */

import { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { ExportResult, ExportResultCode } from '@opentelemetry/core';
import { filterDataRecursive } from './data-filters';
import { getConfig } from './tracing/config';
import { toOtlpTraceRequest, type InternalSpanForOtlp } from './otlp-json';

/** OTLP/HTTP trace ingest, the server's only span-upload route. */
const OTLP_TRACES_PATH = '/v1/traces';

/** Settings that can be changed on a running exporter - see {@link AIQASpanExporter.configure}. */
export interface AIQASpanExporterOptions {
  serverUrl?: string;
  apiKey?: string;
  /** Auto-flush interval. 0 or less turns the timer off, leaving flushing to the caller. */
  flushIntervalSeconds?: number;
}

/** The internal span shape: what the buffer holds, and what otlp-json.ts serialises. */
type SerializableSpan = InternalSpanForOtlp;

/**
 * Exports spans to AIQA server. Buffers spans and auto-flushes every flushIntervalSeconds.
 * Call shutdown() before process exit to flush remaining spans.
 */
export class AIQASpanExporter implements SpanExporter {
  private serverUrl: string;
  private apiKey: string;
  private flushIntervalMs: number;
  private maxBatchSizeBytes: number = 5 * 1024 * 1024; // 5MB default
  private maxBufferSpans: number = 10000; // Maximum spans to buffer (prevents unbounded growth)
  private buffer: SerializableSpan[] = [];
  private bufferSpanKeys: Set<string> = new Set(); // Track (trace_id, id) tuples to prevent duplicates
  private flushTimer?: ReturnType<typeof setInterval>;
  private flushLock: Promise<void> = Promise.resolve();
  private shutdownRequested: boolean = false;

  /**
   * Anything omitted falls back to the resolved client config (see tracing/config.ts),
   * which is the single place the `AIQA_*` env vars and `initTracing` overrides are read.
   * The tracing runtime always passes all three; the defaults are for callers wiring the
   * exporter into their own TracerProvider.
   */
  constructor(serverUrl?: string, apiKey?: string, flushIntervalSeconds?: number) {
    const config = getConfig();
    this.serverUrl = (serverUrl ?? config.serverUrl).replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey ?? config.apiKey;
    this.flushIntervalMs = (flushIntervalSeconds ?? config.flushIntervalSeconds) * 1000;
    this.startAutoFlush();
  }

  /**
   * Update credentials, endpoint or flush interval on a running exporter.
   *
   * Reconfiguring beats replacing the exporter: a span processor cannot be detached
   * from a TracerProvider, so a replacement would leave the old exporter wired in.
   * Buffered spans are kept and sent with the new settings.
   */
  configure(options: AIQASpanExporterOptions): void {
    if (options.serverUrl !== undefined) {
      this.serverUrl = options.serverUrl.replace(/\/$/, '');
    }
    if (options.apiKey !== undefined) {
      this.apiKey = options.apiKey;
    }
    if (options.flushIntervalSeconds !== undefined) {
      const intervalMs = options.flushIntervalSeconds * 1000;
      if (intervalMs !== this.flushIntervalMs) {
        this.flushIntervalMs = intervalMs;
        if (!this.shutdownRequested) {
          this.startAutoFlush();
        }
      }
    }
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (spans.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    // Call callback immediately to avoid timeout
    resultCallback({ code: ExportResultCode.SUCCESS });
    
    // Buffer them; flush() sends them.
    this.addToBuffer(spans);
  }

  /**
   * Add spans to the buffer.
   * Deduplicates spans based on (traceId, spanId) to prevent repeated exports.
   * Drops spans if buffer exceeds maxBufferSpans to prevent unbounded memory growth.
   */
  private addToBuffer(spans: ReadableSpan[]): void {
    let duplicatesCount = 0;
    let droppedCount = 0;
    for (const span of spans) {
      if (this.buffer.length >= this.maxBufferSpans) {
        droppedCount++;
        continue;
      }
      const serialized = this.serializeSpan(span);
      const spanKey = `${serialized.trace_id}:${serialized.id}`;
      if (this.bufferSpanKeys.has(spanKey)) {
        duplicatesCount++;
        continue;
      }
      this.bufferSpanKeys.add(spanKey);
      this.buffer.push(serialized);
    }

    if (droppedCount > 0) {
      console.warn(
        `AIQA: WARNING: Buffer full (${this.buffer.length} spans), dropped ${droppedCount} span(s). ` +
        `Consider increasing maxBufferSpans or fixing server connectivity.`
      );
    }
    if (duplicatesCount > 0) {
      console.debug(`AIQA: export() skipped ${duplicatesCount} duplicate(s). Total buffered: ${this.buffer.length}`);
    }
  }


  /**
   * Convert HrTime tuple [seconds, nanoseconds] to epoch milliseconds
   */
  private hrTimeToMillis(hrTime: [number, number]): number {
    return hrTime[0] * 1000 + Math.floor(hrTime[1] / 1_000_000);
  }

  /**
   * The parent span id, from either OpenTelemetry SDK generation.
   *
   * 1.x has `parentSpanId: string`; 2.x replaced it with
   * `parentSpanContext?: SpanContext`. Reading only one shape silently produced
   * `parent_span_id: undefined` against the other, which flattens the trace tree on the
   * server - and the exporter does not control which SDK it is attached to, since it can
   * be wired into a provider the host application registered.
   */
  private parentSpanId(span: ReadableSpan): string | undefined {
    const asAny = span as any;
    return asAny.parentSpanContext?.spanId ?? asAny.parentSpanId;
  }

  /** Likewise `instrumentationLibrary` (1.x) vs `instrumentationScope` (2.x). */
  private instrumentationScope(span: ReadableSpan): { name: string; version?: string } | undefined {
    const asAny = span as any;
    return asAny.instrumentationScope ?? asAny.instrumentationLibrary;
  }

  /**
   * Convert ReadableSpan to a serializable format
   */
  private serializeSpan(span: ReadableSpan): SerializableSpan {
    const spanContext = span.spanContext();
    const startTime = this.hrTimeToMillis(span.startTime);
    const endTime = span.endTime ? this.hrTimeToMillis(span.endTime) : undefined;

    return {
      name: span.name,
      kind: span.kind,
      parent_span_id: this.parentSpanId(span),
      start_time: startTime,
      end_time: endTime,
      status: {
        code: span.status.code,
        message: span.status.message,
      },
      attributes: filterDataRecursive(span.attributes),
      links: span.links.map(link => ({
        context: {
          traceId: link.context.traceId,
          spanId: link.context.spanId,
        },
        attributes: filterDataRecursive(link.attributes),
      })),
      events: span.events.map(event => ({
        name: event.name,
        time: this.hrTimeToMillis(event.time),
        attributes: filterDataRecursive(event.attributes),
      })),
      resource: {
        attributes: filterDataRecursive(span.resource.attributes),
      },
      trace_id: spanContext.traceId,
      id: spanContext.spanId,
      traceFlags: spanContext.traceFlags,
      instrumentationLibrary: this.instrumentationScope(span),
    };
  }

  /**
   * Flush buffered spans to the server. Flushes are queued, so only one runs at a time
   * and each sends whatever was buffered when it started.
   *
   * A batch that fails to send is dropped, not retried, as OpenTelemetry's own exporters
   * do: retrying a batch the server rejected (a 400, say) would fail again every interval.
   * Errors are logged; they are only thrown during shutdown, so the caller can see them.
   */
  flush(): Promise<void> {
    const run = this.flushLock.then(() => this.flushNow());
    this.flushLock = run.catch(() => undefined);
    return run;
  }

  private async flushNow(): Promise<void> {
    const spansToFlush = this.buffer.splice(0);
    // Dedup only guards what is in the buffer: once taken, a span is sent or dropped.
    this.bufferSpanKeys.clear();
    if (spansToFlush.length === 0) {
      return;
    }

    if (!this.serverUrl) {
      console.warn(`AIQA: Skipping flush: AIQA_SERVER_URL is not set. ${spansToFlush.length} span(s) will not be sent.`);
      return;
    }
    // Without an API key the server will reject every batch. This is the state after
    // tracing is disabled at runtime.
    if (!this.apiKey) {
      console.warn(`AIQA: Skipping flush: no API key. ${spansToFlush.length} span(s) will not be sent.`);
      return;
    }

    const batches = this.splitIntoBatches(spansToFlush);
    const errors: string[] = [];
    for (let i = 0; i < batches.length; i++) {
      try {
        await this.sendSpans(batches[i]);
      } catch (error: any) {
        errors.push(`batch ${i + 1}/${batches.length} (${batches[i].length} spans): ${error?.message ?? error}`);
      }
    }
    if (errors.length > 0) {
      const message = `AIQA: Failed to send spans, which have been dropped: ${errors.join('; ')}`;
      console.error(message);
      if (this.shutdownRequested) {
        throw new Error(message);
      }
    }
  }

  /**
   * Split spans into batches based on maxBatchSizeBytes.
   * Each batch will be as large as possible without exceeding the limit.
   * If a single span exceeds the limit, it will be sent in its own batch with a warning.
   */
  private splitIntoBatches(spans: SerializableSpan[]): SerializableSpan[][] {
    if (spans.length === 0) {
      return [];
    }

    const batches: SerializableSpan[][] = [];
    let currentBatch: SerializableSpan[] = [];
    let currentBatchSize = 0;

    for (const span of spans) {
      // Estimate size of this span when serialized
      const spanJSON = JSON.stringify(span);
      const spanSize = new Blob([spanJSON]).size; // Use Blob to get accurate byte size

      // Check if this single span exceeds the limit
      if (spanSize > this.maxBatchSizeBytes) {
        // If we have a current batch, save it first
        if (currentBatch.length > 0) {
          batches.push(currentBatch);
          currentBatch = [];
          currentBatchSize = 0;
        }

        // Log warning about oversized span
        console.warn(
          `AIQA: Span '${span.name}' (trace_id=${span.trace_id}) exceeds maxBatchSizeBytes ` +
          `(${spanSize} bytes > ${this.maxBatchSizeBytes} bytes). Will attempt to send it anyway.`
        );
        // Still create a batch with just this span - we'll try to send it
        batches.push([span]);
        continue;
      }

      // If adding this span would exceed the limit, start a new batch
      if (currentBatch.length > 0 && currentBatchSize + spanSize > this.maxBatchSizeBytes) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchSize = 0;
      }

      currentBatch.push(span);
      currentBatchSize += spanSize;
    }

    // Add the last batch if it has any spans
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }

  /**
   * Send spans to the server's OTLP ingest endpoint.
   */
  private async sendSpans(spans: SerializableSpan[]): Promise<void> {
    const response = await fetch(`${this.serverUrl}${OTLP_TRACES_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(toOtlpTraceRequest(spans)),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to send spans: ${response.status} ${response.statusText} - ${errorText}`);
    }
  }

  /**
   * Start the auto-flush timer. A flush interval of 0 or less turns it off, which is
   * what you want where a timer cannot be relied on anyway - an MV3 service worker can
   * be suspended at any point, so flush explicitly at the end of each unit of work.
   */
  private startAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.flushIntervalMs <= 0) {
      return;
    }

    this.flushTimer = setInterval(() => {
      if (!this.shutdownRequested) {
        // flush() logs its own errors and only throws during shutdown.
        void this.flush().catch(() => undefined);
      }
    }, this.flushIntervalMs);
    
    // Unref the timer so it doesn't prevent process exit. This allows the exporter to
    // work as a daemon that won't block normal exit. Browsers return a number from
    // setInterval, hence the typeof guard.
    const timer = this.flushTimer as any;
    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  /**
   * Shutdown the exporter, flushing any remaining spans. Call before process exit.
   */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }

    // Flush any remaining spans
    await this.flush();
  }
}
