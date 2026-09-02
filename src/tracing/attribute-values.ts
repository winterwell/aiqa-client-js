/**
 * Coercing values into things OpenTelemetry will actually record.
 *
 * `span.setAttribute` accepts a string, number or boolean, or a homogeneous array of
 * those. Anything else - an object, a Map, a class instance - is silently dropped with
 * only a `diag` warning, which is easy to miss. That was losing the `input` and `output`
 * attributes on every traced function taking or returning an object, i.e. most of them.
 *
 * The sibling Python client serialises to a JSON string in the same place, so that is
 * what the AIQA server expects.
 */

import type { AttributeValue } from '@opentelemetry/api';

function isPrimitive(value: unknown): value is string | number | boolean {
	const type = typeof value;
	return type === 'string' || type === 'number' || type === 'boolean';
}

/**
 * OpenTelemetry accepts a primitive array only if it is homogeneous - nulls aside, every
 * element the same type. A mixed array is as invalid as an object, and dropped the same
 * silent way.
 */
function isHomogeneousPrimitiveArray(value: unknown): boolean {
	if (!Array.isArray(value)) {
		return false;
	}
	let elementType: string | undefined;
	for (const item of value) {
		if (item == null) {
			continue;
		}
		if (!isPrimitive(item)) {
			return false;
		}
		if (elementType === undefined) {
			elementType = typeof item;
		} else if (typeof item !== elementType) {
			return false;
		}
	}
	return true;
}

/**
 * A value OpenTelemetry will record. Primitives and primitive arrays pass through
 * unchanged; anything else becomes JSON, or its `String()` form if it will not
 * serialise (a cycle, or a throwing `toJSON`).
 */
export function toAttributeValue(value: any): AttributeValue {
	if (isPrimitive(value)) {
		return value;
	}
	if (isHomogeneousPrimitiveArray(value)) {
		return value as AttributeValue;
	}
	try {
		const json = JSON.stringify(value);
		// undefined and functions stringify to undefined, not to a string.
		return json === undefined ? String(value) : json;
	} catch (_e) {
		return String(value);
	}
}
