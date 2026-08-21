// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.

/**
 * Elasticsearch stores embeddings as dense_vector with fixed dims. Pad/truncate on write; use embeddingMeta_1/embeddingMeta_2.dimensions for semantic length.
 */

export const EMBEDDING_STORAGE_DIMS = Math.min(
  4096,
  Math.max(32, parseInt(process.env.EMBEDDING_STORAGE_DIMS || '1536', 10) || 1536)
);

/** Fields omitted from default Example/Span API responses (large vectors + meta). */
export const EMBEDDING_SOURCE_FIELDS = [
  'embedding_1',
  'embedding_2',
  'embeddingMeta_1',
  'embeddingMeta_2',
] as const;

/**
 * Search/list: omit embedding fields by default unless `_source_includes` is set (then only listed fields are returned).
 * Pass `_source_excludes: []` to request full _source including embeddings (internal use).
 */
export function mergeSearchSourceExcludes(
  _source_includes: string[] | null | undefined,
  _source_excludes: string[] | null | undefined
): string[] | undefined {
  if (_source_includes && _source_includes.length > 0) {
    return _source_excludes ?? undefined;
  }
  if (_source_excludes === undefined) {
    return [...EMBEDDING_SOURCE_FIELDS];
  }
  if (_source_excludes.length === 0) {
    return undefined;
  }
  return [...new Set([...EMBEDDING_SOURCE_FIELDS, ..._source_excludes])];
}

export function padEmbeddingForStorage(vec: number[], targetDims: number = EMBEDDING_STORAGE_DIMS): number[] {
  if (!Array.isArray(vec) || vec.length === 0) {
    return new Array(targetDims).fill(0);
  }
  if (vec.length === targetDims) return [...vec];
  if (vec.length > targetDims) return vec.slice(0, targetDims);
  return [...vec, ...new Array(targetDims - vec.length).fill(0)];
}

/** Pad `embedding_1` / `embedding_2` on a partial document before ES update/index. */
export function normaliseEmbeddingOnDocForEs(doc: Record<string, unknown>): void {
  for (const key of ['embedding_1', 'embedding_2'] as const) {
    const v = doc[key];
    if (Array.isArray(v) && v.length > 0) {
      doc[key] = padEmbeddingForStorage(v as number[]);
    }
  }
}

/** Prefer `embedding_1` (default slot), then `embedding_2`. */
export function getDefaultStoredEmbedding(doc: {
  embedding_1?: number[];
  embedding_2?: number[];
}): number[] | undefined {
  if (doc.embedding_1 && doc.embedding_1.length > 0) return doc.embedding_1;
  if (doc.embedding_2 && doc.embedding_2.length > 0) return doc.embedding_2;
  return undefined;
}
