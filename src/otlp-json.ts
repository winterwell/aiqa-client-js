/**
 * Convert our internal span shape to an OTLP/JSON ExportTraceServiceRequest.
 *
 * AIQA's ingest endpoint is OTLP: `POST /v1/traces`, JSON or protobuf (see the server's
 * `routes/spans.ts`). The older `POST /span`, which took a flat array of our own span
 * JSON, was removed in January 2026 - it now 404s, silently losing every span. The
 * Python and Go clients get OTLP from OpenTelemetry's own OTLP exporter; we serialise
 * here instead, because that package's browser build needs XMLHttpRequest or
 * sendBeacon, and an MV3 service worker has neither, only `fetch`.
 *
 * Integers are encoded as JSON numbers rather than the strings the protobuf JSON
 * mapping prescribes for int64. Both are accepted, and the server stores the value it is
 * given: numbers keep numeric attributes (token counts, scores, durations) numeric in
 * AIQA, as the pre-OTLP route did. Anything past Number.MAX_SAFE_INTEGER - only a bigint
 * attribute, which OpenTelemetry itself will not produce - falls back to a string.
 */

/** OTLP AnyValue. */
type OtlpValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: number | string }
  | { doubleValue: number }
  | { arrayValue: { values: OtlpValue[] } }
  | { kvlistValue: { values: OtlpKeyValue[] } };

interface OtlpKeyValue {
  key: string;
  value: OtlpValue;
}

/** The subset of the internal span shape (see aiqa-exporter.ts) that OTLP needs. */
export interface InternalSpanForOtlp {
  name: string;
  kind: number;
  parent_span_id?: string;
  start_time: number;
  end_time?: number;
  status: { code: number; message?: string };
  attributes: Record<string, any>;
  links: Array<{ context: { traceId: string; spanId: string }; attributes?: Record<string, any> }>;
  events: Array<{ name: string; time: number; attributes?: Record<string, any> }>;
  resource: { attributes: Record<string, any> };
  trace_id: string;
  id: string;
  traceFlags: number;
  instrumentationLibrary?: { name: string; version?: string };
}

export interface OtlpTraceRequest {
  resourceSpans: Array<{
    resource: { attributes: OtlpKeyValue[] };
    scopeSpans: Array<{
      scope: { name: string; version?: string };
      spans: any[];
    }>;
  }>;
}

/**
 * Epoch milliseconds to the OTLP nanosecond string. Appending zeroes rather than
 * multiplying keeps it exact: ms * 1e6 is past Number.MAX_SAFE_INTEGER.
 */
function msToUnixNano(ms: number): string {
  return `${Math.round(ms)}000000`;
}

function toOtlpValue(value: any): OtlpValue | undefined {
  switch (typeof value) {
    case 'string':
      return { stringValue: value };
    case 'boolean':
      return { boolValue: value };
    case 'number':
      if (!Number.isFinite(value)) return undefined;
      return Number.isInteger(value) ? { intValue: value } : { doubleValue: value };
    case 'bigint':
      return { intValue: String(value) };
    case 'object':
      if (value === null) return undefined;
      if (Array.isArray(value)) {
        const values = value.map(toOtlpValue).filter((v): v is OtlpValue => v !== undefined);
        return { arrayValue: { values } };
      }
      return { kvlistValue: { values: toOtlpKeyValues(value) } };
    default:
      return undefined;
  }
}

function toOtlpKeyValues(attributes: Record<string, any> | undefined): OtlpKeyValue[] {
  if (!attributes) return [];
  const out: OtlpKeyValue[] = [];
  for (const [key, raw] of Object.entries(attributes)) {
    const value = toOtlpValue(raw);
    if (value !== undefined) out.push({ key, value });
  }
  return out;
}

/**
 * OpenTelemetry's SpanKind starts at INTERNAL = 0; OTLP's starts at UNSPECIFIED = 0, so
 * the wire value is one higher.
 */
function toOtlpKind(kind: number | undefined): number {
  return typeof kind === 'number' && Number.isFinite(kind) ? kind + 1 : 1;
}

function toOtlpSpan(span: InternalSpanForOtlp): any {
  return {
    traceId: span.trace_id,
    spanId: span.id,
    ...(span.parent_span_id ? { parentSpanId: span.parent_span_id } : {}),
    name: span.name,
    kind: toOtlpKind(span.kind),
    startTimeUnixNano: msToUnixNano(span.start_time),
    ...(span.end_time !== undefined ? { endTimeUnixNano: msToUnixNano(span.end_time) } : {}),
    attributes: toOtlpKeyValues(span.attributes),
    events: (span.events || []).map(event => ({
      timeUnixNano: msToUnixNano(event.time),
      name: event.name,
      attributes: toOtlpKeyValues(event.attributes),
    })),
    links: (span.links || []).map(link => ({
      traceId: link.context?.traceId ?? '',
      spanId: link.context?.spanId ?? '',
      attributes: toOtlpKeyValues(link.attributes),
    })),
    status: {
      code: span.status?.code ?? 0,
      ...(span.status?.message ? { message: span.status.message } : {}),
    },
    flags: span.traceFlags ?? 0,
  };
}

/**
 * Group spans into OTLP's resource -> scope -> span nesting. Spans in one batch usually
 * share both, but a host application can attach this exporter to a provider serving
 * several tracers, so we group rather than assume.
 */
export function toOtlpTraceRequest(spans: InternalSpanForOtlp[]): OtlpTraceRequest {
  const byResource = new Map<string, Map<string, { scope: { name: string; version?: string }; spans: any[] }>>();
  const resourceAttributes = new Map<string, Record<string, any>>();

  for (const span of spans) {
    const attrs = span.resource?.attributes ?? {};
    const resourceKey = JSON.stringify(attrs);
    if (!byResource.has(resourceKey)) {
      byResource.set(resourceKey, new Map());
      resourceAttributes.set(resourceKey, attrs);
    }
    const scopes = byResource.get(resourceKey)!;
    const name = span.instrumentationLibrary?.name ?? '';
    const version = span.instrumentationLibrary?.version;
    const scopeKey = `${name} ${version ?? ''}`;
    if (!scopes.has(scopeKey)) {
      scopes.set(scopeKey, { scope: { name, ...(version ? { version } : {}) }, spans: [] });
    }
    scopes.get(scopeKey)!.spans.push(toOtlpSpan(span));
  }

  return {
    resourceSpans: [...byResource.entries()].map(([resourceKey, scopes]) => ({
      resource: { attributes: toOtlpKeyValues(resourceAttributes.get(resourceKey)) },
      scopeSpans: [...scopes.values()],
    })),
  };
}
