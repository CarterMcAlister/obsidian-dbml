export type DatabaseType = "postgres" | "mysql" | "mssql" | "snowflake";

export const DATABASE_TYPES: DatabaseType[] = ["postgres", "mysql", "mssql", "snowflake"];

export function connectionPlaceholder(type: DatabaseType): string {
  switch (type) {
    case "postgres": return "postgresql://user:password@localhost:5432/dbname?schemas=schema1,schema2,schema3";
    case "mysql": return "mysql://user:password@localhost:3306/dbname";
    case "mssql": return "Server=localhost,1433;Database=master;User Id=sa;Password=your_password;Encrypt=true;TrustServerCertificate=true;Schemas=schema1,schema2,schema3;";
    case "snowflake": return "SERVER=<account_identifier>.<region>;UID=<your_username>;PWD=<your_password>;DATABASE=<your_database>;WAREHOUSE=<your_warehouse>;ROLE=<your_role>;SCHEMAS=schema1,schema2,schema3;";
  }
}

export async function generateDbmlFromConnection(connection: string, databaseType: DatabaseType): Promise<string> {
  const connectorModule = require("@dbml/connector") as { connector?: { fetchSchemaJson: (connection: string, databaseType: string) => Promise<unknown> } };
  if (!connectorModule.connector) throw new Error("@dbml/connector export was not found.");
  const schemaJson = await connectorModule.connector.fetchSchemaJson(connection, databaseType);
  return generateDbmlFromSchemaJson(schemaJson);
}

export function generateDbmlFromSchemaJson(schemaJson: unknown): string {
  try {
    const core = require("@dbml/core") as Record<string, unknown>;
    const exporter = core.exporter as { export?: (database: unknown, format: string) => string } | undefined;
    const importer = core.importer as { import?: (schema: unknown, format: string) => unknown } | undefined;
    if (importer?.import && exporter?.export) {
      const database = importer.import(schemaJson, "schema_json");
      const exported = exporter.export(database, "dbml");
      if (typeof exported === "string" && exported.trim()) return exported;
    }
  } catch {}
  return manualSchemaJsonToDbml(schemaJson);
}

function manualSchemaJsonToDbml(schemaJson: unknown): string {
  const root = asRecord(schemaJson);
  const tables = collectTables(root);
  const refs = collectRefs(root);
  const lines: string[] = [];
  for (const table of tables) {
    const schema = stringValue(table.schema) || stringValue(table.schemaName);
    const name = stringValue(table.name) || stringValue(table.tableName) || "table";
    lines.push(`Table ${quoteName(schema ? `${schema}.${name}` : name)} {`);
    for (const column of collectArray(table, ["columns", "fields"])) {
      const columnRecord = asRecord(column);
      const columnName = stringValue(columnRecord.name) || stringValue(columnRecord.columnName) || "column";
      const type = stringValue(columnRecord.type) || stringValue(columnRecord.dataType) || stringValue(columnRecord.dbType) || "varchar";
      const settings = columnSettings(columnRecord);
      lines.push(`  ${quoteName(columnName)} ${type}${settings.length ? ` [${settings.join(", ")}]` : ""}`);
    }
    lines.push("}", "");
  }
  for (const ref of refs) {
    const line = refToDbml(ref);
    if (line) lines.push(line);
  }
  return lines.join("\n").trimEnd() + "\n";
}

function collectTables(root: Record<string, unknown>): Array<Record<string, unknown>> {
  const direct = collectArray(root, ["tables"]);
  const schemas = collectArray(root, ["schemas"]);
  return [
    ...direct.map(asRecord),
    ...schemas.flatMap((schema) => collectArray(asRecord(schema), ["tables"]).map((table) => ({ ...asRecord(table), schema: stringValue(asRecord(schema).name) })))
  ];
}

function collectRefs(root: Record<string, unknown>): Array<Record<string, unknown>> {
  return collectArray(root, ["refs", "relationships", "foreignKeys"]).map(asRecord);
}

function columnSettings(column: Record<string, unknown>): string[] {
  const settings: string[] = [];
  if (column.pk || column.primary || column.primaryKey) settings.push("primary key");
  if (column.unique) settings.push("unique");
  if (column.notNull || column.nullable === false) settings.push("not null");
  if (column.increment || column.autoIncrement) settings.push("increment");
  const note = stringValue(column.note || column.comment);
  if (note) settings.push(`note: '${escapeSingle(note)}'`);
  return settings;
}

function refToDbml(ref: Record<string, unknown>): string | null {
  const endpoints = collectArray(ref, ["endpoints"]);
  if (endpoints.length >= 2) {
    const left = endpointToDbml(asRecord(endpoints[0]));
    const right = endpointToDbml(asRecord(endpoints[1]));
    return left && right ? `Ref: ${left} > ${right}` : null;
  }
  const from = endpointToDbml(asRecord(ref.from || ref.source));
  const to = endpointToDbml(asRecord(ref.to || ref.target));
  return from && to ? `Ref: ${from} > ${to}` : null;
}

function endpointToDbml(endpoint: Record<string, unknown>): string | null {
  const table = stringValue(endpoint.tableName || endpoint.table || endpoint.table_name);
  const schema = stringValue(endpoint.schemaName || endpoint.schema || endpoint.schema_name);
  const fields = collectArray(endpoint, ["fieldNames", "fields", "columns", "columnNames"]).map((field) => stringValue(field) || stringValue(asRecord(field).name)).filter(Boolean);
  if (!table || fields.length === 0) return null;
  return `${quoteName(schema ? `${schema}.${table}` : table)}.${quoteName(fields[0] as string)}`;
}

function collectArray(record: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.values(value as Record<string, unknown>);
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function quoteName(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(value) ? value : `"${value.replace(/"/g, "\\\"")}"`;
}

function escapeSingle(value: string): string {
  return value.replace(/'/g, "\\'");
}
