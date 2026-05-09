import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, DbmlPluginSettings, DbmlSettingTab } from "./settings";
import { DiagramStateStore } from "./dbml/state-store";
import type { DbmlSourceRef, DiagramState } from "./dbml/types";
import { registerCommands } from "./commands";
import { resolveActiveDbmlSource, resolveDbmlSourceForFile } from "./dbml/source";
import { DbmlPreviewView, VIEW_TYPE_DBML_PREVIEW } from "./preview/preview-view";
import { registerDbmlCodeblockProcessor } from "./preview/markdown-codeblock";
import { createDbmlLivePreviewExtension } from "./editor/live-preview-widget";
import { createDbmlLintExtension } from "./editor/dbml-lint";
import { createDbmlSyntaxHighlightExtension } from "./editor/dbml-syntax-highlight";

interface PluginData {
  settings?: Partial<DbmlPluginSettings>;
  states?: Record<string, DiagramState>;
}

export default class DbmlPlugin extends Plugin {
  settings: DbmlPluginSettings = { ...DEFAULT_SETTINGS };
  states: Record<string, DiagramState> = {};
  stateStore!: DiagramStateStore;
  private pendingPreviewSourceRef: DbmlSourceRef | null = null;

  async onload(): Promise<void> {
    await this.loadPluginData();
    this.stateStore = new DiagramStateStore({
      vault: this.app.vault,
      settings: this.settings,
      states: this.states,
      savePluginData: () => this.savePluginData()
    });
    this.registerExtensions(["dbml"], "markdown");
    this.registerView(VIEW_TYPE_DBML_PREVIEW, (leaf) => new DbmlPreviewView(leaf, this));
    this.registerEditorExtension([createDbmlSyntaxHighlightExtension(this), createDbmlLintExtension(this), createDbmlLivePreviewExtension(this)]);
    registerDbmlCodeblockProcessor(this);
    registerCommands(this);
    this.addSettingTab(new DbmlSettingTab(this.app, this));
    this.addRibbonIcon("layout-dashboard", "Open database diagram preview", () => void this.openPreviewForActiveSource());

    this.registerEvent(this.app.workspace.on("css-change", () => this.broadcastTheme()));
  }

  async onunload(): Promise<void> {
    await this.stateStore?.flush();
  }

  async loadPluginData(): Promise<void> {
    const data = (await this.loadData()) as PluginData | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings || {});
    this.states = data?.states || {};
  }

  async saveSettings(): Promise<void> {
    await this.savePluginData();
  }

  async savePluginData(): Promise<void> {
    const data: PluginData = {
      settings: this.settings,
      states: this.states
    };
    await this.saveData(data);
  }

  async openPreviewForActiveSource(fileHint?: TFile): Promise<void> {
    const source = await resolveActiveDbmlSource(this.app) || (fileHint ? await resolveDbmlSourceForFile(this.app, fileHint) : null);
    if (!source) {
      new Notice("Open a .dbml file or place the cursor inside a fenced dbml block.");
      return;
    }
    let leaf = this.findPreviewLeaf(source.ref.sourceKey);
    this.pendingPreviewSourceRef = source.ref;
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("split");
      await leaf.open(new DbmlPreviewView(leaf, this));
    }
    if (leaf.view instanceof DbmlPreviewView) await leaf.view.setSource(source.ref);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  consumePendingPreviewSourceRef(): DbmlSourceRef | null {
    const ref = this.pendingPreviewSourceRef;
    this.pendingPreviewSourceRef = null;
    return ref;
  }

  currentIsDark(): boolean {
    if (this.settings.followObsidianTheme) return activeDocument.body.hasClass("theme-dark");
    return this.settings.defaultDarkMode;
  }

  broadcastTheme(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DBML_PREVIEW)) {
      if (leaf.view instanceof DbmlPreviewView) leaf.view.applyTheme();
    }
  }

  private findPreviewLeaf(sourceKey: string): WorkspaceLeaf | null {
    let emptyLeaf: WorkspaceLeaf | null = null;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DBML_PREVIEW)) {
      if (!(leaf.view instanceof DbmlPreviewView)) continue;
      if (leaf.view.matches({ kind: "file", filePath: "", sourceKey, displayName: "" })) return leaf;
      if (!emptyLeaf && leaf.view.getState().sourceRef === null) emptyLeaf = leaf;
    }
    return emptyLeaf;
  }
}
