import { ItemView, Notice, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type DbmlPlugin from "../main";
import { addDiagramViewInSource, applyDiagramView, DiagramViewDefinition, parseDiagramViews, removeDiagramViewInSource, removeStickyNoteFromDiagramViews, renameDiagramViewInSource, resetDiagramViewInSource, updateDiagramViewFilterInSource } from "../dbml/diagram-views";
import { normalizeDbmlSource } from "../dbml/export";
import { diagnosticsToMessage, parseDbml } from "../dbml/parser";
import { resolveActiveDbmlSource, resolveSourceRef } from "../dbml/source";
import { createRefInSource, createStickyNoteInSource, findRefByRendererId, findTableByRendererId, findTableGroupByRendererId, removeStickyNoteFromSource, renameTableByNameInSource, renameTableInSource, replaceSourceForRef, setRefColorInSource, setTableGroupColorInSource, setTableHeaderColorInSource, sourceMatchesRef, updateElementNoteInSource, updateRecordsInSource, updateStickyNoteInSource } from "../dbml/source-edits";
import type { DbmlSourceRef, DiagramState, RendererFilterConfig, ResolvedDbmlSource } from "../dbml/types";
import { RendererHost } from "./renderer-host";
import { confirmWithModal } from "../ui/confirm-modal";

export const VIEW_TYPE_DBML_PREVIEW = "dbml-preview";

export class DbmlPreviewView extends ItemView {
  private plugin: DbmlPlugin;
  private sourceRef: DbmlSourceRef | null = null;
  private source: ResolvedDbmlSource | null = null;
  private renderer: RendererHost | null = null;
  private state: DiagramState | null = null;
  private toolbarEl: HTMLElement | null = null;
  private hostEl: HTMLElement | null = null;
  private refreshTimer: number | null = null;
  private diagramViews: DiagramViewDefinition[] = [];
  private selectedDiagramViewName: string | null = null;
  private latestDatabase: unknown = null;
  private latestError: string | undefined;

  constructor(leaf: WorkspaceLeaf, plugin: DbmlPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_DBML_PREVIEW;
  }

  getDisplayText(): string {
    return "Diagram preview";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  getState(): Record<string, unknown> {
    return {
      sourceRef: this.sourceRef,
      selectedDiagramViewName: this.selectedDiagramViewName
    };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const record = asRecord(state);
    const sourceRef = dbmlSourceRefFromState(record.sourceRef) || dbmlSourceRefFromState(asRecord(record.state).sourceRef);
    if (sourceRef) this.sourceRef = sourceRef;
    this.selectedDiagramViewName = typeof record.selectedDiagramViewName === "string" ? record.selectedDiagramViewName : null;
    await super.setState(state, result);
    if (this.hostEl && this.sourceRef) await this.refresh();
  }

  async onOpen(): Promise<void> {
    this.restoreSourceRefFromLeafState();
    this.renderShell();
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof TFile && this.sourceRef?.filePath === file.path) this.scheduleRefresh();
    }));
    if (!this.sourceRef) await this.attachActiveSourceIfMissing();
    if (this.sourceRef) await this.refresh();
    await super.onOpen();
  }

  onClose(): Promise<void> {
    return this.closeView();
  }

  private async closeView(): Promise<void> {
    const stateRef = this.currentStateRef();
    if (this.state && stateRef) await this.plugin.stateStore.saveImmediate(stateRef, this.pruneStateForCurrentView(this.state));
    this.renderer?.destroy();
    if (this.refreshTimer) activeWindow.clearTimeout(this.refreshTimer);
  }

  async setSource(sourceRef: DbmlSourceRef): Promise<void> {
    this.sourceRef = sourceRef;
    await this.refresh();
  }

  matches(ref: DbmlSourceRef): boolean {
    return this.sourceRef?.sourceKey === ref.sourceKey;
  }

  applyTheme(): void {
    this.renderer?.setTheme(this.plugin.currentIsDark());
  }

  private renderShell(): void {
    this.contentEl.empty();
    this.contentEl.addClass("obsidian-dbml-preview");
    this.toolbarEl = this.contentEl.createDiv({ cls: "obsidian-dbml-toolbar" });
    this.hostEl = this.contentEl.createDiv({ cls: "obsidian-dbml-renderer-host" });
    this.renderToolbar();
  }

  private renderToolbar(): void {
    if (!this.toolbarEl) return;
    this.toolbarEl.empty();
    this.toolbarEl.createDiv({ cls: "obsidian-dbml-toolbar-label", text: this.sourceRef?.displayName || "No DBML source selected" });
  }

  private restoreSourceRefFromLeafState(): void {
    if (this.sourceRef) return;
    const sourceRef = dbmlSourceRefFromState(this.leaf.getViewState().state?.sourceRef) || this.plugin.consumePendingPreviewSourceRef();
    if (sourceRef) this.sourceRef = sourceRef;
  }

  private async attachActiveSourceIfMissing(): Promise<void> {
    if (this.sourceRef) return;
    const source = await resolveActiveDbmlSource(this.app);
    if (!source) return;
    this.sourceRef = source.ref;
  }

  private currentStateRef(): DbmlSourceRef | null {
    if (!this.sourceRef) return null;
    if (!this.selectedDiagramViewName) return this.sourceRef;
    return {
      ...this.sourceRef,
      layoutKey: `view:${this.selectedDiagramViewName}`,
      displayName: `${this.sourceRef.displayName} (${this.selectedDiagramViewName})`
    };
  }

  private async switchDiagramView(viewName: string | null): Promise<void> {
    const previousStateRef = this.currentStateRef();
    if (this.state && previousStateRef) await this.plugin.stateStore.saveImmediate(previousStateRef, this.pruneStateForCurrentView(this.state));
    this.selectedDiagramViewName = viewName && this.diagramViews.some((view) => view.name === viewName) ? viewName : null;
    const nextStateRef = this.currentStateRef();
    this.state = nextStateRef ? this.pruneStateForCurrentView(await this.plugin.stateStore.load(nextStateRef)) : null;
    if (this.state) this.renderer?.loadState(this.state);
    this.sendCurrentDatabaseToRenderer();
    this.renderToolbar();
  }

  private sendCurrentDatabaseToRenderer(): void {
    const selectedView = this.diagramViews.find((view) => view.name === this.selectedDiagramViewName) || null;
    const database = applyDiagramView(this.latestDatabase, selectedView);
    this.renderer?.update({
      database,
      fullDatabase: this.latestDatabase,
      error: this.latestError,
      views: Object.fromEntries(this.diagramViews.map((view) => [view.name, view.name])),
      selectedViewId: this.selectedDiagramViewName,
      defaultViewName: "All",
      filterConfig: selectedView ? viewToFilterConfig(selectedView, this.latestDatabase) : { tables: [], schemas: [], tableGroups: [], stickyNotes: [] },
      isFilterConfigDirty: false
    });
  }

  private pruneStateForCurrentView(state: DiagramState): DiagramState {
    const selectedView = this.diagramViews.find((view) => view.name === this.selectedDiagramViewName) || null;
    return pruneDiagramStateForDatabase(state, applyDiagramView(this.latestDatabase, selectedView));
  }

  private async handleTableRenamed(args: unknown[]): Promise<void> {
    const newName = typeof args[1] === "string" ? args[1] : "";
    if (!newName.trim()) return;
    const changed = await this.applySourcePatch("rename table", (source, database) => {
      if (typeof args[0] === "string" && typeof args[2] === "string") {
        return renameTableByNameInSource(source, args[0], newName, args[2], typeof args[3] === "string" ? args[3] : args[2]);
      }
      const table = findTableByRendererId(database, args[0]);
      return table ? renameTableInSource(source, database, table, newName) : { source, changed: false };
    });
    if (changed) this.reparseDiagramViewsFromCurrentSource();
  }

  private async handleColorPicked(args: unknown[]): Promise<void> {
    const [type, id, color] = args;
    if (typeof type !== "string" || typeof color !== "string") return;
    await this.applySourcePatch("set color", (source, database) => {
      if (type === "table") return setTableHeaderColorInSource(source, database, findTableByRendererId(database, id) || {}, color);
      if (type === "table-group") return setTableGroupColorInSource(source, findTableGroupByRendererId(database, id) || {}, color);
      if (type === "ref") return setRefColorInSource(source, database, findRefByRendererId(database, id) || {}, color);
      return { source, changed: false };
    });
  }

  private async handleRefCreated(args: unknown[]): Promise<void> {
    await this.applySourcePatch("create ref", (source, database) => createRefInSource(source, database, args));
  }

  private async handleNoteUpdated(payload: unknown): Promise<void> {
    await this.applySourcePatch("update note", (source, database) => updateElementNoteInSource(source, database, payload));
  }

  private async handleStickyNoteCreated(payload: unknown): Promise<void> {
    await this.persistStickyNoteLayoutFromPayload(payload);
    const noteName = stickyNoteNameFromPayload(payload);
    const changed = await this.applySourcePatch("create sticky note", (source) => {
      const created = createStickyNoteInSource(source, payload);
      if (!created.changed || !this.selectedDiagramViewName || !noteName) return created;
      const selectedView = this.diagramViews.find((view) => view.name === this.selectedDiagramViewName) || null;
      if (!selectedView || selectedView.all || (Array.isArray(selectedView.stickyNoteNames) && selectedView.stickyNoteNames.length === 0)) return created;
      const filterConfig = appendStickyNoteToFilterConfig(viewToFilterConfig(selectedView, this.latestDatabase), noteName);
      return updateDiagramViewFilterInSource(created.source, selectedView.name, filterConfig);
    });
    if (changed) this.reparseDiagramViewsFromCurrentSource();
  }

  private async handleStickyNoteEdited(args: unknown[]): Promise<void> {
    await this.applySourcePatch("edit sticky note", (source) => updateStickyNoteInSource(source, { name: args[0], content: args[1] }));
  }

  private async handleStickyNoteRemoved(payload: unknown): Promise<void> {
    await this.removeStickyNoteLayoutFromPayload(payload);
    const noteName = stickyNoteNameFromPayload(payload);
    const changed = await this.applySourcePatch("remove sticky note", (source) => {
      const removed = removeStickyNoteFromSource(source, payload);
      if (!removed.changed || !noteName) return removed;
      const updatedViews = removeStickyNoteFromDiagramViews(removed.source, noteName);
      return { source: updatedViews.source, changed: true };
    });
    if (changed) this.reparseDiagramViewsFromCurrentSource();
  }

  private async handleEditDataSample(payload: unknown): Promise<void> {
    await this.applySourcePatch("edit Records", (source, database) => updateRecordsInSource(source, database, payload));
  }

  private async handleFilterChangeRequested(payload: unknown): Promise<void> {
    if (!this.selectedDiagramViewName) return;
    await this.applySourcePatch("update DiagramView filter", (source) => updateDiagramViewFilterInSource(source, this.selectedDiagramViewName || "", normalizeFilterConfig(payload)));
  }

  private async handleViewAdded(name: string): Promise<void> {
    const changed = await this.applySourcePatch("add DiagramView", (source) => addDiagramViewInSource(source, name));
    if (changed) this.reparseDiagramViewsFromCurrentSource();
    await this.switchDiagramView(name);
  }

  private async handleViewRenamed(oldId: string, newName: string): Promise<void> {
    const oldName = oldId || this.selectedDiagramViewName || "";
    const renamedSelectedView = this.selectedDiagramViewName === oldName;
    const stateToCarry = renamedSelectedView ? this.state : null;
    const changed = await this.applySourcePatch("rename DiagramView", (source) => renameDiagramViewInSource(source, oldName, newName));
    if (changed) this.reparseDiagramViewsFromCurrentSource();
    if (renamedSelectedView && stateToCarry) {
      this.selectedDiagramViewName = newName;
      const nextRef = this.currentStateRef();
      if (nextRef) await this.plugin.stateStore.saveImmediate(nextRef, stateToCarry);
      this.state = stateToCarry;
      this.renderer?.loadState(stateToCarry);
      this.sendCurrentDatabaseToRenderer();
      this.renderToolbar();
      return;
    }
    await this.switchDiagramView(newName);
  }

  private async handleViewRemoved(viewId: string): Promise<void> {
    const changed = await this.applySourcePatch("remove DiagramView", (source) => removeDiagramViewInSource(source, viewId || this.selectedDiagramViewName || ""));
    if (changed) this.reparseDiagramViewsFromCurrentSource();
    await this.switchDiagramView(null);
  }

  private async handleViewReset(): Promise<void> {
    if (!this.selectedDiagramViewName) return;
    const changed = await this.applySourcePatch("reset DiagramView", (source) => resetDiagramViewInSource(source, this.selectedDiagramViewName || ""));
    if (changed) this.reparseDiagramViewsFromCurrentSource();
  }

  private async persistStickyNoteLayoutFromPayload(payload: unknown): Promise<void> {
    const layout = stickyNoteLayoutFromPayload(payload);
    if (!layout || !this.state) return;
    this.state = {
      ...this.state,
      stickyNoteLayouts: [
        ...this.state.stickyNoteLayouts.filter((item) => asRecord(item).name !== layout.name),
        layout
      ]
    };
    const ref = this.currentStateRef();
    if (ref) await this.plugin.stateStore.saveImmediate(ref, this.state);
    this.renderer?.loadState(this.state);
  }

  private async removeStickyNoteLayoutFromPayload(payload: unknown): Promise<void> {
    const name = stringValue(asRecord(payload).name || payload);
    if (!name || !this.state) return;
    this.state = {
      ...this.state,
      stickyNoteLayouts: this.state.stickyNoteLayouts.filter((item) => asRecord(item).name !== name)
    };
    const ref = this.currentStateRef();
    if (ref) await this.plugin.stateStore.saveImmediate(ref, this.state);
    this.renderer?.loadState(this.state);
  }

  private reparseDiagramViewsFromCurrentSource(): void {
    if (!this.source) return;
    this.diagramViews = parseDiagramViews(this.source.source);
  }

  private handleFocusEditor(): void {
    if (!this.source?.file) return;
    void this.app.workspace.getLeaf(false).openFile(this.source.file);
  }

  private async applySourcePatch(operationName: string, patcher: (currentSource: string, currentDatabase: unknown) => { source: string; changed: boolean }): Promise<boolean> {
    if (!this.source || !this.sourceRef) return false;
    const file = this.source.file;
    try {
      const resolved = await resolveSourceRef(this.app, this.sourceRef);
      if (!resolved) {
        new Notice(`Cannot ${operationName}: DBML source no longer exists.`);
        return false;
      }
      const parsed = parseDbml(resolved.source);
      if (!parsed.database) {
        new Notice(`Cannot ${operationName}: fix DBML parse errors first.`);
        return false;
      }
      const patch = patcher(resolved.source, parsed.database);
      if (!patch.changed || patch.source === resolved.source) {
        new Notice(`Cannot ${operationName}: no safe source change was found.`);
        return false;
      }
      const validation = parseDbml(patch.source);
      if (!validation.database) {
        new Notice(`Cannot ${operationName}: generated DBML did not parse. Source left unchanged.`);
        await this.offerNormalizedRecovery(operationName, resolved.source);
        return false;
      }
      const currentFileText = await this.app.vault.read(file);
      if (!sourceMatchesRef(currentFileText, resolved.ref, resolved.source)) {
        new Notice(`Cannot ${operationName}: source changed before the patch could be applied.`);
        return false;
      }
      const nextFileText = replaceSourceForRef(currentFileText, resolved.ref, patch.source);
      if (nextFileText === null || nextFileText === currentFileText) {
        new Notice(`Cannot ${operationName}: source location changed before the patch could be applied.`);
        return false;
      }
      const stateRef = this.currentStateRef();
      if (this.state && stateRef) await this.plugin.stateStore.saveImmediate(stateRef, this.pruneStateForCurrentView(this.state));
      this.source = { ...resolved, source: patch.source };
      this.sourceRef = resolved.ref;
      await this.app.vault.modify(file, nextFileText);
      return true;
    } catch (error) {
      console.error(`DBML: failed to ${operationName}`, error);
      new Notice(`Failed to ${operationName}: ${error instanceof Error ? error.message : String(error)}`);
      if (this.source) await this.offerNormalizedRecovery(operationName, this.source.source);
      return false;
    }
  }

  private async offerNormalizedRecovery(operationName: string, source: string): Promise<void> {
    if (!this.source) return;
    const confirmed = await confirmWithModal(this.app, {
      title: "Create recovery file",
      message: `Could not safely ${operationName}. Create a normalized recovery file instead?`,
      confirmText: "Create recovery file"
    });
    if (!confirmed) return;
    try {
      const normalized = normalizeDbmlSource(source, { includeRecords: this.plugin.settings.exportIncludeRecords });
      const folder = this.source.file.parent?.path || "";
      const base = this.source.file.basename || "schema";
      const path = uniqueVaultPath(this.app.vault, `${folder === "/" ? "" : `${folder}/`}${base}.recovered.dbml`);
      const file = await this.app.vault.create(path, normalized.endsWith("\n") ? normalized : `${normalized}\n`);
      await this.app.workspace.getLeaf(false).openFile(file);
      new Notice(`Created recovery file ${path}`);
    } catch (error) {
      console.error("DBML: failed to create recovery file", error);
      new Notice(`Failed to create recovery file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) activeWindow.clearTimeout(this.refreshTimer);
    this.refreshTimer = activeWindow.setTimeout(() => void this.refresh(), 250);
  }

  private async refresh(): Promise<void> {
    if (!this.sourceRef || !this.hostEl) return;
    const source = await resolveSourceRef(this.app, this.sourceRef);
    if (!source) {
      this.hostEl.empty();
      this.hostEl.createDiv({ cls: "obsidian-dbml-empty", text: "DBML source no longer exists." });
      return;
    }
    this.source = source;
    this.sourceRef = source.ref;
    this.diagramViews = parseDiagramViews(source.source);
    if (!this.diagramViews.some((view) => view.name === this.selectedDiagramViewName)) this.selectedDiagramViewName = null;
    const result = parseDbml(source.source);
    this.latestDatabase = result.database;
    this.latestError = diagnosticsToMessage(result.errors);
    const stateRef = this.currentStateRef();
    this.state = stateRef ? this.pruneStateForCurrentView(await this.plugin.stateStore.load(stateRef)) : null;
    if (!this.state) return;
    if (!this.renderer) {
      this.renderer = new RendererHost(this.hostEl, this.state, (state) => {
        this.state = this.pruneStateForCurrentView(state);
        const currentRef = this.currentStateRef();
        if (currentRef) this.plugin.stateStore.save(currentRef, this.state);
        this.renderToolbar();
      }, {
        onTableRenamed: (args) => void this.handleTableRenamed(args),
        onColorPicked: (args) => void this.handleColorPicked(args),
        onRefCreated: (args) => void this.handleRefCreated(args),
        onNoteUpdated: (payload) => void this.handleNoteUpdated(payload),
        onStickyNoteCreated: (payload) => void this.handleStickyNoteCreated(payload),
        onStickyNoteEdited: (args) => void this.handleStickyNoteEdited(args),
        onStickyNoteRemoved: (payload) => void this.handleStickyNoteRemoved(payload),
        onEditDataSample: (payload) => void this.handleEditDataSample(payload),
        onFilterChangeRequested: (payload) => void this.handleFilterChangeRequested(payload),
        onViewAdded: (name) => void this.handleViewAdded(name),
        onSelectDiagramView: (viewId) => void this.switchDiagramView(viewId),
        onViewRenamed: (oldId, newName) => void this.handleViewRenamed(oldId, newName),
        onViewRemoved: (viewId) => void this.handleViewRemoved(viewId),
        onViewReset: () => void this.handleViewReset(),
        onFocusEditor: () => this.handleFocusEditor()
      }, { context: "preview", settings: this.plugin.settings });
      this.renderer.setTheme(this.plugin.currentIsDark());
    } else {
      this.renderer.loadState(this.state);
    }
    this.sendCurrentDatabaseToRenderer();
    this.renderToolbar();
    if (result.errors.length > 0) new Notice(`DBML parse error: ${result.errors[0].message}`);
  }
}

function normalizeFilterConfig(value: unknown): RendererFilterConfig {
  const record = asRecord(value);
  return {
    tables: normalizeFilterArray(record.tables),
    schemas: normalizeFilterArray(record.schemas),
    tableGroups: normalizeFilterArray(record.tableGroups),
    stickyNotes: normalizeFilterArray(record.stickyNotes)
  };
}

function viewToFilterConfig(view: DiagramViewDefinition, database: unknown): RendererFilterConfig {
  return {
    tables: view.tableNames === null ? null : view.tableNames.map((name) => tableFilterEntry(name, database)),
    schemas: view.schemaNames === null ? null : view.schemaNames.map((name) => ({ name })),
    tableGroups: view.tableGroupNames === null ? null : view.tableGroupNames.map((name) => ({ name })),
    stickyNotes: view.stickyNoteNames === null ? null : view.stickyNoteNames.map((name) => ({ name }))
  };
}

function normalizeFilterArray(value: unknown): unknown[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) return [];
  return value.map((item: unknown) => item);
}

function tableFilterEntry(value: string, database: unknown): { name: string; schemaName: string } {
  const parsed = splitQualifiedName(value);
  if (parsed.schemaName) return { name: parsed.name, schemaName: parsed.schemaName };
  const db = asRecord(database);
  const schemas = asRecord(db.schemas);
  const table = Object.values(asRecord(db.tables)).map(asRecord).find((table) => normalizeName(stringValue(table.name)) === normalizeName(parsed.name));
  const schemaName = stringValue(asRecord(schemas[String(table?.schemaId)]).name) || "public";
  return { name: parsed.name, schemaName };
}

function appendStickyNoteToFilterConfig(filterConfig: RendererFilterConfig, noteName: string): RendererFilterConfig {
  const existing = Array.isArray(filterConfig.stickyNotes) ? filterConfig.stickyNotes : [];
  const stickyNotes = existing.some((note) => asRecord(note).name === noteName)
    ? existing
    : [...existing, { name: noteName }];
  return { ...filterConfig, stickyNotes };
}

function stickyNoteNameFromPayload(payload: unknown): string {
  if (typeof payload === "string" || typeof payload === "number") return String(payload);
  const record = asRecord(payload);
  return stringValue(record.name || record.id);
}

function stickyNoteLayoutFromPayload(payload: unknown): { name: string; x: number; y: number; width: number; height: number } | null {
  const record = asRecord(payload);
  const config = asRecord(record.config);
  const name = stringValue(record.name || record.id);
  if (!name) return null;
  return {
    name,
    x: numberValue(config.x),
    y: numberValue(config.y),
    width: numberValue(config.width),
    height: numberValue(config.height)
  };
}

function dbmlSourceRefFromState(value: unknown): DbmlSourceRef | null {
  const record = asRecord(value);
  const kind = record.kind === "file" || record.kind === "markdown-codeblock" ? record.kind : null;
  const filePath = stringValue(record.filePath);
  const sourceKey = stringValue(record.sourceKey);
  const displayName = stringValue(record.displayName);
  if (!kind || !filePath || !sourceKey || !displayName) return null;
  return {
    kind,
    filePath,
    blockStartLine: typeof record.blockStartLine === "number" ? record.blockStartLine : undefined,
    blockEndLine: typeof record.blockEndLine === "number" ? record.blockEndLine : undefined,
    sourceKey,
    displayName,
    layoutKey: typeof record.layoutKey === "string" ? record.layoutKey : undefined
  };
}

function splitQualifiedName(value: string): { name: string; schemaName?: string } {
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
  const filtered = parts.filter(Boolean);
  if (filtered.length > 1) return { schemaName: filtered.slice(0, -1).join("."), name: filtered[filtered.length - 1] };
  return { name: filtered[0] || value };
}

function unquoteIdentifier(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")) || (value.startsWith("`") && value.endsWith("`"))) {
    return value.slice(1, -1).replace(/\\(["'`])/g, "$1");
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function pruneDiagramStateForDatabase(state: DiagramState, database: unknown): DiagramState {
  const db = asRecord(database);
  const schemas = asRecord(db.schemas);
  const tables = Object.values(asRecord(db.tables)).map(asRecord);
  const tableGroups = Object.values(asRecord(db.tableGroups)).map(asRecord);
  const refs = Object.values(asRecord(db.refs)).map(asRecord);
  const notes = Object.values(asRecord(db.notes)).map(asRecord);

  const tableIds = new Set(tables.map((table) => stringValue(table.id)).filter(Boolean));
  const tableKeys = new Set(tables.map((table) => tableKey(stringValue(table.name), schemaNameForTable(table, schemas))).filter(Boolean));
  const unqualifiedTableNames = new Set(tables.map((table) => normalizeName(stringValue(table.name))).filter(Boolean));
  const tableGroupNames = new Set(tableGroups.map((group) => normalizeName(stringValue(group.name))).filter(Boolean));
  const refIds = new Set(refs.map((ref) => stringValue(ref.id)).filter(Boolean));
  const noteNames = new Set(notes.map((note) => normalizeName(stringValue(note.name))).filter(Boolean));

  return {
    ...state,
    tablePositions: state.tablePositions.filter((position) => tablePositionIsVisible(position, tableIds, tableKeys, unqualifiedTableNames)),
    tableGroupCollapseStates: state.tableGroupCollapseStates.filter((group) => namedLayoutIsVisible(group, tableGroupNames)),
    stickyNoteLayouts: state.stickyNoteLayouts.filter((note) => namedLayoutIsVisible(note, noteNames)),
    referencePaths: state.referencePaths.filter((path) => referencePathIsVisible(path, refIds, tableKeys, unqualifiedTableNames))
  };
}

