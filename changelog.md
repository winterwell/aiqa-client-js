# Changelog for aiqa-client-js

## Pending version

- Fixed: no spans reached the server at all. They were posted to `POST /span`, which the
  AIQA server dropped in January 2026 in favour of the OTLP endpoint (`POST /v1/traces`),
  so every flush 404'd - logged by the exporter, but not raised, leaving a configured
  client looking healthy with an empty Traces view. Spans are now serialised as OTLP/JSON
  and posted to `/v1/traces`, the same endpoint the Python and Go clients use. `GET /span`
  is unaffected, so the server lookup helpers are unchanged. Serialisation is ours rather
  than OpenTelemetry's OTLP exporter (`src/otlp-json.ts`), whose browser build needs
  XMLHttpRequest or sendBeacon - an MV3 service worker has neither.

Browser, web worker and Chrome MV3 support, requested by the `bn-extension` MV3
consumer, which previously had to deep-import `dist/aiqa-exporter.js` and drive it
itself.

- Added: a browser entry point. `import 'aiqa-client/browser'`, or just
  `import 'aiqa-client'` - a `browser` condition in the new package.json `exports` map
  points bundlers at it. It reaches no Node built-ins, so it bundles with
  `esbuild --platform=browser`: no `dotenv` (and so no `fs`/`os`/`crypto`) and no
  `@opentelemetry/sdk-trace-node` (and so no `async_hooks`/`events`). It uses
  `BasicTracerProvider`; the Node entry point still uses `NodeTracerProvider` and still
  loads `.env`.
- Added: `initTracing({ apiKey, serverUrl, organisationId, componentTag, samplingRate,
  serviceName, flushIntervalSeconds })` - programmatic config, for runtimes with no
  `process.env` to read. Safe to call repeatedly: changing the key, server URL or flush
  interval reconfigures the running exporter in place, and changing `samplingRate` or
  `serviceName` rebuilds the provider.
- Added: `startSpan(name, { parent, attributes, startTime, kind, links, root,
  samplingRate })`, for an explicitly parented span. No OpenTelemetry context manager
  survives an `await` in an MV3 service worker, so `context.active()` cannot be relied on
  to hold the current span and `withTracing`'s implicit nesting does not work there.
  `startTime` also lets work timed elsewhere be replayed as a span.
- Added: `setSpanAttribute`, `setConversationId`, `setTokenUsage`, `setProviderAndModel`,
  `getTraceId` and `getSpanId` take an optional span as a trailing argument, for the same
  reason - by default they annotate the active span, and there isn't one.
- Added: per-call-site sampling. `samplingRate` on `startSpan`, `withTracing` and
  `withTracingAsync` samples one call site independently of `AIQA_SAMPLING_RATE`;
  dropping a span drops any span created with it as an explicit `parent`.
- Added: `AIQASpanExporter.configure({ serverUrl, apiKey, flushIntervalSeconds })`,
  to change credentials on a running exporter. A span processor cannot be detached from a
  TracerProvider, so replacing the exporter would leave the old one wired in.
  `flushIntervalSeconds: 0` disables the auto-flush timer, for runtimes where a timer
  cannot be relied on anyway.
- Added: `getTracingConfig()`, returning the effective config after overrides and env.
- Fixed: config was read from `process.env` at the point of use, which is a
  ReferenceError rather than undefined in a browser or a service worker. All env access
  now goes through a guarded helper (`src/env.ts`). This affected `getEnabledFilters`,
  `AIQASpanExporter`'s constructor defaults, the server lookup helpers and
  `ExperimentRunner`.
- Fixed: an existing host-registered `TracerProvider` was never detected, so the client
  always registered its own and clobbered the global. The check looked for
  `addSpanProcessor` on the value from `trace.getTracerProvider()`, which is a
  `ProxyTracerProvider` and never has it; the real provider is one `getDelegate()` hop
  away. The client now adds its span processor to the host's provider instead. Detection
  is by `register`/`forceFlush`/`shutdown`, which both OpenTelemetry SDK generations have,
  rather than by `addSpanProcessor`, which 1.x has and 2.x does not - so a 2.x host
  provider is recognised too. It still cannot be *attached* to, because 2.x takes span
  processors at construction only; the client leaves it registered and says so, since
  clobbering it would break the host's own tracing. To send those spans to AIQA, pass the
  exporter in when building the provider:
  `new NodeTracerProvider({ spanProcessors: [new BatchSpanProcessor(new AIQASpanExporter())] })`.
- Changed: `flushSpans()` no longer throws - send failures are logged - and returns
  immediately if nothing has been traced, so it is cheap to call on a path that may be
  about to be suspended.
- Changed: `shutdownTracing()` is no longer undone by the next traced call. Lazy
  initialisation stays off after it; call `initTracing()` to start again.
- Changed: dropped the `@opentelemetry/semantic-conventions` dependency, which was
  imported for the single string `'service.name'`. It is an un-treeshakeable barrel of
  every convention ever defined, so that one import cost ~250kB in a browser bundle. It
  also renamed its exports between 1.x and 2.x.
