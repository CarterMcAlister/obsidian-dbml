import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type DbmlPlugin from "../main";
import { applyDiagramView, DiagramViewDefinition, parseDiagramViews } from "../dbml/diagram-views";
import { diagnosticsToMessage, parseDbml } from "../dbml/parser";
import { resolveSourceRef } from "../dbml/source";
import { findTableByRendererId, findTableGroupByRendererId, renameTableInSource, replaceSourceForRef, setTableGroupColorInSource, setTableHeaderColorInSource } from "../dbml/source-edits";
import type { DbmlSourceRef, DiagramState, ResolvedDbmlSource } from "../dbml/types";
import { RendererHost } from "./renderer-host";

export const VIEW_TYPE_DBML_PREVIEW = "dbml-preview";

export class DbmlPreviewView extends ItemView {
  private plugin: DbmlPlugin;
  private sourceRef: DbmlSourceRef | null = null;
  private source: ResolvedDbmlSource | null = null;
  private renderer: RendererHost | null = null;
  private state: DiagramState | null = null;
  private toolbarEl: HTMLElement | null = null;
  private hostEl: HTMLElement | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private diagramViews: DiagramViewDefinition[] = [];
  private selectedDiagramViewName: string | null = null;
  private latestDatabase: unknown | null = null;
  private latestError: string | undefined;

  constructor(leaf: WorkspaceLeaf, plugin: DbmlPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_DBML_PREVIEW;
  }

  getDisplayText(): string {
    return "DBML Diagram Preview";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  async onOpen(): Promise<void> {
    this.renderShell();
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof TFile && this.sourceRef?.filePath === file.path) this.scheduleRefresh();
    }));
  }

  async onClose(): Promise<void> {
    const stateRef = this.currentStateRef();
    if (this.state && stateRef) await this.plugin.stateStore.saveImmediate(stateRef, this.state);
    this.renderer?.destroy();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
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
    if (this.state && previousStateRef) await this.plugin.stateStore.saveImmediate(previousStateRef, this.state);
    this.selectedDiagramViewName = viewName && this.diagramViews.some((view) => view.name === viewName) ? viewName : null;
    const nextStateRef = this.currentStateRef();
    this.state = nextStateRef ? await this.plugin.stateStore.load(nextStateRef) : null;
    if (this.state) this.renderer?.loadState(this.state);
    this.sendCurrentDatabaseToRenderer();
    this.renderToolbar();
  }

  private sendCurrentDatabaseToRenderer(): void {
    const selectedView = this.diagramViews.find((view) => view.name === this.selectedDiagramViewName) || null;
    this.renderer?.update({
      database: applyDiagramView(this.latestDatabase, selectedView),
      fullDatabase: this.latestDatabase,
      error: this.latestError,
      views: Object.fromEntries(this.diagramViews.map((view) => [view.name, view.name])),
      selectedViewId: this.selectedDiagramViewName,
      filterConfig: { tables: [], schemas: [], tableGroups: [], stickyNotes: [] }
    });
  }

  private async handleTableRenamed(args: unknown[]): Promise<void> {
    if (!this.source || !this.latestDatabase) return;
    const table = findTableByRendererId(this.latestDatabase, args[0]);
    const newName = typeof args[1] === "string" ? args[1] : "";
    if (!table || !newName.trim()) return;
    const patch = renameTableInSource(this.source.source, this.latestDatabase, table, newName);
    if (patch.changed) await this.writeUpdatedSource(patch.source);
  }

  private async handleColorPicked(args: unknown[]): Promise<void> {
    if (!this.source || !this.latestDatabase) return;
    const [type, id, color] = args;
    if (typeof type !== "string" || typeof color !== "string") return;
    const patch = type === "table"
      ? setTableHeaderColorInSource(this.source.source, this.latestDatabase, findTableByRendererId(this.latestDatabase, id) || {}, color)
      : type === "table-group"
        ? setTableGroupColorInSource(this.source.source, findTableGroupByRendererId(this.latestDatabase, id) || {}, color)
        : null;
    if (patch?.changed) await this.writeUpdatedSource(patch.source);
  }

  private async writeUpdatedSource(nextSource: string): Promise<void> {
    if (!this.source || !this.sourceRef) return;
    const file = this.source.file;
    const currentFileText = await this.app.vault.read(file);
    const nextFileText = replaceSourceForRef(currentFileText, this.sourceRef, nextSource);
    if (nextFileText === null || nextFileText === currentFileText) return;
    this.source = { ...this.source, source: nextSource };
    await this.app.vault.modify(file, nextFileText);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 250);
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
    const stateRef = this.currentStateRef();
    this.state = stateRef ? await this.plugin.stateStore.load(stateRef) : null;
    if (!this.state) return;
    if (!this.renderer) {
      this.renderer = new RendererHost(this.hostEl, this.state, (state) => {
        this.state = state;
        const currentRef = this.currentStateRef();
        if (currentRef) this.plugin.stateStore.save(currentRef, state);
        this.renderToolbar();
      }, {
        onTableRenamed: (args) => void this.handleTableRenamed(args),
        onColorPicked: (args) => void this.handleColorPicked(args),
        onSelectDiagramView: (viewId) => void this.switchDiagramView(viewId)
      });
      this.renderer.setTheme(this.plugin.currentIsDark());
    } else {
      this.renderer.loadState(this.state);
    }
    const result = parseDbml(source.source);
    this.latestDatabase = result.database;
    this.latestError = diagnosticsToMessage(result.errors);
    this.sendCurrentDatabaseToRenderer();
    this.renderToolbar();
    if (result.errors.length > 0) new Notice(`DBML parse error: ${result.errors[0].message}`);
  }
}