function schemaNameForTable(table: Record<string, unknown>, schemas: Record<string, unknown>): string {
  return stringValue(table.schemaName) || stringValue(asRecord(schemas[stringValue(table.schemaId)]).name) || "public";
}

function tablePositionIsVisible(position: unknown, tableIds: Set<string>, tableKeys: Set<string>, unqualifiedTableNames: Set<string>): boolean {
  const record = asRecord(position);
  const id = stringValue(record.id);
  if (id && tableIds.has(id)) return true;
  return tableNameIsVisible(stringValue(record.name), stringValue(record.schemaName), tableKeys, unqualifiedTableNames);
}

function referencePathIsVisible(path: unknown, refIds: Set<string>, tableKeys: Set<string>, unqualifiedTableNames: Set<string>): boolean {
  const record = asRecord(path);
  const id = stringValue(record.id);
  if (id && refIds.has(id)) return true;
  const firstVisible = tableNameIsVisible(stringValue(record.firstTableName), stringValue(record.firstSchemaName), tableKeys, unqualifiedTableNames);
  const secondVisible = tableNameIsVisible(stringValue(record.secondTableName), stringValue(record.secondSchemaName), tableKeys, unqualifiedTableNames);
  return firstVisible && secondVisible;
}

function namedLayoutIsVisible(value: unknown, visibleNames: Set<string>): boolean {
  const name = normalizeName(stringValue(asRecord(value).name || value));
  return !!name && visibleNames.has(name);
}

function tableNameIsVisible(name: string, schemaName: string, tableKeys: Set<string>, unqualifiedTableNames: Set<string>): boolean {
  if (!name) return false;
  if (schemaName) return tableKeys.has(tableKey(name, schemaName));
  return unqualifiedTableNames.has(normalizeName(name));
}

function tableKey(name: string, schemaName: string): string {
  return `${normalizeName(schemaName || "public")}.${normalizeName(name)}`;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueVaultPath(vault: import("obsidian").Vault, path: string): string {
  if (!vault.getAbstractFileByPath(path)) return path;
  const dot = path.lastIndexOf(".");
  const base = dot === -1 ? path : path.slice(0, dot);
  const ext = dot === -1 ? "" : path.slice(dot);
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} ${index}${ext}`;
    if (!vault.getAbstractFileByPath(candidate)) return candidate;
  }
  throw new Error("Could not create a unique recovery file name.");
}
