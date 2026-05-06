import { App, PluginSettingTab, Setting } from "obsidian";
import type { DbmlExportFormat, DbmlImportFormat } from "./dbml/core";
import type DbmlPlugin from "./main";

export interface DbmlPluginSettings {
  renderMarkdownCodeBlocks: boolean;
  renderLivePreviewWidgets: boolean;
  defaultPreviewHeight: number;
  followObsidianTheme: boolean;
  defaultDarkMode: boolean;
  defaultGridEnabled: boolean;
  defaultDetailLevel: "All" | "Table names" | "Keys only";
  stateStorage: "sidecar" | "plugin-data";
  showSourceBelowMarkdownPreview: boolean;
  enableDatabaseGeneration: boolean;
  rendererIsolation: "iframe" | "dom";
  visualSourceEdits: boolean;
  visualEditsInMarkdown: boolean;
  visualEditsInLivePreview: boolean;
  enableRendererDragRefCreation: boolean;
  enableRendererStickyNotes: boolean;
  enableRendererRecordsEditing: boolean;
  enableRendererTableSearch: boolean;
  enableRendererDiagramViews: boolean;
  importDefaultDialect: DbmlImportFormat;
  exportDefaultFormat: DbmlExportFormat;
  exportIncludeRecords: boolean;
  exportJsonNormalized: boolean;
}

export const DEFAULT_SETTINGS: DbmlPluginSettings = {
  renderMarkdownCodeBlocks: true,
  renderLivePreviewWidgets: false,
  defaultPreviewHeight: 600,
  followObsidianTheme: true,
  defaultDarkMode: false,
  defaultGridEnabled: false,
  defaultDetailLevel: "All",
  stateStorage: "sidecar",
  showSourceBelowMarkdownPreview: false,
  enableDatabaseGeneration: true,
  rendererIsolation: "dom",
  visualSourceEdits: true,
  visualEditsInMarkdown: false,
  visualEditsInLivePreview: false,
  enableRendererDragRefCreation: true,
  enableRendererStickyNotes: true,
  enableRendererRecordsEditing: true,
  enableRendererTableSearch: true,
  enableRendererDiagramViews: true,
  importDefaultDialect: "postgres",
  exportDefaultFormat: "postgres",
  exportIncludeRecords: true,
  exportJsonNormalized: true
};

export class DbmlSettingTab extends PluginSettingTab {
  plugin: DbmlPlugin;

