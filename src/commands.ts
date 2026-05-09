import { Modal, normalizePath, Notice, Setting, TAbstractFile, TFile, TFolder } from "obsidian";
import type DbmlPlugin from "./main";
import { resolveActiveDbmlSource } from "./dbml/source";
import { normalizeDbmlSource } from "./dbml/export";
import { ConnectionModal } from "./ui/connection-modal";
import { ExportDbmlModal } from "./ui/export-modal";
import { ImportDbmlModal } from "./ui/import-modal";

export function registerCommands(plugin: DbmlPlugin): void {
  plugin.registerEvent(plugin.app.workspace.on("file-menu", (menu, file) => {
    const folder = folderForMenuTarget(file);
    menu.addItem((item) => item
      .setTitle("New database diagram")
      .setIcon("layout-dashboard")
      .onClick(() => void createDatabaseDiagram(plugin, folder.path)));
  }));

  plugin.addCommand({
    id: "new-database-diagram",
    name: "New database diagram",
    callback: () => void createDatabaseDiagram(plugin, plugin.app.workspace.getActiveFile()?.parent?.path || "")
  });

  plugin.addCommand({
    id: "open-preview-to-side",
    name: "Open database diagram preview to the side",
    checkCallback: (checking) => {
      const activeFile = plugin.app.workspace.getActiveFile();
      if (!activeFile || !["dbml", "md"].includes(activeFile.extension.toLowerCase())) return false;
      if (!checking) void plugin.openPreviewForActiveSource(activeFile);
      return true;
    }
  });

  plugin.addCommand({
    id: "generate-from-database-connection",
    name: "Generate from database connection",
    callback: () => {
      if (!plugin.settings.enableDatabaseGeneration) {
        new Notice("Database generation is disabled in settings.");
        return;
      }
      new ConnectionModal(plugin.app).open();
    }
  });

  plugin.addCommand({
    id: "import-from-sql-schemarb-json",
    name: "Import from SQL, schema.rb, or JSON",
    callback: () => new ImportDbmlModal(plugin).open()
  });

  plugin.addCommand({
    id: "export-active-source",
    name: "Export active source",
    callback: () => new ExportDbmlModal(plugin).open()
  });

  plugin.addCommand({
    id: "normalize-active-source",
    name: "Normalize active source into a new file",
    callback: () => void normalizeActiveDbml(plugin)
  });

  plugin.addCommand({
    id: "reset-diagram-state",
    name: "Reset diagram state",
    callback: async () => {
      const source = await resolveActiveDbmlSource(plugin.app);
      if (!source) {
        new Notice("Open a .dbml file or place the cursor inside a fenced dbml block.");
        return;
      }
      await plugin.stateStore.delete(source.ref);
      new Notice("Diagram state reset.");
    }
  });
}

async function normalizeActiveDbml(plugin: DbmlPlugin): Promise<void> {
  try {
    const source = await resolveActiveDbmlSource(plugin.app);
    if (!source) {
      new Notice("Open a .dbml file or place the cursor inside a fenced dbml block.");
      return;
    }
    const normalized = normalizeDbmlSource(source.source, { includeRecords: plugin.settings.exportIncludeRecords });
    const folder = source.file.parent?.path || "";
    const baseName = source.file.basename || "schema";
    const path = uniquePath(plugin, normalizePath(`${folder === "/" ? "" : folder}/${baseName}.normalized.dbml`));
    const file = await plugin.app.vault.create(path, normalized.endsWith("\n") ? normalized : `${normalized}\n`);
    await plugin.app.workspace.getLeaf(false).openFile(file);
    new Notice(`Normalized ${path}`);
  } catch (error) {
    console.error("DBML normalization failed", error);
    new Notice(`Failed to normalize DBML: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function createDatabaseDiagram(plugin: DbmlPlugin, folderPath: string): Promise<void> {
  try {
    const enteredName = await requestDatabaseDiagramName(plugin);
    if (!enteredName) return;
    const safeName = enteredName.trim().replace(/\.dbml$/i, "");
    if (!safeName || /[<>:"/\\|?*]/.test(safeName)) {
      new Notice("Invalid database diagram name.");
      return;
    }
    const basePath = diagramPath(folderPath, safeName);
    const path = uniquePath(plugin, basePath);
    const file = await plugin.app.vault.create(path, defaultDbmlTemplate(safeName));
    const leaf = plugin.app.workspace.getLeaf(true);
    await leaf.openFile(file);
    new Notice(`Created ${path}`);
  } catch (error) {
    console.error("DBML: failed to create database diagram", error);
    new Notice(`Failed to create database diagram: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requestDatabaseDiagramName(plugin: DbmlPlugin): Promise<string | null> {
  return new Promise((resolve) => new NewDatabaseDiagramModal(plugin, resolve).open());
}

class NewDatabaseDiagramModal extends Modal {
  private value = "schema";
  private submitted = false;

  constructor(plugin: DbmlPlugin, private resolveName: (name: string | null) => void) {
    super(plugin.app);
  }

  onOpen(): void {
    this.setTitle("New database diagram");
    this.contentEl.empty();

    new Setting(this.contentEl)
      .setName("Diagram name")
      .setDesc("Creates a .dbml file in the selected folder.")
      .addText((text) => {
        text
          .setPlaceholder("Schema")
          .setValue(this.value)
          .onChange((value) => {
            this.value = value;
          });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          this.submit();
        });
        activeWindow.setTimeout(() => {
          text.inputEl.focus();
          text.inputEl.select();
        });
      });

    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText("Create")
        .setCta()
        .onClick(() => this.submit()))
      .addButton((button) => button
        .setButtonText("Cancel")
        .onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.submitted) this.resolveName(null);
  }

  private submit(): void {
    const name = this.value.trim();
    if (!name) {
      new Notice("Enter a database diagram name.");
      return;
    }
    this.submitted = true;
    this.resolveName(name);
    this.close();
  }
}

function uniquePath(plugin: DbmlPlugin, path: string): string {
  if (!plugin.app.vault.getAbstractFileByPath(path)) return path;
  const withoutExt = path.replace(/\.dbml$/i, "");
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${withoutExt} ${index}.dbml`;
    if (!plugin.app.vault.getAbstractFileByPath(candidate)) return candidate;
  }
  throw new Error("Could not create a unique DBML file name.");
}

function diagramPath(folderPath: string, safeName: string): string {
  const folder = folderPath === "/" ? "" : folderPath;
  return normalizePath([folder, `${safeName}.dbml`].filter(Boolean).join("/"));
}

function folderForMenuTarget(file: TAbstractFile): TFolder {
  if (file instanceof TFolder) return file;
  if (file instanceof TFile && file.parent) return file.parent;
  return file.vault.getRoot();
}

function defaultDbmlTemplate(name: string): string {
  return `Project ${quoteIdentifier(name)} {\n  database_type: 'PostgreSQL'\n}\n\nDiagramView Default {\n  *\n}\n\nTable users {\n  id int [primary key]\n  created_at timestamp\n}\n`;
}

function quoteIdentifier(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : `"${value.replace(/"/g, "\\\"")}"`;
}
