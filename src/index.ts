/**
 * Node entry point for the aiqa-client package - `import 'aiqa-client'`.
 *
 * Adds the Node platform setup to the shared surface in src/core.ts: the host
 * application's `.env` is loaded, and the TracerProvider is a NodeTracerProvider, whose
 * async-hooks context manager is what lets `withTracing` nest spans implicitly across
 * awaits.
 *
 * Browser, web worker and MV3 service worker callers want `aiqa-client/browser`
 * (src/browser.ts), which cannot use either of those. Bundlers targeting the browser
 * pick that up automatically via the `browser` condition in package.json `exports`.
 */

import './platform/node';

export * from './core';
