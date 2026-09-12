/**
 * The panel: a module bar, one module at a time, and the wiring between them (README §3.5).
 *
 * This is the only file that holds state *and* touches the DOM, and it is deliberately the only
 * one. Every module is a pure view over a view-model; everything below is a store or a port. What
 * is left here is the part that cannot be either: which module is showing, and who tells whom.
 *
 * The sequence at launch is the one act 1 of the demo depends on:
 *
 * 1. ask the shell where the daemon is (the shell blocked for the handshake, so this cannot race);
 * 2. ask the daemon whether it is ready, and show setup instead of chat if it is not;
 * 3. reopen the tabs the store remembered;
 * 4. for each page, run `list` through the relay, merge the manifest, and show the tools.
 *
 * Step 4 is where the panel does the *one* thing that looks like a decision and is not: it turns a
 * page's `list` answer into a manifest and posts it. The daemon validates it whole, derives every
 * class from the flags, and refuses a second origin claiming an application. The panel just carries.
 */

import { DaemonClient } from "./lib/client.js";
import { h, replace } from "./lib/dom.js";
import { hostPort, inShell, shellPort, type PageListing, type ShellPort, type TabRow } from "./lib/shell.js";
import { MODULES } from "./modules/index.js";
import type { BrowserActions, BrowserModel } from "./modules/browser/index.js";
import type { ChatActions, ChatModel } from "./modules/chat/index.js";
import type { SettingsActions, SettingsModel } from "./modules/settings/index.js";
import type { SetupActions, SetupModel } from "./modules/setup/index.js";
import { RunLoop, type RunModel } from "./stores/run.js";

type ModuleId = (typeof MODULES)[number]["id"];

interface PanelState {
  active: ModuleId;
  tabs: TabRow[];
  activeLabel: string | null;
  address: string;
  opening: boolean;
  browserError: string | null;
  setup: SetupModel;
  settings: SettingsModel;
  /** The window size the store remembered, carried so a save does not invent one. */
  window: { width: number; height: number };
}

const START: PanelState = {
  active: "chat",
  tabs: [],
  activeLabel: null,
  address: "",
  opening: false,
  browserError: null,
  setup: { ready: false, summary: "waiting for the daemon", checks: [], probing: true, daemon: null },
  settings: {
    engine: "claude_code",
    engines: ["claude_code", "codex"],
    model: "",
    brainRoot: "",
    homeUrl: "https://github.com",
    saving: false,
    problems: [],
    savedAt: null,
  },
  window: { width: 1440, height: 900 },
};

