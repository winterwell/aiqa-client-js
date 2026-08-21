// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.



/**
 * LifecycleStatus describes the lifecycle state of an entity or process.
 */
export type LifecycleStatus =
  | "draft"
  | "processing"
  | "active"
  | "closing"
  | "closed"
  | "archived"
  | "error";
