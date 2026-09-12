/**
 * The shell, as the panel talks to it (README §3.1 surfaces; `src-tauri/src/lib.rs`).
 *
 * Every Tauri `invoke` in this application goes through this file, and the reason is the automation
 * seam of README §3.5: a module has to render in `preview.html` with no Tauri at all, and the
 * headless run-loop test has to drive the loop with no window. So the panel depends on a
 * {@link ShellPort} and something binds it — the real commands inside the window, a detached stub
 * in the preview, a fake in the test.
 *
 * The port is also where the panel's one privilege lives. `pageCall` runs a tool on the page, and
 * it is called in exactly one place: the run loop, on a `tool.call` the gate already allowed or an
 * instruction from a resolved approval. Nothing else in the panel may reach it.
 */

import type { HostPort } from "../stores/run.js";

export interface DaemonHandshake {
  kind: string;
  url: string;
  port: number;
  token: string;
  version: string;
  pid: number;
}

export interface TabRow {
  label: string;
  url: string;
  title: string;
  app_id: string | null;
  session_id: string | null;
  tool_count: number;
}

export interface ShellSettings {
  engine: string;
  model: string;
  brain_root: string;
  window_width: number;
  window_height: number;
  home_url: string;
  tabs: string[];
}

/** A page's answer to `list`, as `inject.js` shapes it (packages/athena-bridge/protocol.md). */
export interface PageListing {
  ok: boolean;
  page?: Record<string, unknown>;
  tools?: Array<Record<string, unknown>>;
  error?: string;
  reason?: string;
}

export interface CallAnswer {
  ok: boolean;
  output: string;
  error?: string | null;
}

export interface ShellPort {
  daemonAddress(): Promise<DaemonHandshake>;
  tabList(): Promise<TabRow[]>;
  tabOpen(url: string): Promise<TabRow>;
  tabClose(label: string): Promise<TabRow | null>;
  tabActivate(label: string): Promise<boolean>;
  tabRegistered(
    label: string,
    appId: string,
    sessionId: string,
    toolCount: number,
  ): Promise<boolean>;
  hostState(): Promise<Record<string, unknown>>;
  pageList(label: string): Promise<PageListing>;
  pageCall(label: string, name: string, input: Record<string, unknown>): Promise<CallAnswer>;
  settingsGet(): Promise<ShellSettings>;
  settingsSet(settings: ShellSettings): Promise<ShellSettings>;
  /** Fires when a page's registry moves and the panel should re-run `list`. */
  onToolChange(handler: (label: string) => void): Promise<() => void>;
}

interface TauriGlobal {
  core: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
  event: {
    listen: (
      name: string,
      handler: (event: { payload: unknown }) => void,
    ) => Promise<() => void>;
  };
}

function tauriGlobal(): TauriGlobal | null {
  const found = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  return found && found.core ? found : null;
}

/** `true` when the panel is running inside the shell rather than in a preview tab. */
export function inShell(): boolean {
  return tauriGlobal() !== null;
}

/** The real port. Every method is one command in `src-tauri/src/lib.rs`. */
export function shellPort(): ShellPort {
  const tauri = tauriGlobal();
  if (!tauri) throw new Error("the panel is not running inside the shell");
  const call = <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
    tauri.core.invoke(command, args) as Promise<T>;

  return {
    daemonAddress: () => call<DaemonHandshake>("daemon_address"),
    tabList: () => call<TabRow[]>("tab_list"),
    tabOpen: (url) => call<TabRow>("tab_open", { url }),
    tabClose: (label) => call<TabRow | null>("tab_close", { label }),
    tabActivate: (label) => call<boolean>("tab_activate", { label }),
    tabRegistered: (label, appId, sessionId, toolCount) =>
      call<boolean>("tab_registered", {
        label,
        appId,
        sessionId,
        toolCount,
      }),
    hostState: () => call<Record<string, unknown>>("host_state"),
    pageList: (label) => call<PageListing>("page_list", { label }),
    pageCall: (label, name, input) => call<CallAnswer>("page_call", { label, name, input }),
    settingsGet: () => call<ShellSettings>("settings_get"),
    settingsSet: (settings) => call<ShellSettings>("settings_set", { settings }),
    onToolChange: (handler) =>
      tauri.event.listen("page:toolchange", (event) => handler(String(event.payload))),
  };
}

/**
 * The page, as the run loop reaches it: the active tab's label, resolved at call time.
 *
 * Resolved at call time rather than captured, because the user can switch tabs between two calls
 * of one turn and the gate pinned the turn to an application, not to a webview.
 */
export function hostPort(shell: ShellPort, activeLabel: () => string | null): HostPort {
  return {
    async state() {
      return shell.hostState();
    },
    async call(name, params) {
      const label = activeLabel();
      if (!label) {
        return { ok: false, output: "", error: "no page is open" };
      }
      const answer = await shell.pageCall(label, name, params);
      return { ok: answer.ok, output: answer.output, error: answer.error ?? undefined };
    },
  };
}
