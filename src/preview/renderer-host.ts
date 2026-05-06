import { rendererFeatureConfig, type RendererContext, type RendererFeatureConfig } from "../dbml/features";
import type { DiagramState, RendererUpdate } from "../dbml/types";
import type { DbmlPluginSettings } from "../settings";
import { VsixRendererHost } from "./vsix-renderer-host";

export interface RendererHostSourceEditCallbacks {
  onTableRenamed?: (args: unknown[]) => void;
  onColorPicked?: (args: unknown[]) => void;
  onRefCreated?: (args: unknown[]) => void;
  onNoteUpdated?: (payload: unknown) => void;
  onStickyNoteCreated?: (payload: unknown) => void;
  onStickyNoteEdited?: (args: unknown[]) => void;
  onStickyNoteRemoved?: (payload: unknown) => void;
  onEditDataSample?: (payload: unknown) => void;
  onFilterChangeRequested?: (payload: unknown) => void;
  onViewAdded?: (name: string) => void;
  onSelectDiagramView?: (viewId: string | null) => void;
  onViewRenamed?: (oldId: string, newName: string) => void;
  onViewRemoved?: (viewId: string) => void;
  onViewReset?: () => void;
  onFocusEditor?: () => void;
  onFocusElement?: (payload: unknown) => void;
  onRefMoved?: (payload: unknown) => void;
}

export interface RendererHostOptions {
  context: RendererContext;
  settings: DbmlPluginSettings;
  featureConfig?: RendererFeatureConfig;
}

export class RendererHost {
  private renderer: VsixRendererHost;
  private latestUpdate: RendererUpdate = { database: null };

  constructor(container: HTMLElement, state: DiagramState, onSaveState: (state: DiagramState) => void, sourceEditCallbacks: RendererHostSourceEditCallbacks = {}, options?: RendererHostOptions) {
    const featureConfig = options?.featureConfig || (options ? rendererFeatureConfig(options.context, options.settings) : undefined);
    this.renderer = new VsixRendererHost(container, state, { onSaveState, ...sourceEditCallbacks }, featureConfig);
    if (featureConfig) this.renderer.setFeatureToggles(featureConfig.featuresToggle);
  }

  loadState(state: DiagramState): void {
    this.renderer.loadState(state);
  }

  update(update: RendererUpdate): void {
    this.latestUpdate = update;
    this.renderer.update(update);
  }

  resend(): void {
    this.renderer.update(this.latestUpdate);
  }

  setTheme(isDark: boolean): void {
    this.renderer.setTheme(isDark);
  }

  setDetailLevel(detailLevel: string): void {
    this.renderer.setDetailLevel(detailLevel);
  }

  setGrid(enabled: boolean): void {
    this.renderer.setGrid(enabled);
  }

  resetLayout(): void {
    this.renderer.resetLayout();
  }

  zoomToFit(): void {
    this.renderer.zoomToFit();
  }

  destroy(): void {
    this.renderer.destroy();
  }
}
