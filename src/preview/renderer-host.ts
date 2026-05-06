import { ENABLED_FEATURE_TOGGLES } from "../dbml/features";
import type { DiagramState, RendererUpdate } from "../dbml/types";
import { VsixRendererHost } from "./vsix-renderer-host";

export interface RendererHostSourceEditCallbacks {
  onTableRenamed?: (args: unknown[]) => void;
  onColorPicked?: (args: unknown[]) => void;
  onSelectDiagramView?: (viewId: string | null) => void;
}

export class RendererHost {
  private renderer: VsixRendererHost;
  private latestUpdate: RendererUpdate = { database: null };

  constructor(container: HTMLElement, state: DiagramState, onSaveState: (state: DiagramState) => void, sourceEditCallbacks: RendererHostSourceEditCallbacks = {}) {
    this.renderer = new VsixRendererHost(container, state, { onSaveState, ...sourceEditCallbacks });
    this.renderer.setFeatureToggles(ENABLED_FEATURE_TOGGLES);
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
