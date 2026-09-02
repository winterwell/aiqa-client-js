/**
 * Browser entry point - `import 'aiqa-client/browser'`, and what the `browser`
 * condition in package.json `exports` resolves `import 'aiqa-client'` to.
 *
 * Works in a browser, a web worker and an MV3 service worker. Nothing reachable from
 * here imports a Node built-in, so it bundles with `--platform=browser`: no `dotenv`
 * (hence no `fs`/`os`/`crypto`) and no `@opentelemetry/sdk-trace-node` (hence no
 * `async_hooks`/`events`). Those are pulled in by src/index.ts alone.
 *
 * Two differences from the Node entry point follow from that:
 *
 *   1. There is no `.env` and no `process.env`, so configure explicitly:
 *      `initTracing({ apiKey, serverUrl, componentTag, ... })` - from
 *      `chrome.storage.sync`, say. Calling it again applies new values.
 *   2. The provider is a `BasicTracerProvider` with no context manager, so
 *      `context.active()` never carries the current span and `withTracing`'s implicit
 *      nesting does not work. Pass parents explicitly instead:
 *      `startSpan(name, { parent, attributes, startTime })`.
 *
 * Flush before the runtime can be suspended - an MV3 service worker can stop at any
 * point, so `await flushSpans()` at the end of each unit of work rather than trusting
 * the auto-flush timer. `flushSpans()` is cheap and never throws.
 */

export * from './core';
