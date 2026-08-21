// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.

// Schema registry - imports all JSON schema files so they're bundled into the build
import OrganisationSchema from '../types/Organisation.schema.json';
import OrganisationAccountSchema from '../types/OrganisationAccount.schema.json';
import UserSchema from '../types/User.schema.json';
import ApiKeySchema from '../types/ApiKey.schema.json';
import ModelSchema from '../types/Model.schema.json';
import DatasetSchema from '../types/Dataset.schema.json';
import ExperimentSchema from '../types/Experiment.schema.json';
import ReportSchema from '../types/Report.schema.json';
import SpanSchema from '../types/Span.schema.json';
import ExampleSchema from '../types/Example.schema.json';
import MetricSchema from '../types/Metric.schema.json';

import type { JsonSchema } from './schema-loader.js';

const schemaRegistry: Record<string, JsonSchema> = {
  Metric: MetricSchema as JsonSchema,
  Organisation: OrganisationSchema as JsonSchema,
  OrganisationAccount: OrganisationAccountSchema as JsonSchema,
  User: UserSchema as JsonSchema,
  ApiKey: ApiKeySchema as JsonSchema,
  Model: ModelSchema as JsonSchema,
  Dataset: DatasetSchema as JsonSchema,
  Experiment: ExperimentSchema as JsonSchema,
  Report: ReportSchema as JsonSchema,
  Span: SpanSchema as JsonSchema,
  Example: ExampleSchema as JsonSchema,
};

export function getSchema(typeName: string): JsonSchema {
  const schema = schemaRegistry[typeName];
  if (!schema) {
    throw new Error(`Schema not found for type: ${typeName}`);
  }
  return schema;
}
























