/**
 * Data filtering utilities for removing sensitive information from spans.
 * Shared by tracing.ts and aiqa-exporter.ts to avoid code duplication.
 */

import { getEnvVar } from './env';

/**
 * Get enabled filters from AIQA_DATA_FILTERS env var
 * Default: "RemovePasswords, RemoveJWT, RemoveAuthHeaders, RemoveAPIKeys" (matching Python/Go)
 */
export function getEnabledFilters(): Set<string> {
	const filtersEnv = getEnvVar('AIQA_DATA_FILTERS') || "RemovePasswords, RemoveJWT, RemoveAuthHeaders, RemoveAPIKeys";
	if (!filtersEnv) {
		return new Set();
	}
	return new Set(filtersEnv.split(',').map(f => f.trim()).filter(f => f));
}

/**
 * Check if a value looks like a JWT token
 */
export function isJWTToken(value: any): boolean {
	if (typeof value !== 'string') {
		return false;
	}
	// JWT tokens have format: header.payload.signature (3 parts separated by dots)
	// They typically start with "eyJ" (base64 encoded '{"')
	const parts = value.split('.');
	return parts.length === 3 && value.startsWith('eyJ') && parts.every(p => p.length > 0);
}

/**
 * Check if a value looks like an API key
 */
export function isAPIKey(value: any): boolean {
	if (typeof value !== 'string') {
		return false;
	}
	const trimmed = value.trim();
	// Common API key prefixes
	const apiKeyPrefixes = ['sk-', 'pk-', 'AKIA', 'ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_'];
	return apiKeyPrefixes.some(prefix => trimmed.startsWith(prefix));
}

/**
 * Apply data filters to a key-value pair.
 *
 * `enabledFilters` defaults to reading the environment, which re-parses
 * `AIQA_DATA_FILTERS` and allocates a Set on every call. Callers walking a structure
 * should resolve it once and pass it in - see `filterDataRecursive`.
 */
export function applyDataFilters(key: string, value: any, enabledFilters: Set<string> = getEnabledFilters()): any {
	// Don't filter falsy values
	if (!value) {
		return value;
	}
	
	const keyLower = key.toLowerCase();
	
	// RemovePasswords filter: if key contains "password", replace value with "****"
	if (enabledFilters.has('RemovePasswords') && keyLower.includes('password')) {
		return '****';
	}
	
	// RemoveJWT filter: if value looks like a JWT token, replace with "****"
	if (enabledFilters.has('RemoveJWT') && isJWTToken(value)) {
		return '****';
	}
	
	// RemoveAuthHeaders filter: if key is "authorization" (case-insensitive), replace value with "****"
	if (enabledFilters.has('RemoveAuthHeaders') && keyLower === 'authorization') {
		return '****';
	}
	
	// RemoveAPIKeys filter: if key contains API key patterns or value looks like an API key
	if (enabledFilters.has('RemoveAPIKeys')) {
		// Check key patterns (removed duplicate 'apikey' entry)
		const apiKeyKeyPatterns = ['api_key', 'apikey', 'api-key'];
		if (apiKeyKeyPatterns.some(pattern => keyLower.includes(pattern))) {
			return '****';
		}
		// Check value patterns
		if (isAPIKey(value)) {
			return '****';
		}
	}
	
	return value;
}

/**
 * Recursively apply data filters to nested structures
 */
export function filterDataRecursive(data: any): any {
	// Resolve the enabled filters once per walk rather than once per key: a traced
	// function's input can be thousands of keys, and each one used to re-read and re-parse
	// the env var and build a fresh Set.
	return filterDataRecursiveInner(data, new WeakSet<object>(), getEnabledFilters());
}

/**
 * `seen` guards against cycles. Without it a self-referencing object - a DOM node, an
 * error with a cause chain, a request holding its own response - overflowed the stack,
 * which threw out of `setSpanAttribute` and into the caller's own code rather than just
 * losing an attribute.
 */
function filterDataRecursiveInner(data: any, seen: WeakSet<object>, enabledFilters: Set<string>): any {
	if (data == null) {
		return data;
	}

	if (typeof data === 'object') {
		if (seen.has(data)) {
			return '[Circular]';
		}
		seen.add(data);
		try {
			if (Array.isArray(data)) {
				return data.map(item => filterDataRecursiveInner(item, seen, enabledFilters));
			}
			const result: any = {};
			for (const [k, v] of Object.entries(data)) {
				const filteredValue = applyDataFilters(k, v, enabledFilters);
				result[k] = filterDataRecursiveInner(filteredValue, seen, enabledFilters);
			}
			return result;
		} finally {
			// Siblings that share a value are not cycles, so let them through.
			seen.delete(data);
		}
	}

	return applyDataFilters('', data, enabledFilters);
}
