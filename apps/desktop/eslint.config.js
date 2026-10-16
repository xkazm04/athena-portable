import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  // Build output is not source: `dist` is `pnpm build`'s, `dist-perf` is the perf gate's
  // (`scripts/perf-gate.mjs` builds into it), and both are gitignored but not ignored by ESLint.
  { ignores: ["dist", "dist-perf", "src-tauri"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
