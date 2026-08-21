// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.

import { LifecycleStatus } from "./LifecycleStatus";

type Subscription = {
  type: "trial" | "free" | "pro" | "enterprise";
  status: LifecycleStatus;
  start: Date;
  end: Date | null;
  renewal: Date | null;
  pricePerMonth: number;
  currency: "USD" | "EUR" | "GBP";
}

export default interface OrganisationAccount {
  id: string;
  organisation: string; // Organisation ID (foreign key)

  subscription: Subscription;
  /** Stripe customer ID */
  stripeCustomerId?: string;
  /** Stripe subscription ID */
  stripeSubscriptionId?: string;
  /** default: 1000 */
  rateLimitPerHour?: number;
  /** default: 20 */
  retentionPeriodDays?: number;
  maxMembers?: number;
  maxDatasets?: number;
  experimentRetentionDays?: number;
  maxExamplesPerDataset?: number;

  created: Date;
  updated: Date;
}

