import type { DbmlSourceRef } from "./types";

interface DbmlTableLike {
  id?: string | number;
  name?: string;
  schemaId?: string | number;
}

interface DbmlTableGroupLike {
  id?: string | number;
  name?: string;
}

interface DbmlDatabaseLike {
  schemas?: Record<string, { name?: string }>;
  tables?: Record<string, DbmlTableLike>;
  tableGroups?: Record<string, DbmlTableGroupLike>;
}

export interface SourcePatchResult {
  source: string;
  changed: boolean;
}

export function findTableByRendererId(database: unknown, id: unknown): DbmlTableLike | null {
  const db = asDatabase(database);
  const normalizedId = normalizeRendererId(id);
  if (normalizedId === null) return null;
  return findRecordById(db.tables, normalizedId) || null;
}

export function findTableGroupByRendererId(database: unknown, id: unknown): DbmlTableGroupLike | null {
  const db = asDatabase(database);
  const normalizedId = normalizeRendererId(id);
  if (normalizedId === null) return null;
  return findRecordById(db.tableGroups, normalizedId) || null;
}

export function renameTableInSource(source: string, database: unknown, table: DbmlTableLike, newName: string): SourcePatchResult {
  const db = asDatabase(database);
  const oldName = stringValue(table.name);
  if (!oldName || !newName.trim() || oldName === newName.trim()) return { source, changed: false };
  const schemaName = stringValue(db.schemas?.[String(table.schemaId)]?.name) || "public";
  const declaration = findNamedBlockDeclaration(source, "Table", oldName, schemaName);
  if (!declaration) return { source, changed: false };

  const formattedName = formatPossiblyQualifiedIdentifier(newName.trim(), schemaName, declaration.identifier.includes("."));
  let next = source.slice(0, declaration.identifierStart) + formattedName + source.slice(declaration.identifierEnd);
  next = replaceTableReferences(next, oldName, schemaName, newName.trim(), declaration.identifier, formattedName);
  return { source: next, changed: next !== source };
}

export function setTableHeaderColorInSource(source: string, database: unknown, table: DbmlTableLike, color: string): SourcePatchResult {
  const db = asDatabase(database);
  const tableName = stringValue(table.name);
  if (!tableName || !isColor(color)) return { source, changed: false };
  const schemaName = stringValue(db.schemas?.[String(table.schemaId)]?.name) || "public";
  const declaration = findNamedBlockDeclaration(source, "Table", tableName, schemaName);
  if (!declaration) return { source, changed: false };
  return setHeaderSetting(source, declaration, "headercolor", color.toUpperCase());
}

export function setTableGroupColorInSource(source: string, group: DbmlTableGroupLike, color: string): SourcePatchResult {
  const groupName = stringValue(group.name);
  if (!groupName || !isColor(color)) return { source, changed: false };
  const declaration = findNamedBlockDeclaration(source, "TableGroup", groupName, "public");
  if (!declaration) return { source, changed: false };
  return setHeaderSetting(source, declaration, "color", color.toUpperCase());
}

export function replaceSourceForRef(markdown: string, ref: DbmlSourceRef, nextSource: string): string | null {
  if (ref.kind === "file") return nextSource;
  if (ref.blockStartLine === undefined || ref.blockEndLine === undefined) return null;
  const lines = markdown.split(/\r?\n/);
  if (ref.blockStartLine < 0 || ref.blockEndLine > lines.length || ref.blockStartLine >= ref.blockEndLine) return null;
  const nextLines = nextSource.split("\n");
  lines.splice(ref.blockStartLine + 1, Math.max(0, ref.blockEndLine - ref.blockStartLine - 1), ...nextLines);
  return lines.join("\n");
}

interface DeclarationMatch {
  start: number;
  openBrace: number;
  headerStart: number;
  headerEnd: number;
  identifier: string;
  identifierStart: number;
  identifierEnd: number;
  settingsStart: number | null;
  settingsEnd: number | null;
}

function findNamedBlockDeclaration(source: string, keyword: "Table" | "TableGroup", name: string, schemaName: string): DeclarationMatch | null {
  const pattern = new RegExp(`\\b${keyword}\\b`, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const afterKeyword = match.index + match[0].length;
    const parsed = readIdentifier(source, afterKeyword);
    if (!parsed) continue;
    const openBrace = findHeaderOpenBrace(source, parsed.end);
    if (openBrace === -1) continue;
    const identifierName = lastQualifiedPart(parsed.value);
    const identifierSchema = schemaPart(parsed.value) || "public";
    const matchesName = normalizeName(identifierName) === normalizeName(name);
    const matchesSchema = keyword === "TableGroup" || normalizeName(identifierSchema) === normalizeName(schemaName) || schemaName === "public";
    if (!matchesName || !matchesSchema) continue;
    const headerStart = match.index;
    const headerEnd = openBrace;
    const settings = findSettingsSpan(source, parsed.end, openBrace);
    return {
      start: match.index,
      openBrace,
      headerStart,
      headerEnd,
      identifier: parsed.value,
      identifierStart: parsed.start,
      identifierEnd: parsed.end,
      settingsStart: settings?.start ?? null,
      settingsEnd: settings?.end ?? null
    };
  }
  return null;
}

