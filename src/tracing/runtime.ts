/**
 * Tracing pipeline lifecycle: build it, reconfigure it, flush it, tear it down.
 *
 * The pipeline is built lazily on first use, so importing the package is cheap. It can
 * also be built or rebuilt explicitly with `initTracing({...})`, which is how browser
 * and MV3 callers supply config that cannot come from `process.env`.
 *
 * Which TracerProvider gets built is decided by src/tracing/provider.ts, so this module
 * stays free of Node built-ins and can be bundled for a browser.
 */

import { context, propagation, trace, type Tracer } from '@opentelemetry/api';
import type { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { AIQASpanExporter } from '../aiqa-exporter';
import { TRACER_NAME } from './constants';
import {
	exporterConfigChanged,
	getComponentTagConfig,
	getConfig,
	providerConfigChanged,
	setConfigOverrides,
	type AIQAConfig,
	type InitTracingOptions,
} from './config';
import { attachSpanProcessor, createBatchProcessor, getProviderFactory, isSdkTracerProvider } from './provider';

let initialized = false;
let shutdownComplete = false;
let provider: BasicTracerProvider | null = null;
/** False when we attached to a provider the host application registered. */
let ownsProvider = false;
let exporter: AIQASpanExporter | null = null;
let tracer: Tracer | null = null;
let tracingEnabled = false;
let activeConfig: AIQAConfig | null = null;
let missingKeyWarned = false;
let hostAttachWarned = false;

/**
 * The provider the host application registered, if any.
 *
 * `trace.getTracerProvider()` hands back a ProxyTracerProvider, so the real provider is
 * one `getDelegate()` hop away; an unset delegate is a NoopTracerProvider. Whether we can
 * then attach our exporter to it is a separate question - see `attachSpanProcessor`.
 */
function resolveExistingProvider(): BasicTracerProvider | null {
	try {
		const registered: any = trace.getTracerProvider();
		const candidate = registered && typeof registered.getDelegate === 'function' ? registered.getDelegate() : registered;
		if (isSdkTracerProvider(candidate)) {
			return candidate;
		}
	} catch (_e) {
		// Fall through: build our own provider.
	}
	return null;
}

/** Undo the global registrations `provider.register()` made, so we can register again. */
function unregisterGlobals(): void {
	try {
		trace.disable();
		context.disable();
		propagation.disable();
	} catch (e) {
		console.warn('AIQA: Error unregistering OpenTelemetry globals:', e);
	}
}

function buildPipeline(config: AIQAConfig): void {
	activeConfig = config;
	if (!config.apiKey) {
		if (!missingKeyWarned) {
			console.warn('AIQA: WARNING: Tracing is disabled: no API key. Set AIQA_API_KEY, or call initTracing({ apiKey }).');
			console.warn('AIQA: Your application will continue to run without tracing.');
			missingKeyWarned = true;
		}
		tracingEnabled = false;
		tracer = null;
		provider = null;
		exporter = null;
		ownsProvider = false;
		return;
	}

	missingKeyWarned = false;
	tracingEnabled = true;
	exporter = new AIQASpanExporter(config.serverUrl, config.apiKey, config.flushIntervalSeconds);
	const existing = resolveExistingProvider();
	if (existing) {
		// Share the host's provider rather than clobbering the global registration,
		// which would break their instrumentation and our context propagation.
		provider = existing;
		ownsProvider = false;
		if (!attachSpanProcessor(existing, createBatchProcessor(exporter)) && !hostAttachWarned) {
			// An OpenTelemetry SDK 2.x provider takes its processors at construction only.
			console.warn('AIQA: WARNING: The TracerProvider this application registered cannot take a span processor after construction (OpenTelemetry SDK 2.x), so AIQA cannot attach its exporter to it.');
			console.warn('AIQA: Spans are still recorded for that provider. To send them to AIQA too, pass the exporter in when you build it: new NodeTracerProvider({ spanProcessors: [new BatchSpanProcessor(new AIQASpanExporter())] }).');
			hostAttachWarned = true;
		}
	} else {
		provider = getProviderFactory()({
			serviceName: config.serviceName,
			samplingRate: config.samplingRate,
			spanProcessors: [createBatchProcessor(exporter)],
		});
		ownsProvider = true;
		provider.register();
	}
	tracer = trace.getTracer(TRACER_NAME);
}

/**
 * Discard the current pipeline. The old exporter is flushed in the background, so spans
 * recorded under the previous config are still sent with the credentials they were
 * recorded under. Callers wanting to wait should use `shutdownTracing()` instead.
 */
function teardown(): void {
	const oldProvider = provider;
	const oldExporter = exporter;
	const owned = ownsProvider;
	provider = null;
	exporter = null;
	tracer = null;
	ownsProvider = false;
	tracingEnabled = false;
	if (owned && oldProvider) {
		// shutdown() drains the batch processor, which flushes and shuts down the exporter.
		void oldProvider.shutdown().catch(e => console.warn('AIQA: Error shutting down previous tracer provider:', e));
		unregisterGlobals();
	} else if (oldExporter) {
		void oldExporter.shutdown().catch(e => console.warn('AIQA: Error shutting down previous span exporter:', e));
	}
}

/** Move the running pipeline to `next`, doing the least work that will get us there. */
function applyConfig(next: AIQAConfig): void {
	const prev = activeConfig;
	// componentTag, organisationId and the like are read live from getConfig(), so a
	// change to those needs nothing done here.
	if (prev && !exporterConfigChanged(prev, next) && !providerConfigChanged(prev, next)) {
		activeConfig = next;
		return;
	}

	if (prev && exporter && provider && !ownsProvider) {
		// We added a span processor to the host's provider and there is no API for
		// removing it again, so reconfigure in place rather than leaking a processor.
		if (providerConfigChanged(prev, next)) {
			console.warn('AIQA: samplingRate/serviceName cannot be changed while attached to an existing TracerProvider; ignoring.');
		}
		exporter.configure(next);
		tracingEnabled = !!next.apiKey;
		activeConfig = next;
		return;
	}

	if (prev && exporter && provider && next.apiKey && !providerConfigChanged(prev, next)) {
		// Credentials or endpoint only: swap them into the running exporter.
		exporter.configure(next);
		tracingEnabled = true;
		activeConfig = next;
		return;
	}

	teardown();
	buildPipeline(next);
}

/**
 * Configure and start tracing explicitly. Optional on Node, where config is read from
 * the environment and tracing starts on first use; required in a browser or an MV3
 * service worker, where there is no `process.env` to read.
 *
 * Safe to call repeatedly - for example after the user edits their API key. Anything
 * omitted keeps its previous value, falling back to the environment. Changing the API
 * key, server URL or flush interval updates the running exporter in place; changing
 * `samplingRate` or `serviceName` rebuilds the provider, which is only possible for a
 * provider this client created.
 */
export function initTracing(options: InitTracingOptions = {}): void {
	setConfigOverrides(options);
	const next = getConfig();
	shutdownComplete = false;
	if (!initialized) {
		initialized = true;
		buildPipeline(next);
		return;
	}
	applyConfig(next);
}

/** Back-compat alias for the lazy initialisation path. */
export function getAIQAClient(): void {
	ensureTracingInitialized();
}

export function ensureTracingInitialized(): void {
	if (initialized || shutdownComplete) {
		return;
	}
	initialized = true;
	buildPipeline(getConfig());
}

/**
 * Send any buffered spans now. Cheap to call often - it is a no-op if nothing has been
 * traced - and never throws, so it is safe on a path that may be about to be suspended,
 * such as the end of an MV3 service worker task. Send failures are logged.
 */
export async function flushSpans(): Promise<void> {
	if (!initialized) {
		return;
	}
	const currentProvider = provider;
	const currentExporter = exporter;
	if (currentProvider) {
		try {
			await currentProvider.forceFlush();
		} catch (e) {
			console.warn('AIQA: Error flushing span processors:', e);
		}
	}
	if (currentExporter) {
		try {
			await currentExporter.flush();
		} catch (e) {
			console.warn('AIQA: Error flushing spans to server:', e);
		}
	}
}

/**
 * Flush and stop tracing. Lazy initialisation will not restart it afterwards; call
 * `initTracing()` to start again.
 */
export async function shutdownTracing(): Promise<void> {
	initialized = true;
	shutdownComplete = true;
	// Clear the remembered config as well as the pipeline, so a later initTracing() with
	// the same settings rebuilds rather than taking applyConfig's "nothing changed" path.
	activeConfig = null;
	const oldProvider = provider;
	const oldExporter = exporter;
	const owned = ownsProvider;
	provider = null;
	exporter = null;
	tracer = null;
	ownsProvider = false;
	tracingEnabled = false;
	if (owned && oldProvider) {
		await oldProvider.shutdown();
		unregisterGlobals();
	}
	if (oldExporter) {
		await oldExporter.shutdown();
	}
}

export function getProvider(): BasicTracerProvider | null {
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

export function getTracer(): Tracer | null {
	ensureTracingInitialized();
	return tracer;
}

/** The effective config, after programmatic overrides and the environment. */
export function getTracingConfig(): AIQAConfig {
	return getConfig();
}

export function getComponentTag(): string {
	return getComponentTagConfig();
}

/** Set the tag reported as `gen_ai.component.id`. Takes effect on the next span. */
export function setComponentTag(tag: string): void {
	// Nothing else to do: the tag is read live from the config on every span, and neither
	// the provider nor the exporter holds a copy of it.
	setConfigOverrides({ componentTag: tag });
}
