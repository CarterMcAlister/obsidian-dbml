import rendererHtml from "../../assets/renderer/index.html";
import rendererCss from "../../assets/renderer/assets/index-C2uQdR0a.css";
import rendererJs from "../../assets/renderer/assets/index-CQ7BFret.js.txt";
import type { DiagramState, FeatureToggles, RendererUpdate } from "../dbml/types";

interface VsixRendererCallbacks {
  onSaveState: (state: DiagramState) => void;
  onTableRenamed?: (args: unknown[]) => void;
  onColorPicked?: (args: unknown[]) => void;
  onSelectDiagramView?: (viewId: string | null) => void;
}

type RendererToHostMessage =
  | { type: "ready" }
  | { type: "saveState"; state: DiagramState }
  | { type: "tableRenamed"; args: unknown[] }
  | { type: "colorPicked"; args: unknown[] }
  | { type: "viewSelected"; viewId: string | null };

type HostToRendererMessage =
  | ({ type: "update"; database: unknown; error?: string } & Omit<RendererUpdate, "database" | "error">)
  | { type: "loadState"; state: DiagramState }
  | { type: "themeChange"; isDark: boolean }
  | { type: "setFeaturesToggle"; featuresToggle: FeatureToggles };

export class VsixRendererHost {
  private container: HTMLElement;
  private callbacks: VsixRendererCallbacks;
  private iframe: HTMLIFrameElement;
  private id = crypto.randomUUID();
  private ready = false;
  private destroyed = false;
  private state: DiagramState;
  private features: FeatureToggles | null = null;
  private isDark = false;
  private latestUpdate: RendererUpdate = { database: null };
  private pending: HostToRendererMessage[] = [];
  private messageHandler = (event: MessageEvent) => this.onWindowMessage(event);

  constructor(container: HTMLElement, state: DiagramState, callbacks: VsixRendererCallbacks) {
    this.container = container;
    this.state = state;
    this.callbacks = callbacks;
    this.container.empty();
    this.iframe = document.createElement("iframe");
    this.iframe.addClass("obsidian-dbml-vsix-frame");
    this.iframe.setAttr("sandbox", "allow-scripts allow-same-origin");
    this.iframe.setAttr("title", "DBML diagram renderer");
    this.iframe.style.width = "100%";
    this.iframe.style.height = "100%";
    this.iframe.style.border = "0";
    this.container.appendChild(this.iframe);
    window.addEventListener("message", this.messageHandler);
    this.iframe.srcdoc = this.buildSrcdoc();
  }

  loadState(state: DiagramState): void {
    this.state = state;
    this.post({ type: "loadState", state });
  }

  update(update: RendererUpdate): void {
    this.latestUpdate = update;
    this.post({ type: "update", ...update, database: update.database || {}, error: update.error });
  }

  resend(): void {
    this.update(this.latestUpdate);
  }

  setTheme(isDark: boolean): void {
    this.isDark = isDark;
    this.post({ type: "themeChange", isDark });
  }

  setFeatureToggles(features: FeatureToggles): void {
    this.features = features;
    this.post({ type: "setFeaturesToggle", featuresToggle: features });
  }

  setDetailLevel(detailLevel: string): void {
    this.state = { ...this.state, detailLevel };
    this.callbacks.onSaveState(this.state);
    this.post({ type: "loadState", state: this.state });
  }

  setGrid(enabled: boolean): void {
    this.state = { ...this.state, gridEnabling: enabled };
    this.callbacks.onSaveState(this.state);
    this.post({ type: "loadState", state: this.state });
  }

  resetLayout(): void {
    this.state = { ...this.state, tablePositions: [], tableGroupCollapseStates: [], stickyNoteLayouts: [], referencePaths: [] };
    this.callbacks.onSaveState(this.state);
    this.post({ type: "loadState", state: this.state });
    this.resend();
  }

  zoomToFit(): void {
    this.iframe.contentWindow?.focus();
  }

  destroy(): void {
    this.destroyed = true;
    window.removeEventListener("message", this.messageHandler);
    this.iframe.remove();
  }

  private post(message: HostToRendererMessage): void {
    if (this.destroyed) return;
    if (!this.ready || !this.iframe.contentWindow) {
      this.pending.push(message);
      return;
    }
    this.iframe.contentWindow.postMessage(message, "*");
  }