function readIdentifier(source: string, position: number): { value: string; start: number; end: number } | null {
  let index = skipWhitespace(source, position);
  const start = index;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source[index];
    const previous = source[index - 1];
    if (quote) {
      index += 1;
      if (char === quote && previous !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      index += 1;
      continue;
    }
    if (/\s|\[|\{/.test(char)) break;
    index += 1;
  }
  if (index <= start) return null;
  return { value: source.slice(start, index), start, end: index };
}

function findHeaderOpenBrace(source: string, position: number): number {
  let quote: string | null = null;
  let bracketDepth = 0;
  for (let index = position; index < source.length; index += 1) {
    const char = source[index];
    const previous = source[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === "{" && bracketDepth === 0) return index;
    if (char === "\n" && bracketDepth === 0) return -1;
  }
  return -1;
}

function findSettingsSpan(source: string, from: number, to: number): { start: number; end: number } | null {
  const start = source.indexOf("[", from);
  if (start === -1 || start > to) return null;
  let quote: string | null = null;
  for (let index = start + 1; index < to; index += 1) {
    const char = source[index];
    const previous = source[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "]") return { start, end: index + 1 };
  }
  return null;
}

function setHeaderSetting(source: string, declaration: DeclarationMatch, settingName: string, value: string): SourcePatchResult {
  if (declaration.settingsStart !== null && declaration.settingsEnd !== null) {
    const settings = source.slice(declaration.settingsStart + 1, declaration.settingsEnd - 1);
    const settingPattern = new RegExp(`(^|,)\\s*${settingName}\\s*:\\s*[^,\\]]+`, "i");
    const nextSettings = settingPattern.test(settings)
      ? settings.replace(settingPattern, (_match, prefix: string) => `${prefix} ${settingName}: ${value}`)
      : `${settings.trimEnd()}${settings.trim() ? "," : ""} ${settingName}: ${value}`;
    const next = source.slice(0, declaration.settingsStart + 1) + nextSettings.trim() + source.slice(declaration.settingsEnd - 1);
    return { source: next, changed: next !== source };
  }
  const next = source.slice(0, declaration.openBrace) + ` [${settingName}: ${value}] ` + source.slice(declaration.openBrace);
  return { source: next, changed: true };
}

function replaceTableReferences(source: string, oldName: string, schemaName: string, newName: string, oldDeclarationIdentifier: string, newDeclarationIdentifier: string): string {
  const oldUnqualified = formatIdentifier(oldName);
  const newUnqualified = formatIdentifier(lastQualifiedPart(newName));
  const oldQualified = `${formatIdentifier(schemaName)}.${oldUnqualified}`;
  const newQualified = schemaPart(newName) ? formatPossiblyQualifiedIdentifier(newName, schemaName, true) : `${formatIdentifier(schemaName)}.${newUnqualified}`;

  let next = source;
  if (oldDeclarationIdentifier !== newDeclarationIdentifier) {
    next = replaceOutsideDeclaration(next, oldQualified, newQualified, oldDeclarationIdentifier, newDeclarationIdentifier);
    next = replaceOutsideDeclaration(next, oldUnqualified, newUnqualified, oldDeclarationIdentifier, newDeclarationIdentifier);
  }
  return next;
}

function replaceOutsideDeclaration(source: string, oldToken: string, newToken: string, oldDeclarationIdentifier: string, newDeclarationIdentifier: string): string {
  if (!oldToken || oldToken === newToken) return source;
  const declarationMarker = `Table ${newDeclarationIdentifier}`;
  const escaped = escapeRegExp(oldToken);
  const pattern = new RegExp(`(^|[^\\w\"'])(${escaped})(?![\\w\"'])`, "g");
  return source.replace(pattern, (match, prefix: string, token: string, offset: number) => {
    const tokenOffset = offset + prefix.length;
    const before = source.slice(Math.max(0, tokenOffset - declarationMarker.length - 2), tokenOffset + token.length + 2);
    if (oldToken === oldDeclarationIdentifier && before.includes(declarationMarker)) return match;
    return `${prefix}${newToken}`;
  });
}

function formatPossiblyQualifiedIdentifier(value: string, fallbackSchemaName: string, keepQualified: boolean): string {
  const schema = schemaPart(value);
  const table = lastQualifiedPart(value);
  if (keepQualified || schema) return `${formatIdentifier(schema || fallbackSchemaName)}.${formatIdentifier(table)}`;
  return formatIdentifier(table);
}

function formatIdentifier(value: string): string {
  const trimmed = unquoteIdentifier(value.trim());
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) ? trimmed : `"${trimmed.replace(/"/g, "\\\"")}"`;
}

function schemaPart(value: string): string | null {
  const parts = splitQualifiedIdentifier(value);
  return parts.length > 1 ? parts.slice(0, -1).join(".") : null;
}

function lastQualifiedPart(value: string): string {
  const parts = splitQualifiedIdentifier(value);
  return parts[parts.length - 1] || value;
}

function splitQualifiedIdentifier(value: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = value[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === ".") {
      parts.push(unquoteIdentifier(value.slice(start, index).trim()));
      start = index + 1;
    }
  }
  parts.push(unquoteIdentifier(value.slice(start).trim()));
  return parts.filter(Boolean);
}

function unquoteIdentifier(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")) || (value.startsWith("`") && value.endsWith("`"))) {
    return value.slice(1, -1).replace(/\\(["'`])/g, "$1");
  }
  return value;
}

function skipWhitespace(source: string, position: number): number {
  let index = position;
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
}

function findRecordById<T extends { id?: string | number }>(records: Record<string, T> | undefined, id: string): T | null {
  if (!records) return null;
  if (records[id]) return records[id];
  return Object.values(records).find((record) => String(record.id) === id) || null;
}

function normalizeRendererId(id: unknown): string | null {
  if (typeof id === "number") return String(id);
  if (typeof id === "string") {
    const parts = id.split("-");
    return parts[parts.length - 1] || null;
  }
  return null;
}

function asDatabase(value: unknown): DbmlDatabaseLike {
  return value && typeof value === "object" ? value as DbmlDatabaseLike : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function normalizeName(value: string): string {
  return unquoteIdentifier(value).trim().toLowerCase();
}

function isColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?$/.test(value.trim());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
