import type { DbmlDiagnostic, DbmlParseResult } from "./types";

let parserInstance: unknown | null = null;

function getParser(): { parse: (source: string, format: string) => { normalize: () => unknown } } {
  if (!parserInstance) {
    const core = require("@dbml/core") as { Parser?: new () => { parse: (source: string, format: string) => { normalize: () => unknown } } };
    if (!core.Parser) throw new Error("@dbml/core Parser export was not found.");
    parserInstance = new core.Parser();
  }
  return parserInstance as { parse: (source: string, format: string) => { normalize: () => unknown } };
}

export function parseDbml(source: string): DbmlParseResult {
  try {
    const database = getParser().parse(source, "dbmlv2").normalize();
    return { database, errors: [] };
  } catch (error) {
    const parserError = error as { diags?: DbmlDiagnostic[]; message?: string };
    if (Array.isArray(parserError.diags)) {
      return { database: null, errors: parserError.diags.map(normalizeDiagnostic) };
    }
    return {
      database: null,
      errors: [{
        message: error instanceof Error ? error.message : "Unknown parsing error",
        location: { start: { line: 1, column: 1 }, end: { line: 1, column: 10 } }
      }]
    };
  }
}

export function diagnosticsToMessage(errors: DbmlDiagnostic[]): string | undefined {
  if (errors.length === 0) return undefined;
  return errors.map((error) => error.message).join("\n");
}

function normalizeDiagnostic(error: DbmlDiagnostic): DbmlDiagnostic {
  return {
    message: error.message || "Unknown DBML parsing error",
    code: error.code,
    location: {
      start: {
        line: Math.max(1, Number(error.location?.start?.line) || 1),
        column: Math.max(1, Number(error.location?.start?.column) || 1)
      },
      end: {
        line: Math.max(1, Number(error.location?.end?.line) || Number(error.location?.start?.line) || 1),
        column: Math.max(1, Number(error.location?.end?.column) || Number(error.location?.start?.column) || 10)
      }
    }
  };
}
