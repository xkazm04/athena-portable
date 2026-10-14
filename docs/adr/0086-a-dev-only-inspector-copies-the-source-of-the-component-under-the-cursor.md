# 0086. A dev-only inspector copies the source of the component under the cursor

## Context

The shell is two webviews with many small components. Pointing an agent at "the card in the
welcome" costs a grep each time. The reference app solved this with a dev overlay, but React 19
removed the Fiber `_debugSource` that click-to-component tools read.

## Decision

`scripts/dev-source-loc.mjs` is a Vite plugin that stamps host JSX elements with
`data-loc="src/...:LINE:COL"`. It runs only on the dev server and only when `ATHENA_INSPECTOR=1`
(`pnpm dev:inspect`, `pnpm tauri:inspect`). `src/lib/dev/inspector.tsx` reads the stamps from the
DOM. Ctrl+Shift+L, or `;` then `i`, arms it; right-click copies the call site (the first file
outside `src/components`, `src/lib`, `src/stores`), Alt+right-click the literal element, Esc
disarms. Both windows mount it behind `import.meta.env.DEV`. Left-click is untouched so the app
stays usable while armed.

## Consequences

- A build carries neither the stamp nor the overlay; a normal dev session pays nothing.
- Components (`<Button>`) are not stamped, so a click lands on their root host element and the
  call-site rule walks up to the file that used them.
- Without the flag the HUD says how to relaunch instead of failing silently.
- `@babel/core` and `cross-env` are dev dependencies of the desktop package.
