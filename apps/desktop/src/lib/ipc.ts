/**
 * The Rust surface, typed once — README section 3.5, the row that reads "`store_set` lost an
 * `undefined` argument at the IPC boundary".
 *
 * **Nothing else in this app imports `invoke`.** Two rules hold here and nowhere else:
 *
 *  1. `undefined` is rejected at the type level. Tauri serialises the argument object with
 *     `JSON.stringify`, which *drops* a key whose value is `undefined`; Rust then rejects the
 *     call with "missing required key", which is an argument error for what the caller meant as
 *     "nothing here". `Wire` has no `undefined` member, so `{ value: undefined }` does not
 *     typecheck and `null` is the only empty value that reaches the wire.
 *  2. The shell may be absent. The preview harness runs these modules in a plain browser, so
 *     `hasShell()` is the one question the stores ask; a command called without a shell rejects
 *     with a sentence rather than a `window.__TAURI_INTERNALS__` of undefined.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Everything JSON can spell, and nothing it cannot. `undefined` is deliberately not a member:
 * that omission is the whole of rule 1, and `src/lib/ipc.test.ts` asserts it still bites.
 */
export type Wire = null | boolean | number | string | Wire[] | { [key: string]: Wire };

/** The argument object of a command. Snake case, because Rust declares `rename_all`. */
export type Args = Record<string, Wire>;

/** Is a Tauri shell hosting this document? False in the preview harness and in any browser. */
export function hasShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * The one call. Every exported command below goes through it, so a change to how the app talks to
 * Rust — a timeout, a log line, a refusal vocabulary — has exactly one place to happen.
 *
 * Exported since c19 so a surface with a vocabulary of its own — `lib/bridge.ts` is the first —
 * can be its own file without importing `invoke`. Rule 1 above is why: the rule is about the
 * *boundary*, and this function is the boundary.
 */
export async function call<T>(command: string, args: Args = {}): Promise<T> {
  if (!hasShell()) {
    throw new Error(`no shell: ${command} needs the Tauri window (this is a plain browser)`);
  }
  return invoke<T>(command, args);
}

// -- tabs (c18) --------------------------------------------------------------------------------

/** One open tab, as Rust holds it. The tab list lives in `src-tauri/src/tabs.rs`; this mirrors. */
export interface Tab {
  id: number;
  /** The webview label, `page-<id>`. The UI needs it for nothing; a bug report that names the
   *  webview is worth the eight bytes. */
  label: string;
  url: string;
  title: string;
  focused: boolean;
}

export const tabsCreate = (url: string) => call<number>("tabs_create", { url });
export const tabsClose = (id: number) => call<void>("tabs_close", { id });
export const tabsFocus = (id: number) => call<void>("tabs_focus", { id });
export const tabsNavigate = (id: number, url: string) => call<void>("tabs_navigate", { id, url });
export const tabsList = () => call<Tab[]>("tabs_list");

// -- the selected module (c18) -------------------------------------------------------------------

/**
 * Which module the window is showing. Rust owns it because the window's rectangles depend on it
 * (`src-tauri/src/layout.rs`): the Browser module hands the area under the chrome to a page
 * webview and every other module keeps it.
 */
export const layoutModule = () => call<string>("layout_module");
export const layoutSelect = (module: string) => call<void>("layout_select", { module });

// -- the store (c21) ---------------------------------------------------------------------------

/**
 * The tables `src-tauri/src/store.rs` describes, in its order. Rust refuses any other name, and
 * this list is the same list — a table is added in both files or in neither.
 *
 * There is deliberately **no command per table**. One key/value surface over a described schema
 * is what lets c24, c25 and c27 add a module without adding a pair of Rust commands, and it is
 * the Rust half of the answer to "seven people editing one panel" (README section 9).
 */
export const STORE_TABLES = [
  "settings",
  "origins",
  "projects",
  "project_pages",
  "project_runs",
  "activity",
  "captures",
] as const;

export type StoreTable = (typeof STORE_TABLES)[number];

/**
 * A bounded read. `showing` and `total` are the two halves of `(showing N of M)`; Rust counts
 * the total through the same `WHERE` as the page, so the footer is never a guess.
 */
export interface StorePage<Row> {
  rows: Row[];
  showing: number;
  total: number;
}

/** What `captures_sweep` reports back. `bytes` is what the table holds once the sweep is done. */
export interface SweepResult {
  removed: number;
  freed: number;
  bytes: number;
  cap_bytes: number;
}

/**
 * The four raw store commands, plus the path and the sweep.
 *
 * These are the *wire*: a table name, a key, and `Wire` in and out. `lib/store.ts` is the layer
 * above them that knows what a row of each table looks like, and it is what a store imports.
 * Nothing here interprets a value, which is why `storeGetRow` is generic and unchecked: the
 * shell carries settings between the panel and the sidecar and reads none of them.
 */
export const storeGetRow = <T>(table: StoreTable, key: string) =>
  call<T | null>("store_get", { table, key });

/** Answers the key the row was written under — the only way an appended row learns its id. */
export const storeSetRow = (table: StoreTable, key: string, value: Wire) =>
  call<string>("store_set", { table, key, value });

export const storeListRows = <Row>(table: StoreTable, filter: Args = {}) =>
  call<StorePage<Row>>("store_list", { table, filter });

export const storeDeleteRow = (table: StoreTable, key: string) =>
  call<void>("store_delete", { table, key });

/** The store file itself, for the read-only line in Settings. */
export const storePath = () => call<string>("store_path");

/** `null` asks Rust for its own cap constant, which is the only place that number lives. */
export const capturesSweep = (capBytes: number | null = null) =>
  call<SweepResult>("captures_sweep", { cap_bytes: capBytes });

// -- the smoke (c23) ---------------------------------------------------------------------------

/**
 * What `ATHENA_SMOKE` armed this shell with, or `""`.
 *
 * `1` is the relay's claim and is made in Rust (`src-tauri/src/bridge.rs`); `turn` is the panel's
 * and is made here, because the thing under test is the run store and a second copy of the loop
 * written in Rust would be a test of the copy.
 */
export const smokeMode = () => call<string>("smoke_mode");

/**
 * One line of a smoke run, on the shell process's stdout — and, with a code, the end of the run.
 *
 * A `console.log` in a webview is not on this process's stdout, and stdout is what
 * `scripts/smoke.mjs` reads. Rust adds the `[smoke]` prefix, so every line in this repository has
 * the same shape whichever side of the IPC made the claim.
 */
export const smokeSay = (line: string, exit: number | null = null) =>
  call<void>("smoke_say", { line, exit });

// -- events ---------------------------------------------------------------------------------

/**
 * The other half of the boundary, exported for the same reason `call` is (c19): one subscription
 * helper, so every listener in the app unwraps the payload the same way and a file with its own
 * vocabulary never has to import `listen` for itself.
 */
export const on = <T>(event: string, f: (payload: T) => void): Promise<UnlistenFn> =>
  listen<T>(event, (e) => f(e.payload));

/**
 * The whole tab list, not a diff: the list is short, and a diff is a bug surface the strip does
 * not need. Emitted on create, close, focus, navigate and every title change.
 */
export const onTabsChanged = (f: (tabs: Tab[]) => void): Promise<UnlistenFn> =>
  listen<Tab[]>("tabs:changed", (e) => f(e.payload));

/** Emitted whenever the selected module changes, whoever changed it. */
export const onLayoutChanged = (f: (module: string) => void): Promise<UnlistenFn> =>
  listen<{ module: string }>("layout:changed", (e) => f(e.payload.module));
