/**
 * Data filtering utilities for removing sensitive information from spans.
 * Shared by tracing.ts and aiqa-exporter.ts to avoid code duplication.
 */

/**
 * Get enabled filters from AIQA_DATA_FILTERS env var
 * Default: "RemovePasswords, RemoveJWT, RemoveAuthHeaders, RemoveAPIKeys" (matching Python/Go)
 */
export function getEnabledFilters(): Set<string> {
	const filtersEnv = process.env.AIQA_DATA_FILTERS || "RemovePasswords, RemoveJWT, RemoveAuthHeaders, RemoveAPIKeys";
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
 * Apply data filters to a key-value pair
 */
export function applyDataFilters(key: string, value: any): any {
	// Don't filter falsy values
	if (!value) {
		return value;
	}
	
	const enabledFilters = getEnabledFilters();
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
	if (data == null) {
		return data;
	}
	
	if (Array.isArray(data)) {
		return data.map(item => filterDataRecursive(item));
	}
	
	if (typeof data === 'object') {
		const result: any = {};
		for (const [k, v] of Object.entries(data)) {
			const filteredValue = applyDataFilters(k, v);
			result[k] = filterDataRecursive(filteredValue);
		}
		return result;
	}
	
	return applyDataFilters('', data);
}

