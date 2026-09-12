/**
 * The Browser module's view-model — README section 3.5, "the browser is one module among them".
 *
 * The whole of what the surface is about: the tab list, which one is focused, and what can be
 * done to them. The page itself is not in here and never will be — it is a webview the Rust side
 * positions under the chrome (`src-tauri/src/layout.rs`), so the module renders a rectangle it
 * does not paint. That is the one thing this module has that no other module will, and it is
 * why the stand-in exists in the view.
 */
import type { Tab } from "@/lib/ipc";
import { hostOf } from "@/lib/url";

export interface BrowserTab {
  id: number;
  title: string;
  url: string;
  /** The host alone, for the strip: a chip is 11rem and an address is not. */
  host: string;
  focused: boolean;
}

export interface BrowserActions {
  open: (url: string) => void;
  focus: (id: number) => void;
  close: (id: number) => void;
  navigate: (id: number, url: string) => void;
}

export interface BrowserModel {
  tabs: readonly BrowserTab[];
  /** The one the page webview is showing, or null when nothing is open. */
  focused: BrowserTab | null;
  /**
   * A sentence when the tab list could not be read, null when it could. "Nothing here" and
   * "could not be read" are different facts and the view renders them differently.
   */
  problem: string | null;
  actions: BrowserActions;
}

/** A new tab starts blank; the address field is the way in. */
export const NEW_TAB_URL = "about:blank";

/**
 * The selector: the store snapshot in, the view-model out, and nothing else in the world. Pure,
 * so it is the piece a test can hold still — `model.test.ts` is the whole of what c18 asserts
 * about this module's behaviour.
 *
 * `loaded` is not a display state, it is a *fact*: before Rust has answered once, an empty list
 * means "nobody has asked yet", which is not "no tabs are open".
 */
export function selectBrowser(
  tabs: readonly Tab[],
  loaded: boolean,
  actions: BrowserActions,
): BrowserModel {
  const mapped: BrowserTab[] = tabs.map((t) => ({
    id: t.id,
    title: t.title || t.url,
    url: t.url,
    host: hostOf(t.url),
    focused: t.focused,
  }));
  return {
    tabs: mapped,
    focused: mapped.find((t) => t.focused) ?? null,
    problem: loaded ? null : "the shell has not answered tabs_list yet",
    actions,
  };
}
