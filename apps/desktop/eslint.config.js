// The panel's lint rules. Flat config, and deliberately short: what matters here is what a review
// cannot see at a glance — an unhandled promise, an `any` that erased a contract, a `console` left
// in a surface whose user cannot open a devtools window.
//
// Type-aware rules are scoped to `src/**/*.ts` and to nothing else. Pointing them at the config
// file or at the tests would need those in a tsconfig, and a lint setup that drags files into the
// build to satisfy itself is a lint setup that will be turned off.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["dist/**", "src-tauri/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["src/**/*.ts"],
  })),
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
    },
  },
  {
    files: ["test/**/*.js", "scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        globalThis: "readonly",
        Response: "readonly",
        ReadableStream: "readonly",
        TextEncoder: "readonly",
      },
    },
  },
];
