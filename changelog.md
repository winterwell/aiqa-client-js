# Changelog for aiqa-client-js

## Pending version

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