import * as dotenv from 'dotenv';
import * as path from 'path';
import tap from 'tap';
import { ExperimentRunner } from '../src/ExperimentRunner';
import { scoreAllMetrics } from '../src/localScoring';

// Load environment variables from .env file in client-js directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// a dummy test engine that returns a dummy response
async function myEngine(input) {
	// imitate an OpenAI api responses response
	// sleep for random about 0.5 - 1 seconds
	const sleepTime = Math.random() * 0.5 + 0.5;
	await new Promise(resolve => setTimeout(resolve, sleepTime * 1000));
	return {
		choices: [
			{
				message: {
					content: 'hello ' + input,
				},
			},
		],
	}
}

// Integration test: needs credentials and a live AIQA server holding the dataset below.
// Skipped rather than failed when unconfigured, so the suite is green on a fresh clone
// and `npm run build && npm test` can gate a release. Set AIQA_API_KEY to run it.
const skip = process.env.AIQA_API_KEY ? false : 'requires AIQA_API_KEY and a live AIQA server';

tap.test('test_ExperimentRunner_stepwise_local', { skip }, async t => {
	const datasetId = 'cef17877-4fbe-4b99-ba86-eb5221729274';
	const organisationId = 'd876c206-8a4e-4da8-bed3-490478437101';
	const options = {datasetId, organisationId};
    const experimentRunner = new ExperimentRunner(options);
    
	// Get metrics from the dataset
	const dataset = await experimentRunner.getDataset();
	const metrics = dataset.metrics || [];
	console.log(`Found ${metrics.length} metrics in dataset:`, metrics.map(m => m.name));
	
	// Create scorer that scores all metrics from the dataset
	async function scorer(output: any, example: any, parameters?: any) {
		return await scoreAllMetrics(metrics, output, example);
	}
	
    const exampleInputs = await experimentRunner.getExampleInputs();
	console.log(`Processing ${exampleInputs.length} examples`);

	for (const eg of exampleInputs) {
		const result = await experimentRunner.runExample(eg, myEngine, scorer);
		if (result) {
			console.log(`Scored example ${eg.id}:`, JSON.stringify(result, null, 2));
		} else {
			console.log(`No results for example ${eg.id}`);
		}
	}
	const summaryResults = await experimentRunner.getSummaryResults();
	console.log('Summary results:', JSON.stringify(summaryResults, null, 2));
	
	t.pass('Test completed successfully');
	t.end();
});
