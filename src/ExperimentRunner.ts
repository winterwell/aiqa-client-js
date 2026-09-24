/**
 * ExperimentRunner - runs experiments on datasets and scores results
 */

import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import { getEnvVar, hasProcessEnv } from './env';
import { getConfig } from './tracing/config';
import { requestJson } from './tracing/http';
import { flushSpans } from './tracing/runtime';
import { startSpan } from './tracing/spans';
import { getTraceId, setSpanAttribute } from './tracing/span-helpers';
import { AIQA_EXAMPLE_ID, AIQA_EXPERIMENT_ID } from './common/constants_otel';
import Example from './common/types/Example';
import Dataset from './common/types/Dataset';
import Experiment, { MetricStats } from './common/types/Experiment';

export interface ExperimentRunnerOptions {
	datasetId: string;
	/** Usually unset, and a fresh experiment is created. Set it to add results to an existing experiment. */
	experimentId?: string;
	serverUrl?: string;
	apiKey?: string;
	organisationId?: string;
	/** max concurrent examples to run; default 1 */
	parallelism?: number;
	/** Set each experiment parameter as an env var while an example runs. Off by default, as it is process-wide. */
	setEnvFromParameters?: boolean;
}

export interface ScoreResult {
	[metric: string]: any;
}

type Engine = (input: any, parameters: Record<string, any>) => any | Promise<any>;
type Scorer = (output: any, example: Example, parameters: Record<string, any>) => Promise<Record<string, number>>;

/**
 * The ExperimentRunner is the main class for running experiments on datasets.
 * It can create an experiment, run it, and score the results.
 * Handles setting up environment variables and passing parameters to the engine function.
 */
export class ExperimentRunner {
	private datasetId: string;
	private serverUrl: string;
	private apiKey: string;
	private organisation?: string;
	private experimentId?: string;
	private experiment?: Experiment;
	/** In-flight fetch/create, shared so parallel workers do not each create an experiment. */
	private pendingExperiment?: Promise<Experiment>;
	private parallelism: number;
	private setEnvFromParameters: boolean;

	constructor(options: ExperimentRunnerOptions) {
		this.datasetId = options.datasetId;
		this.experimentId = options.experimentId;
		const config = getConfig();
		this.serverUrl = (options.serverUrl || config.serverUrl).replace(/\/$/, '');
		this.apiKey = options.apiKey || config.apiKey;
		this.organisation = options.organisationId || config.organisationId || undefined;
		this.parallelism = Math.max(1, Number(options.parallelism || 1));
		this.setEnvFromParameters = options.setEnvFromParameters === true;
	}

