import rendererHtml from "../../assets/renderer/index.html";
import rendererCss from "../../assets/renderer/index.css";
import rendererJs from "../../assets/renderer/index.js.txt";
import type { RendererFeatureConfig } from "../dbml/features";
import type { DiagramState, FeatureToggles, RendererUpdate } from "../dbml/types";

interface VsixRendererCallbacks {
  onSaveState: (state: DiagramState) => void;
  onTableRenamed?: (args: unknown[]) => void;
  onColorPicked?: (args: unknown[]) => void;
  onSelectDiagramView?: (viewId: string | null) => void;
  onRefCreated?: (args: unknown[]) => void;
  onNoteUpdated?: (payload: unknown) => void;
  onStickyNoteCreated?: (payload: unknown) => void;
  onStickyNoteEdited?: (args: unknown[]) => void;
  onStickyNoteRemoved?: (payload: unknown) => void;
  onEditDataSample?: (payload: unknown) => void;
  onFilterChangeRequested?: (payload: unknown) => void;
  onViewAdded?: (name: string) => void;
  onViewRenamed?: (oldId: string, newName: string) => void;
  onViewRemoved?: (viewId: string) => void;
  onViewReset?: () => void;
  onFocusEditor?: () => void;
  onFocusElement?: (payload: unknown) => void;
  onRefMoved?: (payload: unknown) => void;
}

