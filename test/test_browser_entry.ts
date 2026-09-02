/**
 * The browser entry point has two jobs: bundle for a browser target, and work with no
 * `process` and no OpenTelemetry context manager. Both are checked here, because both
 * are easy to break from a module the browser build happens to reach.
 *
 * The bundle is run in a `vm` context holding only what a service worker has - notably
 * no `process` and no `require` - which is the closest we can get to an MV3 worker
 * in-process.
 */

import * as http from 'http';
import * as path from 'path';
import * as vm from 'vm';
import * as esbuild from 'esbuild';
import tap from 'tap';
import { spansFromOtlpBody } from './fixtures/otlp';

const REPO_ROOT = path.resolve(__dirname, '..');

interface Batch {
	auth?: string;
	spans: any[];
}

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

async function bundleForBrowser(entry: string): Promise<string> {
	const built = await esbuild.build({
		entryPoints: [path.join(REPO_ROOT, entry)],
		bundle: true,
		platform: 'browser',
		format: 'iife',
		globalName: 'aiqa',
		write: false,
		absWorkingDir: REPO_ROOT,
	});
	return built.outputFiles[0].text;
}

tap.test('the browser entry point bundles for a browser target', async t => {
	const code = await bundleForBrowser('dist/browser.js');

	// dotenv pulls in fs/os/crypto, and sdk-trace-node pulls in async_hooks/events.
	// Neither can resolve for a browser, so neither may be reachable from here.
	t.notMatch(code, /dotenv/, 'does not reach dotenv');
	t.notMatch(code, /async_hooks|AsyncHooksContextManager/, 'does not reach @opentelemetry/sdk-trace-node');

	// A bare `process.env` is a ReferenceError in a service worker. Guarded
	// `globalThis.process.env` is fine, and is only reached where a process exists.
	const bare = code
		.replace(/globalThis\.process\.env/g, '')
		.replace(/there is no process\.env on this runtime/g, '');
	t.notMatch(bare, /\bprocess\s*\.\s*env/, 'does not read a bare process.env');
	t.end();
});

tap.test('the Node entry point does still reach the Node-only modules', async t => {
	// The mirror of the test above: if this ever passes for dist/index.js too, the Node
	// entry point has quietly lost .env loading and its context manager.
	const built = await esbuild.build({
		entryPoints: [path.join(REPO_ROOT, 'dist/index.js')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		write: false,
		absWorkingDir: REPO_ROOT,
	});
	t.match(built.outputFiles[0].text, /AsyncHooksContextManager/, 'the Node entry point keeps the async-hooks context manager');
	t.end();
});

tap.test('the browser entry point runs with no process and no context manager', async t => {
	const collector = await startCollector();
	t.teardown(() => collector.close());
	const code = await bundleForBrowser('dist/browser.js');

	const sandbox: any = {
		fetch, console, performance, setTimeout, clearTimeout, setInterval, clearInterval,
		Blob, TextEncoder, URLSearchParams, Math, Date, JSON, Promise, Error, WeakSet,
		Set, Map, Object, Array, String, Number, Boolean, Symbol, RegExp, Uint8Array,
		isNaN, parseFloat, parseInt,
	};
	sandbox.globalThis = sandbox;
	const context = vm.createContext(sandbox);
	t.equal(vm.runInContext('typeof process', context), 'undefined', 'the sandbox really has no process');
	vm.runInContext(code, context);
	const aiqa = sandbox.aiqa;

	aiqa.initTracing({
		apiKey: 'sw-key',
		serverUrl: collector.url,
		serviceName: 'bn-extension',
		componentTag: 'ext.sw',
		flushIntervalSeconds: 0,
	});
	t.ok(aiqa.isTracingEnabled(), 'initTracing is enough to enable tracing with no env vars');
	t.equal(aiqa.getProvider().constructor.name, 'BasicTracerProvider', 'the browser entry point uses BasicTracerProvider');

	// The point of startSpan: an await in between would lose an implicit parent here.
	const chunkedAt = Date.now() - 3000;
	const page = aiqa.startSpan('analyse_page', { attributes: { url: 'https://example.com/p' } });
	await new Promise(resolve => setTimeout(resolve, 5));
	const chunk = aiqa.startSpan('chunk_page', { parent: page, startTime: chunkedAt });
	const llm = aiqa.startSpan('call_model', { parent: page });
	aiqa.setTokenUsage(11, 22, 33, llm);
	aiqa.setProviderAndModel('anthropic', 'claude-opus-5', llm);
	llm.end();
	chunk.end();
	page.end();
	await aiqa.flushSpans();

	const spans = Object.fromEntries(collector.batches.flatMap(b => b.spans).map(s => [s.name, s]));
	t.equal(Object.keys(spans).length, 3, 'all three spans were sent');
	t.equal(spans.chunk_page.parent_span_id, spans.analyse_page.id, 'the explicit parent survives an await');
	t.equal(spans.call_model.parent_span_id, spans.analyse_page.id, 'a second child gets the same parent');
	t.equal(spans.chunk_page.trace_id, spans.analyse_page.trace_id, 'it is one trace');
	t.equal(spans.chunk_page.start_time, chunkedAt, 'work timed elsewhere can be replayed with startTime');
	t.equal(spans.call_model.attributes['gen_ai.usage.total_tokens'], 33, 'token usage set on a span passed explicitly');
	t.equal(spans.call_model.attributes['gen_ai.request.model'], 'claude-opus-5', 'model set on a span passed explicitly');
	t.equal(spans.analyse_page.attributes['gen_ai.component.id'], 'ext.sw', 'componentTag is applied');
	t.equal(spans.analyse_page.resource.attributes['service.name'], 'bn-extension', 'serviceName is applied');
	t.ok(collector.batches.every(b => b.auth === 'Bearer sw-key'), 'the configured API key is sent');

	// Users can change the key in an options page while the worker is alive.
	collector.batches.length = 0;
	aiqa.initTracing({ apiKey: 'rotated-key' });
	aiqa.startSpan('after_rotate').end();
	await aiqa.flushSpans();
	t.equal(collector.batches.length, 1, 'a span is still sent after the key changes');
	t.equal(collector.batches[0].auth, 'Bearer rotated-key', 'the new key is used');

	// Per-call-site sampling takes the subtree with it.
	const dropped = aiqa.startSpan('sampled_out', { samplingRate: 0 });
	aiqa.startSpan('child_of_sampled_out', { parent: dropped }).end();
	dropped.end();
	aiqa.startSpan('sampled_in', { samplingRate: 1 }).end();
	collector.batches.length = 0;
	await aiqa.flushSpans();
	t.same(collector.batches.flatMap(b => b.spans).map(s => s.name), ['sampled_in'], 'only the sampled-in span is sent');

	// Clearing the key disables tracing rather than sending unauthenticated batches.
	aiqa.initTracing({ apiKey: '' });
	t.notOk(aiqa.isTracingEnabled(), 'clearing the API key disables tracing');
	aiqa.startSpan('while_disabled').end();
	collector.batches.length = 0;
	await aiqa.flushSpans();
	t.equal(collector.batches.length, 0, 'nothing is sent while tracing is disabled');

	t.end();
});
