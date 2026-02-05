import tap from 'tap';
import { getOrganisation, getAPIKeyInfo } from '../dist/tracing.js';

tap.test('Utility functions tests', async t => {
	// Note: These tests require a real server or mocking
	// For now, we'll test that the functions exist and can be called
	
	t.test('getOrganisation function exists', async t => {
		t.ok(typeof getOrganisation === 'function', 'getOrganisation is a function');
		t.end();
	});

	t.test('getAPIKeyInfo function exists', async t => {
		t.ok(typeof getAPIKeyInfo === 'function', 'getAPIKeyInfo is a function');
		t.end();
	});

	// Test error handling when server URL is not set
	t.test('getOrganisation handles missing server URL gracefully', async t => {
		const originalUrl = process.env.AIQA_SERVER_URL;
		delete process.env.AIQA_SERVER_URL;
		
		try {
			await getOrganisation('test-org');
			t.fail('Should have thrown an error');
		} catch (error: any) {
			t.ok(error.message.includes('Failed to get organisation') || error.message.includes('fetch'), 'Error message is appropriate');
		} finally {
			if (originalUrl) {
				process.env.AIQA_SERVER_URL = originalUrl;
			}
		}
		t.end();
	});

	t.end();
});