  private flushReadyMessages(): void {
    this.post({ type: "loadState", state: this.state });
    this.post({ type: "themeChange", isDark: this.isDark });
    if (this.features) this.post({ type: "setFeaturesToggle", featuresToggle: this.features });
    this.post({ type: "update", ...this.latestUpdate, database: this.latestUpdate.database || {}, error: this.latestUpdate.error });
    const pending = [...this.pending];
    this.pending = [];
    for (const message of pending) this.post(message);
  }

  private onWindowMessage(event: MessageEvent): void {
    if (event.source !== this.iframe.contentWindow) return;
    const data = event.data as { __obsidianDbmlRenderer?: true; id?: string; message?: RendererToHostMessage };
    if (!data || data.__obsidianDbmlRenderer !== true || data.id !== this.id || !data.message) return;
    const message = data.message;
    if (message.type === "ready") {
      this.ready = true;
      this.flushReadyMessages();
      return;
    }
    if (message.type === "saveState" && isDiagramStateLike(message.state)) {
      this.state = normalizeState(message.state, this.state);
      this.callbacks.onSaveState(this.state);
      return;
    }
    if (message.type === "tableRenamed" && Array.isArray(message.args)) {
      this.callbacks.onTableRenamed?.(message.args);
      return;
    }
    if (message.type === "colorPicked" && Array.isArray(message.args)) {
      this.callbacks.onColorPicked?.(message.args);
      return;
    }
    if (message.type === "viewSelected") {
      this.callbacks.onSelectDiagramView?.(typeof message.viewId === "string" ? message.viewId : null);
    }
  }

