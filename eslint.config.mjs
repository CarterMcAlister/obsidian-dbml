import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs", "esbuild.config.mjs", "scripts/*.ts"]
        },
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-misused-promises": ["error", {
        checksVoidReturn: {
          inheritedMethods: false
        }
      }]
    }
  },
  {
    files: ["src/preview/vsix-renderer-host.ts"],
    rules: {
      "obsidianmd/prefer-create-el": "off",
      "obsidianmd/prefer-active-doc": "off",
      "obsidianmd/no-static-styles-assignment": "off"
    }
  },
  {
    files: ["esbuild.config.mjs", "scripts/**/*.ts"],
    rules: {
      "no-console": "off",
      "obsidianmd/rule-custom-message": "off"
    }
  },
  globalIgnores([
    "dist",
    "node_modules",
    ".tmp-vsix",
    "assets/renderer",
    "fixtures",
    "plans",
    "reference",
    "bun.lock"
  ])
);
