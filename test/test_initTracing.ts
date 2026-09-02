import * as http from 'http';
import tap from 'tap';
import {
	initTracing,
	startSpan,
	withTracingAsync,
	withTracing,
	flushSpans,
	getProvider,
	getExporter,
	setSpanAttribute,
	isTracingEnabled,
	shutdownTracing,
} from '../dist/index.js';
import { spansFromOtlpBody } from './fixtures/otlp';

interface Batch {
	auth?: string;
	spans: any[];
}

/** A stand-in AIQA server, so these tests need no credentials and no network. */
async function startCollector(): Promise<{ url: string; batches: Batch[]; close: () => Promise<void> }> {
	const batches: Batch[] = [];
	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', chunk => { body += chunk; });
		req.on('end', () => {
			batches.push({ auth: req.headers.authorization as string | undefined, spans: spansFromOtlpBody(JSON.parse(body)) });
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end('{}');
		});
	});
	await new Promise<void>(resolve => server.listen(0, resolve));
	const port = (server.address() as any).port;
	return {
		url: `http://127.0.0.1:${port}`,
		batches,
		close: () => new Promise<void>(resolve => { server.close(() => resolve()); }),
	};
}

function byName(batches: Batch[]): Record<string, any> {
	return Object.fromEntries(batches.flatMap(b => b.spans).map(s => [s.name, s]));
}

tap.test('initTracing: programmatic config, explicit parents, and reconfiguration', async t => {
	const collector = await startCollector();
	t.teardown(() => collector.close());

	// No env vars involved: everything comes from the call. flushIntervalSeconds: 0
	// turns the auto-flush timer off, so every send below is one we asked for.
	initTracing({
		apiKey: 'key-one',
		serverUrl: collector.url,
		serviceName: 'test-service',
		componentTag: 'test.tag',
		flushIntervalSeconds: 0,
	});
	t.ok(isTracingEnabled(), 'initTracing alone enables tracing, with no AIQA_API_KEY set');

	const provider = getProvider();
	t.equal(provider && provider.constructor.name, 'NodeTracerProvider', 'the Node entry point uses NodeTracerProvider');

	// withTracing still nests implicitly on Node, where there is a context manager.
	const inner = withTracingAsync(async function inner(x: number) { return x * 2; });
	const outer = withTracingAsync(async function outer(x: number) { return (await inner(x)) + 1; });
	t.equal(await outer(5), 11, 'wrapped functions still return their value');

	// Explicit parent and explicit start time, as used from a service worker.
	const chunkedAt = Date.now() - 5000;
	const page = startSpan('analyse_page', { attributes: { url: 'https://example.com/x' } });
	const chunk = startSpan('chunk_page', { parent: page, startTime: chunkedAt });
	setSpanAttribute('chunk_count', 7, chunk);
	chunk.end();
	page.end();

	await flushSpans();
	const spans = byName(collector.batches);
	t.equal(spans.inner.parent_span_id, spans.outer.id, 'implicit nesting still works on Node');
	t.equal(spans.chunk_page.parent_span_id, spans.analyse_page.id, 'explicit parent is honoured');
	t.equal(spans.chunk_page.trace_id, spans.analyse_page.trace_id, 'parent and child share a trace');
	t.equal(spans.chunk_page.start_time, chunkedAt, 'explicit startTime is honoured');
	t.equal(spans.chunk_page.attributes.chunk_count, 7, 'attributes can be set on a span passed explicitly');
	t.equal(spans.analyse_page.attributes.url, 'https://example.com/x', 'startSpan attributes are recorded');
	t.equal(spans.analyse_page.attributes['gen_ai.component.id'], 'test.tag', 'componentTag is applied');
	t.equal(spans.outer.resource.attributes['service.name'], 'test-service', 'serviceName is applied');
	t.ok(collector.batches.every(b => b.auth === 'Bearer key-one'), 'the configured API key is sent');

	// Rotating credentials reconfigures the running exporter rather than rebuilding the
	// pipeline: a span processor cannot be detached from a provider.
	const exporterBefore = getExporter();
	initTracing({ apiKey: 'key-two' });
	t.equal(getExporter(), exporterBefore, 'the exporter is reused when only credentials change');
	t.equal(getProvider(), provider, 'the provider is reused when only credentials change');

	collector.batches.length = 0;
	withTracing(function afterRotate() { return 1; })();
	await flushSpans();
	t.ok(collector.batches.length > 0, 'spans are still sent after the key changes');
	t.ok(collector.batches.every(b => b.auth === 'Bearer key-two'), 'the new API key is sent');

	// serviceName and samplingRate are baked into the provider, so changing either has to
	// rebuild it. That unregisters and re-registers the OpenTelemetry globals, including
	// the context manager, so check implicit nesting survives it.
	initTracing({ serviceName: 'test-service-2' });
	const rebuiltProvider = getProvider();
	t.not(rebuiltProvider, provider, 'the provider is rebuilt when serviceName changes');

	collector.batches.length = 0;
	const innerAgain = withTracingAsync(async function innerAgain() { return 1; });
	const outerAgain = withTracingAsync(async function outerAgain() { return await innerAgain(); });
	await outerAgain();
	await flushSpans();
	const rebuilt = byName(collector.batches);
	t.equal(rebuilt.innerAgain.parent_span_id, rebuilt.outerAgain.id, 'implicit nesting still works after a rebuild');
	t.equal(rebuilt.outerAgain.resource.attributes['service.name'], 'test-service-2', 'the new serviceName is used');

	initTracing({ samplingRate: 0.5 });
	t.not(getProvider(), rebuiltProvider, 'the provider is rebuilt when samplingRate changes');

	t.end();
});

