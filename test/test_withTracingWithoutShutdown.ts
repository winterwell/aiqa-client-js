import * as dotenv from 'dotenv';
import * as path from 'path';
import tap from 'tap';
import { withTracing } from '../dist/tracing.js';

// Load environment variables from .env file in client-js directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Test that withTracing does not cause the process to hang.
 * The user should not have to explicitly call shutdown. withTracing's periodic send 
 * should operate as a daemon that won't block normal exit of the main process.
 */
tap.test('withTracing: No shutdown required', async t => {
  // Create some traced functions
  const add = (a: number, b: number) => a + b;
  const tracedAdd = withTracing(add, { name: 'add' });

  const multiply = (a: number, b: number) => a * b;
  const tracedMultiply = withTracing(multiply, { name: 'multiply' });

  // Call the traced functions to generate spans
  const result1 = tracedAdd(5, 3);
  t.equal(result1, 8, 'tracedAdd returns correct value');

  const result2 = tracedMultiply(4, 7);
  t.equal(result2, 28, 'tracedMultiply returns correct value');

  // Wait a short time to let spans be created
  await new Promise(resolve => setTimeout(resolve, 100));

  t.pass('Test completed - process should exit normally without calling shutdownTracing()');
  t.end();
});
