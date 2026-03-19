export type IgnorePatterns = string | string[] | undefined;

export function normalizeIgnorePatterns(ignorePatterns?: string | string[]): string[] {
	if (!ignorePatterns) {
		return [];
	}
	if (Array.isArray(ignorePatterns)) {
		return ignorePatterns.filter((pattern) => typeof pattern === 'string' && pattern.length > 0);
	}
	if (typeof ignorePatterns === 'string') {
		return [ignorePatterns];
	}
	return [];
}

export function matchIgnorePattern(key: string, pattern: string): boolean {
	if (pattern === key) {
		return true;
	}
	if (!pattern.includes('*') && !pattern.includes('?')) {
		return false;
	}
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '.*')
		.replace(/\?/g, '.');
	const regex = new RegExp(`^${escaped}$`);
	return regex.test(key);
}

export function applyIgnorePatterns(value: any, ignorePatterns?: IgnorePatterns): any {
	const patterns = normalizeIgnorePatterns(ignorePatterns);
	if (!patterns.length || value == null || typeof value !== 'object') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => applyIgnorePatterns(item, patterns));
	}
	const input = value as Record<string, any>;
	const output: Record<string, any> = {};
	for (const [key, childValue] of Object.entries(input)) {
		const shouldIgnore = patterns.some((pattern) => matchIgnorePattern(key, pattern));
		if (shouldIgnore) {
			continue;
		}
		output[key] = applyIgnorePatterns(childValue, patterns);
	}
	return output;
}

export function prepareInputForSpan(
	args: any[],
	filterInput?: (input: any) => any,
	ignoreInput?: IgnorePatterns
): any {
	let input: any = args;
	if (args.length === 0) {
		input = null;
	} else if (args.length === 1) {
		input = args[0];
	}
	if (filterInput) {
		input = filterInput(input);
	}
	return applyIgnorePatterns(input, ignoreInput);
}

export function prepareOutputForSpan(
	output: any,
	filterOutput?: (output: any) => any,
	ignoreOutput?: IgnorePatterns
): any {
	let outputForSpan = output;
	if (filterOutput) {
		outputForSpan = filterOutput(outputForSpan);
	}
	return applyIgnorePatterns(outputForSpan, ignoreOutput);
}
