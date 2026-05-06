import { getDbmlCore, type DbmlImportFormat } from "./core";

export const DBML_IMPORT_FORMATS: DbmlImportFormat[] = ["postgres", "mysql", "mssql", "snowflake", "oracle", "schemarb", "json"];

export function importSourceToDbml(source: string, format: DbmlImportFormat, options?: { includeRecords?: boolean }): string {
  return getDbmlCore().importToDbml(source, format, options);
}

export function labelForImportFormat(format: DbmlImportFormat): string {
  switch (format) {
    case "postgres": return "PostgreSQL SQL";
    case "mysql": return "MySQL SQL";
    case "mssql": return "SQL Server SQL";
    case "snowflake": return "Snowflake SQL";
    case "oracle": return "Oracle SQL";
    case "schemarb": return "Schema.rb";
    case "json": return "DBML JSON";
    default: return format;
  }
}
