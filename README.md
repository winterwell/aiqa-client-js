# OpenTelemetry based client - logs traces to the server

## Setup

1. Install dependencies:
```bash
npm install
```

2. Build TypeScript:
```bash
npm run build
```

## Running

Make sure Elasticsearch APM Server is running and accessible at `http://localhost:8200` (or set `OTEL_EXPORTER_OTLP_ENDPOINT`).

Run the example:
```bash
npm start
```

Or run directly with ts-node:
```bash
npm run dev
```

## Retrieving Traces

After running, traces are sent to Elasticsearch. To view them:

1. **Kibana UI**: Navigate to `http://localhost:5601/app/apm/traces`
2. **Elasticsearch API**: Query traces by traceId:
```bash
curl -X GET "localhost:9200/apm-*/_search?q=trace.id:<traceId>"
```

The traceId is printed in the console output when the example runs.

## Configuration

Set the OTLP endpoint via environment variable:
```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://your-elasticsearch:8200 npm start
```

## Usage

### Basic Tracing

```typescript
import { withTracing, withTracingAsync } from './src/tracing';

// Synchronous function
const tracedFn = withTracing(function myFunction(x: number, y: number) {
  return x + y;
});

// Async function
const tracedAsyncFn = withTracingAsync(async function myAsyncFunction(x: number, y: number) {
  await someAsyncOperation();
  return x * y;
});
```

### Grouping Traces by Conversation

To group multiple traces together that are part of the same conversation or session:

```typescript
import { withTracing, setConversationId } from './src/tracing';

const tracedFn = withTracing(function handleUserRequest(userId: string, sessionId: string) {
  // Set conversation ID to group all traces for this user session
  setConversationId(`user_${userId}_session_${sessionId}`);
  // All spans created in this function and its children will have this gen_ai.conversation.id
  // ... rest of function
});
```

The `gen_ai.conversation.id` attribute allows you to filter and group traces in the AIQA server by conversation, making it easier to analyze multi-step interactions or user sessions. See the [OpenTelemetry GenAI Events specification](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/) for more details.

### Trace ID Propagation Across Services/Agents

To link traces across different services or agents, you can extract and propagate trace IDs:

#### Getting Current Trace ID

```typescript
import { getTraceId, getSpanId } from './src/tracing';

// Get the current trace ID and span ID
const traceId = getTraceId();  // Returns hex string (32 chars) or undefined
const spanId = getSpanId();    // Returns hex string (16 chars) or undefined

// Pass these to another service (e.g., in HTTP headers, message queue, etc.)
```

#### Continuing a Trace in Another Service

```typescript
import { createSpanFromTraceId, trace, context } from './src/tracing';
import { trace as otelTrace } from '@opentelemetry/api';

// Continue a trace from another service/agent
// traceId and parentSpanId come from the other service
const span = createSpanFromTraceId(
  traceId, 
  parentSpanId,
  "service_b_operation"
);

context.with(otelTrace.setSpan(context.active(), span), () => {
  // Your code here - this span will be linked to the original trace
  span.end();
});
```

#### Using OpenTelemetry Context Propagation (Recommended)

For HTTP requests, use the built-in context propagation:

```typescript
import { injectTraceContext, extractTraceContext } from './src/tracing';
import { trace, context } from '@opentelemetry/api';
import axios from 'axios';

// In the sending service:
const headers: Record<string, string> = {};
injectTraceContext(headers);  // Adds trace context to headers
const response = await axios.get("http://other-service/api", { headers });

// In the receiving service:
// Extract context from incoming request headers
const ctx = extractTraceContext(request.headers);

// Use the context to create a span
const span = tracer.startSpan("operation", {}, ctx);
context.with(trace.setSpan(ctx, span), () => {
  // Your code here
  span.end();
});
```

