import { getDbmlCore } from "./core";
import type { RendererFilterConfig } from "./types";

export interface DiagramViewDefinition {
  name: string;
  all: boolean;
  tableNames: string[] | null;
  tableGroupNames: string[] | null;
  schemaNames: string[] | null;
  stickyNoteNames: string[] | null;
}

export function parseDiagramViews(source: string): DiagramViewDefinition[] {
  try {
    const blocks = getDbmlCore().findDiagramViewBlocks(source);
    return blocks.map((block) => diagramViewFromCoreBlock(source, block)).filter((view): view is DiagramViewDefinition => !!view);
  } catch {
    // Fall back to the source scanner below only when the core scanner is unavailable or fails.
  }
  const views: DiagramViewDefinition[] = [];
  const pattern = /\bDiagramView\s+("(?:\\.|[^"])+"|'(?:\\.|[^'])+'|[A-Za-z_][\w.-]*)\s*\{/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const openBrace = source.indexOf("{", match.index);
    const closeBrace = findMatchingBrace(source, openBrace);
    if (closeBrace === -1) continue;
    const body = source.slice(openBrace + 1, closeBrace);
    views.push(parseDiagramViewBody(unquote(match[1]), body));
    pattern.lastIndex = closeBrace + 1;
  }
  return views;
}

export function addDiagramViewInSource(source: string, name: string, filterConfig?: RendererFilterConfig): { source: string; changed: boolean } {
  const viewName = sanitizeViewName(name);
  if (!viewName) return { source, changed: false };
  if (!filterHasNullEntities(filterConfig)) {
    try {
      const synced = getDbmlCore().syncDiagramView(source, [{ operation: "create", name: viewName, visibleEntities: visibleEntitiesFromFilter(filterConfig || allVisibleFilter()) }]);
      if (synced.newDbml && synced.newDbml !== source) return { source: synced.newDbml, changed: true };
    } catch {
      // Fallback to direct append below.
    }
  }
  const block = renderDiagramViewBlock(viewName, filterConfig);
  const next = `${source.trimEnd()}\n\n${block}\n`;
  return { source: next, changed: next !== source };
}

export function renameDiagramViewInSource(source: string, oldName: string, newName: string): { source: string; changed: boolean } {
  const safeNewName = sanitizeViewName(newName);
  if (!safeNewName) return { source, changed: false };
  try {
    const synced = getDbmlCore().syncDiagramView(source, [{ operation: "update", name: oldName, newName: safeNewName }], getDbmlCore().findDiagramViewBlocks(source));
    if (synced.newDbml && synced.newDbml !== source) return { source: synced.newDbml, changed: true };
  } catch {
    // Fallback to direct rename below.
  }
  const span = findDiagramViewSpan(source, oldName);
  if (!span) return { source, changed: false };
  const next = source.slice(0, span.nameStart) + formatViewName(safeNewName) + source.slice(span.nameEnd);
  return { source: next, changed: next !== source };
}

export function removeDiagramViewInSource(source: string, name: string): { source: string; changed: boolean } {
  try {
    const synced = getDbmlCore().syncDiagramView(source, [{ operation: "delete", name }], getDbmlCore().findDiagramViewBlocks(source));
    if (synced.newDbml !== undefined && synced.newDbml !== source) return { source: synced.newDbml, changed: true };
  } catch {
    // Fallback to direct removal below.
  }
  const span = findDiagramViewSpan(source, name);
  if (!span) return { source, changed: false };
  const next = source.slice(0, span.start).trimEnd() + "\n\n" + source.slice(span.end).trimStart();
  return { source: next, changed: next !== source };
}

export function resetDiagramViewInSource(source: string, name: string): { source: string; changed: boolean } {
  return updateDiagramViewFilterInSource(source, name, { tables: [], schemas: [], tableGroups: [], stickyNotes: [] });
}