type RendererToHostMessage =
  | { type: "ready" }
  | { type: "saveState"; state: DiagramState }
  | { type: "tableRenamed"; args: unknown[] }
  | { type: "colorPicked"; args: unknown[] }
  | { type: "viewSelected"; viewId: string | null }
  | { type: "refCreated"; args: unknown[] }
  | { type: "noteUpdated"; payload: unknown }
  | { type: "stickyNoteCreated"; payload: unknown }
  | { type: "stickyNoteEdited"; args: unknown[] }
  | { type: "stickyNoteRemoved"; payload: unknown }
  | { type: "editDataSample"; payload: unknown }
  | { type: "filterChangeRequested"; payload: unknown }
  | { type: "viewAdded"; name: string }
  | { type: "viewRenamed"; oldId: string; newName: string }
  | { type: "viewRemoved"; viewId: string }
  | { type: "viewReset" }
  | { type: "focusEditor" }
  | { type: "focusElement"; payload: unknown }
  | { type: "refMoved"; payload: unknown };

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
  private featureConfig: RendererFeatureConfig | null;
  private isDark = false;
  private latestUpdate: RendererUpdate = { database: null };
  private pending: HostToRendererMessage[] = [];
  private messageHandler = (event: MessageEvent) => this.onWindowMessage(event);

  constructor(container: HTMLElement, state: DiagramState, callbacks: VsixRendererCallbacks, featureConfig?: RendererFeatureConfig) {
    this.container = container;
    this.state = state;
    this.callbacks = callbacks;
    this.featureConfig = featureConfig || null;
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
      return;
    }
    switch (message.type) {
      case "refCreated": this.callbacks.onRefCreated?.(message.args); break;
      case "noteUpdated": this.callbacks.onNoteUpdated?.(message.payload); break;
      case "stickyNoteCreated": this.callbacks.onStickyNoteCreated?.(message.payload); break;
      case "stickyNoteEdited": this.callbacks.onStickyNoteEdited?.(message.args); break;
      case "stickyNoteRemoved": this.callbacks.onStickyNoteRemoved?.(message.payload); break;
      case "editDataSample": this.callbacks.onEditDataSample?.(message.payload); break;
      case "filterChangeRequested": this.callbacks.onFilterChangeRequested?.(message.payload); break;
      case "viewAdded": this.callbacks.onViewAdded?.(message.name); break;
      case "viewRenamed": this.callbacks.onViewRenamed?.(message.oldId, message.newName); break;
      case "viewRemoved": this.callbacks.onViewRemoved?.(message.viewId); break;
      case "viewReset": this.callbacks.onViewReset?.(); break;
      case "focusEditor": this.callbacks.onFocusEditor?.(); break;
      case "focusElement": this.callbacks.onFocusElement?.(message.payload); break;
      case "refMoved": this.callbacks.onRefMoved?.(message.payload); break;
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
  window.__OBSIDIAN_DBML_RENDERER_CONFIG__ = ${JSON.stringify(this.featureConfig || null)};
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
  const replacements: Array<[string, string]> = [
    [
      `const Nht = pb(\`dbml\`, () => {
			let e = r0({}),
				s = r0(void 0),
				t = r0(false);
			return {
				database: e,
				error: s,
				isDatabaseLoaded: t,
				updateDatabase: (a, r) => {
					(s.value = r), !r && ((e.value = a), (t.value = true));
				},
				testDatabase: () => {`,
      `const Nht = pb(\`dbml\`, () => {
			let e = r0({}),
				s = r0({}),
				t = r0(void 0),
				a = r0(false),
				r = r0(null),
				l = r0({}),
				T = r0({ tables: [], schemas: [], tableGroups: [], stickyNotes: [] }),
				d = r0(void 0),
				h = r0(false);
			return {
				database: e,
				fullDatabase: s,
				error: t,
				isDatabaseLoaded: a,
				selectedViewId: r,
				views: l,
				filterConfig: T,
				defaultViewName: d,
				isFilterConfigDirty: h,
				updateDatabase: (I, L, v) => {
					(t.value = L), !L && ((e.value = I), (s.value = v?.fullDatabase || I), (l.value = v?.views || {}), (r.value = v?.selectedViewId ?? null), (T.value = v?.filterConfig || { tables: [], schemas: [], tableGroups: [], stickyNotes: [] }), (d.value = v?.defaultViewName), (h.value = !!v?.isFilterConfigDirty), (a.value = true));
				},
				testDatabase: () => {`
    ],
    [
      `r = An(\`_diagramRef\`),
						l = T1(() => ({`,
      `r = An(\`_diagramRef\`),
						g = globalThis.__OBSIDIAN_DBML_RENDERER_CONFIG__ || {},
						l = T1(() => g.shouldShowProTag || ({`
    ],
    [
      `h = (I) => {
							t.setDetailLevel(I);
						};`,
      `h = (I) => {
							t.setDetailLevel(I);
						},
						p = (I, L) => window.acquireVsCodeApi().postMessage({ type: I, ...L }),
						m = (...I) => p(\`tableRenamed\`, { args: I }),
						b = (...I) => p(\`colorPicked\`, { args: I }),
						x = (I) => p(\`viewSelected\`, { viewId: I }),
						S = (...I) => p(\`refCreated\`, { args: I }),
						C = (I) => p(\`noteUpdated\`, { payload: I }),
						w = (I) => p(\`stickyNoteCreated\`, { payload: I }),
						E = (...I) => p(\`stickyNoteEdited\`, { args: I }),
						D = (I) => p(\`stickyNoteRemoved\`, { payload: I }),
						O = (I) => p(\`editDataSample\`, { payload: I }),
						k = (I) => p(\`filterChangeRequested\`, { payload: I }),
						A = (I) => p(\`viewAdded\`, { name: I }),
						P = (I, L) => p(\`viewRenamed\`, { oldId: I, newName: L }),
						M = (I) => p(\`viewRemoved\`, { viewId: I }),
						R = () => p(\`viewReset\`, {}),
						N = () => p(\`focusEditor\`, {}),
						F = (I) => p(\`focusElement\`, { payload: I }),
						U = (I) => p(\`refMoved\`, { payload: I });`
    ],
    [`"full-normalized-database": Vt(s).database`, `"full-normalized-database": Vt(s).fullDatabase`],
    [
      `"reference-paths": Vt(t).referencePaths,
										"editable-sticky-note": false,`,
      `"reference-paths": Vt(t).referencePaths,
										"filter-config": Vt(s).filterConfig,
										"selected-view-id": Vt(s).selectedViewId,
										views: Vt(s).views,
										"default-view-name": Vt(s).defaultViewName,
										"is-filter-config-dirty": Vt(s).isFilterConfigDirty,
										"can-edit-note": !!g.canEditNote,
										"editable-sticky-note": !!g.editableStickyNote,`
    ],
    [`"should-show-sticky-note-toolbar": false`, `"should-show-sticky-note-toolbar": !!g.shouldShowStickyNoteToolbar`],
    [`"hide-diagram-view-actions": true`, `"hide-diagram-view-actions": !!(g.featuresToggle && g.featuresToggle.diagramViewRestricted)`],
    ['f2493c96: `${Vt(gE).POSITION.BOTTOM}px`', '"normalized-renderer-var-0061": `${Vt(gE).POSITION.BOTTOM}px`'],
    ['f1028760: L.value', '"normalized-renderer-var-0060": L.value'],
    ['v87817e62: `${Vt(gE).POSITION.BOTTOM}px`', '"normalized-renderer-var-0141": `${Vt(gE).POSITION.BOTTOM}px`'],
    ['v230060f6: I.value', '"normalized-renderer-var-0134": I.value'],
    ['v497651cc: s.value', '"normalized-renderer-var-0137": s.value'],
    [
      `onToggleGrid: Vt(t).toggleGrid,
										onDetailLevelChanged: h,`,
      `onToggleGrid: Vt(t).toggleGrid,
										onDetailLevelChanged: h,
										onTableRenamed: m,
										onColorPicked: b,
										onViewSelected: x,
										onRefCreated: S,
										onNoteUpdated: C,
										onStickyNoteCreated: w,
										onStickyNoteEdited: E,
										onStickyNoteRemoved: D,
										onEditDataSample: O,
										onFilterChangeRequested: k,
										onViewAdded: A,
										onViewRenamed: P,
										onViewRemoved: M,
										onViewReset: R,
										onFocusEditor: N,
										onFocusElement: F,
										onRefMoved: U,`
    ],
    [
      `\`reference-paths\`,
										\`should-show-pro-tag\`,
										\`onTableMoved\`,`,
      `\`reference-paths\`,
										\`filter-config\`,
										\`selected-view-id\`,
										\`views\`,
										\`default-view-name\`,
										\`is-filter-config-dirty\`,
										\`can-edit-note\`,
										\`should-show-pro-tag\`,
										\`onTableMoved\`,`
    ],
    [`_81.updateDatabase(s.database, s.error);`, `_81.updateDatabase(s.database, s.error, s);`],
    [
      `if (O3?.nextAction === \`edit-data-sample\`)
										a(\`editDataSample\`, Xn);`,
      `if (O3?.nextAction === \`edit-data-sample\`)
										a(\`editDataSample\`, O3.data || Xn);`
    ]
  ];

  if (replacements.some(([needle]) => !value.includes(needle))) {
    console.warn("DBML: renderer edit event bridge patch did not match bundled renderer");
    return value;
  }
  return replacements.reduce((patched, [needle, replacement]) => patched.replace(needle, replacement), value);
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
