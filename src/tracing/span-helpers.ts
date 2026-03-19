import { trace, context, SpanContext, TraceFlags } from '@opentelemetry/api';
import { propagation } from '@opentelemetry/api';
import { filterDataRecursive } from '../data-filters';
import { getTracer, ensureTracingInitialized, getComponentTag, setComponentTag as setRuntimeComponentTag } from './runtime';
import { TRACER_NAME } from './constants';

export function setSpanAttribute(attributeName: string, attributeValue: any): boolean {
	const span = trace.getActiveSpan();
	if (span) {
		span.setAttribute(attributeName, filterDataRecursive(attributeValue));
		return true;
	}
	return false;
}

export function getActiveSpan() {
	ensureTracingInitialized();
	return trace.getActiveSpan();
}

export function setConversationId(conversationId: string): boolean {
	return setSpanAttribute('gen_ai.conversation.id', conversationId);
}

export function setTokenUsage(inputTokens?: number | null, outputTokens?: number | null, totalTokens?: number | null): boolean {
	const span = trace.getActiveSpan();
	if (!span) {
		return false;
	}
	let setCount = 0;
	try {
		if (inputTokens != null) {
			span.setAttribute('gen_ai.usage.input_tokens', Number(inputTokens));
			setCount++;
		}
		if (outputTokens != null) {
			span.setAttribute('gen_ai.usage.output_tokens', Number(outputTokens));
			setCount++;
		}
		if (totalTokens != null) {
			span.setAttribute('gen_ai.usage.total_tokens', Number(totalTokens));
			setCount++;
		}
	} catch (e) {
		console.warn('AIQA: Failed to set token usage attributes:', e);
		return false;
	}
	return setCount > 0;
}

export function setProviderAndModel(provider?: string | null, model?: string | null): boolean {
	const span = trace.getActiveSpan();
	if (!span) {
		return false;
	}
	let setCount = 0;
	try {
		if (provider) {
			span.setAttribute('gen_ai.provider.name', String(provider));
			setCount++;
		}
		if (model) {
			span.setAttribute('gen_ai.request.model', String(model));
			setCount++;
		}
	} catch (e) {
		console.warn('AIQA: Failed to set provider/model attributes:', e);
		return false;
	}
	return setCount > 0;
}

export function setComponentTag(tag: string): void {
	setRuntimeComponentTag(tag);
}

export function getTraceId(): string | undefined {
	ensureTracingInitialized();
	const span = trace.getActiveSpan();
	if (span) {
		const spanContext = span.spanContext();
		if (spanContext.traceId && spanContext.traceId !== '00000000000000000000000000000000') {
			return spanContext.traceId;
		}
	}
	return undefined;
}

export function getSpanId(): string | undefined {
	ensureTracingInitialized();
	const span = trace.getActiveSpan();
	if (span) {
		const spanContext = span.spanContext();
		if (spanContext.spanId && spanContext.spanId !== '0000000000000000') {
			return spanContext.spanId;
		}
	}
	return undefined;
}

export function createSpanFromTraceId(traceId: string, parentSpanId?: string, spanName: string = 'continued_span') {
	ensureTracingInitialized();
	const tracer = getTracer();
	if (!tracer) {
		const span = trace.getTracer(TRACER_NAME).startSpan(spanName);
		const componentTag = getComponentTag();
		if (componentTag) {
			span.setAttribute('gen_ai.component.id', componentTag);
		}
		return span;
	}
	try {
		const parentSpanContext: SpanContext = {
			traceId,
			spanId: parentSpanId || '0000000000000000',
			traceFlags: TraceFlags.SAMPLED,
			isRemote: true,
		};
		const parentContext = trace.setSpanContext(context.active(), parentSpanContext);
		const span = tracer.startSpan(spanName, { root: false }, parentContext);
		const componentTag = getComponentTag();
		if (componentTag) {
			span.setAttribute('gen_ai.component.id', componentTag);
		}
		return span;
	} catch (error) {
		console.error('AIQA: Error creating span from trace_id:', error instanceof Error ? error.message : String(error));
		const fallbackTracer = tracer ?? trace.getTracer(TRACER_NAME);
		const span = fallbackTracer.startSpan(spanName);
		const componentTag = getComponentTag();
		if (componentTag) {
			span.setAttribute('gen_ai.component.id', componentTag);
		}
		return span;
	}
}

export function injectTraceContext(carrier: Record<string, string>): void {
	try {
		propagation.inject(context.active(), carrier);
	} catch (error) {
		console.warn('AIQA: Error injecting trace context:', error);
	}
}

export function extractTraceContext(carrier: Record<string, string>) {
	try {
		return propagation.extract(context.active(), carrier);
	} catch (error) {
		console.warn('AIQA: Error extracting trace context:', error);
		return context.active();
	}
}