  constructor(app: App, plugin: DbmlPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "DBML" });

    new Setting(containerEl)
      .setName("Render DBML code blocks")
      .setDesc("Render fenced dbml blocks in Reading view.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.renderMarkdownCodeBlocks).onChange(async (value) => {
        this.plugin.settings.renderMarkdownCodeBlocks = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Render Live Preview widgets")
      .setDesc("Show rendered DBML diagrams below fenced dbml blocks while editing. Disable this for very large notes.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.renderLivePreviewWidgets).onChange(async (value) => {
        this.plugin.settings.renderLivePreviewWidgets = value;
        await this.plugin.saveSettings();
        this.app.workspace.updateOptions();
      }));

    new Setting(containerEl)
      .setName("Default preview height")
      .setDesc("Height in pixels for Markdown and Live Preview diagrams.")
      .addText((text) => text
        .setPlaceholder("600")
        .setValue(String(this.plugin.settings.defaultPreviewHeight))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed) && parsed >= 200) {
            this.plugin.settings.defaultPreviewHeight = parsed;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName("Follow Obsidian theme")
      .setDesc("Automatically switch diagram dark mode with Obsidian's current theme.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.followObsidianTheme).onChange(async (value) => {
        this.plugin.settings.followObsidianTheme = value;
        await this.plugin.saveSettings();
        this.plugin.broadcastTheme();
      }));

    new Setting(containerEl)
      .setName("Default dark mode")
      .setDesc("Used when not following Obsidian theme.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.defaultDarkMode).onChange(async (value) => {
        this.plugin.settings.defaultDarkMode = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Default grid")
      .setDesc("Enable the diagram grid for new diagrams.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.defaultGridEnabled).onChange(async (value) => {
        this.plugin.settings.defaultGridEnabled = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Default detail level")
      .setDesc("Initial field visibility for new diagram states.")
      .addDropdown((dropdown) => dropdown
        .addOptions({ All: "All fields", "Table names": "Table names", "Keys only": "Keys only" })
        .setValue(this.plugin.settings.defaultDetailLevel)
        .onChange(async (value) => {
          this.plugin.settings.defaultDetailLevel = value as DbmlPluginSettings["defaultDetailLevel"];
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("State storage")
      .setDesc("Sidecar stores .dbdiagram files next to .dbml files. Plugin data stores everything in the plugin data file.")
      .addDropdown((dropdown) => dropdown
        .addOptions({ sidecar: "Sidecar files", "plugin-data": "Plugin data" })
        .setValue(this.plugin.settings.stateStorage)
        .onChange(async (value) => {
          this.plugin.settings.stateStorage = value as DbmlPluginSettings["stateStorage"];
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Show source below rendered blocks")
      .setDesc("Add a collapsed source toggle below rendered Markdown DBML diagrams.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.showSourceBelowMarkdownPreview).onChange(async (value) => {
        this.plugin.settings.showSourceBelowMarkdownPreview = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Database generation")
      .setDesc("Enable Generate DBML from Database Connection. Connection strings are never saved.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.enableDatabaseGeneration).onChange(async (value) => {
        this.plugin.settings.enableDatabaseGeneration = value;
        await this.plugin.saveSettings();
      }));

    containerEl.createEl("h3", { text: "Import/export defaults" });

    new Setting(containerEl)
      .setName("Default import dialect")
      .addDropdown((dropdown) => dropdown
        .addOptions({ postgres: "PostgreSQL", mysql: "MySQL", mssql: "SQL Server", snowflake: "Snowflake", oracle: "Oracle", schemarb: "Schema.rb", json: "JSON" })
        .setValue(this.plugin.settings.importDefaultDialect)
        .onChange(async (value) => {
          this.plugin.settings.importDefaultDialect = value as DbmlPluginSettings["importDefaultDialect"];
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Default export format")
      .addDropdown((dropdown) => dropdown
        .addOptions({ postgres: "PostgreSQL SQL", mysql: "MySQL SQL", mssql: "SQL Server SQL", oracle: "Oracle SQL", json: "JSON", dbml: "Normalized DBML" })
        .setValue(this.plugin.settings.exportDefaultFormat)
        .onChange(async (value) => {
          this.plugin.settings.exportDefaultFormat = value as DbmlPluginSettings["exportDefaultFormat"];
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Include Records in DBML export")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.exportIncludeRecords).onChange(async (value) => {
        this.plugin.settings.exportIncludeRecords = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Export normalized JSON by default")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.exportJsonNormalized).onChange(async (value) => {
        this.plugin.settings.exportJsonNormalized = value;
        await this.plugin.saveSettings();
      }));

    containerEl.createEl("h3", { text: "Advanced renderer features" });

    new Setting(containerEl)
      .setName("Visual source edits")
      .setDesc("Allow the preview renderer to update DBML source for implemented visual actions.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.visualSourceEdits).onChange(async (value) => {
        this.plugin.settings.visualSourceEdits = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Visual edits in Markdown reading view")
      .setDesc("Off by default so rendered Markdown blocks remain read-only.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.visualEditsInMarkdown).onChange(async (value) => {
        this.plugin.settings.visualEditsInMarkdown = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Visual edits in Live Preview")
      .setDesc("Off by default for editor performance and source safety.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.visualEditsInLivePreview).onChange(async (value) => {
        this.plugin.settings.visualEditsInLivePreview = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Renderer table search")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.enableRendererTableSearch).onChange(async (value) => {
        this.plugin.settings.enableRendererTableSearch = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Renderer DiagramViews")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.enableRendererDiagramViews).onChange(async (value) => {
        this.plugin.settings.enableRendererDiagramViews = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Drag-to-create refs")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.enableRendererDragRefCreation).onChange(async (value) => {
        this.plugin.settings.enableRendererDragRefCreation = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Editable sticky notes")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.enableRendererStickyNotes).onChange(async (value) => {
        this.plugin.settings.enableRendererStickyNotes = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Records/data sample editing")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.enableRendererRecordsEditing).onChange(async (value) => {
        this.plugin.settings.enableRendererRecordsEditing = value;
        await this.plugin.saveSettings();
      }));
  }
}
