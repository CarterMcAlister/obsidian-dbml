import { getDbmlCore, type DbmlExportFormat, type DbmlExportOptions } from "./core";

export const DBML_EXPORT_FORMATS: DbmlExportFormat[] = ["postgres", "mysql", "mssql", "oracle", "json", "dbml"];

export function exportDbmlSource(source: string, format: DbmlExportFormat, options?: DbmlExportOptions): string {
  if (format === "json" && options?.isNormalized === false) return exportDbmlSourceJson(source);
  return getDbmlCore().exportDbml(source, format, options);
}

function exportDbmlSourceJson(source: string): string {
  const model = getDbmlCore().parseDbmlToModel(source) as { export?: () => unknown };
  if (typeof model.export !== "function") return getDbmlCore().exportDbml(source, "json", { isNormalized: false });
  return JSON.stringify(model.export(), null, 2);
}

export function normalizeDbmlSource(source: string, options?: Pick<DbmlExportOptions, "includeRecords">): string {
  const model = getDbmlCore().parseDbmlToDatabase(source);
  return getDbmlCore().exportModel(model, "dbml", options);
}

export function labelForExportFormat(format: DbmlExportFormat): string {
  switch (format) {
    case "postgres": return "PostgreSQL SQL";
    case "mysql": return "MySQL SQL";
    case "mssql": return "SQL Server SQL";
    case "oracle": return "Oracle SQL";
    case "json": return "JSON";
    case "dbml": return "Normalized DBML";
  }
}

export function extensionForExportFormat(format: DbmlExportFormat, options?: DbmlExportOptions): string {
  switch (format) {
    case "postgres": return "postgres.sql";
    case "mysql": return "mysql.sql";
    case "mssql": return "mssql.sql";
    case "oracle": return "oracle.sql";
    case "json": return options?.isNormalized ? "normalized.json" : "json";
    case "dbml": return "normalized.dbml";
  }
}
