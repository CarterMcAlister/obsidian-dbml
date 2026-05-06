export type DbmlImportFormat = "dbml" | "mysql" | "postgres" | "json" | "mssql" | "postgresLegacy" | "mssqlLegacy" | "schemarb" | "snowflake" | "oracle";
export type DbmlExportFormat = "dbml" | "mysql" | "postgres" | "json" | "mssql" | "oracle";
export type DbmlParseFormat = DbmlImportFormat | "dbmlv2";

export interface DbmlExportOptions {
  includeRecords?: boolean;
  isNormalized?: boolean;
}

export interface DbmlCoreFacade {
  parseToDatabase(source: string, format?: DbmlParseFormat): unknown;
  parseDbmlToDatabase(source: string): unknown;
  parseDbmlToModel(source: string): unknown;
  importToDbml(source: string, format: DbmlImportFormat, options?: { includeRecords?: boolean }): string;
  generateDbmlFromSchemaJson(schemaJson: unknown): string;
  exportDbml(source: string, format: DbmlExportFormat, options?: DbmlExportOptions): string;
  exportModel(model: unknown, format: DbmlExportFormat, options?: DbmlExportOptions): string;
  renameTable(oldName: TableNameInput, newName: TableNameInput, source: string): string;
  findDiagramViewBlocks(source: string): unknown[];
  syncDiagramView(source: string, operations: unknown[], blocks?: unknown[]): { newDbml: string; edits: unknown[] };
  addDoubleQuoteIfNeeded(value: string): string;
  formatRecordValue(value: unknown): string;
}

export type TableNameInput = string | { schema?: string; table: string };

interface CoreModule {
  Parser?: new () => { parse: (source: string, format: string) => { normalize?: () => unknown } | unknown };
  importer?: { import?: (source: string, format: DbmlImportFormat, options?: unknown) => string; generateDbml?: (schemaJson: unknown) => string };
  exporter?: { export?: (source: string, format: DbmlExportFormat, options?: unknown) => string };
  ModelExporter?: { export?: (model: unknown, format: DbmlExportFormat, options?: unknown) => string };
  renameTable?: (oldName: TableNameInput, newName: TableNameInput, source: string) => string;
  findDiagramViewBlocks?: (source: string) => unknown[];
  syncDiagramView?: (source: string, operations: unknown[], blocks?: unknown[]) => { newDbml: string; edits: unknown[] };
  addDoubleQuoteIfNeeded?: (value: string) => string;
  formatRecordValue?: (value: unknown) => string;
}

let coreModule: CoreModule | null = null;
let parserInstance: { parse: (source: string, format: string) => unknown } | null = null;
let facade: DbmlCoreFacade | null = null;

export function getDbmlCore(): DbmlCoreFacade {
  if (facade) return facade;
  const core = loadCoreModule();
  const parser = getParser(core);
  const requireFn = <T>(value: T | undefined, name: string): T => {
    if (!value) throw new Error(`@dbml/core ${name} export was not found.`);
    return value;
  };

  facade = {
    parseToDatabase(source: string, format: DbmlParseFormat = "dbmlv2"): unknown {
      const parsed = parser.parse(source, format);
      return normalizeParseResult(parsed);
    },
    parseDbmlToDatabase(source: string): unknown {
      const parsed = parser.parse(source, "dbmlv2");
      return normalizeParseResult(parsed);
    },
    parseDbmlToModel(source: string): unknown {
      return parser.parse(source, "dbmlv2");
    },
    importToDbml(source: string, format: DbmlImportFormat, options?: { includeRecords?: boolean }): string {
      return requireFn(core.importer?.import, "importer.import")(source, format, options);
    },
    generateDbmlFromSchemaJson(schemaJson: unknown): string {
      return requireFn(core.importer?.generateDbml, "importer.generateDbml")(schemaJson);
    },
    exportDbml(source: string, format: DbmlExportFormat, options?: DbmlExportOptions): string {
      return requireFn(core.exporter?.export, "exporter.export")(source, format, options);
    },
    exportModel(model: unknown, format: DbmlExportFormat, options?: DbmlExportOptions): string {
      return requireFn(core.ModelExporter?.export, "ModelExporter.export")(model, format, options);
    },
    renameTable(oldName: TableNameInput, newName: TableNameInput, source: string): string {
      return requireFn(core.renameTable, "renameTable")(oldName, newName, source);
    },
    findDiagramViewBlocks(source: string): unknown[] {
      return requireFn(core.findDiagramViewBlocks, "findDiagramViewBlocks")(source);
    },
    syncDiagramView(source: string, operations: unknown[], blocks?: unknown[]): { newDbml: string; edits: unknown[] } {
      return requireFn(core.syncDiagramView, "syncDiagramView")(source, operations, blocks);
    },
    addDoubleQuoteIfNeeded(value: string): string {
      return core.addDoubleQuoteIfNeeded ? core.addDoubleQuoteIfNeeded(value) : fallbackQuoteIdentifier(value);
    },
    formatRecordValue(value: unknown): string {
      return core.formatRecordValue ? core.formatRecordValue(value) : fallbackFormatRecordValue(value);
    }
  };
  return facade;
}

function loadCoreModule(): CoreModule {
  if (!coreModule) coreModule = require("@dbml/core") as CoreModule;
  return coreModule;
}

function getParser(core: CoreModule): { parse: (source: string, format: string) => unknown } {
  if (!parserInstance) {
    if (!core.Parser) throw new Error("@dbml/core Parser export was not found.");
    parserInstance = new core.Parser();
  }
  return parserInstance;
}

function normalizeParseResult(parsed: unknown): unknown {
  if (parsed && typeof parsed === "object" && typeof (parsed as { normalize?: unknown }).normalize === "function") {
    return (parsed as { normalize: () => unknown }).normalize();
  }
  return parsed;
}

function fallbackQuoteIdentifier(value: string): string {
  const trimmed = value.trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) ? trimmed : `"${trimmed.replace(/"/g, "\\\"")}"`;
}

function fallbackFormatRecordValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${String(value).replace(/'/g, "\\'")}'`;
}
