import { getDbmlCore } from "./core";
import type { DbmlDiagnostic, DbmlDiagnosticSeverity, DbmlParseResult } from "./types";

export function parseDbml(source: string): DbmlParseResult {
  try {
    const database = getDbmlCore().parseDbmlToDatabase(source);
    return { database, errors: [] };
  } catch (error) {
    const parserError = error as { diags?: unknown[]; message?: string };
    if (Array.isArray(parserError.diags)) {
      return { database: null, errors: parserError.diags.map(normalizeDiagnostic) };
    }
    return {
      database: null,
      errors: [{
        message: error instanceof Error ? error.message : "Unknown parsing error",
        type: "error",
        location: { start: { line: 1, column: 1 }, end: { line: 1, column: 10 } }
      }]
    };
  }
}

export function diagnosticsToMessage(errors: DbmlDiagnostic[]): string | undefined {
  if (errors.length === 0) return undefined;
  return errors.map((error) => `${error.message}${error.code ? ` [${error.code}]` : ""}`).join("\n");
}

function normalizeDiagnostic(error: unknown): DbmlDiagnostic {
  const record = asRecord(error);
  const location = asRecord(record.location);
  const start = asRecord(location.start);
  const end = asRecord(location.end);
  return {
    message: stringValue(record.message) || "Unknown DBML parsing error",
    code: typeof record.code === "string" || typeof record.code === "number" ? record.code : undefined,
    type: normalizeSeverity(record.type),
    filepath: stringValue(record.filepath) || stringValue(record.fileName) || stringValue(record.filename),
    stack: record.stack,
    location: {
      start: {
        line: Math.max(1, Number(start.line) || 1),
        column: Math.max(1, Number(start.column) || 1)
      },
      end: {
        line: Math.max(1, Number(end.line) || Number(start.line) || 1),
        column: Math.max(1, Number(end.column) || Number(start.column) || 10)
      }
    }
  };
}

function normalizeSeverity(value: unknown): DbmlDiagnosticSeverity {
  if (value === "warning" || value === "warn") return "warning";
  if (value === "info" || value === "information") return "info";
  return "error";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
