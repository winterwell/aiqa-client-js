import * as dotenv from 'dotenv';
import * as path from 'path';
import { trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { AIQASpanExporter } from '../aiqa-exporter';
import { DEFAULT_AIQA_SERVER_URL, TRACER_NAME } from './constants';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

let samplingRate = 1.0;
if (process.env.AIQA_SAMPLING_RATE) {
	const rate = parseFloat(process.env.AIQA_SAMPLING_RATE);
	if (!isNaN(rate)) {
		samplingRate = Math.max(0, Math.min(1, rate));
	}
}

let componentTag: string = process.env.AIQA_COMPONENT_TAG || '';
let initialized = false;
let provider: NodeTracerProvider | null = null;
let exporter: AIQASpanExporter | null = null;
let tracer: trace.Tracer | null = null;
let tracingEnabled = true;

export function getAIQAClient(): void {
	if (!initialized) {
		ensureTracingInitialized();
	}
}

export function ensureTracingInitialized(): void {
	if (initialized) {
		return;
	}
	initialized = true;

	const aiqaServerUrl = process.env.AIQA_SERVER_URL || DEFAULT_AIQA_SERVER_URL;
	const aiqaApiKey = process.env.AIQA_API_KEY || '';
	if (!aiqaApiKey) {
		console.warn('AIQA: WARNING: Tracing is disabled: missing required environment variables: AIQA_API_KEY');
		console.warn('AIQA: Your application will continue to run without tracing.');
		tracingEnabled = false;
		tracer = null;
		provider = null;
		exporter = null;
		return;
	}

	tracingEnabled = true;
	exporter = new AIQASpanExporter(aiqaServerUrl, aiqaApiKey);
	const existingProvider = trace.getTracerProvider();
	const isRealProvider = existingProvider && typeof (existingProvider as any).addSpanProcessor === 'function';
	if (!isRealProvider) {
		provider = new NodeTracerProvider({
			resource: new Resource({ [SEMRESATTRS_SERVICE_NAME]: 'example-service' }),
			sampler: new TraceIdRatioBasedSampler(samplingRate),
		});
		provider.addSpanProcessor(new BatchSpanProcessor(exporter));
		provider.register();
	} else {
		provider = existingProvider as NodeTracerProvider;
		let processorAlreadyAdded = false;
		try {
			const processors = (provider as any)._spanProcessors;
			if (processors) {
				for (const proc of processors) {
					if (proc && proc._exporter === exporter) {
						processorAlreadyAdded = true;
						break;
					}
				}
			}
		} catch (_e) {
			// Best effort duplicate detection only.
		}
		if (!processorAlreadyAdded) {
			provider.addSpanProcessor(new BatchSpanProcessor(exporter));
		}
	}
	tracer = trace.getTracer(TRACER_NAME);
}

export async function flushSpans(): Promise<void> {
	ensureTracingInitialized();
	if (provider) {
		await provider.forceFlush();
	}
	if (exporter) {
		await exporter.flush();
	}
}

export async function shutdownTracing(): Promise<void> {
	ensureTracingInitialized();
	tracingEnabled = false;
	if (provider) {
		await provider.shutdown();
	}
	if (exporter) {
		await exporter.shutdown();
	}
	tracer = null;
}

export function getProvider(): NodeTracerProvider | null {
	ensureTracingInitialized();
	return provider;
}

export function getExporter(): AIQASpanExporter | null {
	ensureTracingInitialized();
	return exporter;
}

export function isTracingEnabled(): boolean {
	ensureTracingInitialized();
	return tracingEnabled;
}

export function getTracer(): trace.Tracer | null {
	ensureTracingInitialized();
	return tracer;
}

export function getComponentTag(): string {
	return componentTag;
}

export function setComponentTag(tag: string): void {
	componentTag = tag;
}
