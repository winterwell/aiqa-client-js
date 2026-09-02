/**
 * Tracing from a Chrome MV3 service worker.
 *
 * Bundle this with esbuild --platform=browser. `aiqa-client` resolves to the browser
 * build through the `browser` condition in its exports map; `aiqa-client/browser` is the
 * same thing spelled explicitly, if your bundler does not set that condition.
 *
 * Two things are different from Node, and both come from the same cause - an MV3 worker
 * has no OpenTelemetry context manager and no `process.env`:
 *
 *   - config is passed to initTracing() rather than read from the environment
 *   - span parents are passed explicitly, because `context.active()` never holds the
 *     current span, so withTracing()'s implicit nesting would give a flat trace
 */

import { initTracing, startSpan, setSpanAttribute, setTokenUsage, flushSpans } from 'aiqa-client/browser';

/**
 * Configure from extension settings. Safe to call again whenever they change - a user
 * pasting a new API key into the options page, for example.
 *
 * flushIntervalSeconds: 0 turns the auto-flush timer off. A worker can be suspended
 * between ticks, so we flush at the end of each page analysis instead.
 */
async function configureTracing() {
	const { aiqaApiKey, aiqaServerUrl } = await chrome.storage.sync.get(['aiqaApiKey', 'aiqaServerUrl']);
	initTracing({
		apiKey: aiqaApiKey || '',
		serverUrl: aiqaServerUrl || undefined,
		componentTag: 'bn-extension.worker',
		serviceName: 'bn-extension',
		flushIntervalSeconds: 0,
	});
}

chrome.runtime.onInstalled.addListener(configureTracing);
chrome.runtime.onStartup.addListener(configureTracing);
chrome.storage.onChanged.addListener(configureTracing);

/**
 * The content script chunks the page and reports how long it took. We replay that as a
 * span with an explicit startTime, so the trace shows work that happened elsewhere.
 */
async function analysePage({ url, chunks, chunkingStartedAt }) {
	const page = startSpan('analyse_page', { attributes: { url, chunk_count: chunks.length } });
	try {
		startSpan('chunk_page', { parent: page, startTime: chunkingStartedAt }).end();

		const model = startSpan('call_model', { parent: page, attributes: { 'gen_ai.request.model': 'claude-opus-5' } });
		try {
			const answer = await callTheModel(chunks);
			setTokenUsage(answer.usage.input_tokens, answer.usage.output_tokens, null, model);
			setSpanAttribute('output', answer.text, model);
			return answer;
		} finally {
			model.end();
		}
	} finally {
		page.end();
		// The worker can be killed the moment this handler returns, so send now.
		await flushSpans();
	}
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.type !== 'analyse-page') {
		return false;
	}
	analysePage(message).then(sendResponse, error => sendResponse({ error: String(error) }));
	return true; // keep the message channel open for the async response
});

async function callTheModel(_chunks) {
	throw new Error('example only');
}
