import { App, Modal, Notice, normalizePath, Setting, TFile } from "obsidian";
import { connectionPlaceholder, DATABASE_TYPES, DatabaseType, generateDbmlFromConnection } from "../dbml/generator";

export class ConnectionModal extends Modal {
  private databaseType: DatabaseType = "postgres";
  private connection = "";
  private outputName = "my-database";

  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Generate from database connection");

    new Setting(contentEl)
      .setName("Database type")
      .addDropdown((dropdown) => {
        for (const type of DATABASE_TYPES) dropdown.addOption(type, labelForType(type));
        dropdown.setValue(this.databaseType).onChange((value) => {
          this.databaseType = value as DatabaseType;
          const textarea = contentEl.querySelector<HTMLTextAreaElement>(".obsidian-dbml-connection textarea");
          if (textarea) textarea.placeholder = connectionPlaceholder(this.databaseType);
        });
      });

    const connectionInput = new Setting(contentEl)
      .setName("Connection string")
      .setDesc("Connection strings are used once and are never saved.")
      .addTextArea((text) => text
        .setPlaceholder(connectionPlaceholder(this.databaseType))
        .setValue(this.connection)
        .onChange((value) => this.connection = value));
    connectionInput.settingEl.addClass("obsidian-dbml-connection");
    connectionInput.controlEl.querySelector("textarea")?.setAttr("spellcheck", "false");

    new Setting(contentEl)
      .setName("Output file name")
      .setDesc("Saved as a .dbml file in the active folder or vault root.")
      .addText((text) => text
        .setPlaceholder("Database")
        .setValue(this.outputName)
        .onChange((value) => this.outputName = value));

    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText("Generate")
        .setCta()
        .onClick(() => void this.generate()))
      .addButton((button) => button
        .setButtonText("Cancel")
        .onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async generate(): Promise<void> {
    const connection = this.connection.trim();
    if (!connection) {
      new Notice("Connection string cannot be empty.");
      return;
    }
    const outputName = this.sanitizeOutputName(this.outputName);
    if (!outputName) {
      new Notice("Output file name is invalid.");
      return;
    }
    try {
      new Notice("Generating from database...");
      const dbml = await generateDbmlFromConnection(connection, this.databaseType);
      const folder = this.app.workspace.getActiveFile()?.parent || this.app.vault.getRoot();
      const path = normalizePath(`${folder.path === "/" ? "" : folder.path}/${outputName.endsWith(".dbml") ? outputName : `${outputName}.dbml`}`);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) await this.app.vault.modify(existing, dbml);
      else await this.app.vault.create(path, dbml);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
      new Notice(`Generated ${path}`);
      this.close();
    } catch (error) {
      new Notice(`Failed to generate DBML: ${error instanceof Error ? error.message : String(error)}`);
      console.error("DBML generation failed", error);
    }
  }

  private sanitizeOutputName(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed || /[<>:"/\\|?*]/.test(trimmed)) return null;
    return trimmed;
  }
}

function labelForType(type: DatabaseType): string {
  switch (type) {
    case "postgres": return "PostgreSQL";
    case "mysql": return "MySQL";
    case "mssql": return "SQL Server";
    case "snowflake": return "Snowflake";
  }
}
