// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.

/**
 * Subscription defaults: uses shared config from subscriptions.ts (server and webapp).
 */

import { subscriptionsConfig } from './subscriptions.js';

export type SubscriptionDefaults = {
  rateLimitPerHour: number;
  retentionPeriodDays: number;
  maxMembers: number;
  maxDatasets: number;
  experimentRetentionDays: number;
  maxExamplesPerDataset: number;
};

type SubscriptionType = 'free' | 'trial' | 'pro' | 'enterprise';

/**
 * Get subscription defaults for a given subscription type.
 * Returns null if subscription type is invalid.
 */
export function getSubscriptionDefaults(
  subscriptionType: SubscriptionType | string | undefined
): SubscriptionDefaults | null {
  if (!subscriptionType) {
    return null;
  }

  const type = subscriptionType.toLowerCase() as SubscriptionType;
  if (type in subscriptionsConfig) {
    return subscriptionsConfig[type];
  }

  return null;
}

/**
 * Get a specific threshold value for an organisation, falling back to subscription defaults.
 *
 * @param org - Organisation object
 * @param thresholdKey - Key of the threshold to get (e.g., 'rateLimitPerHour')
 * @returns The threshold value, or null if not set and no subscription fallback
 */
export function getOrganisationThreshold<T extends keyof SubscriptionDefaults>(
  org: { subscription?: { type?: string } } & Partial<Record<T, number>>,
  thresholdKey: T
): number | null {
  const explicitValue = org[thresholdKey];
  if (explicitValue !== undefined && explicitValue !== null) {
    return explicitValue;
  }

  const subscriptionType = org.subscription?.type;
  if (subscriptionType) {
    const defaults = getSubscriptionDefaults(subscriptionType);
    if (defaults && thresholdKey in defaults) {
      return defaults[thresholdKey];
    }
  }

  return null;
}
