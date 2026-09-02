/**
 * The same host-provider case, but where the host is on OpenTelemetry SDK 2.x.
 *
 * 2.x removed `addSpanProcessor` - processors are constructor-only there - so the client
 * cannot attach its exporter to a provider it did not build. It used to probe for exactly
 * that method to decide whether a host provider existed at all, so a 2.x provider looked
 * like no provider and got clobbered by ours, silently breaking the host's tracing. Now
 * it is detected, left alone, and the failure to attach is reported.
 *
 * The stub is a real 1.x provider with `addSpanProcessor` hidden, so the test does not
 * need a second copy of the SDK installed.
 *
 * Own file because the tracing pipeline is process-global and tap gives each file its
 * own process.
 */

import * as http from 'http';
import { trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import tap from 'tap';
import { initTracing, withTracing, flushSpans, getProvider } from '../dist/index.js';
import { spansFromOtlpBody } from './fixtures/otlp';

/** A provider that behaves like SDK 2.x: everything except `addSpanProcessor`. */
function withoutAddSpanProcessor<T extends object>(provider: T): T {
	return new Proxy(provider, {
		get(target: any, prop) {
			if (prop === 'addSpanProcessor') {
				return undefined;
			}
			const value = target[prop];
			return typeof value === 'function' ? value.bind(target) : value;
		},
		has(target, prop) {
			return prop === 'addSpanProcessor' ? false : prop in target;
		},
	});
}

tap.test('an SDK 2.x host TracerProvider is left alone, loudly', async t => {
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

	const hostExporter = new InMemorySpanExporter();
	const real = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(hostExporter)] });
	const hostProvider = withoutAddSpanProcessor(real);
	// Registered directly rather than via real.register(), which would put the unwrapped
	// provider in the global slot - and the API ignores a second registration.
	trace.setGlobalTracerProvider(hostProvider);

	const warnings: string[] = [];
	const realWarn = console.warn;
	console.warn = (...args: any[]) => { warnings.push(args.join(' ')); };
	t.teardown(() => { console.warn = realWarn; });

	initTracing({ apiKey: 'key', serverUrl: url, flushIntervalSeconds: 0 });

	// t.ok rather than t.equal: a deep-equal diff of a Proxy over a provider is unreadable.
	t.ok(getProvider() === hostProvider, 'the host provider is detected, not clobbered');
	t.match(warnings.join('\n'), /cannot take a span processor after construction/, 'and the failure to attach is reported');
	t.match(warnings.join('\n'), /spanProcessors/, 'with the fix the host should apply');

	withTracing(function hostOnly() { return 1; })();
	await flushSpans();

	t.equal(hostExporter.getFinishedSpans().length, 1, "the host's own tracing keeps working");
	t.same(collected, [], 'AIQA gets nothing, rather than the host getting broken');
	t.end();
});
