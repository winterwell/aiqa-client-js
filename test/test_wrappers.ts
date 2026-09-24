/**
 * withTracing / withTracingAsync result handling: plain values, promises, generators and
 * async generators each end their span at the right time, and ordinary iterables
 * (arrays, strings, Maps) come back unchanged. Also local javascript metric scoring.
 */

import * as http from 'http';
import tap from 'tap';
import { initTracing, withTracing, withTracingAsync, flushSpans, shutdownTracing, scoreAllMetrics } from '../dist/index.js';
import { spansFromOtlpBody } from './fixtures/otlp';

async function startCollector() {
	const spans: any[] = [];
	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', chunk => { body += chunk; });
		req.on('end', () => {
			spans.push(...spansFromOtlpBody(JSON.parse(body)));
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end('{}');
		});
	});
	await new Promise<void>(resolve => server.listen(0, resolve));
	return {
		url: `http://127.0.0.1:${(server.address() as any).port}`,
		spans,
		close: () => new Promise<void>(resolve => { server.close(() => resolve()); }),
	};
}

tap.test('wrapped functions return what the function returns, and end their spans', async t => {
	const collector = await startCollector();
	t.teardown(() => collector.close());
	initTracing({ apiKey: 'key', serverUrl: collector.url, flushIntervalSeconds: 0 });

	const list = withTracing(function list() { return [1, 2, 3]; });
	const result = list();
	t.ok(Array.isArray(result), 'an array is returned as an array, not wrapped as a stream');
	t.same(result, [1, 2, 3]);
	t.equal(withTracing(function text() { return 'abc'; })(), 'abc', 'a string is returned unchanged');

	const promised = withTracing(async function promised(x: number) { return { answer: x }; });
	t.same(await promised(42), { answer: 42 }, 'withTracing passes a promise through');

	const gen = withTracing(function* gen() { yield 1; yield 2; yield 3; });
	const seen: number[] = [];
	for (const v of gen()) {
		seen.push(v);
		if (v === 2) break;
	}
	t.same(seen, [1, 2], 'a generator is iterated lazily');

	const agen = withTracingAsync(async function* agen() { yield 'a'; yield 'b'; });
	const chunks: string[] = [];
	for await (const c of await agen()) chunks.push(c);
	t.same(chunks, ['a', 'b'], 'an async generator is streamed');

	const boom = withTracingAsync(async function boom() { throw new Error('bang'); });
	await t.rejects(boom(), { message: 'bang' }, 'errors propagate');

	await flushSpans();
	const byName = Object.fromEntries(collector.spans.map(s => [s.name, s]));
	t.same(byName.list?.attributes.output, [1, 2, 3], 'array output recorded');
	t.equal(byName.promised?.attributes.output, '{"answer":42}', 'the resolved value is recorded, not the promise');
	t.ok(byName.gen, 'a generator abandoned with break still ends its span');
	t.same(JSON.parse(byName.gen.attributes.output), { type: 'iterable', yielded_count: 2 });
	t.same(JSON.parse(byName.agen.attributes.output), { type: 'async_iterable', yielded_count: 2 });
	t.ok(byName.agen.attributes['gen_ai.server.time_to_first_output_token'] >= 0, 'time to first token recorded');
	t.equal(byName.boom?.status.code, 2, 'error status recorded');

	await shutdownTracing();
});

tap.test('javascript metrics score locally, keyed by metric id', async t => {
	const metrics: any[] = [
		{ id: 'len', name: 'Length', type: 'javascript', code: 'return output.length;' },
		{ id: 'judge', name: 'Judge', type: 'llm' },
	];
	t.same(await scoreAllMetrics(metrics, 'hello', {} as any), { len: 5 });
});
