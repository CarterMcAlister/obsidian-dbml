import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import type DbmlPlugin from "../main";
import { diagnosticsToMessage, parseDbml } from "../dbml/parser";
import { stateKeyForBlock } from "../dbml/state-store";
import type { DbmlSourceRef, DiagramState } from "../dbml/types";
import { RendererHost } from "../preview/renderer-host";

interface FenceMatch {
  from: number;
  to: number;
  startLine: number;
  source: string;
}

export function createDbmlLivePreviewExtension(plugin: DbmlPlugin) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view, plugin);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) this.decorations = buildDecorations(update.view, plugin);
    }
  }, {
    decorations: (value) => value.decorations
  });
}

class DbmlWidget extends WidgetType {
  private plugin: DbmlPlugin;
  private source: string;
  private startLine: number;
  private renderer: RendererHost | null = null;
  private state: DiagramState | null = null;

  constructor(plugin: DbmlPlugin, source: string, startLine: number) {
    super();
    this.plugin = plugin;
    this.source = source;
    this.startLine = startLine;
  }

  eq(other: DbmlWidget): boolean {
    return other.source === this.source && other.startLine === this.startLine && other.plugin.settings.renderLivePreviewWidgets === this.plugin.settings.renderLivePreviewWidgets;
  }

  toDOM(): HTMLElement {
    const wrapper = activeDocument.createDiv({ cls: "obsidian-dbml-live-widget" });
    wrapper.style.setProperty("--obsidian-dbml-height", `${this.plugin.settings.defaultPreviewHeight}px`);
    const host = wrapper.createDiv({ cls: "obsidian-dbml-renderer-host" });
    void this.mount(host);
    return wrapper;
  }

  destroy(): void {
    if (this.state) void this.plugin.stateStore.saveImmediate(this.ref(), this.state);
    this.renderer?.destroy();
  }

  private async mount(host: HTMLElement): Promise<void> {
    this.state = await this.plugin.stateStore.load(this.ref());
    this.renderer = new RendererHost(host, this.state, (state) => {
      this.state = state;
      this.plugin.stateStore.save(this.ref(), state);
    }, {}, { context: "live-preview", settings: this.plugin.settings });
    this.renderer.setTheme(this.plugin.currentIsDark());
    const result = parseDbml(this.source);
    this.renderer.update({ database: result.database, error: diagnosticsToMessage(result.errors) });
  }

  private ref(): DbmlSourceRef {
    const filePath = this.plugin.app.workspace.getActiveFile()?.path || "unknown.md";
    return {
      kind: "markdown-codeblock",
      filePath,
      blockStartLine: this.startLine,
      sourceKey: stateKeyForBlock(filePath, this.startLine, this.source),
      displayName: `${filePath}:${this.startLine + 1}`
    };
  }
}

function buildDecorations(view: EditorView, plugin: DbmlPlugin): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (!plugin.settings.renderLivePreviewWidgets) return builder.finish();
  for (const fence of findFences(view)) {
    builder.add(fence.to, fence.to, Decoration.widget({ widget: new DbmlWidget(plugin, fence.source, fence.startLine), block: true, side: 1 }));
  }
  return builder.finish();
}

function findFences(view: EditorView): FenceMatch[] {
  const doc = view.state.doc;
  const text = doc.toString();
  const lines = text.split(/\r?\n/);
  const matches: FenceMatch[] = [];
  let position = 0;
  let inFence = false;
  let startLine = 0;
  let sourceStart = 0;
  let fenceChar = "`";
  let fenceLength = 3;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineStart = position;
    const lineEnd = position + line.length;
    if (!inFence) {
      const match = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
      if (match && match[3].toLowerCase() === "dbml") {
        inFence = true;
        startLine = index;
        sourceStart = lineEnd + 1;
        fenceChar = match[2][0];
        fenceLength = match[2].length;
      }
    } else {
      const closePattern = new RegExp(`^\\s*${escapeRegExp(fenceChar)}{${fenceLength},}\\s*$`);
      if (closePattern.test(line)) {
        matches.push({ from: sourceStart, to: lineEnd + 1, startLine, source: text.slice(sourceStart, lineStart).replace(/\n$/, "") });
        inFence = false;
      }
    }
    position = lineEnd + 1;
  }
  return matches;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
