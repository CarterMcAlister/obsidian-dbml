
# Obsidian DBML

DBML authoring, validation, generation, and diagram preview.

<img width="2096" height="1428" alt="dbml-screenshot" src="https://github.com/user-attachments/assets/2962fe29-7daf-49b3-b1d7-eb80e4aea00d" />

## Features

- Opens `.dbml` files as editable Obsidian documents.
- Renders interactive ER diagrams from `.dbml` files
- Renders fenced Markdown code blocks using <code>```dbml</code> in Reading view.
- Optional Live Preview diagram widgets for fenced DBML blocks.
- DBML parse diagnostics through CodeMirror linting and preview error panels.
- Per-diagram visual state persistence using `.dbdiagram` sidecar files or plugin data.
- Generate DBML from Postgres, MySQL, SQL Server, or Snowflake connection strings.
- Supports `DiagramView` blocks with a view dropdown in the preview.
- Adds `New database diagram` to folder/file context menus and the command palette.

## Development

```bash
bun install
bun run build
```

## Release

Create a tag that matches `package.json` and `src/manifest.json`, then push it to GitHub:

```bash
git tag 1.0.1
git push origin 1.0.1
```

The release workflow builds the plugin and uploads `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` to the GitHub release.

## Local Install

Copy the build output into a vault plugin folder such as `.obsidian/plugins/dbml/`:

```bash
mkdir -p /path/to/Vault/.obsidian/plugins/dbml
cp dist/main.js dist/manifest.json dist/styles.css /path/to/Vault/.obsidian/plugins/dbml/
```

Then reload Obsidian and enable the plugin.

## Commands

- `DBML: New database diagram`
- `DBML: Open DBML preview to the side`
- `DBML: Generate DBML from Database Connection`
- `DBML: Reset DBML diagram state`

## DBML workbench features

This plugin can now act as a local DBML workbench inside Obsidian:

- **Import DBML from SQL/SchemaRb/JSON**: paste or load active-file text and convert `postgres`, `mysql`, `mssql`, `snowflake`, `oracle`, `schemarb`, or `json` input to a new `.dbml` file.
- **Export active DBML as SQL/JSON/normalized DBML**: export the current `.dbml` file or active Markdown `dbml` fence to `postgres`, `mysql`, `mssql`, `oracle`, `json`, or normalized `dbml` next to the source. Existing files require overwrite confirmation.
- **Generate DBML from Database Connection** uses `@dbml/connector` to fetch schema JSON and `@dbml/core` `importer.generateDbml` before falling back to a conservative manual generator.
- **Visual preview edits** in the dedicated DBML preview pane can update source for implemented local actions: table rename, table/table-group color, best-effort ref creation, sticky notes, Records/data samples, and DiagramView operations. Markdown reading and Live Preview widgets are read-only by default.

### Renderer feature matrix

| Feature                        |             Preview pane |     Markdown reading |         Live Preview |
| ------------------------------ | -----------------------: | -------------------: | -------------------: |
| Dark mode, grid, detail levels |                      Yes |                  Yes |                  Yes |
| Table search                   |             Configurable |         Configurable |         Configurable |
| DiagramView switching          |                      Yes | Read-only by default | Read-only by default |
| Table rename                   | Configurable visual edit |       Off by default |       Off by default |
| Color edits                    | Configurable visual edit |       Off by default |       Off by default |
| Drag-to-create refs            | Configurable visual edit |       Off by default |       Off by default |
| Sticky note edit               | Configurable visual edit |       Off by default |       Off by default |
| Records/data sample edit       | Configurable visual edit |       Off by default |       Off by default |

Renderer Pro badges are disabled for local features; if a feature is not editable in the current context, its renderer flag is disabled instead.

### Import/export formats

Import supports `postgres`, `mysql`, `mssql`, `snowflake`, `oracle`, `schemarb`, and `json` through `@dbml/core`.

Export supports `postgres`, `mysql`, `mssql`, `oracle`, `json`, and normalized `dbml`. DBML export can omit Records with the `includeRecords` option; JSON export can use the normalized model or the default exported JSON form.

### Known SQL parser limitations

The SQL importers come from `@dbml/core` and inherit its parser limitations. In particular, unsupported or partial cases include many `ALTER TABLE` forms (`ADD`, `DROP`, `ALTER`, and `RENAME COLUMN`), `DROP TABLE`, `DROP INDEX`, `ALTER INDEX`, `CREATE VIEW`, `CREATE TABLE AS SELECT`, some Snowflake foreign-key/check forms, and known MSSQL column-level foreign-key edge cases. For best results, import canonical `CREATE TABLE`, `CREATE INDEX`, enum/type, and foreign-key DDL.

### Source-edit safety

Visual edits re-read and re-parse the current source before writing, update only the active `.dbml` file or Markdown fenced block, validate the generated DBML, and leave the file unchanged if a safe patch cannot be applied. Layout-only state continues to be stored in `.dbdiagram` sidecars or plugin data according to settings.
