import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { mkdir, copyFile } from "node:fs/promises";

const prod = process.argv[2] === "production";
const watch = process.argv[2] === "--watch";

const banner = `/* obsidian-dbml */`;

await mkdir("dist", { recursive: true });

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    ...builtins,
    ...builtins.map((module) => `node:${module}`)
  ],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "dist/main.js",
  minify: prod,
  loader: {
    ".html": "text",
    ".css": "text",
    ".txt": "text"
  }
});

async function copyReleaseFiles() {
  await mkdir("dist", { recursive: true });
  await Promise.all([
    copyFile("src/manifest.json", "dist/manifest.json"),
    copyFile("src/styles.css", "dist/styles.css")
  ]);
}

if (watch) {
  await copyReleaseFiles();
  await context.watch();
  console.log("Watching for changes...");
} else {
  await context.rebuild();
  await copyReleaseFiles();
  await context.dispose();
}
