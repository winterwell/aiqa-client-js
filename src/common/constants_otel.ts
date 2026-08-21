// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.

/**
 * OpenTelemetry semantic convention constants for GenAI attributes.
 * These follow the OpenTelemetry GenAI semantic conventions:
 * https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
 */

// Token usage attributes
export const GEN_AI_USAGE_TOTAL_TOKENS = 'gen_ai.usage.total_tokens';
export const GEN_AI_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
export const GEN_AI_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';
export const GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS = 'gen_ai.usage.cache_creation.input_tokens';
/** When set to '1h', cache creation is costed at cache_write_1h_Mtkn; otherwise 5m (default). */
export const GEN_AI_USAGE_CACHE_WRITE_TTL = 'gen_ai.usage.cache_write.ttl';
export const GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS = 'gen_ai.usage.cache_read.input_tokens';

// Cost attributes (non-standard)
export const GEN_AI_COST_USD = 'gen_ai.cost.usd';
export const GEN_AI_COST_CALCULATOR = 'gen_ai.costcalculator';

// Server-side generation timing (seconds)
export const GEN_AI_SERVER_TIME_TO_FIRST_OUTPUT_TOKEN = 'gen_ai.server.time_to_first_output_token';

// Provider and model attributes
export const GEN_AI_PROVIDER_NAME = 'gen_ai.provider.name';
export const GEN_AI_REQUEST_MODEL = 'gen_ai.request.model';
export const GEN_AI_REQUEST_MODE = 'gen_ai.request.mode';

// AIQA-specific attributes
/**
 * The experiment ID for the trace of an experiment running an Example.
 * This is set by the experiment runner.
 */
export const AIQA_EXPERIMENT_ID = 'aiqa.experiment';

/**
 * The example ID for the example being run by the experiment.
 * This is set by the experiment runner.
 */
export const AIQA_EXAMPLE_ID = 'aiqa.example';

/**
 * positive, negative, neutral
 */
export const FEEDBACK_VALUE = 'feedback.value';
export const GEN_AI_OPERATION_NAME = 'gen_ai.operation.name';