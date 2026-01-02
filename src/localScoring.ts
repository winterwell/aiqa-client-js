import { Metric } from './common/types/Dataset';
import Example from './common/types/Example';

/**
 * Score a javascript metric locally by executing the metric's code
 */
async function scoreMetricJavascript(metric: Metric, output: any, example: Example): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		try {
			const functionBody = metric.parameters?.code || metric.parameters?.script;
			if (!functionBody) {
				return reject(new Error(`No script or code found in metric.parameters for metric "${metric.name}"`));
			}

			let finished = false;
			// Provide only output, example, and a restricted global context
			const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

			// Prepare our function
			let userFn: any;
			try {
				// block all IO and other dangerous functions for security
				userFn = new AsyncFunction('output', 'example', `
					"use strict";
					const global = undefined;
					const require = undefined;
					const process = undefined;
					const eval = undefined;
					const Function = undefined;
					const setTimeout = undefined;
					const setInterval = undefined;
					const fetch = undefined;
					const XMLHttpRequest = undefined;
					const File = undefined;
					const WebSocket = undefined;
					const Buffer = undefined;
					${functionBody}
				`);
			} catch (e) {
				return reject(new Error(`Failed to parse script for metric "${metric.name}": ${(e as any)?.message || e}`));
			}

			// Handle timeout
			const timer = setTimeout(() => {
				if (!finished) {
					finished = true;
					reject(new Error(`Script execution timed out for metric "${metric.name}"`));
				}
			}, 5000);

			// Actually run the code
			Promise.resolve(userFn(output, example))
				.then((result: any) => {
					if (finished) return;
					finished = true;
					clearTimeout(timer);
					// If result is numeric, return it, else error
					const num = Number(result);
					if (!isFinite(num)) {
						return reject(new Error(`Script for metric "${metric.name}" did not return a finite number, got: ${result}`));
					}
					resolve(num);
				})
				.catch((err: any) => {
					if (finished) return;
					finished = true;
					clearTimeout(timer);
					reject(new Error(`Metric script error for "${metric.name}": ${err?.message || err}`));
				});
		} catch (err: any) {
			reject(new Error(`Metric script error for "${metric.name}": ${err?.message || err}`));
		}
	});
}

/**
 * Score a metric locally based on its type.
 * Currently only supports 'javascript' type metrics.
 * 
 * @param metric - The metric definition
 * @param output - The output to score
 * @param example - The example (for context, expected outputs, etc.)
 * @returns The score as a number
 */
export async function scoreMetric(
	metric: Metric,
	output: any,
	example: Example
): Promise<number> {
	if (!metric.type) {
		throw new Error(`Metric "${metric.name}" has no type field. Cannot score locally.`);
	}
	
	switch (metric.type) {
		case 'javascript':
			return scoreMetricJavascript(metric, output, example);
		case 'llm':
			throw new Error(`LLM metrics cannot be scored locally. Metric "${metric.name}" requires server-side scoring.`);
		case 'number':
			throw new Error(`Number metric scoring not yet implemented for metric "${metric.name}"`);
		default:
			throw new Error(`Unknown metric type "${(metric as any).type}" for metric "${metric.name}"`);
	}
}

/**
 * Score all metrics from a dataset locally.
 * Returns a record of metric names to scores.
 * 
 * @param metrics - Array of metrics to score
 * @param output - The output to score
 * @param example - The example (for context)
 * @returns Record of metric names to scores
 */
export async function scoreAllMetrics(
	metrics: Metric[],
	output: any,
	example: Example
): Promise<Record<string, number>> {
	const scores: Record<string, number> = {};
	
	for (const metric of metrics) {
		try {
			scores[metric.name] = await scoreMetric(metric, output, example);
		} catch (err: any) {
			// Only log warnings for metrics that can't be scored locally (LLM, number, etc.)
			// This is expected behavior, so we don't fail the test
			const errorMsg = err?.message || err;
			if (errorMsg.includes('cannot be scored locally') || 
			    errorMsg.includes('not yet implemented') ||
			    errorMsg.includes('has no type field') ||
			    errorMsg.includes('Unknown metric type')) {
				// These are expected - skip silently or log at debug level
			} else {
				console.warn(`AIQA: Failed to score metric "${metric.name}": ${errorMsg}`);
			}
			// Skip metrics that fail to score
		}
	}
	
	return scores;
}

