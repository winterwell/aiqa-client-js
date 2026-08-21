// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.

export default interface ApiKey {
  id: string;
  organisation: string;
  /**
   * Optional name for the API key (for easier identification).
   */
  name?: string;
  /**
   * The actual API key. This is NOT stored in the database.
   * Only present temporarily in the frontend when generating a new key.
   */
  key?: string;
  /**
   * Only the hash of the API key is stored in the database.
   * This is used to authenticate requests.
   * Hash algorithm: sha256
   */
  hash: string;
  /** store the last 4 characters of the API key so the user can identify it in the webapp */
  keyEnd?: string;
  // rateLimitPerHour?: number;
  // retentionPeriodDays?: number;
  /** Role of the API key: 'trace' (can only post spans), 'developer' (most endpoints), or 'admin' (all endpoints) */
  role: 'trace' | 'developer' | 'admin';
  created: Date;
  updated: Date;
}