export function updateDiagramViewFilterInSource(source: string, name: string, filterConfig: RendererFilterConfig): { source: string; changed: boolean } {
  const span = findDiagramViewSpan(source, name);
  if (!span) return addDiagramViewInSource(source, name, filterConfig);
  if (!filterHasNullEntities(filterConfig)) {
    try {
      const blocks = getDbmlCore().findDiagramViewBlocks(source);
      const synced = getDbmlCore().syncDiagramView(source, [{ operation: "update", name, visibleEntities: visibleEntitiesFromFilter(filterConfig) }], blocks);
      if (synced.newDbml && synced.newDbml !== source) return { source: synced.newDbml, changed: true };
    } catch {
      // Fallback to direct block replacement below.
    }
  }
  const block = renderDiagramViewBlock(name, filterConfig);
  const next = source.slice(0, span.start) + block + source.slice(span.end);
  return { source: next, changed: next !== source };
}

export function removeStickyNoteFromDiagramViews(source: string, noteName: string): { source: string; changed: boolean } {
  let next = source;
  let changed = false;
  for (const view of parseDiagramViews(source)) {
    if (!Array.isArray(view.stickyNoteNames)) continue;
    const stickyNoteNames = view.stickyNoteNames.filter((name) => normalizeName(name) !== normalizeName(noteName));
    if (stickyNoteNames.length === view.stickyNoteNames.length) continue;
    const filterConfig = filterConfigFromView({ ...view, stickyNoteNames: stickyNoteNames.length > 0 ? stickyNoteNames : null });
    const patch = updateDiagramViewFilterInSource(next, view.name, filterConfig);
    next = patch.source;
    changed = changed || patch.changed;
  }
  return { source: next, changed };
}

export function applyDiagramView(database: unknown, view: DiagramViewDefinition | null): unknown {
  if (!view || view.all) return database;
  const root = clonePlain(database) as Record<string, unknown>;
  const tables = asRecord(root.tables);
  const tableGroups = asRecord(root.tableGroups);
  const schemas = asRecord(root.schemas);
  const allowedTableIds = new Set<string>();
  const tableGroupNames = setOrNull(view.tableGroupNames);
  const tableNames = setOrNull(view.tableNames);
  const schemaNames = setOrNull(view.schemaNames);
  const stickyNoteNames = setOrNull(view.stickyNoteNames);
  const allTablesVisible = tableNames !== null && tableNames.size === 0 && schemaNames !== null && schemaNames.size === 0 && tableGroupNames !== null && tableGroupNames.size === 0;

  if (allTablesVisible) {
    for (const table of Object.values(tables).map(asRecord)) allowedTableIds.add(String(table.id));
  } else {
    for (const group of Object.values(tableGroups).map(asRecord)) {
      if (tableGroupNames && tableGroupNames.size > 0 && tableGroupNames.has(normalizeName(stringValue(group.name)))) {
        for (const tableId of arrayValue(group.tableIds)) allowedTableIds.add(String(tableId));
      }
    }

    for (const table of Object.values(tables).map(asRecord)) {
      const schemaName = stringValue(asRecord(schemas[String(table.schemaId)]).name);
      const name = stringValue(table.name);
      const candidates = [name, schemaName && name ? `${schemaName}.${name}` : ""].map(normalizeName);
      if ((tableNames && candidates.some((candidate) => tableNames.has(candidate))) || (schemaNames && schemaNames.has(normalizeName(schemaName)))) allowedTableIds.add(String(table.id));
    }
  }

  root.notes = stickyNoteNames === null ? {} : stickyNoteNames.size === 0 ? asRecord(root.notes) : filterObject(asRecord(root.notes), (note) => {
    const record = asRecord(note);
    const name = stringValue(record.name);
    return stickyNoteNames.has(normalizeName(name));
  });

  root.tables = filterObject(tables, (table) => allowedTableIds.has(String(asRecord(table).id)));
  root.fields = filterObject(asRecord(root.fields), (field) => allowedTableIds.has(String(asRecord(field).tableId)));
  root.indexes = filterObject(asRecord(root.indexes), (index) => allowedTableIds.has(String(asRecord(index).tableId)) || allowedTableIds.has(String(asRecord(index).table_id)));
  root.checks = filterObject(asRecord(root.checks), (check) => {
    const tableId = asRecord(check).tableId;
    return tableId === undefined || allowedTableIds.has(String(tableId));
  });
  root.records = filterObject(asRecord(root.records), (record) => {
    const tableId = asRecord(record).tableId;
    return tableId === undefined || allowedTableIds.has(String(tableId));
  });

  const endpoints = asRecord(root.endpoints);
  const allowedEndpointIds = new Set<string>();
  root.endpoints = filterObject(endpoints, (endpoint) => {
    const record = asRecord(endpoint);
    const tableName = stringValue(record.tableName);
    const schemaName = stringValue(record.schemaName);
    const matched = Object.values(root.tables as Record<string, unknown>).map(asRecord).some((table) => {
      const schema = stringValue(asRecord(schemas[String(table.schemaId)]).name);
      return normalizeName(stringValue(table.name)) === normalizeName(tableName) && (!schemaName || normalizeName(schema) === normalizeName(schemaName));
    });
    if (matched) allowedEndpointIds.add(String(record.id));
    return matched;
  });

  root.refs = filterObject(asRecord(root.refs), (ref) => arrayValue(asRecord(ref).endpointIds).every((id) => allowedEndpointIds.has(String(id))));
  const allowedRefIds = new Set(Object.values(asRecord(root.refs)).map((ref) => String(asRecord(ref).id)));

  root.tableGroups = tableGroupNames === null ? {} : filterObject(tableGroups, (group) => {
    const record = asRecord(group);
    const originalTableIds = arrayValue(record.tableIds);
    const explicitGroup = tableGroupNames.size > 0 && tableGroupNames.has(normalizeName(stringValue(record.name)));
    record.tableIds = originalTableIds.filter((id) => allowedTableIds.has(String(id)));
    const allGroupTablesVisible = originalTableIds.length > 0 && originalTableIds.every((id) => allowedTableIds.has(String(id)));
    return explicitGroup || (tableGroupNames.size === 0 && allGroupTablesVisible);
  });

  root.schemas = schemaNames === null ? {} : filterObject(schemas, (schema) => {
    const record = asRecord(schema);
    const originalTableIds = arrayValue(record.tableIds);
    const explicitSchema = schemaNames.size > 0 && schemaNames.has(normalizeName(stringValue(record.name)));
    record.tableIds = originalTableIds.filter((id) => allowedTableIds.has(String(id)));
    record.refIds = arrayValue(record.refIds).filter((id) => allowedRefIds.has(String(id)));
    record.tableGroupIds = arrayValue(record.tableGroupIds).filter((id) => Boolean((root.tableGroups as Record<string, unknown>)[String(id)]));
    const allSchemaTablesVisible = originalTableIds.length > 0 && originalTableIds.every((id) => allowedTableIds.has(String(id)));
    return explicitSchema || (schemaNames.size === 0 && allSchemaTablesVisible);
  });

  return root;
}

