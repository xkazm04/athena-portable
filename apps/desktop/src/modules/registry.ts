/**
 * Every module, in one list — README section 3.5 ("module-first window from the start").
 *
 * Two consumers and no others: `src/app.tsx`, which renders the bar and the selected module, and
 * `src/preview.tsx`, which renders one module against one fixture in a plain browser. Both go
 * through `ModuleEntry`, so neither knows any module's view-model type.
 *
 * Adding a module is one line here plus its directory. Nothing else in the app enumerates them,
 * which is what keeps a merge between two module authors to one line of conflict.
 *
 * Two ids are known outside this list. `browser` is Rust's too (`src-tauri/src/layout.rs`),
 * because the window's rectangles depend on which module is selected — the Browser module hands
 * the area under the chrome to a page webview and every other module keeps it. `panel` is the
 * launch module, spelled here, in `layout.rs` and in `stores/shell.ts`, and all three must agree.
 */
import { DEFAULT_MODULE_ID, type ModuleEntry } from "./types";

import { entry as browser } from "./browser";
import { entry as origins } from "./origins";
import { entry as panel } from "./panel";
import { entry as settings } from "./settings";
import { entry as setup } from "./setup";

/** In bar order: what the window does, then what it is configured to be. */
export const MODULE_ENTRIES: readonly ModuleEntry[] = [panel, browser, origins, settings, setup];

export const MODULE_REGISTRY: Readonly<Record<string, ModuleEntry>> = Object.fromEntries(
  MODULE_ENTRIES.map((m) => [m.id, m]),
);

/**
 * The launch module, the fallback for an id nothing answers to, and the harness's own default.
 *
 * Declared in `./types` and re-exported here so the list and the default read as one thing; see
 * that file for why it cannot be declared beside the list.
 */
export { DEFAULT_MODULE_ID };

export function isModuleId(id: string | null): boolean {
  return id !== null && id in MODULE_REGISTRY;
}

export function moduleFor(id: string | null): ModuleEntry {
  return MODULE_REGISTRY[isModuleId(id) ? (id as string) : DEFAULT_MODULE_ID];
}
