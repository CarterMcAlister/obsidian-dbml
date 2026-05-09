import { normalizePath, TFile, Vault } from "obsidian";
import type { DbmlPluginSettings } from "../settings";
import type { DbmlSourceRef, DiagramState } from "./types";

export interface StateStoreHost {
  vault: Vault;
  settings: DbmlPluginSettings;
  states: Record<string, DiagramState>;
  savePluginData(): Promise<void>;
}

export function createDefaultDiagramState(settings: DbmlPluginSettings): DiagramState {
  return {
    version: "1.0.0",
    darkMode: settings.defaultDarkMode,
    gridEnabling: settings.defaultGridEnabled,
    detailLevel: settings.defaultDetailLevel,
    tablePositions: [],
    tableGroupCollapseStates: [],
    stickyNoteLayouts: [],
    referencePaths: []
  };
}

export class DiagramStateStore {
  private host: StateStoreHost;
  private saveTimers = new Map<string, number>();
  private pendingSaves = new Map<string, { ref: DbmlSourceRef; state: DiagramState }>();

  constructor(host: StateStoreHost) {
    this.host = host;
  }

  async load(ref: DbmlSourceRef): Promise<DiagramState> {
    if (this.shouldUseSidecar(ref)) {
      const sidecar = this.sidecarPath(ref.filePath, ref.layoutKey);
      try {
        if (await this.host.vault.adapter.exists(sidecar)) {
          const raw = await this.host.vault.adapter.read(sidecar);
          const parsed = parseDiagramState(raw);
          if (parsed) return parsed;
        }
      } catch (error) {
        console.error("DBML: failed to load sidecar state", error);
      }
    }
    const state = this.host.states[this.storageKey(ref)];
    return isDiagramState(state) ? state : createDefaultDiagramState(this.host.settings);
  }

  save(ref: DbmlSourceRef, state: DiagramState): void {
    const key = this.storageKey(ref);
    const existing = this.saveTimers.get(key);
    if (existing) activeWindow.clearTimeout(existing);
    this.pendingSaves.set(key, { ref, state });
    this.saveTimers.set(key, activeWindow.setTimeout(() => {
      this.saveTimers.delete(key);
      this.pendingSaves.delete(key);
      void this.saveImmediate(ref, state);
    }, 1000));
  }

  async saveImmediate(ref: DbmlSourceRef, state: DiagramState): Promise<void> {
    const normalized = normalizeState(state, this.host.settings);
    const key = this.storageKey(ref);
    const existing = this.saveTimers.get(key);
    if (existing) {
      activeWindow.clearTimeout(existing);
      this.saveTimers.delete(key);
    }
    this.pendingSaves.delete(key);
    if (this.shouldUseSidecar(ref)) {
      try {
        await this.host.vault.adapter.write(this.sidecarPath(ref.filePath, ref.layoutKey), JSON.stringify(normalized, null, 2));
        return;
      } catch (error) {
        console.error("DBML: failed to write sidecar state, falling back to plugin data", error);
      }
    }
    this.host.states[key] = normalized;
    await this.host.savePluginData();
  }

  async delete(ref: DbmlSourceRef): Promise<void> {
    const key = this.storageKey(ref);
    const timer = this.saveTimers.get(key);
    if (timer) activeWindow.clearTimeout(timer);
    this.saveTimers.delete(key);
    delete this.host.states[key];
    if (this.shouldUseSidecar(ref)) {
      const sidecar = this.sidecarPath(ref.filePath, ref.layoutKey);
      if (await this.host.vault.adapter.exists(sidecar)) await this.host.vault.adapter.remove(sidecar);
    }
    await this.host.savePluginData();
  }

  async flush(): Promise<void> {
    for (const timer of this.saveTimers.values()) activeWindow.clearTimeout(timer);
    this.saveTimers.clear();
    const pending = [...this.pendingSaves.values()];
    this.pendingSaves.clear();
    for (const { ref, state } of pending) await this.saveImmediate(ref, state);
    await this.host.savePluginData();
  }

  private storageKey(ref: DbmlSourceRef): string {
    return ref.layoutKey ? `${ref.sourceKey}:${ref.layoutKey}` : ref.sourceKey;
  }

  private shouldUseSidecar(ref: DbmlSourceRef): boolean {
    return this.host.settings.stateStorage === "sidecar" && ref.kind === "file" && ref.filePath.toLowerCase().endsWith(".dbml");
  }

  private sidecarPath(filePath: string, layoutKey?: string): string {
    const suffix = layoutKey ? `.${sanitizeLayoutKey(layoutKey)}` : "";
    const slash = filePath.lastIndexOf("/");
    const folder = slash === -1 ? "" : `${filePath.slice(0, slash + 1)}`;
    const fileName = slash === -1 ? filePath : filePath.slice(slash + 1);
    return normalizePath(`${folder}.${fileName.replace(/\.dbml$/i, `${suffix}.dbml-layout.json`)}`);
  }

}

export function stateKeyForFile(file: TFile): string {
  return `file:${file.path}`;
}

export function stateKeyForBlock(path: string, startLine: number, _source: string): string {
  return `block:${path}:${startLine}`;
}

export function parseDiagramState(raw: string): DiagramState | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isDiagramState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeState(state: DiagramState, settings: DbmlPluginSettings): DiagramState {
  return isDiagramState(state) ? state : createDefaultDiagramState(settings);
}

function isDiagramState(value: unknown): value is DiagramState {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.version === "1.0.0" &&
    typeof record.darkMode === "boolean" &&
    typeof record.gridEnabling === "boolean" &&
    typeof record.detailLevel === "string" &&
    Array.isArray(record.tablePositions) &&
    Array.isArray(record.tableGroupCollapseStates) &&
    Array.isArray(record.stickyNoteLayouts) &&
    Array.isArray(record.referencePaths);
}

function sanitizeLayoutKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "layout";
}