function renderDiagramViewBlock(name: string, filterConfig?: RendererFilterConfig): string {
  const tables = namesFromFilter(filterConfig?.tables, true);
  const tableGroups = namesFromFilter(filterConfig?.tableGroups);
  const schemas = namesFromFilter(filterConfig?.schemas);
  const stickyNotes = namesFromFilter(filterConfig?.stickyNotes);
  if (isAllVisibleFilter({ tables, tableGroups, schemas, stickyNotes })) return `DiagramView ${formatViewName(name)} {\n  *\n}`;
  const lines = [`DiagramView ${formatViewName(name)} {`];
  appendFilterBlock(lines, "Tables", tables);
  appendFilterBlock(lines, "TableGroups", tableGroups);
  appendFilterBlock(lines, "Schemas", schemas);
  appendFilterBlock(lines, "Notes", stickyNotes);
  lines.push("}");
  return lines.join("\n");
}

function appendFilterBlock(lines: string[], blockName: string, names: string[] | null): void {
  if (names === undefined) return;
  lines.push(`  ${blockName} {`);
  if (Array.isArray(names) && names.length === 0) lines.push("    *");
  else for (const name of names || []) lines.push(`    ${formatViewName(name)}`);
  lines.push("  }");
}

function namesFromFilter(values: unknown[] | null | undefined, qualifyTables = false): string[] | null {
  if (values === null) return null;
  if (!Array.isArray(values)) return [];
  return unique(values.map((value) => {
    const record = asRecord(value);
    const name = stringValue(value) || stringValue(record.name || record.id);
    const schemaName = stringValue(record.schemaName);
    return qualifyTables && schemaName && name ? `${schemaName}.${name}` : name;
  }).filter(Boolean));
}

