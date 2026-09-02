/**
 * Resolved AIQA client configuration.
 *
 * Config comes from two places, programmatic values winning over the environment:
 *
 *   1. `initTracing({ apiKey, serverUrl, ... })` - the only option in a browser or an
 *      MV3 service worker, where there is no `process.env` and no `.env` file. Callers
 *      typically read these from `chrome.storage` or a settings endpoint.
 *   2. `AIQA_*` environment variables (plus `OTEL_SERVICE_NAME`), for servers and CLIs.
 *
 * Values are resolved lazily on read, so on Node the node entry point has already run
 * `dotenv.config()` by the time anything asks.
 */

import { getEnvVar } from '../env';
import { DEFAULT_AIQA_SERVER_URL } from './constants';

export interface AIQAConfig {
	/** Required for tracing to be enabled at all. */
	apiKey: string;
	/** AIQA server base URL, no trailing slash. */
	serverUrl: string;
	/** Organisation ID, used by the server lookup helpers. */
	organisationId: string;
	/** Optional tag set as `gen_ai.component.id` on every span this client creates. */
	componentTag: string;
	/** Fraction of traces to sample, 0-1. */
	samplingRate: number;
	/** Service name reported on spans. */
	serviceName: string;
	/** Auto-flush interval for the exporter. 0 or less disables the timer. */
	flushIntervalSeconds: number;
}

/** Config accepted by `initTracing`. Anything omitted falls back to the environment. */
export type InitTracingOptions = Partial<AIQAConfig>;

const DEFAULT_FLUSH_INTERVAL_SECONDS = 5;

let overrides: InitTracingOptions = {};

/** Clamp to the 0-1 range OpenTelemetry samplers expect; ignore junk. */
function normalizeSamplingRate(value: unknown): number | undefined {
	const rate = typeof value === 'number' ? value : parseFloat(String(value));
	if (isNaN(rate)) {
		return undefined;
	}
	return Math.max(0, Math.min(1, rate));
}

/**
 * Merge programmatic config over whatever is already set. Explicit `undefined` values
 * are ignored (they mean "not specified"), so callers can spread a partial settings
 * object without wiping earlier values.
 */
export function setConfigOverrides(options: InitTracingOptions): void {
	const next: InitTracingOptions = { ...overrides };
	if (options.apiKey !== undefined) next.apiKey = options.apiKey;
	if (options.serverUrl !== undefined) next.serverUrl = options.serverUrl;
	if (options.organisationId !== undefined) next.organisationId = options.organisationId;
	if (options.componentTag !== undefined) next.componentTag = options.componentTag;
	if (options.serviceName !== undefined) next.serviceName = options.serviceName;
	if (options.samplingRate !== undefined) {
		const rate = normalizeSamplingRate(options.samplingRate);
		if (rate !== undefined) {
			next.samplingRate = rate;
		}
	}
	if (options.flushIntervalSeconds !== undefined) {
		const seconds = Number(options.flushIntervalSeconds);
		if (!isNaN(seconds)) {
			next.flushIntervalSeconds = seconds;
		}
	}
	overrides = next;
}

/** The programmatic overrides only, for tests and for diffing across re-inits. */
export function getConfigOverrides(): InitTracingOptions {
	return { ...overrides };
}

/** Drop all programmatic config, so the environment is authoritative again. */
export function clearConfigOverrides(): void {
	overrides = {};
}

/** The effective config: programmatic values, else environment, else defaults. */
export function getConfig(): AIQAConfig {
	const envSamplingRate = normalizeSamplingRate(getEnvVar('AIQA_SAMPLING_RATE'));
	const serverUrl = overrides.serverUrl ?? getEnvVar('AIQA_SERVER_URL') ?? DEFAULT_AIQA_SERVER_URL;
	return {
		apiKey: overrides.apiKey ?? getEnvVar('AIQA_API_KEY') ?? '',
		serverUrl: serverUrl.replace(/\/$/, ''),
		organisationId: overrides.organisationId ?? getEnvVar('AIQA_ORGANISATION_ID') ?? '',
		componentTag: overrides.componentTag ?? getEnvVar('AIQA_COMPONENT_TAG') ?? '',
		samplingRate: overrides.samplingRate ?? envSamplingRate ?? 1.0,
		serviceName: overrides.serviceName ?? getEnvVar('OTEL_SERVICE_NAME') ?? getEnvVar('AIQA_SERVICE_NAME') ?? 'aiqa-client',
		flushIntervalSeconds: overrides.flushIntervalSeconds ?? DEFAULT_FLUSH_INTERVAL_SECONDS,
	};
}

/**
 * Just the component tag. Read on every span, so it avoids resolving the whole config.
 */
export function getComponentTagConfig(): string {
	return overrides.componentTag ?? getEnvVar('AIQA_COMPONENT_TAG') ?? '';
}

/**
 * Settings that are baked into the TracerProvider when it is built, and so need the
 * whole pipeline rebuilt to change. Everything else can be updated in place.
 */
export function providerConfigChanged(a: AIQAConfig, b: AIQAConfig): boolean {
	return a.samplingRate !== b.samplingRate || a.serviceName !== b.serviceName;
}

/** Settings the exporter holds, which it can be reconfigured with while running. */
export function exporterConfigChanged(a: AIQAConfig, b: AIQAConfig): boolean {
	return a.apiKey !== b.apiKey || a.serverUrl !== b.serverUrl || a.flushIntervalSeconds !== b.flushIntervalSeconds;
}
