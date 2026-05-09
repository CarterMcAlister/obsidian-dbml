import { MarkdownPostProcessorContext, MarkdownRenderChild } from "obsidian";
import type DbmlPlugin from "../main";
import { diagnosticsToMessage, parseDbml } from "../dbml/parser";
import { stateKeyForBlock } from "../dbml/state-store";
import type { DbmlSourceRef, DiagramState } from "../dbml/types";
import { RendererHost } from "./renderer-host";

class DbmlCodeblockChild extends MarkdownRenderChild {
  private plugin: DbmlPlugin;
  private source: string;
  private ctx: MarkdownPostProcessorContext;
  private renderer: RendererHost | null = null;
  private state: DiagramState | null = null;
  private ref: DbmlSourceRef;

  constructor(containerEl: HTMLElement, source: string, ctx: MarkdownPostProcessorContext, plugin: DbmlPlugin) {
    super(containerEl);
    this.plugin = plugin;
    this.source = source;
    this.ctx = ctx;
    const startLine = ctx.getSectionInfo(containerEl)?.lineStart || 0;
    this.ref = {
      kind: "markdown-codeblock",
      filePath: ctx.sourcePath,
      blockStartLine: startLine,
      sourceKey: stateKeyForBlock(ctx.sourcePath, startLine, source),
      displayName: `${ctx.sourcePath}:${startLine + 1}`
    };
  }

  onload(): void {
    void this.initialize();
  }

  onunload(): void {
    void this.disposeRenderer();
  }

  private async initialize(): Promise<void> {
    if (!this.plugin.settings.renderMarkdownCodeBlocks) {
      this.containerEl.createEl("pre", { text: this.source });
      return;
    }
    this.containerEl.empty();
    this.containerEl.addClass("obsidian-dbml-codeblock");
    this.containerEl.style.setProperty("--obsidian-dbml-height", `${this.plugin.settings.defaultPreviewHeight}px`);
    const host = this.containerEl.createDiv({ cls: "obsidian-dbml-renderer-host" });
    this.state = await this.plugin.stateStore.load(this.ref);
    this.renderer = new RendererHost(host, this.state, (state) => {
      this.state = state;
      this.plugin.stateStore.save(this.ref, state);
    }, {}, { context: "markdown", settings: this.plugin.settings });
    this.renderer.setTheme(this.plugin.currentIsDark());
    const result = parseDbml(this.source);
    this.renderer.update({ database: result.database, error: diagnosticsToMessage(result.errors) });
    if (this.plugin.settings.showSourceBelowMarkdownPreview) this.renderSourceToggle();
  }

  private async disposeRenderer(): Promise<void> {
    if (this.state) await this.plugin.stateStore.saveImmediate(this.ref, this.state);
    this.renderer?.destroy();
  }

  private renderSourceToggle(): void {
    const toggle = this.containerEl.createDiv({ cls: "obsidian-dbml-source-toggle", text: "Show source" });
    let pre: HTMLPreElement | null = null;
    toggle.addEventListener("click", () => {
      if (pre) {
        pre.remove();
        pre = null;
        toggle.setText("Show source");
        return;
      }
      pre = this.containerEl.createEl("pre", { cls: "obsidian-dbml-source", text: this.source });
      toggle.setText("Hide source");
    });
  }
}

export function registerDbmlCodeblockProcessor(plugin: DbmlPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor("dbml", (source, el, ctx) => {
    ctx.addChild(new DbmlCodeblockChild(el, source, ctx, plugin));
  });
}
