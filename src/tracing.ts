/**
 * Public tracing facade for Node.
 *
 * Same surface as src/tracing/facade.ts, plus the Node platform setup (.env loading and
 * NodeTracerProvider, which installs the async-hooks context manager that `withTracing`
 * needs for implicit span nesting). Browser callers want `aiqa-client/browser` instead -
 * see src/browser.ts.
 *
 * This module exists for the `aiqa-client/dist/tracing.js` deep-import path only; new
 * code should import from the package root. The `.js` is required: package.json's
 * `exports` map passes `./dist/*` through, but `exports` patterns do no extension
 * probing, so `aiqa-client/dist/tracing` no longer resolves.
 */

import './platform/node';

export * from './tracing/facade';
