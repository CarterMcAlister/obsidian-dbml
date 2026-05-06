import { App, Modal, Notice, normalizePath, Setting, TFile } from "obsidian";
import type { DbmlImportFormat } from "../dbml/core";
import { DBML_IMPORT_FORMATS, importSourceToDbml, labelForImportFormat } from "../dbml/import";
import type DbmlPlugin from "../main";

export class ImportDbmlModal extends Modal {
  private format: DbmlImportFormat;
  private source = "";
  private sourceFilePath = "";
  private outputName = "imported-schema";
  private includeRecords = true;

  constructor(private plugin: DbmlPlugin) {
    super(plugin.app);
    this.format = plugin.settings.importDefaultDialect;
    this.includeRecords = plugin.settings.exportIncludeRecords;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Import DBML from SQL/SchemaRb/JSON" });

    new Setting(contentEl)
      .setName("Input format")
      .addDropdown((dropdown) => {
        for (const format of DBML_IMPORT_FORMATS) dropdown.addOption(format, labelForImportFormat(format));
        dropdown.setValue(this.format).onChange((value) => this.format = value as DbmlImportFormat);
      });

    new Setting(contentEl)
      .setName("Load active file text")
      .setDesc("Use the current active file as the import input.")
      .addButton((button) => button.setButtonText("Load active file").onClick(() => void this.loadActiveFile()));

    new Setting(contentEl)
      .setName("Load vault file")
      .setDesc("Enter a vault-relative path to a SQL, Schema.rb, or JSON file.")
      .addText((text) => text
        .setPlaceholder("schema.sql")
        .setValue(this.sourceFilePath)
        .onChange((value) => this.sourceFilePath = value))
      .addButton((button) => button.setButtonText("Load path").onClick(() => void this.loadSourceFilePath()));

    const sourceSetting = new Setting(contentEl)
      .setName("Source")
      .setDesc("Paste SQL, Schema.rb, or JSON here.")
      .addTextArea((text) => text
        .setPlaceholder("CREATE TABLE users (id int primary key);")
        .setValue(this.source)
        .onChange((value) => this.source = value));
    sourceSetting.settingEl.addClass("obsidian-dbml-import-source");
    const textarea = sourceSetting.controlEl.querySelector("textarea");
    textarea?.setAttr("spellcheck", "false");
    if (textarea) {
      textarea.style.minHeight = "220px";
      textarea.style.minWidth = "420px";
    }

    new Setting(contentEl)
      .setName("Include Records")
      .setDesc("Preserve records when the input format supports them.")
      .addToggle((toggle) => toggle.setValue(this.includeRecords).onChange((value) => this.includeRecords = value));

    new Setting(contentEl)
      .setName("Output file name")
      .setDesc("Saved as a .dbml file next to the active file or in the vault root.")
      .addText((text) => text.setValue(this.outputName).onChange((value) => this.outputName = value));

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Import").setCta().onClick(() => void this.import()))
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async loadActiveFile(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active file to load.");
      return;
    }
    this.source = await this.app.vault.read(file);
    const textarea = this.contentEl.querySelector<HTMLTextAreaElement>("textarea");
    if (textarea) textarea.value = this.source;
    new Notice(`Loaded ${file.path}`);
  }

  private async loadSourceFilePath(): Promise<void> {
    const path = normalizePath(this.sourceFilePath.trim());
    if (!path) {
      new Notice("Enter a vault-relative file path.");
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`File not found: ${path}`);
      return;
    }
    this.source = await this.app.vault.read(file);
    const textarea = this.contentEl.querySelector<HTMLTextAreaElement>("textarea");
    if (textarea) textarea.value = this.source;
    new Notice(`Loaded ${file.path}`);
  }

  private async import(): Promise<void> {
    const source = this.source.trim();
    if (!source) {
      new Notice("Import source cannot be empty.");
      return;
    }
    const outputName = sanitizeOutputName(this.outputName);
    if (!outputName) {
      new Notice("Output file name is invalid.");
      return;
    }
    try {
      const dbml = importSourceToDbml(source, this.format, { includeRecords: this.includeRecords });
      const path = outputPath(this.app, outputName.endsWith(".dbml") ? outputName : `${outputName}.dbml`);
      if (!(await confirmOverwrite(this.app, path))) return;
      const file = await writeTextFile(this.app, path, dbml.endsWith("\n") ? dbml : `${dbml}\n`);
      await this.app.workspace.getLeaf(false).openFile(file);
      new Notice(`Imported ${path}`);
      this.close();
    } catch (error) {
      console.error("DBML import failed", error);
      new Notice(`Failed to import DBML: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function sanitizeOutputName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /[<>:"/\\|?*]/.test(trimmed)) return null;
  return trimmed;
}

function outputPath(app: App, filename: string): string {
  const folder = app.workspace.getActiveFile()?.parent || app.vault.getRoot();
  return normalizePath(`${folder.path === "/" ? "" : folder.path}/${filename}`);
}

async function confirmOverwrite(app: App, path: string): Promise<boolean> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (!(existing instanceof TFile)) return true;
  return window.confirm(`${path} already exists. Overwrite it?`);
}

async function writeTextFile(app: App, path: string, content: string): Promise<TFile> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
    return existing;
  }
  return app.vault.create(path, content);
}
