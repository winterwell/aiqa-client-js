// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.

/**
 * Single source for subscription tier limits. Imported by server (subscription_defaults) and webapp (AccountPage).
 */

export const subscriptionsConfig = {
	free: {
		rateLimitPerHour: 100,
		retentionPeriodDays: 7,
		maxMembers: 1,
		maxDatasets: 1,
		experimentRetentionDays: 30,
		maxExamplesPerDataset: 100,
	},
	trial: {
		rateLimitPerHour: 1000,
		retentionPeriodDays: 30,
		maxMembers: 10,
		maxDatasets: 10,
		experimentRetentionDays: 45,
		maxExamplesPerDataset: 1000,
	},
	pro: {
		rateLimitPerHour: 1000,
		retentionPeriodDays: 30,
		maxMembers: 10,
		maxDatasets: 10,
		experimentRetentionDays: 90,
		maxExamplesPerDataset: 1000,
	},
	enterprise: {
		rateLimitPerHour: 10000,
		retentionPeriodDays: 365,
		maxMembers: 1000,
		maxDatasets: 1000,
		experimentRetentionDays: 365,
		maxExamplesPerDataset: 10000,
	},
} as const;