function findDiagramViewSpan(source: string, name: string): { start: number; end: number; nameStart: number; nameEnd: number } | null {
  const pattern = /\bDiagramView\s+("(?:\\.|[^"])+"|'(?:\\.|[^'])+'|[A-Za-z_][\w.-]*)\s*\{/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (normalizeName(unquote(match[1])) !== normalizeName(name)) continue;
    const openBrace = source.indexOf("{", match.index);
    const closeBrace = findMatchingBrace(source, openBrace);
    if (closeBrace === -1) return null;
    const nameStart = match.index + match[0].indexOf(match[1]);
    return { start: match.index, end: closeBrace + 1, nameStart, nameEnd: nameStart + match[1].length };
  }
  return null;
}

function sanitizeViewName(name: string): string {
  return name.trim();
}

function formatViewName(value: string): string {
  return /^[A-Za-z_][\w.-]*$/.test(value) ? value : `"${value.replace(/"/g, "\\\"")}"`;
}

function diagramViewFromCoreBlock(source: string, block: unknown): DiagramViewDefinition | null {
  const record = asRecord(block);
  const name = stringValue(record.name);
  const start = Number(record.startIndex);
  const end = Number(record.endIndex);
  if (!name || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  const blockSource = source.slice(start, end);
  const open = blockSource.indexOf("{");
  const close = blockSource.lastIndexOf("}");
  if (open === -1 || close === -1 || close <= open) return null;
  return parseDiagramViewBody(name, blockSource.slice(open + 1, close));
}

function parseDiagramViewBody(name: string, body: string): DiagramViewDefinition {
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const tableGroupsBody = extractNamedBlock(withoutComments, "TableGroups");
  const tablesBody = extractNamedBlock(withoutComments, "Tables");
  const schemasBody = extractNamedBlock(withoutComments, "Schemas");
  const notesBody = extractNamedBlock(withoutComments, "Notes");
  let tableGroupNames = namesForBlock(tableGroupsBody);
  let tableNames = namesForBlock(tablesBody);
  let schemaNames = namesForBlock(schemasBody);
  const stickyNoteNames = namesForBlock(notesBody);
  const remaining = withoutComments
    .replace(/\bTableGroups\s*\{[\s\S]*?\}/gi, "")
    .replace(/\bTables\s*\{[\s\S]*?\}/gi, "")
    .replace(/\bSchemas\s*\{[\s\S]*?\}/gi, "")
    .replace(/\bNotes\s*\{[\s\S]*?\}/gi, "");
  const remainingNames = parseNames(remaining).filter((item) => item !== "*");
  if (remainingNames.length > 0) tableNames = [...(tableNames || []), ...remainingNames];
  const all = /(^|\s)\*(\s|$)/.test(remaining) && !tableGroupsBody && !tablesBody && !schemasBody && !notesBody;
  if (all) {
    return { name, all, tableNames: [], tableGroupNames: [], schemaNames: [], stickyNoteNames: [] };
  }
  if (tablesBody !== null || tableGroupsBody !== null || schemasBody !== null || remainingNames.length > 0) {
    const hasVisibleRelationalFilter = tableNames !== null || tableGroupNames !== null || schemaNames !== null;
    if (hasVisibleRelationalFilter) {
      if (tablesBody === null && remainingNames.length === 0) tableNames = [];
      if (tableGroupsBody === null) tableGroupNames = [];
      if (schemasBody === null) schemaNames = [];
    }
  }
  return {
    name,
    all: false,
    tableNames: uniqueOrNull(tableNames),
    tableGroupNames: uniqueOrNull(tableGroupNames),
    schemaNames: uniqueOrNull(schemaNames),
    stickyNoteNames: uniqueOrNull(stickyNoteNames)
  };
}

function namesForBlock(body: string | null): string[] | null {
  if (body === null) return null;
  const parsed = parseNames(body);
  if (parsed.includes("*")) return [];
  const names = parsed.filter((item) => item !== "*");
  return names.length === 0 ? null : names;
}

function allVisibleFilter(): RendererFilterConfig {
  return { tables: [], schemas: [], tableGroups: [], stickyNotes: [] };
}

function filterConfigFromView(view: DiagramViewDefinition): RendererFilterConfig {
  return {
    tables: view.tableNames,
    schemas: view.schemaNames,
    tableGroups: view.tableGroupNames,
    stickyNotes: view.stickyNoteNames
  };
}

function visibleEntitiesFromFilter(filterConfig: RendererFilterConfig): Record<string, unknown> {
  return {
    tables: tableEntitiesFromFilter(filterConfig.tables),
    schemas: namedEntitiesFromFilter(filterConfig.schemas),
    tableGroups: namedEntitiesFromFilter(filterConfig.tableGroups),
    stickyNotes: namedEntitiesFromFilter(filterConfig.stickyNotes)
  };
}

function tableEntitiesFromFilter(values: unknown[] | null): Array<{ name: string; schemaName: string }> | null {
  if (values === null) return null;
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    const record = asRecord(value);
    const rawName = stringValue(value) || stringValue(record.name || record.id);
    const schemaName = stringValue(record.schemaName) || schemaPart(rawName) || "public";
    const name = lastQualifiedPart(rawName);
    return name ? { name, schemaName } : null;
  }).filter((item): item is { name: string; schemaName: string } => !!item);
}

