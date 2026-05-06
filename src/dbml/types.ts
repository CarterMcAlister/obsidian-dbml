import type { TFile } from "obsidian";

export interface FeatureToggles {
  darkMode: boolean;
  colorHeader: boolean;
  colorPicker: boolean;
  dragAndDrop: boolean;
  tableGroup: boolean;
  detailLevelsEnabled: boolean;
  stickyNote: boolean;
  tableSearch: boolean;
  diagramView: boolean;
  diagramViewRestricted: boolean;
  tableRename: boolean;
  dbmlEditEnabled: boolean;
}

export interface DiagramState {
  version: "1.0.0";
  darkMode: boolean;
  gridEnabling: boolean;
  detailLevel: string;
  tablePositions: TablePosition[];
  tableGroupCollapseStates: unknown[];
  stickyNoteLayouts: unknown[];
  referencePaths: ReferencePath[];
}

export interface TablePosition {
  id?: string | number;
  name?: string;
  x: number;
  y: number;
}

export interface ReferencePath {
  id?: string | number;
  points?: Array<{ x: number; y: number }>;
}

export type DbmlSourceKind = "file" | "markdown-codeblock";

export interface DbmlSourceRef {
  kind: DbmlSourceKind;
  filePath: string;
  blockStartLine?: number;
  blockEndLine?: number;
  sourceKey: string;
  displayName: string;
  layoutKey?: string;
}

export interface ResolvedDbmlSource {
  ref: DbmlSourceRef;
  source: string;
  file: TFile;
}

export interface DbmlDiagnostic {
  message: string;
  code?: string;
  location: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

export interface DbmlParseResult {
  database: unknown | null;
  errors: DbmlDiagnostic[];
}

export interface DiagramTableField {
  id: string;
  name: string;
  type: string;
  pk: boolean;
  unique: boolean;
  nullable: boolean | null;
}

export interface DiagramTable {
  id: string;
  name: string;
  schema?: string;
  fields: DiagramTableField[];
  note?: string;
}

export interface DiagramRefEndpoint {
  tableId?: string;
  tableName?: string;
  fieldNames: string[];
  relation?: string;
}

export interface DiagramRef {
  id: string;
  name?: string;
  endpoints: [DiagramRefEndpoint, DiagramRefEndpoint];
}

export interface DiagramModel {
  tables: DiagramTable[];
  refs: DiagramRef[];
  enums: Array<{ id: string; name: string; values: string[] }>;
}

export interface RendererUpdate {
  database: unknown | null;
  fullDatabase?: unknown | null;
  error?: string;
  views?: Record<string, string>;
  selectedViewId?: string | null;
  defaultViewName?: string;
  filterConfig?: unknown;
}
