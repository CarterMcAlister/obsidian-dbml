import { App, MarkdownView, TFile } from "obsidian";
import type { DbmlSourceRef, ResolvedDbmlSource } from "./types";
import { stateKeyForBlock, stateKeyForFile } from "./state-store";

interface CodeFence {
  startLine: number;
  endLine: number;
  source: string;
  label: string;
}

export async function resolveActiveDbmlSource(app: App): Promise<ResolvedDbmlSource | null> {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  const activeViewSource = view ? await sourceForMarkdownView(app, view, true) : null;
  if (activeViewSource) return activeViewSource;

  const activeFile = app.workspace.getActiveFile();
  const activeFileSource = activeFile ? await sourceForFile(app, activeFile) : null;
  if (activeFileSource) return activeFileSource;

  const mostRecentLeaf = app.workspace.getMostRecentLeaf();
  if (mostRecentLeaf?.view instanceof MarkdownView) {
    const recentSource = await sourceForMarkdownView(app, mostRecentLeaf.view, false);
    if (recentSource) return recentSource;
  }

  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    if (leaf.view instanceof MarkdownView) {
      const leafSource = await sourceForMarkdownView(app, leaf.view, false);
      if (leafSource) return leafSource;
    }
  }

  return null;
}

async function sourceForMarkdownView(app: App, view: MarkdownView, allowCursorSelection: boolean): Promise<ResolvedDbmlSource | null> {
  const file = view.file;
  if (!file) return null;
  if (file.extension.toLowerCase() === "dbml") {
    return sourceForDbmlFile(app, file);
  }
  if (file.extension.toLowerCase() !== "md") return null;
  const editor = view.editor;
  const text = editor.getValue();
  const fences = findDbmlFences(text);
  if (fences.length === 0) return null;
  const selected = allowCursorSelection
    ? fences.find((fence) => editor.getCursor().line >= fence.startLine && editor.getCursor().line <= fence.endLine) || (fences.length === 1 ? fences[0] : null)
    : fences.length === 1 ? fences[0] : null;
  if (!selected) return null;
  return sourceForFence(file, selected);
}

async function sourceForFile(app: App, file: TFile): Promise<ResolvedDbmlSource | null> {
  if (file.extension.toLowerCase() === "dbml") return sourceForDbmlFile(app, file);
  if (file.extension.toLowerCase() !== "md") return null;
  const text = await app.vault.read(file);
  const fences = findDbmlFences(text);
  return fences.length === 1 ? sourceForFence(file, fences[0]) : null;
}

export async function resolveDbmlSourceForFile(app: App, file: TFile): Promise<ResolvedDbmlSource | null> {
  return sourceForFile(app, file);
}

async function sourceForDbmlFile(app: App, file: TFile): Promise<ResolvedDbmlSource> {
  const source = await app.vault.read(file);
  return {
    file,
    source,
    ref: {
      kind: "file",
      filePath: file.path,
      sourceKey: stateKeyForFile(file),
      displayName: file.path
    }
  };
}

export async function resolveSourceRef(app: App, ref: DbmlSourceRef): Promise<ResolvedDbmlSource | null> {
  const file = app.vault.getAbstractFileByPath(ref.filePath);
  if (!(file instanceof TFile)) return null;
  const text = await app.vault.read(file);
  if (ref.kind === "file") {
    return { file, source: text, ref };
  }
  const fences = findDbmlFences(text);
  const fence = fences.find((candidate) => candidate.startLine === ref.blockStartLine);
  if (!fence) return null;
  return sourceForFence(file, fence);
}

export function findDbmlFences(markdown: string): CodeFence[] {
  const lines = markdown.split(/\r?\n/);
  const fences: CodeFence[] = [];
  let inFence = false;
  let startLine = 0;
  let fenceChar = "`";
  let fenceLength = 3;
  let buffer: string[] = [];
  for (let line = 0; line < lines.length; line += 1) {
    const text = lines[line];
    if (!inFence) {
      const match = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/.exec(text);
      if (match && match[3].toLowerCase() === "dbml") {
        inFence = true;
        startLine = line;
        fenceChar = match[2][0];
        fenceLength = match[2].length;
        buffer = [];
      }
      continue;
    }
    const closePattern = new RegExp(`^\\s*${escapeRegExp(fenceChar)}{${fenceLength},}\\s*$`);
    if (closePattern.test(text)) {
      fences.push({
        startLine,
        endLine: line,
        source: buffer.join("\n"),
        label: `DBML block at line ${startLine + 1}`
      });
      inFence = false;
      continue;
    }
    buffer.push(text);
  }
  return fences;
}

function sourceForFence(file: TFile, fence: CodeFence): ResolvedDbmlSource {
  return {
    file,
    source: fence.source,
    ref: {
      kind: "markdown-codeblock",
      filePath: file.path,
      blockStartLine: fence.startLine,
      blockEndLine: fence.endLine,
      sourceKey: stateKeyForBlock(file.path, fence.startLine, fence.source),
      displayName: `${file.path}:${fence.startLine + 1}`
    }
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
