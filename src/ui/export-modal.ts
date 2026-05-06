import { App, Modal, Notice, normalizePath, Setting, TFile } from "obsidian";
import type { DbmlExportFormat } from "../dbml/core";
import { DBML_EXPORT_FORMATS, exportDbmlSource, extensionForExportFormat, labelForExportFormat, normalizeDbmlSource } from "../dbml/export";
import { resolveActiveDbmlSource } from "../dbml/source";
import type { ResolvedDbmlSource } from "../dbml/types";
import type DbmlPlugin from "../main";

export class ExportDbmlModal extends Modal {
  private format: DbmlExportFormat;
  private includeRecords: boolean;
  private normalizedJson: boolean;
  private outputName = "";
  private source: ResolvedDbmlSource | null = null;

  constructor(private plugin: DbmlPlugin) {
    super(plugin.app);
    this.format = plugin.settings.exportDefaultFormat;
    this.includeRecords = plugin.settings.exportIncludeRecords;
    this.normalizedJson = plugin.settings.exportJsonNormalized;
  }

  async onOpen(): Promise<void> {
    this.source = await resolveActiveDbmlSource(this.app);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Export active DBML as SQL/JSON/normalized DBML" });
    if (!this.source) {
      contentEl.createEl("p", { text: "Open a .dbml file or place the cursor inside a fenced dbml block first." });
      new Setting(contentEl).addButton((button) => button.setButtonText("Close").onClick(() => this.close()));
      return;
    }
    this.outputName = defaultOutputName(this.source, this.format, { isNormalized: this.normalizedJson });

    contentEl.createEl("p", { text: `Source: ${this.source.ref.displayName}` });

    new Setting(contentEl)
      .setName("Export format")
      .addDropdown((dropdown) => {
        for (const format of DBML_EXPORT_FORMATS) dropdown.addOption(format, labelForExportFormat(format));
        dropdown.setValue(this.format).onChange((value) => {
          this.format = value as DbmlExportFormat;
          this.outputName = defaultOutputName(this.source, this.format, { isNormalized: this.normalizedJson });
          const input = contentEl.querySelector<HTMLInputElement>(".obsidian-dbml-export-output input");
          if (input) input.value = this.outputName;
        });
      });

    new Setting(contentEl)
      .setName("Include Records")
      .setDesc("Relevant for normalized DBML export.")
      .addToggle((toggle) => toggle.setValue(this.includeRecords).onChange((value) => this.includeRecords = value));

    new Setting(contentEl)
      .setName("Normalized JSON")
      .setDesc("When exporting JSON, output the normalized model instead of Database.export().")
      .addToggle((toggle) => toggle.setValue(this.normalizedJson).onChange((value) => {
        this.normalizedJson = value;
        this.outputName = defaultOutputName(this.source, this.format, { isNormalized: this.normalizedJson });
        const input = contentEl.querySelector<HTMLInputElement>(".obsidian-dbml-export-output input");
        if (input) input.value = this.outputName;
      }));

    const output = new Setting(contentEl)
      .setName("Output file name")
      .setDesc("Saved next to the active DBML source.")
      .addText((text) => text.setValue(this.outputName).onChange((value) => this.outputName = value));
    output.settingEl.addClass("obsidian-dbml-export-output");

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Export").setCta().onClick(() => void this.export()))
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async export(): Promise<void> {
    if (!this.source) return;
    const outputName = sanitizeOutputName(this.outputName);
    if (!outputName) {
      new Notice("Output file name is invalid.");
      return;
    }
    try {
      const options = { includeRecords: this.includeRecords, isNormalized: this.normalizedJson };
      const output = this.format === "dbml"
        ? normalizeDbmlSource(this.source.source, { includeRecords: this.includeRecords })
        : exportDbmlSource(this.source.source, this.format, options);
      const path = normalizePath(`${this.source.file.parent?.path === "/" ? "" : this.source.file.parent?.path || ""}/${outputName}`);
      if (!(await confirmOverwrite(this.app, path))) return;
      const file = await writeTextFile(this.app, path, output.endsWith("\n") ? output : `${output}\n`);
      await this.app.workspace.getLeaf(false).openFile(file);
      new Notice(`Exported ${path}`);
      this.close();
    } catch (error) {
      console.error("DBML export failed", error);
      new Notice(`Failed to export DBML: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function defaultOutputName(source: ResolvedDbmlSource | null, format: DbmlExportFormat, options: { isNormalized?: boolean }): string {
  const base = source?.file.basename || "schema";
  return `${base}.${extensionForExportFormat(format, options)}`;
}

function sanitizeOutputName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /[<>:"/\\|?*]/.test(trimmed)) return null;
  return trimmed;
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
