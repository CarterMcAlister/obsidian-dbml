import type { DbmlPluginSettings } from "../settings";
import type { FeatureToggles } from "./types";

export type RendererContext = "preview" | "markdown" | "live-preview";

export interface RendererProTagConfig {
  stickyNote: boolean;
  detailLevel: boolean;
  tableSearchPanelTableGroup: boolean;
  colorHeader: boolean;
}

export interface RendererFeatureConfig {
  featuresToggle: FeatureToggles;
  shouldShowProTag: RendererProTagConfig;
  editableStickyNote: boolean;
  shouldShowStickyNoteToolbar: boolean;
  canEditNote: boolean;
}

const NO_PRO_TAGS: RendererProTagConfig = {
  stickyNote: false,
  detailLevel: false,
  tableSearchPanelTableGroup: false,
  colorHeader: false
};

export const ENABLED_FEATURE_TOGGLES: FeatureToggles = {
  darkMode: true,
  colorHeader: true,
  colorPicker: true,
  dragAndDrop: true,
  tableGroup: true,
  detailLevelsEnabled: true,
  stickyNote: true,
  tableSearch: true,
  diagramView: true,
  diagramViewRestricted: false,
  tableRename: true,
  dbmlEditEnabled: true
};

export function rendererFeatureConfig(context: RendererContext, settings: DbmlPluginSettings): RendererFeatureConfig {
  const visualEdits = settings.visualSourceEdits && context === "preview";
  const featuresToggle: FeatureToggles = {
    darkMode: true,
    colorHeader: true,
    colorPicker: visualEdits,
    dragAndDrop: visualEdits && settings.enableRendererDragRefCreation,
    tableGroup: true,
    detailLevelsEnabled: true,
    stickyNote: visualEdits && settings.enableRendererStickyNotes,
    tableSearch: settings.enableRendererTableSearch,
    diagramView: settings.enableRendererDiagramViews,
    diagramViewRestricted: context !== "preview" || !visualEdits,
    tableRename: visualEdits,
    dbmlEditEnabled: visualEdits && settings.enableRendererRecordsEditing
  };
  return {
    featuresToggle,
    shouldShowProTag: { ...NO_PRO_TAGS },
    editableStickyNote: featuresToggle.stickyNote,
    shouldShowStickyNoteToolbar: featuresToggle.stickyNote,
    canEditNote: visualEdits
  };
}