function namedEntitiesFromFilter(values: unknown[] | null): Array<{ name: string }> | null {
  if (values === null) return null;
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    const record = asRecord(value);
    const name = stringValue(value) || stringValue(record.name || record.id);
    return name ? { name } : null;
  }).filter((item): item is { name: string } => !!item);
}

function isAllVisibleFilter(filter: { tables: string[] | null; tableGroups: string[] | null; schemas: string[] | null; stickyNotes: string[] | null }): boolean {
  return [filter.tables, filter.tableGroups, filter.schemas, filter.stickyNotes].every((values) => Array.isArray(values) && values.length === 0);
}

function filterHasNullEntities(filterConfig?: RendererFilterConfig): boolean {
  return !!filterConfig && (filterConfig.tables === null || filterConfig.schemas === null || filterConfig.tableGroups === null || filterConfig.stickyNotes === null);
}

function setOrNull(values: string[] | null): Set<string> | null {
  return values === null ? null : new Set(values.map(normalizeName));
}

function uniqueOrNull(values: string[] | null): string[] | null {
  return values === null ? null : unique(values);
}

function schemaPart(value: string): string | null {
  const parts = splitQualifiedName(value);
  return parts.length > 1 ? parts.slice(0, -1).join(".") : null;
}

function lastQualifiedPart(value: string): string {
  const parts = splitQualifiedName(value);
  return parts[parts.length - 1] || value;
}

function splitQualifiedName(value: string): string[] {
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
      parts.push(unquote(value.slice(start, index).trim()));
      start = index + 1;
    }
  }
  parts.push(unquote(value.slice(start).trim()));
  return parts.filter(Boolean);
}

function extractNamedBlock(source: string, blockName: string): string | null {
  const match = new RegExp(`\\b${blockName}\\s*\\{`, "i").exec(source);
  if (!match) return null;
  const open = source.indexOf("{", match.index);
  const close = findMatchingBrace(source, open);
  return close === -1 ? null : source.slice(open + 1, close);
}

function parseNames(source: string): string[] {
  const names: string[] = [];
  const pattern = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([A-Za-z_][\w.:-]*)|\*/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const value = match[1] ?? match[2] ?? match[3] ?? "*";
    if (!["TableGroups", "Tables", "Schemas", "Notes"].includes(value)) names.push(unescapeName(value));
  }
  return names;
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
    if (char === '"' || char === "'") {
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

function clonePlain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function filterObject(record: Record<string, unknown>, predicate: (value: unknown) => boolean): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => predicate(value)));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return unescapeName(value.slice(1, -1));
  return value;
}

function unescapeName(value: string): string {
  return value.replace(/\\(["'])/g, "$1");
}

function normalizeName(value: string): string {
  return value.trim().replace(/^"|"$/g, "").toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
