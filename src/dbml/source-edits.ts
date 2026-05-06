import { getDbmlCore, type TableNameInput } from "./core";
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

interface DbmlFieldLike {
  id?: string | number;
  name?: string;
  tableId?: string | number;
}

interface DbmlEndpointLike {
  id?: string | number;
  schemaName?: string | null;
  tableName?: string;
  fieldNames?: string[];
}

interface DbmlRefLike {
  id?: string | number;
  name?: string | null;
  endpointIds?: Array<string | number>;
}

interface DbmlDatabaseLike {
  schemas?: Record<string, { id?: string | number; name?: string }>;
  tables?: Record<string, DbmlTableLike>;
  fields?: Record<string, DbmlFieldLike>;
  refs?: Record<string, DbmlRefLike>;
  endpoints?: Record<string, DbmlEndpointLike>;
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

export function findRefByRendererId(database: unknown, id: unknown): DbmlRefLike | null {
  const db = asDatabase(database);
  const normalizedId = normalizeRendererId(id);
  if (normalizedId === null) return null;
  return findRecordById(db.refs, normalizedId) || null;
}

export function renameTableByNameInSource(source: string, oldName: string, newName: string, oldSchemaName?: string, newSchemaName?: string): SourcePatchResult {
  const trimmedOldName = oldName.trim();
  const trimmedNewName = newName.trim();
  if (!trimmedOldName || !trimmedNewName) return { source, changed: false };
  const next = getDbmlCore().renameTable(
    tableNameInput(trimmedOldName, oldSchemaName || schemaPart(trimmedOldName) || undefined),
    parseTableNameInput(newSchemaName && newSchemaName !== oldSchemaName ? `${newSchemaName}.${trimmedNewName}` : trimmedNewName, newSchemaName || oldSchemaName),
    source
  );
  return { source: next, changed: next !== source };
}

export function renameTableInSource(source: string, database: unknown, table: DbmlTableLike, newName: string): SourcePatchResult {
  const oldName = stringValue(table.name);
  const trimmed = newName.trim();
  if (!oldName || !trimmed || oldName === trimmed) return { source, changed: false };
  const db = asDatabase(database);
  const schemaName = stringValue(db.schemas?.[String(table.schemaId)]?.name) || undefined;
  try {
    const next = getDbmlCore().renameTable(tableNameInput(oldName, schemaName), parseTableNameInput(trimmed, schemaName), source);
    return { source: next, changed: next !== source };
  } catch (error) {
    console.warn("DBML: @dbml/core.renameTable failed; using conservative rename fallback", error);
  }
  const fallbackSchema = schemaName || "public";
  const declaration = findNamedBlockDeclaration(source, "Table", oldName, fallbackSchema);
  if (!declaration) return { source, changed: false };
  const formattedName = formatPossiblyQualifiedIdentifier(trimmed, fallbackSchema, declaration.identifier.includes("."));
  let next = source.slice(0, declaration.identifierStart) + formattedName + source.slice(declaration.identifierEnd);
  next = replaceTableReferences(next, oldName, fallbackSchema, trimmed, declaration.identifier, formattedName);
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

export function setRefColorInSource(source: string, database: unknown, ref: DbmlRefLike, color: string): SourcePatchResult {
  if (!isColor(color)) return { source, changed: false };
  const match = findRefLine(source, database, ref);
  if (!match) return { source, changed: false };
  const nextLine = /\[[^\]]*\]\s*$/.test(match.line)
    ? match.line.replace(/\[([^\]]*)\]\s*$/, (_m, settings: string) => `[${replaceOrAppendSetting(settings, "color", color.toUpperCase())}]`)
    : `${match.line} [color: ${color.toUpperCase()}]`;
  const next = source.slice(0, match.start) + nextLine + source.slice(match.start + match.line.length);
  return { source: next, changed: next !== source };
}

export function createRefInSource(source: string, database: unknown, args: unknown[]): SourcePatchResult {
  const endpoints = extractRefEndpoints(database, args);
  if (!endpoints) return { source, changed: false };
  const left = formatEndpoint(endpoints[0]);
  const right = formatEndpoint(endpoints[1]);
  const next = `${source.trimEnd()}\n\nRef: ${left} > ${right}\n`;
  return { source: next, changed: next !== source };
}

