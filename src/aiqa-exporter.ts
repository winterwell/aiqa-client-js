/**
 * OpenTelemetry span exporter that sends spans to the AIQA server API.
 * Buffers spans and flushes them periodically or on shutdown. Thread-safe.
 */

import { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { ExportResult, ExportResultCode } from '@opentelemetry/core';

interface SerializableSpan {
  name: string;
  kind: number;
  parentSpanId?: string;
  startTime: [number, number];
  endTime: [number, number];
  status: {
    code: number;
    message?: string;
  };
  attributes: Record<string, any>;
  links: Array<{
    context: {
      traceId: string;
      spanId: string;
    };
    attributes?: Record<string, any>;
  }>;
  events: Array<{
    name: string;
    time: [number, number];
    attributes?: Record<string, any>;
  }>;
  resource: {
    attributes: Record<string, any>;
  };
  traceId: string;
  spanId: string;
  traceFlags: number;
  duration: [number, number];
  ended: boolean;
  instrumentationLibrary: {
    name: string;
    version?: string;
  };
}

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
  private bufferSpanKeys: Set<string> = new Set(); // Track (traceId, spanId) tuples to prevent duplicates
  private flushTimer?: NodeJS.Timeout;
  private flushLock: Promise<void> = Promise.resolve();
  private shutdownRequested: boolean = false;

  constructor(
    serverUrl: string = 'http://localhost:3000',
    apiKey: string = process.env.AIQA_API_KEY || '',
    flushIntervalSeconds: number = 5
  ) {
    this.serverUrl = serverUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey;
    this.flushIntervalMs = flushIntervalSeconds * 1000;
    this.startAutoFlush();
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (spans.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    // Call callback immediately to avoid timeout
    resultCallback({ code: ExportResultCode.SUCCESS });
    
    // Add spans to buffer (thread-safe)
    this.addToBuffer(spans);
  }

  /**
   * Add spans to the buffer in a thread-safe manner.
   * Deduplicates spans based on (traceId, spanId) to prevent repeated exports.
   * Drops spans if buffer exceeds maxBufferSpans to prevent unbounded memory growth.
   */
  private addToBuffer(spans: ReadableSpan[]): void {
    let duplicatesCount = 0;
    let droppedCount = 0;
    const serializedSpans: SerializableSpan[] = [];
    
    for (const span of spans) {
      // Check if buffer is full (prevent unbounded growth)
      if (this.buffer.length >= this.maxBufferSpans) {
        droppedCount++;
        continue;
      }
      
      const serialized = this.serializeSpan(span);
      const spanKey = `${serialized.traceId}:${serialized.spanId}`;
      
      if (!this.bufferSpanKeys.has(spanKey)) {
        serializedSpans.push(serialized);
        this.bufferSpanKeys.add(spanKey);
      } else {
        duplicatesCount++;
      }
    }
    
    this.buffer.push(...serializedSpans);
    
    if (droppedCount > 0) {
      console.warn(
        `AIQA: WARNING: Buffer full (${this.buffer.length} spans), dropped ${droppedCount} span(s). ` +
        `Consider increasing maxBufferSpans or fixing server connectivity.`
      );
    }
    if (duplicatesCount > 0) {
      console.debug(`AIQA: export() added ${serializedSpans.length} span(s) to buffer, skipped ${duplicatesCount} duplicate(s). Total buffered: ${this.buffer.length}`);
    }
  }

  /**
   * Get enabled filters from AIQA_DATA_FILTERS env var
   */
  private getEnabledFilters(): Set<string> {
    const filtersEnv = process.env.AIQA_DATA_FILTERS || "RemovePasswords, RemoveJWT";
    if (!filtersEnv) {
      return new Set();
    }
    return new Set(filtersEnv.split(',').map(f => f.trim()).filter(f => f));
  }

  /**
   * Check if a value looks like a JWT token
   */
  private isJWTToken(value: any): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    // JWT tokens have format: header.payload.signature (3 parts separated by dots)
    // They typically start with "eyJ" (base64 encoded '{"')
    const parts = value.split('.');
    return parts.length === 3 && value.startsWith('eyJ') && parts.every(p => p.length > 0);
  }

  /**
   * Check if a value looks like an API key
   */
  private isAPIKey(value: any): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    const trimmed = value.trim();
    // Common API key prefixes
    const apiKeyPrefixes = ['sk-', 'pk-', 'AKIA', 'ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_'];
    return apiKeyPrefixes.some(prefix => trimmed.startsWith(prefix));
  }

  /**
   * Apply data filters to a key-value pair
   */
  private applyDataFilters(key: string, value: any): any {
    // Don't filter falsy values
    if (!value) {
      return value;
    }
    
    const enabledFilters = this.getEnabledFilters();
    const keyLower = key.toLowerCase();
    
    // RemovePasswords filter: if key contains "password", replace value with "****"
    if (enabledFilters.has('RemovePasswords') && keyLower.includes('password')) {
      return '****';
    }
    
    // RemoveJWT filter: if value looks like a JWT token, replace with "****"
    if (enabledFilters.has('RemoveJWT') && this.isJWTToken(value)) {
      return '****';
    }
    
    // RemoveAuthHeaders filter: if key is "authorization" (case-insensitive), replace value with "****"
    if (enabledFilters.has('RemoveAuthHeaders') && keyLower === 'authorization') {
      return '****';
    }
    
    // RemoveAPIKeys filter: if key contains API key patterns or value looks like an API key
    if (enabledFilters.has('RemoveAPIKeys')) {
      // Check key patterns
      const apiKeyKeyPatterns = ['api_key', 'apikey', 'api-key', 'apikey'];
      if (apiKeyKeyPatterns.some(pattern => keyLower.includes(pattern))) {
        return '****';
      }
      // Check value patterns
      if (this.isAPIKey(value)) {
        return '****';
      }
    }
    
    return value;
  }

  /**
   * Recursively apply data filters to nested structures
   */
  private filterDataRecursive(data: any): any {
    if (data == null) {
      return data;
    }
    
    if (Array.isArray(data)) {
      return data.map(item => this.filterDataRecursive(item));
    }
    
    if (typeof data === 'object') {
      const result: any = {};
      for (const [k, v] of Object.entries(data)) {
        const filteredValue = this.applyDataFilters(k, v);
        result[k] = this.filterDataRecursive(filteredValue);
      }
      return result;
    }
    
    return this.applyDataFilters('', data);
  }

  /**
   * Convert ReadableSpan to a serializable format
   */
  private serializeSpan(span: ReadableSpan): SerializableSpan {
    const spanContext = span.spanContext();
    return {
      name: span.name,
      kind: span.kind,
      parentSpanId: span.parentSpanId,
      startTime: span.startTime,
      endTime: span.endTime,
      status: {
        code: span.status.code,
        message: span.status.message,
      },
      attributes: this.filterDataRecursive(span.attributes),
      links: span.links.map(link => ({
        context: {
          traceId: link.context.traceId,
          spanId: link.context.spanId,
        },
        attributes: this.filterDataRecursive(link.attributes),
      })),
      events: span.events.map(event => ({
        name: event.name,
        time: event.time,
        attributes: this.filterDataRecursive(event.attributes),
      })),
      resource: {
        attributes: this.filterDataRecursive(span.resource.attributes),
      },
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      traceFlags: spanContext.traceFlags,
      duration: span.duration,
      ended: span.ended,
      instrumentationLibrary: span.instrumentationLibrary,
    };
  }

  /**
   * Remove span keys from tracking set. Called after successful send to free memory.
   */
  private removeSpanKeysFromTracking(spans: SerializableSpan[]): void {
    for (const span of spans) {
      const spanKey = `${span.traceId}:${span.spanId}`;
      this.bufferSpanKeys.delete(spanKey);
    }
  }

  /**
   * Flush buffered spans to the server. Thread-safe: ensures only one flush operation runs at a time.
   */
  async flush(): Promise<void> {
    // Wait for any ongoing flush to complete
    await this.flushLock;

    // Create a new lock for this flush operation
    let resolveFlush: () => void;
    this.flushLock = new Promise(resolve => {
      resolveFlush = resolve;
    });

    try {
      // Get current buffer and clear it atomically
      const spansToFlush = this.buffer.splice(0);
      // Note: Do NOT clear bufferSpanKeys here - only clear after successful send
      // to avoid unnecessary clearing/rebuilding on failures

      if (spansToFlush.length === 0) {
        return;
      }

      // Skip sending if server URL is not configured
      if (!this.serverUrl) {
        console.warn(`AIQA: Skipping flush: AIQA_SERVER_URL is not set. ${spansToFlush.length} span(s) will not be sent.`);
        // Clear keys for spans that won't be sent
        this.removeSpanKeysFromTracking(spansToFlush);
        return;
      }

      // Split into batches if needed
      const batches = this.splitIntoBatches(spansToFlush);
      if (batches.length > 1) {
        console.log(`AIQA: flush() splitting ${spansToFlush.length} spans into ${batches.length} batches`);
      }

      // Track successfully sent spans to clear their keys
      const successfullySentSpans: SerializableSpan[] = [];
      const errors: Array<{ batch: number; error: string }> = [];

      // Send each batch
      for (let i = 0; i < batches.length; i++) {
        try {
          await this.sendSpans(batches[i]);
          // Track successfully sent spans
          successfullySentSpans.push(...batches[i]);
        } catch (error: any) {
          const errorMsg = `batch ${i + 1}/${batches.length}: ${error.message}`;
          console.error(`AIQA: Error sending ${errorMsg}`);
          errors.push({ batch: i + 1, error: errorMsg });
          // Put remaining batches back in buffer for retry
          if (i + 1 < batches.length) {
            for (const remainingBatch of batches.slice(i + 1)) {
              this.buffer.push(...remainingBatch);
              // Keys are already in bufferSpanKeys, no need to re-add
            }
          }
          // Continue with other batches even if one fails
        }
      }

      // Clear keys only for successfully sent spans
      if (successfullySentSpans.length > 0) {
        this.removeSpanKeysFromTracking(successfullySentSpans);
      }

      if (errors.length > 0) {
        const errorSummary = errors.map(e => e.error).join('; ');
        throw new Error(`Failed to send some spans: ${errorSummary}`);
      }
    } catch (error: any) {
      console.error('AIQA: Error flushing spans to server:', error.message);
      // Don't throw in auto-flush to avoid crashing the process
      if (this.shutdownRequested) {
        throw error;
      }
    } finally {
      resolveFlush!();
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
          `AIQA: Span '${span.name}' (traceId=${span.traceId}) exceeds maxBatchSizeBytes ` +
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
   * Send spans to the server API
   */
  private async sendSpans(spans: SerializableSpan[]): Promise<void> {
    if (!this.serverUrl) {
      throw new Error('AIQA_SERVER_URL is not set. Cannot send spans to server.');
    }

    const response = await fetch(`${this.serverUrl}/span`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `ApiKey ${this.apiKey}`,
      },
      body: JSON.stringify(spans),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to send spans: ${response.status} ${response.statusText} - ${errorText}`);
    }
  }

  /**
   * Start the auto-flush timer
   */
  private startAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      if (!this.shutdownRequested) {
        this.flush().catch((error: any) => {
          console.error('AIQA: Error in auto-flush:', error.message);
        });
      }
    }, this.flushIntervalMs);
    
    // Unref the timer so it doesn't prevent process exit
    // This allows the exporter to work as a daemon that won't block normal exit
    if (this.flushTimer && typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
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
