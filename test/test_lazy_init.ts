import tap from 'tap';
import { getAIQAClient, withTracing, withTracingAsync } from '../dist/tracing.js';

tap.test('Lazy initialization tests', async t => {
	// Test that getAIQAClient can be called without errors
	t.test('getAIQAClient can be called', async t => {
		try {
			getAIQAClient();
			t.pass('getAIQAClient called successfully');
		} catch (error: any) {
			t.fail(`getAIQAClient failed: ${error.message}`);
		}
		t.end();
	});

	// Test that withTracing triggers lazy initialization
	t.test('withTracing triggers lazy initialization', async t => {
		const testFunc = (x: number) => x * 2;
		const tracedFunc = withTracing(testFunc, { name: 'test_func' });
		
		const result = tracedFunc(5);
		t.equal(result, 10, 'Traced function returns correct value');
		t.end();
	});

	// Test that withTracingAsync triggers lazy initialization
	t.test('withTracingAsync triggers lazy initialization', async t => {
		const testFunc = async (x: number) => x * 2;
		const tracedFunc = withTracingAsync(testFunc, { name: 'test_async_func' });
		
		const result = await tracedFunc(5);
		t.equal(result, 10, 'Traced async function returns correct value');
		t.end();
	});

	t.end();
});