- Changed: OpenTelemetry SDK dependencies now require `^1.30.0` (was `^1.24.0`), so the
  `spanProcessors` constructor option can be used instead of the deprecated
  `addSpanProcessor` for providers this client creates. Still 1.x: `new Resource(...)`
  does not exist in `@opentelemetry/resources` 2.x, so a 2.x bump stays a breaking change.
- Changed: `getProvider()` is typed `BasicTracerProvider | null` rather than
  `NodeTracerProvider | null`, since the browser build returns the former.
  `NodeTracerProvider` extends it, so callers using `forceFlush`/`shutdown` are unaffected.
Also fixed along the way, both found while reworking span attributes and both affecting
Node as much as the browser:

- Fixed: attribute values OpenTelemetry cannot record were silently dropped. It accepts
  only a string, number, boolean or homogeneous array of those, and discards anything
  else with nothing but a `diag` warning - so the `input` and `output` attributes were
  lost on every traced function taking or returning an object, which is most of them.
  They are now serialised to JSON, matching what the Python client sends.
- Fixed: span serialisation read only the OpenTelemetry 1.x `ReadableSpan` shape, so
  spans from a 2.x SDK were sent with `parent_span_id: undefined` - a flattened trace
  tree on the server rather than a loud failure. The exporter does not control which SDK
  it is attached to (it can be wired into a provider the host application registered), so
  it now reads `parentSpanContext`/`instrumentationScope` (2.x) or
  `parentSpanId`/`instrumentationLibrary` (1.x), whichever is present.
- Fixed: `filterDataRecursive` followed cycles until the stack overflowed, so a
  self-referencing argument (a DOM node, an error with a cause chain, a request holding
  its own response) threw a RangeError out of the traced function rather than just losing
  an attribute. Cycles are now recorded as `"[Circular]"`.

- Changed, and breaking for one case: adding an `exports` map narrows what can be
  deep-imported. `./dist/*` is mapped through deliberately, so an *extensioned* deep path
  like `aiqa-client/dist/aiqa-exporter.js` keeps working. But `exports` patterns do no
  file-extension probing, so the extensionless form that plain CommonJS resolution used to
  accept - `require('aiqa-client/dist/aiqa-exporter')` - now fails with
  `MODULE_NOT_FOUND`. Add the `.js`, or better, import from the package root: everything
  worth deep-importing, `AIQASpanExporter` included, is exported from both entry points.

## 0.9.1

First npm release, published as `aiqa-client`.

- Added: packaged for npm - `src/index.ts` entry point, generated `.d.ts` type declarations, and a `files` allowlist so only `dist/` and the docs ship.
- Added: `src/common` is now a straight copy of `aiqa/server/src/common` (the canonical source), synced by `npm run sync-types`, with a `--check` drift guard wired into `pretest`. It was previously a committed symlink into a sibling checkout, so every fresh clone had a broken build.
- Added: service name on spans is configurable via `OTEL_SERVICE_NAME` / `AIQA_SERVICE_NAME` (was hardcoded to `example-service`).
- Fixed: `.env` loading resolved against the package directory rather than the host application, so an installed copy could never find the app's `.env`. Now resolved against the working directory.
- Fixed: `localScoring` imported `Metric` from `Dataset`, binding it to the `Dataset` interface; and `ExperimentRunner` imported a non-existent named `Metric` export. Both were masked by the broken symlink resolving those modules to `any`.
- Fixed: `ExperimentRunner.getSummaryResults()` declared a return type requiring an internal `_sumSq` field that the server never sends.
- Changed: `@opentelemetry/api` is now a peer dependency, so the client shares the host application's OpenTelemetry instance instead of risking a second copy that breaks context propagation.
- Changed: dropped unused `@elastic/elasticsearch` and `@opentelemetry/exporter-trace-otlp-http` dependencies; declared the previously undeclared `@opentelemetry/core`.
- Added: `withTracing` and `withTracingAsync` now keep spans open for iterable/async-iterable streaming results and record `gen_ai.server.time_to_first_output_token` (seconds) when the first chunk is emitted.
- Added: `extractAndSetTokenUsage` now also records cache token attributes (`gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens`) and supports extracting usage from JSON-string outputs.
- Added: `ExperimentRunner` supports concurrent execution with `parallelism` option.
- Changed: API requests now send `Authorization: Bearer <api_key>` by default (server still accepts legacy `Authorization: ApiKey <api_key>`).
- Changed: `ExperimentRunner` no longer mutates process-wide env vars by default while running examples; opt in with `setEnvFromParameters: true`.
- Fixed: `submitFeedback()` now sets `gen_ai.operation.name` using a defined constant (previously referenced an undefined symbol).
- Fixed: `withTracing` and `withTracingAsync` now apply `ignoreInput` and `ignoreOutput` filters instead of leaving them as TODO stubs.
- Fixed: iterable and async-iterable tracing now runs iterator `next()` inside span context to keep context propagation consistent during streaming.
- Changed: reduced repeated HTTP request boilerplate in tracing and experiment runner by centralizing common header/request helpers.