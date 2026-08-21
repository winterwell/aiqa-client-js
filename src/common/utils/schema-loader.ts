// GENERATED FILE - do not edit.
// Straight copy of aiqa/server/src/common, which is the canonical source.
// Edit the original in the aiqa server repo, then run `npm run sync-types`.

export interface JsonSchema {
  $ref?: string;
  definitions?: Record<string, {
    properties?: Record<string, any>;
    required?: string[];
    type?: string;
  }>;
}

import { getSchema } from './schema-registry.js';

/**
 * Load a JSON schema file for a type
 * Schemas are imported and bundled into the build, so no file system access is needed
 */
export function loadSchema(typeName: string): JsonSchema {
  return getSchema(typeName);
}

/**
 * Get the type definition from a JSON schema
 */
export function getTypeDefinition(schema: JsonSchema, typeName: string): any {
  if (schema.definitions && schema.definitions[typeName]) {
    return schema.definitions[typeName];
  }
  // Try to get from $ref
  if (schema.$ref) {
    const refName = schema.$ref.split('/').pop() || typeName;
    return schema.definitions?.[refName];
  }
  return null;
}

/**
 * Convert JSON Schema type to PostgreSQL type
 */
export function jsonSchemaToPostgresType(prop: any, fieldName: string): string {
  const type = prop.type;

  // Handle special case fields
  switch (fieldName) {
    case 'id':
      return 'UUID PRIMARY KEY DEFAULT gen_random_uuid()';
    case 'created':
    case 'updated':
      return 'TIMESTAMP DEFAULT NOW()';
    case 'members':
      return "TEXT[] DEFAULT '{}'";
    case 'version':
      return 'INTEGER DEFAULT 0';

  }

  if (fieldName.includes('_id') && fieldName !== 'id') {
    // Foreign key fields: NOT NULL will be determined by required array in schema
    return 'UUID';
  }

  switch (type) {
    case 'string':
      if (prop.format === 'date-time') {
        return 'TIMESTAMP DEFAULT NOW()';
      }
      // Hash fields: keep UNIQUE constraint, but NOT NULL comes from required array
      if (fieldName.includes('hash')) {
        return 'VARCHAR(255) UNIQUE';
      }
      // key (plaintext) is never stored in DB, so always nullable
      if (fieldName === 'key') {
        return 'VARCHAR(255)';
      }
      // email: allow null and non-unique (sub is the login auth key)
      if (fieldName === 'email') {
        return 'VARCHAR(255)';
      }
      // All other string fields: NOT NULL determined by required array in schema
      return 'VARCHAR(255)';
    case 'number':
      return 'INTEGER';
    case 'boolean':
      return 'BOOLEAN';
    case 'array':
      if (prop.items?.type === 'string') {
        return 'TEXT[]';
      }
      return 'JSONB';
    case 'object':
    default:
      return 'JSONB';
  }
}

/** PostgreSQL limit: tables may have at most 1600 columns. */
const PG_MAX_COLUMNS = 100; // actual limit is 1600 but > 100 means here would be bogus;

/**
 * Convert PascalCase/camelCase to snake_case. Exported for DB layer (column name mapping).
 */
export function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

/**
 * Convert type name to PostgreSQL table name (snake_case, pluralized)
 */
function typeNameToTableName(typeName: string): string {
  const snakeCase = toSnakeCase(typeName);
  // Simple pluralization: add 's' (works for most cases)
  return `${snakeCase}s`;
}

/**
 * Convert JSON Schema to PostgreSQL CREATE TABLE statement.
 * Does not run the CREATE TABLE statement, just returns the SQL.
 */
export function generatePostgresTable(
  typeName: string,
  schema: JsonSchema,
  additionalColumns: Record<string, string> = {},
  constraints: string[] = []
): string {
  const def = getTypeDefinition(schema, typeName);
  if (!def || !def.properties) {
    throw new Error(`Could not find type definition for ${typeName}`);
  }

  const columns: string[] = [];
  const columnMap = new Map<string, string>();
  const required = def.required || [];

  // Add columns from schema
  for (const [fieldName, prop] of Object.entries(def.properties)) {
    const pgType = jsonSchemaToPostgresType(prop, fieldName);
    const isRequired = required.includes(fieldName);
    // Add NOT NULL if field is required, doesn't have DEFAULT, and doesn't already have NOT NULL
    const notNull = isRequired && !pgType.includes('DEFAULT') && !pgType.includes('NOT NULL') ? ' NOT NULL' : '';
    columnMap.set(fieldName, `${pgType}${notNull}`);
  }

  // Override or add additional columns (for foreign keys, etc.)
  for (const [fieldName, columnDef] of Object.entries(additionalColumns)) {
    columnMap.set(fieldName, columnDef);
  }

  const columnCount = columnMap.size;
  if (columnCount > PG_MAX_COLUMNS) {
    const tableName = typeNameToTableName(typeName);
    throw new Error(
      `Table ${tableName} (type ${typeName}) would have ${columnCount} columns; PostgreSQL allows at most ${PG_MAX_COLUMNS}. Check that the schema for ${typeName} has a reasonable number of top-level properties.`
    );
  }

  // Convert map to array of column definitions (snake_case column names for PostgreSQL)
  for (const [fieldName, columnDef] of columnMap.entries()) {
    columns.push(`  ${toSnakeCase(fieldName)} ${columnDef}`);
  }

  // Add constraints
  columns.push(...constraints);

  const tableName = typeNameToTableName(typeName);
  return `CREATE TABLE IF NOT EXISTS ${tableName} (\n${columns.join(',\n')}\n)`;
}

/**
 * Convert JSON Schema property to Elasticsearch mapping.
 * By default, strings are stored as keyword fields - except for name, description fields.
 */
export function jsonSchemaToEsMapping(prop: any, fieldName: string): any {
  const type = prop.type;

  if (fieldName === '@timestamp' || (fieldName.includes('timestamp') || fieldName.includes('created') || fieldName.includes('updated'))) {
    return { type: 'date' };
  }

  if (fieldName.includes('_id') || fieldName === 'id') {
    return { type: 'keyword' };
  }

  switch (type) {
    case 'string':
      // default to keyword as id-lookup is the normal case
      // HACK: but name, description, notes are text searchable fields.
      if (fieldName === 'name' || fieldName === 'description' || fieldName === 'notes') {
        return { type: 'text', fields: { keyword: { type: 'keyword' } } };
      }
      return { type: 'keyword' };
    case 'integer':
    case 'number':
    case 'boolean':
      return { type: esTypeForJsonSchemaPrimitiveType[type] };
    case 'array':
      const primitiveType = esTypeForJsonSchemaPrimitiveType[prop.items?.type];
      if (primitiveType) {
        return { type: primitiveType };
      }
      console.warn(`TODO Unknown array item type: ${prop} from field ${fieldName}`);
      return {};
    case 'object':
      return {
        type: 'object',
        properties: {}
      };
    default:
      console.warn(`TODO Unknown type: ${type} from field ${fieldName}`);
      return {};
  }
}

const esTypeForJsonSchemaPrimitiveType = {
  'string': 'keyword',
  'integer': 'long',
  'number': 'float',
  'boolean': 'boolean'
}
