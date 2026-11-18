// @ts-check
import js from "@eslint/js";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/node_modules/",
    "**/.next/",
    "**/coverage/",
    "**/next-env.d.ts",
    "docs/",
    "contracts/",
    "plan/",
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    extends: [nextCoreWebVitals],
    settings: { next: { rootDir: "apps/web" } },
  },
]);
