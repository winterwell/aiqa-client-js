import { context, trace } from '@opentelemetry/api';
import { GEN_AI_OPERATION_NAME } from './constants';
import { getConfig } from './config';
import { createSpanFromTraceId } from './span-helpers';
import { flushSpans } from './runtime';

function resolveServerUrl(serverUrl?: string): string {
	return (serverUrl || getConfig().serverUrl).replace(/\/$/, '');
}

function buildApiHeaders(apiKey?: string): Record<string, string> {
	const key = apiKey || getConfig().apiKey;
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (key) {
		headers['Authorization'] = `Bearer ${key}`;
	}
	return headers;
}

/**
 * Call an AIQA server endpoint and parse the JSON reply, throwing on a non-2xx status.
 * `serverUrl` and `apiKey` default to the client config.
 */
export async function requestJson<T = any>(
	path: string,
	options: { method?: 'GET' | 'POST'; body?: any; serverUrl?: string; apiKey?: string; what?: string } = {},
): Promise<T> {
	const method = options.method || 'GET';
	const response = await fetch(`${resolveServerUrl(options.serverUrl)}${path}`, {
		method,
		headers: buildApiHeaders(options.apiKey),
		body: options.body == null ? undefined : JSON.stringify(options.body),
	});
	if (!response.ok) {
		const errorText = await response.text().catch(() => 'Unknown error');
		const what = options.what || `${method} ${path}`;
		throw new Error(`Failed to ${what}: ${response.status} ${response.statusText} - ${errorText}`);
	}
	return await response.json() as T;
}

export async function getSpan(spanId: string, organisationId?: string): Promise<any | undefined> {
	const serverUrl = resolveServerUrl();
	const orgId = organisationId || getConfig().organisationId;
	if (!serverUrl) {
		console.warn('AIQA: AIQA_SERVER_URL is not set. Cannot retrieve span.');
		return undefined;
	}
	// fields=* because the search route leaves out attributes (input, output...) by default.
	const queryParams = new URLSearchParams({ q: `id:${spanId}`, fields: '*' });
	if (orgId) {
		queryParams.set('organisation', orgId);
	}
	const response = await fetch(`${serverUrl}/span?${queryParams.toString()}`, { method: 'GET', headers: buildApiHeaders() });
	if (response.status === 200) {
		const result: any = await response.json();
		const hits = result.hits || [];
		return hits.length > 0 ? hits[0] : undefined;
	}
	if (response.status === 404) {
		return undefined;
	}
	const errorText = await response.text().catch(() => 'Unknown error');
	console.warn(`AIQA: Failed to get span: ${response.status} - ${errorText.substring(0, 200)}`);
	return undefined;
}

export async function submitFeedback(traceId: string, feedback: { thumbsUp?: boolean; comment?: string }): Promise<void> {
	if (!traceId || traceId.length !== 32) {
		throw new Error('Invalid trace ID: must be 32 hexadecimal characters');
	}
	const span = createSpanFromTraceId(traceId, undefined, 'feedback');
	return context.with(trace.setSpan(context.active(), span), async () => {
		try {
			span.setAttribute('feedback.value', feedback.thumbsUp === undefined ? 'neutral' : feedback.thumbsUp ? 'positive' : 'negative');
			if (feedback.comment) {
				span.setAttribute('feedback.comment', feedback.comment);
			}
			span.setAttribute(GEN_AI_OPERATION_NAME, 'feedback');
			span.end();
			await flushSpans();
		} catch (error) {
			span.end();
			throw error;
		}
	});
}

export async function getOrganisation(organisationId: string, serverUrl?: string, apiKey?: string): Promise<any> {
	return requestJson(`/organisation/${encodeURIComponent(organisationId)}`, { serverUrl, apiKey, what: 'get organisation' });
}

export async function getAPIKeyInfo(apiKeyId: string, serverUrl?: string, apiKey?: string): Promise<any> {
	return requestJson(`/api-key/${encodeURIComponent(apiKeyId)}`, { serverUrl, apiKey, what: 'get api key info' });
}
