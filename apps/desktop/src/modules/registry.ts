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
 * One id is known outside this list: `browser`. Rust knows it too (`src-tauri/src/layout.rs`),
 * because the window's rectangles depend on which module is selected — the Browser module hands
 * the area under the chrome to a page webview and every other module keeps it.
 */
import type { ModuleEntry } from "./types";

import { entry as browser } from "./browser";
import { entry as connectors } from "./connectors";
import { entry as playbooks } from "./playbooks";
import { entry as setup } from "./setup";
import { entry as voice } from "./voice";

/** In bar order: what the window does, then what it is configured to be. The panel left for
 * Athena's own window (ADR 0026). Voice sits after Setup (ADR 0028): Setup's letter is the first
 * act and asks for the two things a turn cannot run without; her voice is optional, comes after
 * it, and is the narrower configuration — and appending it leaves every existing position where
 * a returning hand expects it. Playbooks sits beside the Browser (ADR 0040): it is the other
 * thing the window does — the chores worth starting — and it reads, so it belongs before the
 * configuration modules. */
export const MODULE_ENTRIES: readonly ModuleEntry[] = [browser, playbooks, connectors, setup, voice];

export const MODULE_REGISTRY: Readonly<Record<string, ModuleEntry>> = Object.fromEntries(
  MODULE_ENTRIES.map((m) => [m.id, m]),
);

/** The module the window comes up on, and the fallback for an id nothing answers to. */
export const DEFAULT_MODULE_ID = "browser";

export function isModuleId(id: string | null): boolean {
  return id !== null && id in MODULE_REGISTRY;
}

export function moduleFor(id: string | null): ModuleEntry {
  return MODULE_REGISTRY[isModuleId(id) ? (id as string) : DEFAULT_MODULE_ID];
}
