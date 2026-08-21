// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.

export default interface User {
  id: string;
  email?: string;
  name?: string;
  /** Auth0 subject identifier (e.g., "google-oauth2|109424848053592856653") */
  sub: string;
  created: Date;
  updated: Date;
  isSuperAdmin?: boolean;
}

