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

Requires Node 18 or newer.

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

- `submitFeedback` - attach user feedback to a trace
- `getSpan`, `getOrganisation`, `getAPIKeyInfo` - AIQA server lookups
- `scoreMetric`, `scoreAllMetrics` - score metrics locally
- `AIQASpanExporter` - the raw exporter, for wiring up your own OpenTelemetry provider
- `shutdownTracing`, `isTracingEnabled`, `getProvider`, `getExporter`
- Types: `Example`, `Dataset`, `Metric`, `Experiment`, `Span`, `MetricStats`,
  `TracingOptions`, `ExperimentRunnerOptions`, `ScoreResult`

## Development

```bash
npm install
npm run build          # compile to dist/ (entry point: src/index.ts)
npm run typecheck      # typecheck everything, including src/common
npm test               # build, then run the tap tests
```

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
