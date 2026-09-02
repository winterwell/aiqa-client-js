/**
 * The exporter can be attached to a TracerProvider the host application registered, so
 * it does not control which OpenTelemetry SDK generation produces the spans it is given.
 * The two generations disagree on two fields, and reading only one shape silently sent
 * no parent span id - which flattens the trace tree on the server rather than failing
 * loudly.
 *
 * Also covers the wire format itself: the server only accepts OTLP on `/v1/traces`, and
 * a wrong path or encoding fails the same silent way (404, spans dropped).
 */

import * as http from 'http';
import tap from 'tap';
import { AIQASpanExporter } from '../dist/index.js';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';

/** The fields serializeSpan reads, minus the two that differ between generations. */
function spanBase(name: string, spanId: string) {
	return {
		name,
		kind: 1,
		spanContext: () => ({ traceId: TRACE_ID, spanId, traceFlags: 1 }),
		startTime: [1700000000, 0],
		endTime: [1700000001, 0],
		duration: [1, 0],
		status: { code: 1 },
		attributes: { ok: true },
		links: [],
		events: [],
		resource: { attributes: { 'service.name': 'host' } },
		ended: true,
	};
}

/** Collect the requests one flush makes, with the exporter's auto-flush timer off. */
async function capture(spans: any[]) {
	const requests: Array<{ url: string; contentType: string; body: any }> = [];
	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', chunk => { body += chunk; });
		req.on('end', () => {
			requests.push({ url: req.url || '', contentType: String(req.headers['content-type'] || ''), body: JSON.parse(body) });
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end('{}');
		});
	});
	await new Promise<void>(resolve => server.listen(0, resolve));
	// flushIntervalSeconds 0 so the only send is the one we ask for.
	const exporter = new AIQASpanExporter(`http://127.0.0.1:${(server.address() as any).port}`, 'key', 0);
	exporter.export(spans as any, () => undefined);
	await exporter.flush();
	await new Promise<void>(resolve => { server.close(() => resolve()); });
	return requests;
}

/** All spans in an OTLP request, indexed by name, with their enclosing scope. */
function otlpSpansByName(body: any) {
	const out: Record<string, any> = {};
	for (const resourceSpan of body.resourceSpans) {
		for (const scopeSpan of resourceSpan.scopeSpans) {
			for (const span of scopeSpan.spans) {
				out[span.name] = { ...span, scope: scopeSpan.scope, resource: resourceSpan.resource };
			}
		}
	}
	return out;
}

tap.test('spans from either OpenTelemetry SDK generation serialise the same way', async t => {
	// 1.x: parentSpanId + instrumentationLibrary.
	const v1 = { ...spanBase('from_sdk_1x', 'aaaaaaaaaaaaaaa1'), parentSpanId: 'bbbbbbbbbbbbbbb1', instrumentationLibrary: { name: 'lib-1x', version: '1.0' } };
	// 2.x: parentSpanContext + instrumentationScope.
	const v2 = {
		...spanBase('from_sdk_2x', 'aaaaaaaaaaaaaaa2'),
		parentSpanContext: { traceId: TRACE_ID, spanId: 'bbbbbbbbbbbbbbb2', traceFlags: 1 },
		instrumentationScope: { name: 'lib-2x', version: '2.0' },
	};
	// A root span in 2.x has no parentSpanContext at all.
	const v2root = { ...spanBase('root_from_sdk_2x', 'aaaaaaaaaaaaaaa3'), instrumentationScope: { name: 'lib-2x' } };

	const requests = await capture([v1, v2, v2root]);
	t.equal(requests.length, 1, 'one request');
	const byName = otlpSpansByName(requests[0].body);

	t.equal(byName.from_sdk_1x.parentSpanId, 'bbbbbbbbbbbbbbb1', '1.x parentSpanId is read');
	t.equal(byName.from_sdk_2x.parentSpanId, 'bbbbbbbbbbbbbbb2', '2.x parentSpanContext.spanId is read');
	t.equal(byName.root_from_sdk_2x.parentSpanId, undefined, 'a 2.x root span has no parent');
	t.same(byName.from_sdk_1x.scope, { name: 'lib-1x', version: '1.0' }, '1.x instrumentationLibrary becomes the OTLP scope');
	t.same(byName.from_sdk_2x.scope, { name: 'lib-2x', version: '2.0' }, '2.x instrumentationScope becomes the OTLP scope');
	t.same(byName.root_from_sdk_2x.scope, { name: 'lib-2x' }, 'a scope without a version omits it');
	t.end();
});

tap.test('spans are sent as OTLP/JSON to /v1/traces', async t => {
	const span = {
		...spanBase('otlp_shape', 'aaaaaaaaaaaaaaa4'),
		instrumentationLibrary: { name: 'aiqa-tracer' },
		status: { code: 2, message: 'boom' },
		attributes: { text: 'hello', count: 3, ratio: 0.5, flag: false, tags: ['a', 'b'] },
		events: [{ name: 'ev', time: [1700000000, 500000000], attributes: { i: 1 } }],
	};

	const requests = await capture([span]);
	t.equal(requests.length, 1, 'one request');
	const [request] = requests;
	t.equal(request.url, '/v1/traces', 'posts to the OTLP endpoint, not the removed /span route');
	t.match(request.contentType, /application\/json/, 'JSON encoding');

	const sent = otlpSpansByName(request.body).otlp_shape;
	t.equal(sent.traceId, TRACE_ID, 'trace id is hex');
	t.equal(sent.spanId, 'aaaaaaaaaaaaaaa4', 'span id is hex');
	// OpenTelemetry SpanKind.SERVER is 1; OTLP's SPAN_KIND_SERVER is 2.
	t.equal(sent.kind, 2, 'span kind is shifted to the OTLP numbering');
	t.equal(sent.startTimeUnixNano, '1700000000000000000', 'start time in nanoseconds, exactly');
	t.equal(sent.endTimeUnixNano, '1700000001000000000', 'end time in nanoseconds, exactly');
	t.same(sent.status, { code: 2, message: 'boom' }, 'status code and message survive');
	t.equal(sent.flags, 1, 'trace flags are carried as OTLP flags');

	const attrs = Object.fromEntries(sent.attributes.map((kv: any) => [kv.key, kv.value]));
	t.same(attrs.text, { stringValue: 'hello' }, 'strings');
	t.same(attrs.count, { intValue: 3 }, 'integers use intValue, kept as a number so they stay numeric in AIQA');
	t.same(attrs.ratio, { doubleValue: 0.5 }, 'non-integers use doubleValue');
	t.same(attrs.flag, { boolValue: false }, 'booleans');
	t.same(attrs.tags, { arrayValue: { values: [{ stringValue: 'a' }, { stringValue: 'b' }] } }, 'arrays');

	t.same(sent.resource.attributes, [{ key: 'service.name', value: { stringValue: 'host' } }], 'resource attributes');
	t.equal(sent.events[0].timeUnixNano, '1700000000500000000', 'event times in nanoseconds');
	t.same(sent.events[0].attributes, [{ key: 'i', value: { intValue: 1 } }], 'event attributes');
	t.end();
});