  private buildSrcdoc(): string {
    const title = extractTitle(rendererHtml) || "DBML Diagram Preview";
    return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
html, body, #app { width: 100%; height: 100%; margin: 0; overflow: hidden; }
${escapeStyleContent(rendererCss)}
</style>
<script>
(() => {
  const rendererId = ${JSON.stringify(this.id)};
  const vscodeApi = {
    postMessage(message) {
      parent.postMessage({ __obsidianDbmlRenderer: true, id: rendererId, message }, "*");
    },
    getState() { return undefined; },
    setState() { return undefined; }
  };
  window.acquireVsCodeApi = () => vscodeApi;
})();
</script>
</head>
<body>
<div id="app"></div>
<script type="module">
${escapeScriptContent(patchRendererJs(rendererJs))}
</script>
</body>
</html>`;
  }
}

function patchRendererJs(value: string): string {
  const storeNeedle = "const lht=ad(`dbml`,()=>{let e=yn({}),t=yn(void 0),n=yn(!1);return{database:e,error:t,isDatabaseLoaded:n,updateDatabase:(r,i)=>{t.value=i,!i&&(e.value=r,n.value=!0)},testDatabase:()=>{";
  const storeReplacement = "const lht=ad(`dbml`,()=>{let e=yn({}),t=yn({}),n=yn(void 0),r=yn(!1),i=yn(null),a=yn({}),o=yn({tables:[],schemas:[],tableGroups:[],stickyNotes:[]}),s=yn(void 0);return{database:e,fullDatabase:t,error:n,isDatabaseLoaded:r,selectedViewId:i,views:a,filterConfig:o,defaultViewName:s,updateDatabase:(c,l,u)=>{n.value=l,!l&&(e.value=c,t.value=u?.fullDatabase||c,a.value=u?.views||{},i.value=u?.selectedViewId??null,o.value=u?.filterConfig||{tables:[],schemas:[],tableGroups:[],stickyNotes:[]},s.value=u?.defaultViewName,r.value=!0)},testDatabase:()=>{";
  const setupNeedle = "let t=lht(),n=dht(),r=fht(),i=gi(`_diagramRef`),a=cc(()=>({stickyNote:!1,detailLevel:!1,tableSearchPanelTableGroup:!1,colorHeader:!1})),o=async()=>{await cr(),i.value?.display()},s=e=>{e.tablePositions&&n.updateTablePositions(e.tablePositions),e.tableGroupCollapseStates&&n.updateTableGroupCollapseStates(e.tableGroupCollapseStates),e.stickyNoteLayouts&&n.updateStickyNoteLayouts(e.stickyNoteLayouts),e.referencePaths&&n.updateReferencePaths(e.referencePaths)},c=e=>{n.setDetailLevel(e)};return";
  const setupReplacement = "let t=lht(),n=dht(),r=fht(),i=gi(`_diagramRef`),a=cc(()=>({stickyNote:!1,detailLevel:!1,tableSearchPanelTableGroup:!1,colorHeader:!1})),o=async()=>{await cr(),i.value?.display()},s=e=>{e.tablePositions&&n.updateTablePositions(e.tablePositions),e.tableGroupCollapseStates&&n.updateTableGroupCollapseStates(e.tableGroupCollapseStates),e.stickyNoteLayouts&&n.updateStickyNoteLayouts(e.stickyNoteLayouts),e.referencePaths&&n.updateReferencePaths(e.referencePaths)},c=e=>{n.setDetailLevel(e)},l=(...e)=>{uht().postMessage({type:`tableRenamed`,args:e})},d=(...e)=>{uht().postMessage({type:`colorPicked`,args:e})},f=e=>{uht().postMessage({type:`viewSelected`,viewId:e})};return";
  const fullDatabaseNeedle = "\"full-normalized-database\":Cn(t).database";
  const fullDatabaseReplacement = "\"full-normalized-database\":Cn(t).fullDatabase";
  const statePropsNeedle = "\"reference-paths\":Cn(n).referencePaths,\"editable-sticky-note\":!1";
  const statePropsReplacement = "\"reference-paths\":Cn(n).referencePaths,\"filter-config\":Cn(t).filterConfig,\"selected-view-id\":Cn(t).selectedViewId,views:Cn(t).views,\"default-view-name\":Cn(t).defaultViewName,\"editable-sticky-note\":!1";
  const propsNeedle = "onToggleGrid:Cn(n).toggleGrid,onDetailLevelChanged:c}";
  const propsReplacement = "onToggleGrid:Cn(n).toggleGrid,onDetailLevelChanged:c,onTableRenamed:l,onColorPicked:d,onViewSelected:f}";
  const dynamicPropsNeedle = "`reference-paths`,`should-show-pro-tag`,`onTableMoved`";
  const dynamicPropsReplacement = "`reference-paths`,`filter-config`,`selected-view-id`,`views`,`default-view-name`,`should-show-pro-tag`,`onTableMoved`";
  const updateNeedle = "case`update`:_en.updateDatabase(t.database,t.error);break;";
  const updateReplacement = "case`update`:_en.updateDatabase(t.database,t.error,t);break;";
  if (!value.includes(storeNeedle) || !value.includes(setupNeedle) || !value.includes(fullDatabaseNeedle) || !value.includes(statePropsNeedle) || !value.includes(propsNeedle) || !value.includes(dynamicPropsNeedle) || !value.includes(updateNeedle)) {
    console.warn("DBML: renderer edit event bridge patch did not match bundled renderer");
    return value;
  }
  return value
    .replace(storeNeedle, storeReplacement)
    .replace(setupNeedle, setupReplacement)
    .replace(fullDatabaseNeedle, fullDatabaseReplacement)
    .replace(statePropsNeedle, statePropsReplacement)
    .replace(propsNeedle, propsReplacement)
    .replace(dynamicPropsNeedle, dynamicPropsReplacement)
    .replace(updateNeedle, updateReplacement);
}

function escapeScriptContent(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script");
}

function escapeStyleContent(value: string): string {
  return value.replace(/<\/style/gi, "<\\/style");
}

function extractTitle(html: string): string | null {
  return /<title>([^<]*)<\/title>/i.exec(html)?.[1] || null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] || char));
}

function isDiagramStateLike(value: unknown): value is DiagramState {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.darkMode === "boolean" &&
    typeof record.gridEnabling === "boolean" &&
    typeof record.detailLevel === "string" &&
    Array.isArray(record.tablePositions) &&
    Array.isArray(record.tableGroupCollapseStates) &&
    Array.isArray(record.stickyNoteLayouts) &&
    Array.isArray(record.referencePaths);
}

function normalizeState(state: DiagramState, fallback: DiagramState): DiagramState {
  return {
    version: "1.0.0",
    darkMode: state.darkMode ?? fallback.darkMode,
    gridEnabling: state.gridEnabling ?? fallback.gridEnabling,
    detailLevel: state.detailLevel ?? fallback.detailLevel,
    tablePositions: Array.isArray(state.tablePositions) ? state.tablePositions : fallback.tablePositions,
    tableGroupCollapseStates: Array.isArray(state.tableGroupCollapseStates) ? state.tableGroupCollapseStates : fallback.tableGroupCollapseStates,
    stickyNoteLayouts: Array.isArray(state.stickyNoteLayouts) ? state.stickyNoteLayouts : fallback.stickyNoteLayouts,
    referencePaths: Array.isArray(state.referencePaths) ? state.referencePaths : fallback.referencePaths
  };
}
