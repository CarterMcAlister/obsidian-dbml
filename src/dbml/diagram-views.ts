export interface DiagramViewDefinition {
  name: string;
  all: boolean;
  tableNames: string[];
  tableGroupNames: string[];
}

export function parseDiagramViews(source: string): DiagramViewDefinition[] {
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

export function applyDiagramView(database: unknown, view: DiagramViewDefinition | null): unknown {
  if (!view || view.all) return database;
  const root = clonePlain(database) as Record<string, unknown>;
  const tables = asRecord(root.tables);
  const tableGroups = asRecord(root.tableGroups);
  const schemas = asRecord(root.schemas);
  const allowedTableIds = new Set<string>();
  const tableGroupNames = new Set(view.tableGroupNames.map(normalizeName));
  const tableNames = new Set(view.tableNames.map(normalizeName));

  for (const group of Object.values(tableGroups).map(asRecord)) {
    if (tableGroupNames.has(normalizeName(stringValue(group.name)))) {
      for (const tableId of arrayValue(group.tableIds)) allowedTableIds.add(String(tableId));
    }
  }

  for (const table of Object.values(tables).map(asRecord)) {
    const schemaName = stringValue(asRecord(schemas[String(table.schemaId)]).name);
    const name = stringValue(table.name);
    const candidates = [name, schemaName && name ? `${schemaName}.${name}` : ""].map(normalizeName);
    if (candidates.some((candidate) => tableNames.has(candidate))) allowedTableIds.add(String(table.id));
  }

  if (allowedTableIds.size === 0) return root;

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

  root.tableGroups = filterObject(tableGroups, (group) => {
    const record = asRecord(group);
    record.tableIds = arrayValue(record.tableIds).filter((id) => allowedTableIds.has(String(id)));
    return (record.tableIds as unknown[]).length > 0;
  });

  root.schemas = filterObject(schemas, (schema) => {
    const record = asRecord(schema);
    record.tableIds = arrayValue(record.tableIds).filter((id) => allowedTableIds.has(String(id)));
    record.refIds = arrayValue(record.refIds).filter((id) => allowedRefIds.has(String(id)));
    record.tableGroupIds = arrayValue(record.tableGroupIds).filter((id) => Boolean((root.tableGroups as Record<string, unknown>)[String(id)]));
    return (record.tableIds as unknown[]).length > 0;
  });

  return root;
}

function parseDiagramViewBody(name: string, body: string): DiagramViewDefinition {
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const tableGroupsBody = extractNamedBlock(withoutComments, "TableGroups");
  const tablesBody = extractNamedBlock(withoutComments, "Tables");
  const tableGroupNames = tableGroupsBody ? parseNames(tableGroupsBody) : [];
  const tableNames = tablesBody ? parseNames(tablesBody) : [];
  const remaining = withoutComments
    .replace(/\bTableGroups\s*\{[\s\S]*?\}/gi, "")
    .replace(/\bTables\s*\{[\s\S]*?\}/gi, "");
  tableNames.push(...parseNames(remaining).filter((item) => item !== "*"));
  return { name, all: /(^|\s)\*(\s|$)/.test(withoutComments), tableNames: unique(tableNames), tableGroupNames: unique(tableGroupNames) };
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
    if (!["TableGroups", "Tables"].includes(value)) names.push(unescapeName(value));
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
