/**
 * Environment variable access that is safe on every runtime this package supports.
 *
 * `process` does not exist in a browser, a web worker, or an MV3 service worker, and a
 * bare `process.env.X` there is a ReferenceError, not undefined. Everything in this
 * package reads env through here so the browser entry point (src/browser.ts) works with
 * no `process` shim and no bundler `define` for it.
 *
 * In the browser there are no environment variables at all, so config must come from
 * `initTracing({...})` instead - see src/tracing/config.ts.
 */

/** The env var, or undefined if unset, empty, or if there is no `process` at all. */
export function getEnvVar(name: string): string | undefined {
	try {
		const env = (globalThis as any).process?.env;
		if (!env) {
			return undefined;
		}
		const value = env[name];
		return typeof value === 'string' && value.length > 0 ? value : undefined;
	} catch (_e) {
		// Some sandboxes throw on property access rather than returning undefined.
		return undefined;
	}
}

/** True when a writable `process.env` exists, i.e. when setting env vars can work. */
export function hasProcessEnv(): boolean {
	try {
		return !!(globalThis as any).process?.env;
	} catch (_e) {
		return false;
	}
}
