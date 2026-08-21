/**
 * ExperimentRunner - runs experiments on datasets and scores results
 */

import Example from './common/types/Example';
import Dataset from './common/types/Dataset';
import Metric from './common/types/Metric';
import Experiment, { MetricStats } from './common/types/Experiment';

export interface ExperimentRunnerOptions {
	datasetId: string;
	/** usuallu unset, and a fresh experiment is created with a random ID */
	experimentId?: string;
	serverUrl?: string;
	apiKey?: string;
	organisationId?: string;
	/** max concurrent examples to run; default 1 */
	parallelism?: number;
	/** avoid process-wide env side effects when running examples */
	setEnvFromParameters?: boolean;
}

export interface ScoreResult {
	[metric: string]: any;
}

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
	private experimentId: string;
	private experiment?: Experiment;
	private scores: Array<{ example: Example; result: any; scores: ScoreResult }> = [];
	private parallelism: number;
	private setEnvFromParameters: boolean;

	constructor(options: ExperimentRunnerOptions) {
		this.datasetId = options.datasetId;
		this.experimentId = options.experimentId;
		this.serverUrl = (options.serverUrl || process.env.AIQA_SERVER_URL || 'https://server-aiqa.winterwell.com').replace(/\/$/, '');
		this.apiKey = options.apiKey || process.env.AIQA_API_KEY || '';
		this.organisation = options.organisationId;
		this.parallelism = Math.max(1, Number(options.parallelism || 1));
		this.setEnvFromParameters = options.setEnvFromParameters === true;
	}

	private getHeaders(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			'Accept-Encoding': 'gzip, deflate, br',
			'Authorization': `Bearer ${this.apiKey}`
		};
	}

	private async requestJson<T>(path: string, method: 'GET' | 'POST', body?: any): Promise<T> {
		const response = await fetch(`${this.serverUrl}${path}`, {
			method,
			headers: this.getHeaders(),
			body: body == null ? undefined : JSON.stringify(body),
		});
		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error');
			throw new Error(`Request failed ${method} ${path}: ${response.status} ${response.statusText} - ${errorText}`);
		}
		return await response.json() as T;
	}

	/**
	 * Fetch the dataset to get its metrics
	 */
	async getDataset(): Promise<Dataset> {
		return this.requestJson<Dataset>(`/dataset/${this.datasetId}`, 'GET');
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

		const data = await this.requestJson<{ hits?: Example[]; total?: number; limit?: number; offset?: number }>(
			`/example?${params.toString()}`,
			'GET'
		);
		return data.hits || [];
	}

	/**
	 * Create an experiment if one does not exist.
	 * @param experiment - optional setup for the experiment object. You may wish to set: 
	 * - name (recommended for labelling the experiment)
	 * - parameters
	 * @returns the created experiment object
	 */
	async createExperiment(experimentSetup?: Partial<Experiment>): Promise<Experiment> {
		if (!this.organisation || !this.datasetId) {
			throw new Error('Organisation and dataset ID are required to create an experiment');
		}
		if (!experimentSetup) {
			experimentSetup = {} as Partial<Experiment>;
		}
		// fill in if not set
		experimentSetup = {
			...experimentSetup,
			organisation: this.organisation,
			dataset: this.datasetId,
			results: [],
			summaries: {},
		};
		console.log('AIQA: Creating experiment');
		const experiment = await this.requestJson<Experiment>(`/experiment`, 'POST', experimentSetup);
		this.experimentId = experiment.id;
		this.experiment = experiment;
		return experiment;
	}

	/**
	 * Ask the server to score an example result. Stores the score for later summary calculation.
	 */
	async scoreAndStore(example: Example, result: any, scores: Record<string, number> = {}): Promise<ScoreResult> {
		// Do we have an experiment ID? If not, we need to create the experiment first
		if (!this.experimentId) {
			await this.createExperiment();
		}
		console.log('AIQA: Scoring and storing example:', example.id);
		console.log('AIQA: Scores:', scores);
		const jsonResult = await this.requestJson<any>(
			`/experiment/${this.experimentId}/example/${example.id}/scoreAndStore`,
			'POST',
			{
				output: result,
				trace: example.trace,
				scores
			}
		);
		console.log('AIQA: scoreAndStore response:', jsonResult);
		return jsonResult;
	}

	/**
	 * Run an engine function on all examples and score the results
	 */
	async run(engine: (input: any) => any | Promise<any>,
		scorer?: (output: any, example: Example) => Promise<Record<string, number>>): Promise<void> {
		const examples = await this.getExampleInputs();
		let nextIndex = 0;
		const worker = async () => {
			while (nextIndex < examples.length) {
				const index = nextIndex++;
				const example = examples[index];
				try {
					const result = await this.runExample(example, engine, scorer);
					if (result) {
						this.scores.push({
							example,
							result,
							scores: result,
						});
					}
				} catch (error) {
					console.error(`AIQA: Error processing example ${example?.id || 'unknown'}:`, error);
				}
			}
		};
		const workers = Array.from({ length: Math.min(this.parallelism, examples.length || 1) }, () => worker());
		for (const running of workers) {
			await running;
		}
	}

	/**
	 * Run the engine on an example with the experiment's parameters, score the result, and store it.
	 */
	async runExample(example: Example,
		callMyCode: (input: any, parameters: Record<string, any>) => any | Promise<any>,
		scoreThisOutput: (output: any, example: Example, parameters: Record<string, any>) => Promise<Record<string, number>>): Promise<ScoreResult | null> {
		if (!this.experiment) {
			await this.createExperiment();
		}
		if (!this.experiment) {
			throw new Error('Failed to create experiment');
		}
		const parametersHere = this.experiment.parameters || {};
		const input = example.input || (example.spans && example.spans.length > 0 ? example.spans[0].attributes?.input : undefined);
		if (!input) {
			console.warn('AIQA: Example has no input field or spans with input attribute:', example);
		}
		console.log('AIQA: Running with parameters:', parametersHere);
		const originalEnvValues: Record<string, string | undefined> = {};
		if (this.setEnvFromParameters) {
			for (const [key, value] of Object.entries(parametersHere)) {
				if (value != null) {
					originalEnvValues[key] = process.env[key];
					process.env[key] = String(value);
				}
			}
		}
		const start = Date.now();
		try {
			const pOutput = callMyCode(input, parametersHere);
			const output = pOutput instanceof Promise ? await pOutput : pOutput;
			console.log('AIQA: Output:', output);
			const duration = Date.now() - start;
			let scores: Record<string, number> = scoreThisOutput ? await scoreThisOutput(output, example, parametersHere) : {};
			scores['duration'] = duration;
			console.log('AIQA: Call scoreAndStore ... for example:', example.id, 'with scores:', scores);
			const result = await this.scoreAndStore(example, output, scores);
			console.log('AIQA: scoreAndStore returned:', result);
			return result;
		} finally {
			if (this.setEnvFromParameters) {
				for (const [key, originalValue] of Object.entries(originalEnvValues)) {
					if (originalValue == null) {
						delete process.env[key];
					} else {
						process.env[key] = originalValue;
					}
				}
			}
		}
	}

	async getSummaryResults(): Promise<Record<string, MetricStats>> {
		const experiment2 = await this.requestJson<Experiment>(`/experiment/${this.experimentId}`, 'GET');
		return experiment2.summaries || {};
	}
}

