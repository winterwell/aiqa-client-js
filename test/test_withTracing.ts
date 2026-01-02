import * as dotenv from 'dotenv';
import * as path from 'path';
import tap from 'tap';
import { withTracing, flushSpans, shutdownTracing } from '../dist/tracing.js';

// Load environment variables from .env file in client-js directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Note: The exporter uses AIQA_SERVER_URL and AIQA_API_KEY env vars for actual server connection
const aiqaServerUrl = process.env.AIQA_SERVER_URL;

tap.test('withTracing: Basic functionality tests', async t => {
  if (!process.env.AIQA_API_KEY) {
    t.comment('Warning: AIQA_API_KEY environment variable is not set. Spans may not be sent successfully.');
  }

  // Test 1: Simple function with no arguments
  const noArgFn = () => {
    return 'test-result';
  };
  const tracedNoArg = withTracing(noArgFn, { name: 'testNoArg' });
  const result1 = tracedNoArg();
  t.equal(result1, 'test-result', 'No args function returns correct value');

  // Test 2: Function with single argument
  const singleArgFn = (x: number) => {
    return x * 2;
  };
  const tracedSingleArg = withTracing(singleArgFn, { name: 'testSingleArg' });
  const result2 = tracedSingleArg(5);
  t.equal(result2, 10, 'Single arg function returns correct value');

  // Test 3: Function with multiple arguments
  const multiArgFn = (a: number, b: string) => {
    return `${a}-${b}`;
  };
  const tracedMultiArg = withTracing(multiArgFn, { name: 'testMultiArg' });
  const result3 = tracedMultiArg(42, 'hello');
  t.equal(result3, '42-hello', 'Multi arg function returns correct value');

  // Test 4: Function that throws an error
  const errorFn = () => {
    throw new Error('Test error');
  };
  const tracedError = withTracing(errorFn, { name: 'testError' });
  try {
    tracedError();
    t.fail('Should have thrown an error');
  } catch (error: any) {
    t.equal(error.message, 'Test error', 'Error is correctly propagated');
  }

  // Test 5: Function with custom name
  const customNameFn = () => 'custom';
  const tracedCustom = withTracing(customNameFn, { name: 'customTraceName' });
  const result5 = tracedCustom();
  t.equal(result5, 'custom', 'Custom name function returns correct value');

  // Flush spans before shutdown
  try {
    await flushSpans();
    t.pass('Spans flushed successfully');
  } catch (flushError: any) {
    t.fail(`Error flushing traces: ${flushError.message || flushError}`);
  }

  // Shutdown
  try {
    await shutdownTracing();
    t.pass('Tracer shutdown complete');
  } catch (shutdownError: any) {
    t.fail(`Error during shutdown: ${shutdownError.message}`);
  }

  t.end();
});

