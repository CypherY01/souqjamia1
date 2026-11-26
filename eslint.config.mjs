// @ts-check
import js from "@eslint/js";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// Props whose value a person reads or hears.
const TEXT_PROPS =
  "/^(aria-label|aria-description|aria-placeholder|aria-roledescription|aria-valuetext|alt|title|placeholder|label)$/";
// Inline style keys tied to left/right. CSS files are checked by `pnpm check:css`.
const PHYSICAL_STYLE_KEYS =
  "/^(left|right|(margin|padding|border|scrollMargin|scrollPadding)(Left|Right).*|border(Top|Bottom)(Left|Right)Radius)$/";

export default defineConfig([
  globalIgnores([
    "**/node_modules/",
    "**/.next/",
    "**/coverage/",
    "**/next-env.d.ts",
    "docs/",
    "contracts/",
    "plan/",
    // Third-party Claude Code skills, not project code.
    ".claude/skills/",
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
  {
    // Task 1.5: no hard-coded UI strings (DEC30) and logical properties only (RTL, NFR02).
    files: ["apps/web/**/*.tsx"],
    rules: {
      // Text inside JSX goes through t() from @souq/i18n. Props are checked below.
      "react/jsx-no-literals": ["error", { noStrings: true, ignoreProps: true }],
      "no-restricted-syntax": [
        "error",
        {
          selector: `JSXAttribute[name.name=${TEXT_PROPS}] > Literal`,
          message: "User-visible text goes through t() from @souq/i18n (DEC30).",
        },
        {
          selector: `JSXAttribute[name.name=${TEXT_PROPS}] > JSXExpressionContainer > :matches(Literal[value=/\\S/], TemplateLiteral)`,
          message: "User-visible text goes through t() from @souq/i18n (DEC30).",
        },
        {
          selector: `JSXAttribute[name.name="style"] Property > Identifier.key[name=${PHYSICAL_STYLE_KEYS}]`,
          message: "Use logical properties (marginInlineStart, insetInlineEnd...), not left/right.",
        },
        {
          selector: `JSXAttribute[name.name="style"] Property[key.name=/^(textAlign|float|clear)$/] > Literal.value[value=/^(left|right)$/]`,
          message: "Use start/end instead of left/right.",
        },
      ],
    },
  },
]);
