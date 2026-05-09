import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import type DbmlPlugin from "../main";
import { findDbmlFences } from "../dbml/source";

const BLOCK_KEYWORDS = new Set([
  "project", "tablegroup", "table", "enum", "ref", "note", "notes", "tablepartial", "records", "tabledata", "diagramview", "schema", "schemas", "check", "checks"
]);

const SETTING_KEYWORDS = new Set([
  "indexes", "index", "headercolor", "pk", "null", "increment", "unique", "default", "primary", "key", "name", "as", "color",
  "not", "tablegroups", "tables", "database_type", "note", "delete", "update", "on", "cascade", "restrict", "no", "action", "set"
]);

const TYPES = new Set([
  "tinyint", "smallint", "mediumint", "int", "integer", "bigint", "float", "double", "decimal", "dec", "bit", "bool", "boolean",
  "real", "money", "binary_float", "binary_double", "smallmoney", "char", "binary", "varchar", "varbinary", "tinyblob",
  "tinytext", "blob", "text", "mediumblob", "mediumtext", "longblob", "longtext", "set", "inet6", "uuid", "nvarchar",
  "nchar", "ntext", "image", "varchar2", "nvarchar2", "date", "time", "datetime", "datetime2", "timestamp", "year",
  "smalldatetime", "datetimeoffset", "xml", "sql_variant", "uniqueidentifier", "cursor", "bfile", "clob", "nclob", "raw",
  "json", "jsonb", "serial", "bigserial", "uuid"
]);

const TOKEN_PATTERN = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)|`(?:\\.|[^`\\])*(?:`|$)|0[xX][0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?|-?\b[A-Za-z_][\w.]*\b|[{}[\]()]|[,.:]|[<>-]/g;

export function createDbmlSyntaxHighlightExtension(plugin: DbmlPlugin) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view, plugin);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) this.decorations = buildDecorations(update.view, plugin);
    }
  }, {
    decorations: (value) => value.decorations
  });
}

function buildDecorations(view: EditorView, plugin: DbmlPlugin): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  const activeFile = plugin.app.workspace.getActiveFile();
  if (activeFile?.extension.toLowerCase() === "dbml") {
    addDbmlDecorations(builder, text, 0);
  } else if (activeFile?.extension.toLowerCase() === "md") {
    for (const fence of findDbmlFences(text)) {
      const firstSourceLine = fence.startLine + 2;
      if (firstSourceLine > view.state.doc.lines) continue;
      const offset = view.state.doc.line(firstSourceLine).from;
      addDbmlDecorations(builder, fence.source, offset);
    }
  }
  return builder.finish();
}

function addDbmlDecorations(builder: RangeSetBuilder<Decoration>, source: string, offset: number): void {
  TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_PATTERN.exec(source)) !== null) {
    const token = match[0];
    const tokenOffset = match.index;
    const className = classForToken(token);
    if (!className) continue;
    builder.add(offset + tokenOffset, offset + tokenOffset + token.length, Decoration.mark({ class: className }));
  }
}

function classForToken(token: string): string | null {
  if (token.startsWith("/*") || token.startsWith("//")) return "cm-comment";
  if (token.startsWith("'''") || token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) return "cm-string";
  if (/^(?:0[xX][0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?)$/.test(token)) return "cm-number";
  if (/^[{}[\]()]$/.test(token)) return "cm-bracket";
  if (/^[,.:]$/.test(token)) return "cm-punctuation";
  if (/^[<>-]$/.test(token)) return "cm-operator";
  const normalized = token.replace(/^-/, "").toLowerCase();
  if (BLOCK_KEYWORDS.has(normalized) || SETTING_KEYWORDS.has(normalized)) return "cm-keyword";
  if (TYPES.has(normalized)) return "cm-type";
  if (/^[A-Za-z_]/.test(token)) return "cm-variableName";
  return null;
}
