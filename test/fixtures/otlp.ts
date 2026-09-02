/**
 * Decode the OTLP/JSON the exporter now sends (see src/otlp-json.ts) back into the flat
 * span shape these tests assert against, so they stay about tracing behaviour rather
 * than wire encoding. The encoding itself is covered by test_exporter_span_shapes.ts.
 */

function fromOtlpValue(value: any): any {
	if (!value || typeof value !== 'object') return undefined;
	if (value.stringValue !== undefined) return value.stringValue;
	if (value.boolValue !== undefined) return value.boolValue;
	if (value.intValue !== undefined) return Number(value.intValue);
	if (value.doubleValue !== undefined) return value.doubleValue;
	if (value.arrayValue?.values) return value.arrayValue.values.map(fromOtlpValue);
	if (value.kvlistValue?.values) return fromOtlpAttributes(value.kvlistValue.values);
	return undefined;
}

function fromOtlpAttributes(kvs: any[] | undefined): Record<string, any> {
	const out: Record<string, any> = {};
	for (const kv of kvs || []) out[kv.key] = fromOtlpValue(kv.value);
	return out;
}

/**
 * OTLP times are nanoseconds since the epoch (`fixed64` on the wire, which is why
 * src/otlp-json.ts emits them as strings). Dividing by 1e6 loses precision, because a
 * present-day nanosecond timestamp is past Number.MAX_SAFE_INTEGER:
 * `Number('1788300739114000000') / 1e6` is 1788300739113.9998. Strip the nanosecond
 * digits instead, mirroring how the encoder appends them.
 */
function nanoToMillis(nano: string | number | undefined): number | undefined {
	if (nano === undefined) {
		return undefined;
	}
	const digits = String(nano);
	return Number(digits.slice(0, -6) || '0');
}

/** One OTLP ExportTraceServiceRequest body -> flat spans, as the old wire format had them. */
export function spansFromOtlpBody(body: any): any[] {
	const spans: any[] = [];
	for (const resourceSpan of body?.resourceSpans || []) {
		const resource = { attributes: fromOtlpAttributes(resourceSpan.resource?.attributes) };
		for (const scopeSpan of resourceSpan.scopeSpans || []) {
			for (const span of scopeSpan.spans || []) {
				spans.push({
					name: span.name,
					kind: span.kind - 1, // OTLP numbering is one higher than OpenTelemetry's
					id: span.spanId,
					trace_id: span.traceId,
					parent_span_id: span.parentSpanId,
					start_time: nanoToMillis(span.startTimeUnixNano),
					end_time: nanoToMillis(span.endTimeUnixNano),
					status: span.status,
					attributes: fromOtlpAttributes(span.attributes),
					events: (span.events || []).map((event: any) => ({
						name: event.name,
						time: nanoToMillis(event.timeUnixNano),
						attributes: fromOtlpAttributes(event.attributes),
					})),
					resource,
					instrumentationLibrary: scopeSpan.scope,
					traceFlags: span.flags,
				});
			}
		}
	}
	return spans;
}
