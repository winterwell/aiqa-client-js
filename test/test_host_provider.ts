/**
 * When the host application has already registered its own TracerProvider, the client
 * has to attach to it rather than register a second one over the top: clobbering the
 * global registration would break the host's instrumentation, and running two providers
 * breaks context propagation between them.
 *
 * This lives in its own file because the tracing pipeline is process-global and tap
 * gives each test file its own process.
 */

import * as http from 'http';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import tap from 'tap';
import { initTracing, withTracing, flushSpans, getProvider } from '../dist/index.js';
import { spansFromOtlpBody } from './fixtures/otlp';

tap.test('the client attaches to a TracerProvider the host already registered', async t => {
	const collected: any[] = [];
	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', chunk => { body += chunk; });
		req.on('end', () => {
			collected.push(...spansFromOtlpBody(JSON.parse(body)));
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end('{}');
		});
	});
	await new Promise<void>(resolve => server.listen(0, resolve));
	t.teardown(() => new Promise<void>(resolve => { server.close(() => resolve()); }));
	const url = `http://127.0.0.1:${(server.address() as any).port}`;

	// The host sets up its own provider first, as an app with existing OpenTelemetry
	// instrumentation would.
	const hostExporter = new InMemorySpanExporter();
	const hostProvider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(hostExporter)] });
	hostProvider.register();

	initTracing({ apiKey: 'key', serverUrl: url, flushIntervalSeconds: 0 });
	t.equal(getProvider(), hostProvider, 'the host provider is reused, not replaced');

	withTracing(function hostAndAiqa() { return 1; })();
	await flushSpans();

	t.equal(hostExporter.getFinishedSpans().length, 1, 'the span still reaches the host exporter');
	t.same(collected.map(s => s.name), ['hostAndAiqa'], 'and also reaches AIQA');
	t.end();
});
