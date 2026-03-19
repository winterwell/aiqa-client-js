# Changelog for aiqa-client-js

## Pending version

- Added: `withTracing` and `withTracingAsync` now keep spans open for iterable/async-iterable streaming results and record `gen_ai.server.time_to_first_output_token` (seconds) when the first chunk is emitted.
- Added: `extractAndSetTokenUsage` now also records cache token attributes (`gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens`) and supports extracting usage from JSON-string outputs.
- Added: `ExperimentRunner` supports concurrent execution with `parallelism` option.
- Changed: `ExperimentRunner` no longer mutates process-wide env vars by default while running examples; opt in with `setEnvFromParameters: true`.
- Fixed: `submitFeedback()` now sets `gen_ai.operation.name` using a defined constant (previously referenced an undefined symbol).
- Fixed: `withTracing` and `withTracingAsync` now apply `ignoreInput` and `ignoreOutput` filters instead of leaving them as TODO stubs.
- Fixed: iterable and async-iterable tracing now runs iterator `next()` inside span context to keep context propagation consistent during streaming.
- Changed: reduced repeated HTTP request boilerplate in tracing and experiment runner by centralizing common header/request helpers.