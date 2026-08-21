// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.

/**
 * Fraction where 1 is a perfect score, and 0 is the worst score.
 * The message is a short bullet-point explanation of up to 100 words.
 */
export interface MetricResult {
  /** Fraction where 1 is a perfect score, and 0 is the worst score. */
  score: number;
  /** A short bullet-point explanation of up to 100 words. */
  message?: string;
  /** An error message if the metric could not be scored. */
  error?: string;
}
