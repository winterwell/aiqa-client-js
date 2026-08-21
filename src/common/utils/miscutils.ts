// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.


export function is(value: any): boolean {
  // Hm: should this check for NaN if value is a number?
  return value !== null && value !== undefined;
}

/**
 * Test for deep equality of two objects.
 * @param a 
 * @param b 
 * @returns 
 */
export function isDeepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => isDeepEqual(value, b[index]));
  }
  return Object.keys(a).every(key => isDeepEqual(a[key], b[key]));
}

export function truncate(s: string, maxLength: number): string {
  if (s.length <= maxLength) {
    return s;
  }
  return s.substring(0, maxLength) + "...";
}

/** ALways returns an array, even if the input is not an array. */
export function asArray(value: any): any[] {
  if (Array.isArray(value)) {
    return value;
  }
  if ( ! value) {
    return [];
  }
  if (typeof value === 'object' && Object.keys(value).length === 0) {
    return [];
  }
  return [value];
}

export function asDate(value: any): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  // crude but handles number and many strings
  return new Date(value);
}

/** Convenience for join with space, filtering out falsy */
export function space(...things: any[]): string {
  return things.filter(x => x).join(" ");
}