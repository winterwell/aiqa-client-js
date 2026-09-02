export const DEFAULT_AIQA_SERVER_URL = 'https://server-aiqa.winterwell.com';
export const TRACER_NAME = 'aiqa-tracer';
export const GEN_AI_OPERATION_NAME = 'gen_ai.operation.name';
/**
 * The OpenTelemetry `service.name` resource attribute key.
 *
 * Inlined rather than imported from `@opentelemetry/semantic-conventions`: that package
 * is a single un-treeshakeable barrel of every convention ever defined, so importing one
 * string from it costs ~250kB in a browser bundle. It also renamed its exports between
 * 1.x and 2.x, which this does not care about.
 */
export const SERVICE_NAME_ATTRIBUTE = 'service.name';
