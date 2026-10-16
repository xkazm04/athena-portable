import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  // Build output is not source: `dist` is `pnpm build`'s, `dist-perf` is the perf gate's
  // (`scripts/perf-gate.mjs` builds into it), and both are gitignored but not ignored by ESLint.
  // Of `src-tauri`, only what Cargo and tauri-build write is skipped: `src-tauri/src` holds the
  // page-world hands script and its test, which are source like any other.
  { ignores: ["dist", "dist-perf", "src-tauri/target", "src-tauri/gen"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  // Plain JavaScript (the build and gate scripts, this file, the hands script) gets the
  // recommended rules too; without this block ESLint parsed these files and judged them by none.
  // Node and browser globals both: the scripts run in Node and hand functions to a page.
  {
    extends: [js.configs.recommended],
    files: ["**/*.{js,mjs}"],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.node, ...globals.browser } },
  },
);
