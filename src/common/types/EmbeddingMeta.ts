// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.

/**
 * Metadata for a stored embedding vector (model, dimensions, pipeline version).
 */
export default interface EmbeddingMeta {
  /** Logical model id, e.g. openai:text-embedding-3-small */
  model: string;
  /** Length of the meaningful vector (embedding may be padded in ES to EMBEDDING_STORAGE_DIMS). */
  dimensions: number;
  /** Provider or pipeline version string. */
  version?: string;
  /** How the vector was produced, e.g. deterministic_hash_v1, openai_embeddings_api */
  algorithm?: string;
}
