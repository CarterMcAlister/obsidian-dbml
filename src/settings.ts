import { App, PluginSettingTab, Setting } from "obsidian";
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
  rendererIsolation: "dom"
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

  }
}