export async function start(root: HTMLElement, shell: ShellPort): Promise<void> {
  let state: PanelState = { ...START };
  const address = await shell.daemonAddress();
  const client = new DaemonClient({ url: address.url, token: address.token }, fetch);
  const loop = new RunLoop(client, hostPort(shell, () => state.activeLabel));

  const render = () => replace(root, panel(state, loop.snapshot));
  const set = (patch: Partial<PanelState>) => {
    state = { ...state, ...patch };
    render();
  };

  loop.subscribe(render);

  // -- what each module can ask for -------------------------------------------------------------

  const browserActions: BrowserActions = {
    open: (url) => void openTab(url),
    close: (label) => void closeTab(label),
    activate: (label) => void activateTab(label),
    refresh: (label) => void register(label),
  };

  const chatActions: ChatActions = {
    send: (message) => void loop.send(message),
    answer: (id, choice) => void loop.answer(id, choice),
    cancel: () => undefined,
  };

  const setupActions: SetupActions = { probe: () => void refreshReadiness() };

  const settingsActions: SettingsActions = {
    save: (next) => void saveSettings(next),
  };

  // -- the operations ----------------------------------------------------------------------------

  async function refreshReadiness(): Promise<void> {
    set({ setup: { ...state.setup, probing: true } });
    try {
      const ready = await client.ready();
      set({
        setup: {
          ready: ready.ready,
          summary: ready.summary,
          checks: ready.checks,
          probing: false,
          daemon: address.url,
        },
        active: ready.ready ? state.active : "setup",
      });
    } catch (error) {
      set({
        setup: {
          ...state.setup,
          probing: false,
          ready: false,
          summary: describe(error),
          daemon: address.url,
        },
        active: "setup",
      });
    }
  }

  async function refreshTabs(): Promise<void> {
    const tabs = await shell.tabList();
    const active = tabs.find((tab) => tab.label === state.activeLabel) ?? tabs[0];
    set({ tabs, activeLabel: active?.label ?? null });
    await loop.openApp(active?.app_id ?? null);
  }

  async function openTab(url: string): Promise<void> {
    set({ opening: true, browserError: null, address: url });
    try {
      const tab = await shell.tabOpen(url);
      set({ activeLabel: tab.label, opening: false });
      await refreshTabs();
      await register(tab.label);
    } catch (error) {
      set({ opening: false, browserError: describe(error) });
    }
  }

  async function closeTab(label: string): Promise<void> {
    const tab = state.tabs.find((row) => row.label === label);
    await shell.tabClose(label);
    // The session goes with the tab: a page that is gone must not leave its tools addressable.
    if (tab?.session_id) {
      await client.closeSession(tab.session_id).catch(() => undefined);
    }
    await refreshTabs();
  }

  async function activateTab(label: string): Promise<void> {
    await shell.tabActivate(label);
    set({ activeLabel: label });
    await refreshTabs();
  }

  /**
   * Ask a page what it registered and hand the answer to the daemon.
   *
   * A page that has no bridge answers with zero tools rather than an error (ADR 0008), and that is
   * a normal outcome: it is the page act 2 of the demo uses the generic hands on.
   */
  async function register(label: string): Promise<void> {
    let listing: PageListing;
    try {
      listing = await shell.pageList(label);
    } catch (error) {
      set({ browserError: describe(error) });
      return;
    }
    const manifest = manifestOf(listing);
    if (!manifest) return;
    try {
      const opened = (await client.openSession(manifest)) as {
        session: { id: string; app_id: string };
        registered: string[];
      };
      await shell.tabRegistered(
        label,
        opened.session.app_id,
        opened.session.id,
        opened.registered.length,
      );
      await refreshTabs();
    } catch (error) {
      set({ browserError: describe(error) });
    }
  }

  async function saveSettings(next: {
    engine: string;
    model: string;
    brainRoot: string;
    homeUrl: string;
  }): Promise<void> {
    set({ settings: { ...state.settings, saving: true, problems: [] } });
    try {
      const saved = await shell.settingsSet({
        engine: next.engine,
        model: next.model,
        brain_root: next.brainRoot,
        home_url: next.homeUrl,
        window_width: state.window.width,
        window_height: state.window.height,
        tabs: state.tabs.map((tab) => tab.url),
      });
      set({
        settings: {
          ...state.settings,
          engine: saved.engine,
          model: saved.model,
          brainRoot: saved.brain_root,
          homeUrl: saved.home_url,
          saving: false,
          savedAt: new Date().toISOString(),
          // The shell repairs rather than refuses, so a changed value is what was wrong.
          problems: saved.engine === next.engine ? [] : [`engine was repaired to ${saved.engine}`],
        },
      });
    } catch (error) {
      set({ settings: { ...state.settings, saving: false, problems: [describe(error)] } });
    }
  }

  // -- rendering ----------------------------------------------------------------------------------

  function panel(current: PanelState, run: RunModel): HTMLElement {
    return h(
      "div",
      { class: "panel" },
      bar(current),
      h("div", { class: "panel-body", data: { role: "body" } }, body(current, run)),
    );
  }

  function bar(current: PanelState): HTMLElement {
    return h(
      "nav",
      { class: "module-bar", data: { role: "module-bar" } },
      ...MODULES.map((module) =>
        h(
          "button",
          {
            class: module.id === current.active ? "module-tab is-active" : "module-tab",
            title: module.title,
            data: { role: "module-tab", module: module.id },
            on: { click: () => set({ active: module.id }) },
          },
          module.glyph,
        ),
      ),
    );
  }

  function body(current: PanelState, run: RunModel): HTMLElement {
    switch (current.active) {
      case "browser":
        return MODULES[1].view(browserModel(current), browserActions);
      case "setup":
        return MODULES[2].view(current.setup, setupActions);
      case "settings":
        return MODULES[3].view(current.settings, settingsActions);
      default:
        return MODULES[0].view(chatModel(current, run), chatActions);
    }
  }

  function browserModel(current: PanelState): BrowserModel {
    return {
      tabs: current.tabs.map((tab) => ({
        label: tab.label,
        title: tab.title,
        url: tab.url,
        appId: tab.app_id,
        tools: tab.tool_count,
        active: tab.label === current.activeLabel,
        registered: Boolean(tab.session_id),
      })),
      address: current.address,
      opening: current.opening,
      error: current.browserError,
    };
  }

  function chatModel(current: PanelState, run: RunModel): ChatModel {
    return {
      phase: run.phase,
      transcript: run.transcript,
      cards: run.cards,
      tools: run.tools,
      summary: run.summary,
      error: run.error,
      appId: run.appId,
      ready: current.setup.ready,
    };
  }

  // -- launch ---------------------------------------------------------------------------------------

  render();
  await refreshReadiness();
  const stored = await shell.settingsGet();
  set({
    settings: {
      ...state.settings,
      engine: stored.engine,
      model: stored.model,
      brainRoot: stored.brain_root,
      homeUrl: stored.home_url,
    },
    window: { width: stored.window_width, height: stored.window_height },
    address: stored.home_url,
  });
  await refreshTabs();
  await shell.onToolChange((label) => void register(label));
}

function manifestOf(listing: PageListing): Record<string, unknown> | null {
  if (!listing.ok || !listing.page) return null;
  const page = listing.page;
  const appId = typeof page.app_id === "string" ? page.app_id : "";
  if (!appId) return null;
  const tools = (listing.tools ?? []).map((tool) => {
    const athena = (tool.athena ?? {}) as Record<string, unknown>;
    return {
      name: tool.name,
      description: tool.description ?? "",
      params_schema: tool.inputSchema ?? {},
      // Left undefined when the page claimed nothing: the manifest's validator refuses the
      // omission by name, and a panel that guessed would be deciding a class (README §3.3).
      reversible: athena.reversible,
      side_effects: athena.side_effects ?? "internal",
      transport: "webmcp",
    };
  });
  return {
    app_id: appId,
    app_version: page.app_version ?? "0",
    page_origin: page.origin ?? "",
    tools,
    origin_kind: "host",
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (typeof document !== "undefined" && inShell()) {
  const root = document.getElementById("panel");
  if (root) void start(root, shellPort());
}
