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

// -- events ---------------------------------------------------------------------------------

/**
 * The whole tab list, not a diff: the list is short, and a diff is a bug surface the strip does
 * not need. Emitted on create, close, focus, navigate and every title change.
 */
export const onTabsChanged = (f: (tabs: Tab[]) => void): Promise<UnlistenFn> =>
  listen<Tab[]>("tabs:changed", (e) => f(e.payload));

/** Emitted whenever the selected module changes, whoever changed it. */
export const onLayoutChanged = (f: (module: string) => void): Promise<UnlistenFn> =>
  listen<{ module: string }>("layout:changed", (e) => f(e.payload.module));
