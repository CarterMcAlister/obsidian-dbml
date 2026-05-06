# Obsidian DBML

DBML authoring, validation, generation, and diagram preview for Obsidian.

## Features

- Opens `.dbml` files as editable Obsidian documents.
- Renders interactive ER diagrams from `.dbml` files using the bundled dbdiagram VSIX renderer assets.
- Renders fenced Markdown code blocks using <code>```dbml</code> in Reading view.
- Optional Live Preview diagram widgets for fenced DBML blocks.
- DBML parse diagnostics through CodeMirror linting and preview error panels.
- Per-diagram visual state persistence using `.dbdiagram` sidecar files or plugin data.
- Generate DBML from Postgres, MySQL, SQL Server, or Snowflake connection strings.
- Enables all bundled renderer features locally without dbdiagram auth/API calls.
- Supports `DiagramView` blocks with a view dropdown in the preview.
- Adds `New database diagram` to folder/file context menus and the command palette.

## Development

```bash
bun install
bun run build
```

## Local Install

Copy the build output into a vault plugin folder such as `.obsidian/plugins/obsidian-dbml/`:

```bash
mkdir -p /path/to/Vault/.obsidian/plugins/obsidian-dbml
cp dist/main.js dist/manifest.json dist/styles.css /path/to/Vault/.obsidian/plugins/obsidian-dbml/
```

Then reload Obsidian and enable the plugin.

## Commands

- `DBML: New database diagram`
- `DBML: Open DBML preview to the side`
- `DBML: Generate DBML from Database Connection`
- `DBML: Reset DBML diagram state`