	private request<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: any): Promise<T> {
		return requestJson<T>(path, { method, body, serverUrl: this.serverUrl, apiKey: this.apiKey });
	}

	/**
	 * Fetch the dataset to get its metrics
	 */
	async getDataset(): Promise<Dataset> {
		return this.request<Dataset>(`/dataset/${this.datasetId}`);
	}

	/**
	 * Fetch example inputs from the dataset
	 */
	async getExampleInputs({ limit = 10000 }: { limit?: number } = {}): Promise<Example[]> {
		const params = new URLSearchParams();
		params.append('dataset', this.datasetId);
		if (this.organisation) {
			params.append('organisation', this.organisation);
		}
		params.append('limit', limit.toString()); // Fetch big - probably all the examples

		const data = await this.request<{ hits?: Example[]; total?: number; limit?: number; offset?: number }>(
			`/example?${params.toString()}`
		);
		return data.hits || [];
	}

	/**
	 * Create a new experiment on the server, and use it for subsequent results.
	 * @param experimentSetup - optional setup for the experiment object. You may wish to set:
	 * - name (recommended for labelling the experiment)
	 * - parameters
	 * @returns the created experiment object
	 */
	async createExperiment(experimentSetup: Partial<Experiment> = {}): Promise<Experiment> {
		if (!this.organisation || !this.datasetId) {
			throw new Error('Organisation and dataset ID are required to create an experiment');
		}
		console.log('AIQA: Creating experiment');
		const experiment = await this.request<Experiment>(`/experiment`, 'POST', {
			...experimentSetup,
			organisation: this.organisation,
			dataset: this.datasetId,
			results: [],
			summaries: {},
		});
		this.experimentId = experiment.id;
		this.experiment = experiment;
		return experiment;
	}

	/** The experiment: fetched if an `experimentId` was given, else created on first use. */
	private ensureExperiment(): Promise<Experiment> {
		if (this.experiment) {
			return Promise.resolve(this.experiment);
		}
		if (!this.pendingExperiment) {
			const pending = this.experimentId
				? this.request<Experiment>(`/experiment/${this.experimentId}`).then(experiment => (this.experiment = experiment))
				: this.createExperiment();
			this.pendingExperiment = pending.finally(() => {
				this.pendingExperiment = undefined;
			});
		}
		return this.pendingExperiment;
	}

	/**
	 * Ask the server to score an example result, and store it in the experiment.
	 * @param run.trace - the trace of this run, so the server can add its token count and cost
	 * @param run.parameters - the parameters it ran with; the server keeps one result per (example, parameters)
	 */
	async scoreAndStore(example: Example, output: any, scores: Record<string, number> = {},
		run: { trace?: string; parameters?: Record<string, any> } = {}): Promise<ScoreResult> {
		if (!this.experimentId) {
			await this.ensureExperiment();
		}
		console.log('AIQA: Scoring and storing example:', example.id, 'with scores:', scores);
		const result = await this.request<ScoreResult>(
			`/experiment/${this.experimentId}/example/${example.id}/scoreAndStore`,
			'POST',
			{ output, trace: run.trace, scores, parameters: run.parameters }
		);
		console.log('AIQA: scoreAndStore response:', result);
		return result;
	}

	/**
	 * Run an engine function on all examples and score the results
	 */
	async run(engine: Engine, scorer?: Scorer): Promise<void> {
		const examples = await this.getExampleInputs();
		let nextIndex = 0;
		const worker = async () => {
			while (nextIndex < examples.length) {
				const example = examples[nextIndex++];
				try {
					await this.runExample(example, engine, scorer);
				} catch (error) {
					console.error(`AIQA: Error processing example ${example?.id || 'unknown'}:`, error);
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(this.parallelism, examples.length || 1) }, worker));
	}

	/**
	 * Run the engine on an example with the experiment's parameters, score the result, and store it.
	 * The engine runs in its own trace, which is linked to the result.
	 */
	async runExample(example: Example, callMyCode: Engine, scoreThisOutput?: Scorer): Promise<ScoreResult> {
		const experiment = await this.ensureExperiment();
		const parametersHere = experiment.parameters || {};
		const input = example.input || (example.spans && example.spans.length > 0 ? example.spans[0].attributes?.input : undefined);
		if (!input) {
			console.warn('AIQA: Example has no input field or spans with input attribute:', example);
		}
		console.log('AIQA: Running with parameters:', parametersHere);
		const originalEnvValues: Record<string, string | undefined> = {};
		// There is no process.env in a browser or a service worker, so this is opt-in
		// and skipped where it cannot work.
		const setEnv = this.setEnvFromParameters && hasProcessEnv();
		if (this.setEnvFromParameters && !setEnv) {
			console.warn('AIQA: setEnvFromParameters was requested but there is no process.env on this runtime; ignoring.');
		}
		if (setEnv) {
			for (const [key, value] of Object.entries(parametersHere)) {
				if (value != null) {
					originalEnvValues[key] = getEnvVar(key);
					(globalThis as any).process.env[key] = String(value);
				}
			}
		}
		try {
			// A root span, so the server can find this run's trace (by parent:unset) and
			// add its token count and cost to the result.
			const span = startSpan(callMyCode.name || 'run_example', {
				parent: null,
				attributes: { [AIQA_EXPERIMENT_ID]: this.experimentId, [AIQA_EXAMPLE_ID]: example.id, input },
			});
			const traceId = span.isRecording() ? getTraceId(span) : undefined;
			const start = Date.now();
			let output: any;
			try {
				output = await context.with(trace.setSpan(context.active(), span), () => callMyCode(input, parametersHere));
				setSpanAttribute('output', output, span);
			} catch (error) {
				span.recordException(error instanceof Error ? error : new Error(String(error)));
				span.setStatus({ code: SpanStatusCode.ERROR });
				throw error;
			} finally {
				span.end();
			}
			const duration = Date.now() - start;
			await flushSpans();
			const scores: Record<string, number> = scoreThisOutput ? await scoreThisOutput(output, example, parametersHere) : {};
			scores['duration'] = duration;
			return await this.scoreAndStore(example, output, scores, { trace: traceId, parameters: parametersHere });
		} finally {
			if (setEnv) {
				const env = (globalThis as any).process.env;
				for (const [key, originalValue] of Object.entries(originalEnvValues)) {
					if (originalValue == null) {
						delete env[key];
					} else {
						env[key] = originalValue;
					}
				}
			}
		}
	}

	async getSummaryResults(): Promise<Record<string, MetricStats>> {
		if (!this.experimentId) {
			throw new Error('No experiment yet: create or run one first');
		}
		const experiment = await this.request<Experiment>(`/experiment/${this.experimentId}`);
		return experiment.summaries || {};
	}
}
