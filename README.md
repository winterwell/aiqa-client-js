# aiqa-client

OpenTelemetry-based JS/TS client for [AIQA](https://github.com/winterwell/aiqa). Wrap your
functions, and their inputs, outputs, timings and LLM token usage are traced to the AIQA
server.

Sibling clients: [`aiqa-client` for Python](https://pypi.org/project/aiqa-client/) and
`aiqa-client-go`.

## Install

```bash
npm install aiqa-client
```

`@opentelemetry/api` is a peer dependency, so your app and this client share a single
OpenTelemetry instance (two copies in one process would break trace context
propagation). npm 7+ installs it for you; with pnpm or an older npm, add it explicitly:

```bash
npm install @opentelemetry/api
```

Requires Node 18 or newer. For browsers, web workers and Chrome MV3 extensions, see
[Browsers and MV3 extensions](#browsers-and-mv3-extensions).

## Configure

Set these in the environment, or in a `.env` file in your project root (see
`env.example`). Values already present in the environment always take precedence.

| Variable | Description |
| --- | --- |
| `AIQA_API_KEY` | **Required.** Without it, tracing is disabled and your app runs untraced. |
| `AIQA_SERVER_URL` | AIQA server to send traces to. |
| `AIQA_ORGANISATION_ID` | Your organisation ID within AIQA. |
| `AIQA_COMPONENT_TAG` | Optional tag on all spans, e.g. `mynamespace.mysystem`, for filtering in the Traces view. |
| `AIQA_SAMPLING_RATE` | Fraction of traces to sample, `0`-`1`. Defaults to `1`. |
| `OTEL_SERVICE_NAME` | Service name reported on spans. Falls back to `AIQA_SERVICE_NAME`, then `aiqa-client`. |

Tracing initialises lazily on first use, so importing the package is cheap and safe.

Or configure it in code, which is the only option where there is no environment to read
- a browser, or an extension reading its settings from `chrome.storage`:

```typescript
import { initTracing } from 'aiqa-client';

initTracing({
  apiKey,                    // required for tracing to be enabled
  serverUrl,                 // default https://server-aiqa.winterwell.com
  organisationId,
  componentTag: 'myext.worker',
  samplingRate: 0.25,
  serviceName: 'my-service',
  flushIntervalSeconds: 5,   // 0 turns the auto-flush timer off
});
```

Anything omitted keeps its previous value, falling back to the environment, so
`initTracing({ apiKey })` on its own is fine. Call it again whenever the config changes
- after the user edits their API key, say. Changing the key, server URL or flush
interval updates the running exporter in place; changing `samplingRate` or `serviceName`
rebuilds the tracer provider.

## Basic tracing

```typescript
import { withTracing, withTracingAsync, flushSpans } from 'aiqa-client';

const add = withTracing(function add(x: number, y: number) {
  return x + y;
});

const fetchAnswer = withTracingAsync(async function fetchAnswer(prompt: string) {
  return await callTheModel(prompt);
});

// Before a short-lived process exits, flush pending spans:
await flushSpans();
```

Streaming results are handled: if a wrapped function returns an iterable or async
iterable, the span stays open until the stream is exhausted, and
`gen_ai.server.time_to_first_output_token` is recorded when the first chunk is emitted.

Inputs and outputs are recorded as JSON when they are not something OpenTelemetry can
store directly, and the data filters (`AIQA_DATA_FILTERS`) run over them first, so
passwords, JWTs, auth headers and API keys are redacted.

## Spans with an explicit parent

`withTracing` nests spans through the OpenTelemetry context, which needs a context
manager that survives `await`. Node has one; a browser and an MV3 service worker do not,
so there `context.active()` never holds the current span and implicit nesting silently
gives you a flat trace of orphans. Pass the parent yourself instead:

```typescript
import { startSpan, flushSpans } from 'aiqa-client';

const page = startSpan('analyse_page', { attributes: { url } });
const chunks = startSpan('chunk_page', { parent: page, startTime: chunkedAt });
chunks.end();
const answer = startSpan('call_model', { parent: page });
answer.end();
page.end();
await flushSpans();
```

`startSpan(name, options)` always returns a span - a non-recording one if tracing is
disabled or the span was sampled out - so there is nothing to null-check. Options:

| Option | Description |
| --- | --- |
| `parent` | A span, a `SpanContext`, or a whole `Context`. Omit to use the active context; `null` starts a new trace. |
| `attributes` | Attributes to set on the span, run through the data filters. |
| `startTime` | Span start time. Lets you replay work that was timed elsewhere - in a content script, say. |
| `kind`, `links`, `root` | Passed through to OpenTelemetry. |
| `samplingRate` | Sample this call site at `0`-`1`, independently of `AIQA_SAMPLING_RATE`. Dropping a span drops any span created with it as an explicit `parent`. |

`setSpanAttribute`, `setConversationId`, `setTokenUsage`, `setProviderAndModel`,
`getTraceId` and `getSpanId` all take an optional span as their last argument, for the
same reason - without it they annotate the active span, and there isn't one.

## Grouping traces by conversation

```typescript
import { withTracing, setConversationId } from 'aiqa-client';

const handleUserRequest = withTracing(function handleUserRequest(userId: string, sessionId: string) {
  setConversationId(`user_${userId}_session_${sessionId}`);
  // this span and its children all carry the same gen_ai.conversation.id
});
```

`gen_ai.conversation.id` lets you filter and group traces by conversation in AIQA, which
is what you want for analysing multi-step interactions. See the
[OpenTelemetry GenAI events spec](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/).

## Propagating traces across services

For HTTP, use context propagation (recommended):

```typescript
import { injectTraceContext, extractTraceContext } from 'aiqa-client';
import { trace, context } from '@opentelemetry/api';

// Sending service:
const headers: Record<string, string> = {};
injectTraceContext(headers);
await fetch('http://other-service/api', { headers });

// Receiving service:
const ctx = extractTraceContext(request.headers);
const span = tracer.startSpan('operation', {}, ctx);
context.with(trace.setSpan(ctx, span), () => {
  // ... your code
  span.end();
});
```

Where you can only pass IDs around (a message queue, say), carry them explicitly:

```typescript
import { getTraceId, getSpanId, createSpanFromTraceId } from 'aiqa-client';

const traceId = getTraceId();  // 32-char hex, or undefined
const spanId = getSpanId();    // 16-char hex, or undefined

// In the other service:
const span = createSpanFromTraceId(traceId, parentSpanId, 'service_b_operation');
```

## Browsers and MV3 extensions

```typescript
import { initTracing, startSpan, flushSpans } from 'aiqa-client/browser';
```

`import 'aiqa-client'` also works: bundlers targeting the browser resolve it to the same
place through the `browser` condition in the package's `exports` map. The browser build
reaches no Node built-ins, so it bundles with `esbuild --platform=browser` and friends -
no `dotenv` (and so no `fs`/`os`/`crypto`), and no `@opentelemetry/sdk-trace-node` (and
so no `async_hooks`/`events`).

Three things to know:

- **Configure it in code.** There is no `.env` and no `process.env`, so call
  `initTracing({ apiKey, ... })` - from `chrome.storage.sync`, typically. Nothing is
  traced until it has an API key.
- **Pass parents explicitly.** The provider is a `BasicTracerProvider` with no context
  manager, so use `startSpan(name, { parent })` rather than relying on `withTracing`'s
  implicit nesting. See [Spans with an explicit parent](#spans-with-an-explicit-parent).
- **Flush before you can be suspended.** An MV3 service worker can stop at any point, so
  `await flushSpans()` at the end of each unit of work rather than trusting the
  auto-flush timer. `flushSpans()` is cheap to call often and never throws;
  `initTracing({ flushIntervalSeconds: 0 })` turns the timer off entirely.

```typescript
const { apiKey, serverUrl } = await chrome.storage.sync.get(['apiKey', 'serverUrl']);
initTracing({ apiKey, serverUrl, componentTag: 'myext.worker', flushIntervalSeconds: 0 });

async function analysePage(url: string, chunkedAt: number) {
  const page = startSpan('analyse_page', { attributes: { url } });
  try {
    // timed in the content script, replayed here
    startSpan('chunk_page', { parent: page, startTime: chunkedAt }).end();
    const model = startSpan('call_model', { parent: page });
    try {
      return await callTheModel(url);
    } finally {
      model.end();
    }
  } finally {
    page.end();
    await flushSpans();
  }
}
```

`AIQASpanExporter` is exported from both entry points, if you would rather drive your own
`TracerProvider`.

## Experiments

Run a dataset of examples through your code and score the outputs:

```typescript
import { ExperimentRunner } from 'aiqa-client';

const runner = new ExperimentRunner({ datasetId: 'my-dataset', parallelism: 4 });
await runner.createExperiment();

for (const example of await runner.getExampleInputs()) {
  await runner.runExample(example, async (output, ex, parameters) => scoreIt(output, ex));
}

console.log(await runner.getSummaryResults());
```

`parallelism` controls how many examples run concurrently (default 1). By default the
runner does not mutate process-wide env vars while running examples; opt in with
`setEnvFromParameters: true`.

## Other exports

- `initTracing` - configure and start tracing in code, instead of from the environment
- `startSpan` - a span with an explicit parent, attributes and start time
- `submitFeedback` - attach user feedback to a trace
- `getSpan`, `getOrganisation`, `getAPIKeyInfo` - AIQA server lookups
- `scoreMetric`, `scoreAllMetrics` - score metrics locally
- `AIQASpanExporter` - the raw exporter, for wiring up your own OpenTelemetry provider
- `shutdownTracing`, `isTracingEnabled`, `getProvider`, `getExporter`, `getTracingConfig`
- Types: `Example`, `Dataset`, `Metric`, `Experiment`, `Span`, `MetricStats`,
  `TracingOptions`, `StartSpanOptions`, `SpanParent`, `InitTracingOptions`, `AIQAConfig`,
  `ExperimentRunnerOptions`, `ScoreResult`, `AIQASpanExporterOptions`

## Development

```bash
npm install
npm run build          # compile to dist/ (entry points: src/index.ts, src/browser.ts)
npm run typecheck      # typecheck everything, including src/common
npm test               # build, then run the tap tests
```

`test/test_browser_entry.ts` bundles the browser entry point with esbuild and runs it in
a `vm` sandbox with no `process`, which is what stops a Node-only import creeping back
into the browser build.

### `src/common` is generated - do not edit it

`src/common/` is a straight copy of `aiqa/server/src/common`, which is the canonical
source. Edit the originals in the aiqa server repo, then resync:

```bash
npm run sync-types              # copy from aiqa/server/src/common
npm run sync-types -- --check   # exit 1 if src/common has drifted (runs on npm test)
```

Edits made directly under `src/common/` are overwritten by the next sync. The sync
mirrors deletions too, and expects the aiqa repo checked out as a sibling of this one.
See `CLAUDE.md` for the full rationale.

Publishing: see [how-to-publish.md](how-to-publish.md).

## License

MIT - see [LICENSE](LICENSE).