tap.test('object attributes are serialised rather than silently dropped', async t => {
	const collector = await startCollector();
	t.teardown(() => collector.close());
	// samplingRate is spelled out because config overrides persist across initTracing
	// calls, and the subtest above leaves a partial sampling rate set.
	initTracing({ apiKey: 'key', serverUrl: collector.url, samplingRate: 1, flushIntervalSeconds: 0 });

	// OpenTelemetry only records strings, numbers, booleans and arrays of those, and
	// drops anything else with nothing but a diag warning - which used to lose the
	// input and output of every traced function taking or returning an object.
	const shape = withTracing(function shape(arg: { x: number }) { return { doubled: arg.x * 2 }; });
	t.same(shape({ x: 21 }), { doubled: 42 }, 'the wrapped function is unaffected');

	const circular: any = { name: 'loop' };
	circular.self = circular;
	const span = startSpan('attrs', { attributes: { obj: { a: 1 }, list: [1, 2], mixed: [1, 'two'], str: 'plain', num: 3, bool: true } });
	setSpanAttribute('circular', circular, span);
	span.end();
	await flushSpans();

	const spans = byName(collector.batches);
	t.equal(spans.shape.attributes.input, '{"x":21}', 'an object input is recorded as JSON');
	t.equal(spans.shape.attributes.output, '{"doubled":42}', 'an object output is recorded as JSON');
	t.equal(spans.attrs.attributes.obj, '{"a":1}', 'an object attribute is recorded as JSON');
	t.same(spans.attrs.attributes.list, [1, 2], 'a homogeneous primitive array is left alone');
	t.equal(spans.attrs.attributes.mixed, '[1,"two"]', 'a mixed array is recorded as JSON, since OTel would drop it');
	t.equal(spans.attrs.attributes.str, 'plain', 'a string is left alone');
	t.equal(spans.attrs.attributes.num, 3, 'a number is left alone');
	t.equal(spans.attrs.attributes.bool, true, 'a boolean is left alone');
	// A cycle used to overflow the stack in filterDataRecursive, throwing out of
	// setSpanAttribute and into the caller.
	t.equal(spans.attrs.attributes.circular, '{"name":"loop","self":"[Circular]"}', 'a cycle is marked rather than followed');

	// Sharing a value between siblings is not a cycle.
	const shared = { id: 1 };
	const sharing = startSpan('sharing', { attributes: { pair: { a: shared, b: shared } } });
	sharing.end();
	await flushSpans();
	t.equal(byName(collector.batches).sharing.attributes.pair, '{"a":{"id":1},"b":{"id":1}}', 'a shared value is not mistaken for a cycle');
	t.end();
});

tap.test('shutdownTracing can be undone by initTracing', async t => {
	const collector = await startCollector();
	t.teardown(() => collector.close());
	// samplingRate is spelled out because config overrides persist across initTracing calls.
	initTracing({ apiKey: 'key-restart', serverUrl: collector.url, samplingRate: 1, flushIntervalSeconds: 0 });
	t.ok(isTracingEnabled(), 'tracing is on');

	await shutdownTracing();
	t.notOk(isTracingEnabled(), 'shutdownTracing turns it off');

	// With no arguments, so the config is byte-for-byte what it was before the shutdown:
	// applyConfig used to see "nothing changed" and skip rebuilding the torn-down pipeline.
	initTracing();
	t.ok(isTracingEnabled(), 'initTracing() with an unchanged config restarts it');
	t.ok(getExporter(), 'and the pipeline is rebuilt, not just the flag');

	withTracing(function afterRestart() { return 1; })();
	await flushSpans();
	t.same(collector.batches.flatMap(b => b.spans.map((s: any) => s.name)), ['afterRestart'], 'and spans are sent again');
	t.end();
});

tap.test('flushSpans is safe when the server is unreachable', async t => {
	const collector = await startCollector();
	initTracing({ apiKey: 'key', serverUrl: collector.url, samplingRate: 1, flushIntervalSeconds: 0 });
	await collector.close();

	withTracing(function afterServerGone() { return 1; })();
	// Never throws, so it is safe on a shutdown path - failures are logged instead.
	await flushSpans();
	t.pass('flushSpans resolved despite the send failing');
	t.end();
});