export function createStickyNoteInSource(source: string, payload: unknown): SourcePatchResult {
  const note = stickyNotePayload(payload);
  const name = note.name || uniqueNoteName(source);
  const body = escapeTripleSingle(note.content ?? "");
  const next = `${source.trimEnd()}\n\nNote ${formatIdentifier(name)} {\n  '''\n  ${body.replace(/\n/g, "\n  ")}\n  '''\n}\n`;
  return { source: next, changed: next !== source };
}

export function updateStickyNoteInSource(source: string, payload: unknown): SourcePatchResult {
  const note = stickyNotePayload(payload);
  if (!note.name && !note.id) return { source, changed: false };
  const name = note.name || String(note.id);
  const span = findNoteBlock(source, name);
  if (!span) return createStickyNoteInSource(source, { ...note, name });
  const block = source.slice(span.start, span.end);
  const content = escapeTripleSingle(note.content ?? note.note ?? "");
  const nextBlock = /'''[\s\S]*?'''/.test(block)
    ? block.replace(/'''[\s\S]*?'''/, `'''\n${content}\n'''`)
    : block.replace(/\{/, `{\n  '''\n${content}\n  '''`);
  const next = source.slice(0, span.start) + nextBlock + source.slice(span.end);
  return { source: next, changed: next !== source };
}

export function removeStickyNoteFromSource(source: string, payload: unknown): SourcePatchResult {
  const note = stickyNotePayload(payload);
  const name = note.name || (note.id !== undefined ? String(note.id) : "");
  if (!name) return { source, changed: false };
  const span = findNoteBlock(source, name);
  if (!span) return { source, changed: false };
  const next = source.slice(0, span.start).trimEnd() + "\n\n" + source.slice(span.end).trimStart();
  return { source: next, changed: next !== source };
}

export function updateElementNoteInSource(source: string, database: unknown, payload: unknown): SourcePatchResult {
  const record = asRecord(payload);
  const type = stringValue(record.type);
  const id = record.id;
  const note = stringValue(record.note);
  if (!type || id === undefined) return { source, changed: false };
  if (type === "table") {
    const table = findTableByRendererId(database, id);
    if (!table) return { source, changed: false };
    const db = asDatabase(database);
    const schemaName = stringValue(db.schemas?.[String(table.schemaId)]?.name) || "public";
    const declaration = findNamedBlockDeclaration(source, "Table", stringValue(table.name), schemaName);
    return declaration ? setBlockNote(source, declaration, note) : { source, changed: false };
  }
  if (type === "table-group") {
    const group = findTableGroupByRendererId(database, id);
    if (!group) return { source, changed: false };
    const declaration = findNamedBlockDeclaration(source, "TableGroup", stringValue(group.name), "public");
    return declaration ? setBlockNote(source, declaration, note) : { source, changed: false };
  }
  if (type === "table-field") {
    const field = findFieldByRendererId(database, id);
    return field ? setFieldNote(source, database, field, note) : { source, changed: false };
  }
  return { source, changed: false };
}

export function updateRecordsInSource(source: string, database: unknown, payload: unknown): SourcePatchResult {
  const record = asRecord(payload);
  const table = findTableByRendererId(database, record.tableId || record.id || record.table);
  if (!table) return { source, changed: false };
  const db = asDatabase(database);
  const schemaName = stringValue(db.schemas?.[String(table.schemaId)]?.name) || "public";
  const tableName = stringValue(table.name);
  if (!tableName) return { source, changed: false };
  const columns = collectColumnNames(record.columns);
  const rows = Array.isArray(record.values) ? record.values : Array.isArray(record.rows) ? record.rows : [];
  if (columns.length === 0) return { source, changed: false };
  const block = renderTableDataBlock(schemaName, tableName, columns, rows);
  const span = findTableDataBlock(source, tableName, schemaName);
  const next = span ? source.slice(0, span.start) + block + source.slice(span.end) : `${source.trimEnd()}\n\n${block}\n`;
  return { source: next, changed: next !== source };
}

export function sourceMatchesRef(markdown: string, ref: DbmlSourceRef, expectedSource: string): boolean {
  if (ref.kind === "file") return markdown === expectedSource;
  if (ref.blockStartLine === undefined || ref.blockEndLine === undefined) return false;
  const lines = markdown.split(/\r?\n/);
  if (ref.blockStartLine < 0 || ref.blockEndLine > lines.length || ref.blockStartLine >= ref.blockEndLine) return false;
  return lines.slice(ref.blockStartLine + 1, ref.blockEndLine).join("\n") === expectedSource;
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

function findNamedBlockDeclaration(source: string, keyword: "Table" | "TableGroup" | "Note", name: string, schemaName: string): DeclarationMatch | null {
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

function setBlockNote(source: string, declaration: DeclarationMatch, note: string): SourcePatchResult {
  const closeBrace = findMatchingBrace(source, declaration.openBrace);
  if (closeBrace === -1) return { source, changed: false };
  const body = source.slice(declaration.openBrace + 1, closeBrace);
  const notePattern = /(^|\n)(\s*Note\s*:\s*)('''[\s\S]*?'''|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")/i;
  const rendered = renderNoteValue(note);
  if (notePattern.test(body)) {
    const nextBody = body.replace(notePattern, (_match, prefix: string, label: string) => `${prefix}${label}${rendered}`);
    const next = source.slice(0, declaration.openBrace + 1) + nextBody + source.slice(closeBrace);
    return { source: next, changed: next !== source };
  }
  const indent = indentationAfterOpenBrace(source, declaration.openBrace);
  const next = source.slice(0, declaration.openBrace + 1) + `\n${indent}Note: ${rendered}\n` + source.slice(declaration.openBrace + 1);
  return { source: next, changed: next !== source };
}

function setFieldNote(source: string, database: unknown, field: DbmlFieldLike, note: string): SourcePatchResult {
  const db = asDatabase(database);
  const table = findRecordById(db.tables, String(field.tableId));
  if (!table) return { source, changed: false };
  const schemaName = stringValue(db.schemas?.[String(table.schemaId)]?.name) || "public";
  const declaration = findNamedBlockDeclaration(source, "Table", stringValue(table.name), schemaName);
  if (!declaration) return { source, changed: false };
  const closeBrace = findMatchingBrace(source, declaration.openBrace);
  if (closeBrace === -1) return { source, changed: false };
  const fieldName = stringValue(field.name);
  const line = findFieldLine(source, declaration.openBrace + 1, closeBrace, fieldName);
  if (!line) return { source, changed: false };
  const nextLine = setLineSetting(line.text, "note", renderNoteValue(note));
  const next = source.slice(0, line.start) + nextLine + source.slice(line.end);
  return { source: next, changed: next !== source };
}

function findFieldLine(source: string, start: number, end: number, fieldName: string): { start: number; end: number; text: string } | null {
  let lineStart = start;
  let depth = 0;
  while (lineStart < end) {
    const newline = source.indexOf("\n", lineStart);
    const lineEnd = Math.min(end, newline === -1 ? end : newline);
    const text = source.slice(lineStart, lineEnd);
    const trimmed = text.trimStart();
    if (depth === 0 && !trimmed.startsWith("//") && normalizeName(firstToken(trimmed)) === normalizeName(fieldName)) return { start: lineStart, end: lineEnd, text };
    depth += braceDeltaOutsideQuotes(text);
    lineStart = lineEnd + 1;
  }
  return null;
}

function braceDeltaOutsideQuotes(value: string): number {
  let depth = 0;
  let quote: string | null = null;
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
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
  }
  return depth;
}

function setLineSetting(line: string, settingName: string, renderedValue: string): string {
  if (/\[[^\]]*\]/.test(line)) {
    return line.replace(/\[([^\]]*)\]/, (_match, settings: string) => `[${replaceOrAppendSetting(settings, settingName, renderedValue)}]`);
  }
  return `${line} [${settingName}: ${renderedValue}]`;
}

function renderNoteValue(note: string): string {
  if (note.includes("\n") || note.length > 80) return `'''\n${escapeTripleSingle(note)}\n'''`;
  return `'${escapeSingle(note)}'`;
}

function indentationAfterOpenBrace(source: string, openBrace: number): string {
  const lineStart = source.lastIndexOf("\n", openBrace) + 1;
  const headerIndent = /^\s*/.exec(source.slice(lineStart, openBrace))?.[0] || "";
  return `${headerIndent}  `;
}

function firstToken(value: string): string {
  const parsed = readIdentifier(value, 0);
  return parsed?.value || "";
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function tableNameInput(name: string, schema?: string): TableNameInput {
  return schema && schema !== "public" ? { schema, table: name } : name;
}

function parseTableNameInput(value: string, fallbackSchema?: string): TableNameInput {
  const schema = schemaPart(value) || fallbackSchema;
  const table = lastQualifiedPart(value);
  return schema && schema !== "public" ? { schema, table } : table;
}

function extractRefEndpoints(database: unknown, args: unknown[]): [{ tableName: string; schemaName?: string; fieldNames: string[] }, { tableName: string; schemaName?: string; fieldNames: string[] }] | null {
  const ids = collectPossibleIds(args).filter(Boolean);
  const fields = ids.map((id) => findFieldByRendererId(database, id)).filter((field): field is DbmlFieldLike => !!field);
  if (fields.length >= 2) {
    const left = endpointForField(database, fields[0]);
    const right = endpointForField(database, fields[1]);
    return left && right ? [left, right] : null;
  }
  return null;
}

function collectPossibleIds(values: unknown[]): unknown[] {
  const ids: unknown[] = [];
  for (const value of values) {
    if (typeof value === "string" || typeof value === "number") ids.push(value);
    const record = asRecord(value);
    for (const key of ["fieldId", "sourceFieldId", "targetFieldId", "fromFieldId", "toFieldId", "id"]) {
      if (record[key] !== undefined) ids.push(record[key]);
    }
    for (const key of ["source", "target", "from", "to", "start", "end"]) {
      const nested = asRecord(record[key]);
      for (const nestedKey of ["fieldId", "id"]) if (nested[nestedKey] !== undefined) ids.push(nested[nestedKey]);
    }
  }
  return ids;
}

function findFieldByRendererId(database: unknown, id: unknown): DbmlFieldLike | null {
  const db = asDatabase(database);
  const normalizedId = normalizeRendererId(id);
  if (normalizedId === null) return null;
  return findRecordById(db.fields, normalizedId) || null;
}

function endpointForField(database: unknown, field: DbmlFieldLike): { tableName: string; schemaName?: string; fieldNames: string[] } | null {
  const db = asDatabase(database);
  const table = findRecordById(db.tables, String(field.tableId));
  const fieldName = stringValue(field.name);
  const tableName = stringValue(table?.name);
  if (!fieldName || !tableName) return null;
  const schemaName = stringValue(db.schemas?.[String(table?.schemaId)]?.name) || undefined;
  return { tableName, schemaName, fieldNames: [fieldName] };
}

function formatEndpoint(endpoint: { tableName: string; schemaName?: string; fieldNames: string[] }): string {
  const table = endpoint.schemaName && endpoint.schemaName !== "public" ? `${formatIdentifier(endpoint.schemaName)}.${formatIdentifier(endpoint.tableName)}` : formatIdentifier(endpoint.tableName);
  const field = endpoint.fieldNames.length > 1 ? `(${endpoint.fieldNames.map(formatIdentifier).join(", ")})` : formatIdentifier(endpoint.fieldNames[0]);
  return `${table}.${field}`;
}

function findRefLine(source: string, database: unknown, ref: DbmlRefLike): { start: number; line: string } | null {
  const refName = stringValue(ref.name);
  if (refName) {
    const named = new RegExp(`(^|\\n)(\\s*Ref\\s+${escapeRegExp(refName)}\\s*:[^\\n]*)`, "i").exec(source);
    if (named) return { start: named.index + named[1].length, line: named[2] };
  }
  const endpointTexts = endpointTextsForRef(database, ref);
  if (endpointTexts.length >= 2) {
    const linePattern = /(^|\n)(\s*Ref(?:\s+[^:\n]+)?\s*:[^\n]*)/gi;
    let match: RegExpExecArray | null;
    while ((match = linePattern.exec(source)) !== null) {
      const line = match[2];
      if (endpointTexts.every((alternatives) => alternatives.some((endpoint) => lineIncludesEndpoint(line, endpoint)))) {
        return { start: match.index + match[1].length, line };
      }
    }
  }
  return null;
}

function endpointTextsForRef(database: unknown, ref: DbmlRefLike): string[][] {
  const db = asDatabase(database);
  return arrayValue(ref.endpointIds).map((id: unknown) => db.endpoints?.[String(id)]).filter((endpoint: DbmlEndpointLike | undefined): endpoint is DbmlEndpointLike => !!endpoint).map((endpoint: DbmlEndpointLike) => {
    const schemaName = stringValue(endpoint.schemaName) || "public";
    const tableName = stringValue(endpoint.tableName);
    const fields = Array.isArray(endpoint.fieldNames) ? endpoint.fieldNames : [];
    if (!tableName || fields.length === 0) return [];
    const field = fields.length > 1 ? `(${fields.map(formatIdentifier).join(", ")})` : formatIdentifier(fields[0]);
    const unqualified = `${formatIdentifier(tableName)}.${field}`;
    const qualified = `${formatIdentifier(schemaName)}.${unqualified}`;
    return schemaName === "public" ? [unqualified, qualified] : [qualified, unqualified];
  }).filter((alternatives: string[]) => alternatives.length > 0);
}

function lineIncludesEndpoint(line: string, endpoint: string): boolean {
  return normalizeEndpointLine(line).includes(normalizeEndpointLine(endpoint));
}

function normalizeEndpointLine(value: string): string {
  return value.replace(/[`"']/g, "").replace(/\s+/g, "").toLowerCase();
}

function replaceOrAppendSetting(settings: string, name: string, value: string): string {
  const parts = splitSettings(settings);
  const index = parts.findIndex((part) => new RegExp(`^\\s*${escapeRegExp(name)}\\s*:`, "i").test(part));
  if (index >= 0) parts[index] = ` ${name}: ${value}`;
  else parts.push(`${parts.length > 0 ? " " : ""}${name}: ${value}`);
  return parts.map((part) => part.trim()).filter(Boolean).join(", ");
}

function splitSettings(settings: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < settings.length; index += 1) {
    const char = settings[index];
    const previous = settings[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === ",") {
      parts.push(settings.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(settings.slice(start));
  return parts;
}

function stickyNotePayload(payload: unknown): { id?: string | number; name?: string; content?: string; note?: string; color?: string } {
  if (typeof payload === "string" || typeof payload === "number") return { name: String(payload) };
  const record = asRecord(payload);
  return {
    id: record.id as string | number | undefined,
    name: stringValue(record.name || record.title || record.noteName),
    content: stringValue(record.content ?? record.text ?? record.value ?? record.note),
    note: stringValue(record.note),
    color: stringValue(record.color || record.headerColor || record.headercolor)
  };
}

function uniqueNoteName(source: string): string {
  for (let index = 1; index < 1000; index += 1) {
    const name = `note_${index}`;
    if (!new RegExp(`\\bNote\\s+${name}\\b`, "i").test(source)) return name;
  }
  return `note_${Date.now()}`;
}

function findNoteBlock(source: string, name: string): { start: number; end: number } | null {
  const declaration = findNamedBlockDeclaration(source, "Note", name, "public");
  if (!declaration) return null;
  const end = findMatchingBrace(source, declaration.openBrace);
  return end === -1 ? null : { start: declaration.start, end: end + 1 };
}

function findTableDataBlock(source: string, tableName: string, schemaName: string): { start: number; end: number } | null {
  const pattern = /\b(?:TableData|Records)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const parsed = readIdentifier(source, match.index + match[0].length);
    if (!parsed) continue;
    const recordsName = parsed.value.replace(/\(.*$/, "");
    const name = lastQualifiedPart(recordsName);
    const schema = schemaPart(recordsName) || "public";
    if (normalizeName(name) !== normalizeName(tableName) || (schemaName !== "public" && normalizeName(schema) !== normalizeName(schemaName))) continue;
    const openBrace = findHeaderOpenBrace(source, parsed.end);
    if (openBrace === -1) continue;
    const end = findMatchingBrace(source, openBrace);
    if (end !== -1) return { start: match.index, end: end + 1 };
  }
  return null;
}

function findMatchingBrace(source: string, openBrace: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openBrace; index < source.length; index += 1) {
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
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function collectColumnNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((column) => stringValue(column) || stringValue(asRecord(column).name || asRecord(column).columnName)).filter(Boolean);
}

function renderTableDataBlock(schemaName: string, tableName: string, columns: string[], rows: unknown[]): string {
  const qualified = schemaName && schemaName !== "public" ? `${formatIdentifier(schemaName)}.${formatIdentifier(tableName)}` : formatIdentifier(tableName);
  const lines = [`Records ${qualified}(${columns.map(formatIdentifier).join(", ")}) {`];
  for (const row of rows) {
    const values = Array.isArray(row) ? row : columns.map((column) => asRecord(row)[column]);
    lines.push(`  ${values.map((value) => getDbmlCore().formatRecordValue(value)).join(", ")}`);
  }
  lines.push("}");
  return lines.join("\n");
}

function escapeTripleSingle(value: string): string {
  return value.replace(/'''/g, "\\'\\'\\'");
}

function escapeSingle(value: string): string {
  return value.replace(/'/g, "\\'");
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
