// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.

import Metric from './Metric.js';

export default interface Dataset {
  /** uuid */
  id: string;
  organisation: string;
  name: string;
  description?: string;
  tags?: string[];
  metrics?: Metric[];
  // /** id for the user who omade it */
  // owner: string;
  created: Date;
  updated: Date;
  // version: number; updated will do
}

