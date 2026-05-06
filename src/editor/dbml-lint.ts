import { linter, Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import type DbmlPlugin from "../main";
import { parseDbml } from "../dbml/parser";
import { findDbmlFences } from "../dbml/source";

export function createDbmlLintExtension(plugin: DbmlPlugin) {
  return linter((view) => lintDbml(view, plugin), { delay: 400 });
}

function lintDbml(view: EditorView, plugin: DbmlPlugin): Diagnostic[] {
  const activeFile = plugin.app.workspace.getActiveFile();
  const text = view.state.doc.toString();
  if (activeFile?.extension.toLowerCase() === "dbml") return diagnosticsForSource(view, text, 0);
  const diagnostics: Diagnostic[] = [];
  for (const fence of findDbmlFences(text)) {
    diagnostics.push(...diagnosticsForSource(view, fence.source, fence.startLine + 1));
  }
  return diagnostics;
}

function diagnosticsForSource(view: EditorView, source: string, lineOffset: number): Diagnostic[] {
  const result = parseDbml(source);
  return result.errors.map((error) => {
    const startLine = Math.max(1, error.location.start.line + lineOffset);
    const endLine = Math.max(startLine, error.location.end.line + lineOffset);
    const from = positionToOffset(view, startLine, error.location.start.column);
    const to = Math.max(from + 1, positionToOffset(view, endLine, error.location.end.column));
    const suffix = error.code ? ` [${error.code}]` : "";
    const details = [error.filepath, error.stack && typeof error.stack === "string" ? error.stack.split("\n")[0] : undefined].filter(Boolean).join(" — ");
    const message = `${error.message}${suffix}${details ? `\n${details}` : ""}`;
    return { from, to, severity: error.type || "error", message, source: "DBML" };
  });
}

function positionToOffset(view: EditorView, lineNumber: number, column: number): number {
  const line = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, lineNumber)));
  return Math.min(line.to, line.from + Math.max(0, column - 1));
}
