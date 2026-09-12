// Flat config for the bridge (README §7: `pnpm lint` is part of the gate).
//
// The config lives in the package rather than at the workspace root because pnpm's isolated
// node_modules only puts a package's own devDependencies on its resolution path, and `pnpm -r run
// lint` runs each package in its own directory. A root config nobody can resolve eslint from is a
// lint step that silently does nothing.
import js from "@eslint/js";

/** Globals a page script may read. inject.js is the only file that runs in a browser. */
const page = {
  window: "readonly",
  document: "readonly",
  location: "readonly",
  navigator: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  AbortController: "readonly",
  AbortSignal: "readonly",
  EventTarget: "readonly",
  Event: "readonly",
  TypeError: "readonly",
};

const node = {
  console: "readonly",
  process: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  queueMicrotask: "readonly",
  URL: "readonly",
};

export default [
  { ignores: ["node_modules/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      // Present in every JavaScript host the bridge runs in: a browser page, node, a webview.
      globals: { URL: "readonly", globalThis: "readonly" },
    },
    rules: {
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
    },
  },
  {
    // A classic script injected into a page, not a module the workspace imports.
    files: ["inject.js"],
    languageOptions: { sourceType: "script", globals: page },
  },
  {
    files: ["test/**/*.js", "eslint.config.js"],
    languageOptions: { globals: node },
  },
];
