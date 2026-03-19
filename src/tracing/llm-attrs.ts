function isAttributeSet(span: any, attributeName: string): boolean {
	try {
		if (!span || !span.isRecording || !span.isRecording()) {
			return false;
		}
		if (span.attributes) {
			return attributeName in span.attributes;
		}
		if (span._attributes) {
			return attributeName in span._attributes;
		}
		return false;
	} catch (_e) {
		return false;
	}
}

export function extractAndSetTokenUsage(span: any, result: any): void {
	try {
		if (!span || !span.isRecording || !span.isRecording()) {
			return;
		}

		let usage: any = null;
		if (typeof result === 'string') {
			try {
				result = JSON.parse(result);
			} catch (_e) {
				// Keep original value if result is not JSON.
			}
		}

		try {
			if (result && typeof result === 'object') {
				if ('usage' in result) {
					usage = result.usage;
				} else if ('Usage' in result) {
					usage = result.Usage;
				} else if ('prompt_tokens' in result && 'completion_tokens' in result && 'total_tokens' in result) {
					usage = result;
				} else if ('PromptTokens' in result && 'CompletionTokens' in result && 'TotalTokens' in result) {
					usage = result;
				} else if ('input_tokens' in result && 'output_tokens' in result) {
					usage = result;
				} else if ('InputTokens' in result && 'OutputTokens' in result) {
					usage = result;
				}
			}
		} catch (_e) {
			return;
		}

		if (usage && typeof usage === 'object') {
			try {
				let promptTokens = usage.prompt_tokens ?? usage.PromptTokens;
				let completionTokens = usage.completion_tokens ?? usage.CompletionTokens;
				const inputTokens = usage.input_tokens ?? usage.InputTokens;
				const outputTokens = usage.output_tokens ?? usage.OutputTokens;
				let totalTokens = usage.total_tokens ?? usage.TotalTokens;
				const cacheReadTokens = usage.cache_read_input_tokens ?? usage.CacheReadInputTokens;
				const cacheWriteTokens =
					usage.cache_creation_input_tokens ??
					usage.cache_write_input_tokens ??
					usage.CacheCreationInputTokens ??
					usage.CacheWriteInputTokens;

				if (promptTokens == null) {
					promptTokens = inputTokens;
				}
				if (completionTokens == null) {
					completionTokens = outputTokens;
				}
				if (totalTokens == null && promptTokens != null && completionTokens != null) {
					totalTokens = Number(promptTokens) + Number(completionTokens);
				}

				if (promptTokens != null && !isAttributeSet(span, 'gen_ai.usage.input_tokens')) {
					span.setAttribute('gen_ai.usage.input_tokens', Number(promptTokens));
				}
				if (completionTokens != null && !isAttributeSet(span, 'gen_ai.usage.output_tokens')) {
					span.setAttribute('gen_ai.usage.output_tokens', Number(completionTokens));
				}
				if (totalTokens != null && !isAttributeSet(span, 'gen_ai.usage.total_tokens')) {
					span.setAttribute('gen_ai.usage.total_tokens', Number(totalTokens));
				}
				if (cacheReadTokens != null && !isAttributeSet(span, 'gen_ai.usage.cache_read.input_tokens')) {
					span.setAttribute('gen_ai.usage.cache_read.input_tokens', Number(cacheReadTokens));
				}
				if (cacheWriteTokens != null && !isAttributeSet(span, 'gen_ai.usage.cache_creation.input_tokens')) {
					span.setAttribute('gen_ai.usage.cache_creation.input_tokens', Number(cacheWriteTokens));
				}
			} catch (e) {
				console.debug('AIQA: Failed to set token usage attributes on span', e);
			}
		}
	} catch (e) {
		console.debug('AIQA: Error in extractAndSetTokenUsage', e);
	}
}

export function extractAndSetProviderAndModel(span: any, result: any): void {
	try {
		if (!span || !span.isRecording || !span.isRecording()) {
			return;
		}

		let model: any = null;
		let provider: any = null;
		try {
			if (result && typeof result === 'object') {
				model = result.model ?? result.Model;
				provider = result.provider ?? result.Provider ?? result.provider_name ?? result.providerName;

				if (model == null && result.data && typeof result.data === 'object') {
					model = result.data.model ?? result.data.Model;
				}
				if (model == null && Array.isArray(result.choices) && result.choices.length > 0) {
					const firstChoice = result.choices[0];
					if (firstChoice && typeof firstChoice === 'object') {
						model = firstChoice.model ?? firstChoice.Model;
					}
				}
			}
		} catch (_e) {
			return;
		}

		if (model != null && !isAttributeSet(span, 'gen_ai.request.model')) {
			try {
				const modelStr = String(model);
				if (modelStr) {
					span.setAttribute('gen_ai.request.model', modelStr);
				}
			} catch (e) {
				console.debug('AIQA: Failed to set model attribute on span', e);
			}
		}
		if (provider != null && !isAttributeSet(span, 'gen_ai.provider.name')) {
			try {
				const providerStr = String(provider);
				if (providerStr) {
					span.setAttribute('gen_ai.provider.name', providerStr);
				}
			} catch (e) {
				console.debug('AIQA: Failed to set provider attribute on span', e);
			}
		}
	} catch (e) {
		console.debug('AIQA: Error in extractAndSetProviderAndModel', e);
	}
}
