/**
 * Node platform setup. Imported for its side effects by the Node entry points
 * (src/index.ts and src/tracing.ts) and by nothing the browser build reaches - see
 * src/tracing/provider.ts for why this cannot be a conditional import.
 *
 * Two things happen here, both Node-only:
 *   - the host application's .env is loaded
 *   - the TracerProvider becomes NodeTracerProvider, which installs the async-hooks
 *     context manager, so `context.active()` tracks the current span across awaits and
 *     `withTracing` nests spans implicitly
 */

import * as dotenv from 'dotenv';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { SERVICE_NAME_ATTRIBUTE } from '../tracing/constants';
import { setProviderFactory, type ProviderOptions } from '../tracing/provider';

// Load the host application's .env, if it has one. Resolved against the process
// working directory, NOT __dirname: as an installed package __dirname points into
// node_modules/aiqa-client, where there is no .env. Existing environment
// variables always win, so this never clobbers config set by the host.
dotenv.config();

setProviderFactory((options: ProviderOptions) => new NodeTracerProvider({
	resource: new Resource({ [SERVICE_NAME_ATTRIBUTE]: options.serviceName }),
	sampler: new TraceIdRatioBasedSampler(options.samplingRate),
	spanProcessors: options.spanProcessors,
}));
