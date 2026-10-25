/**
 * The shell's own trust wiring for the end-to-end suites - README section 3.3, ADR 0063, 0100.
 *
 * The shipped panel decides what the gate is told through one read: `snapshotOf` over the origins
 * table, the tab strip and the tools store (`stores/run.ts` LIVE, `stores/voice.ts` LIVE). A suite
 * that hand-wires `RunDeps` without it falls through `snapshotFrom` to `NOTHING_GATED`, so every
 * turn tells the daemon no app is first sight, pinned, drifted or switched off - a configuration
 * the shell can never be in. Every suite builds its deps here instead: a seeded table, tabs and
 * tool lists, read through the same functions the shell reads them through, minus Tauri.
 *
 * The tables a suite seeds are the four states a person can leave an origin in: never registered
 * ({@link firstSight}), registered with its current contracts accepted ({@link registered}, with
 * pins and an older accepted contract as options), and switched off ({@link switchedOff}).
 */
import type { BridgeTool } from "@/lib/bridge";
import { contractOf } from "@/lib/contract";
import { DaemonApi, type FetchLike } from "@/lib/api";
import type { Tab } from "@/lib/ipc";
import type { OriginRow, ToolClass } from "@/lib/store";
import { disabledOriginsOf, gatedListsOf, snapshotOf, tabRefOf, type RunDeps, type TrustTable } from "@/stores/run";
import type { TabTools } from "@/stores/tools";
import type { VoiceDeps } from "@/stores/voice";

import { PAGE_ORIGIN, PAGE_TOOLS, pageTab, pageTabTools } from "./page";

type Read<T> = T | (() => T);
const read = <T>(v: Read<T>): T => (typeof v === "function" ? (v as () => T)() : v);

function rowFor(origin: string, enabled: boolean, overrides: Record<string, ToolClass> = {}): OriginRow {
  const now = new Date().toISOString();
  return { origin, enabled, overrides, first_seen: now, last_seen: now };
}

/** A table that loaded and holds no row: every open tab's app is first sight. */
export function firstSight(): TrustTable {
  return { records: {}, known: [], loaded: true, problem: null, contracts: {} };
}

/**
 * A person registered `origin` and accepted a contract for each tool: by default the contracts of
 * `tools` themselves, or those of `accepted` when the page has changed a tool since (ADR 0100).
 * `overrides` are the person's pins, `GATED` the only one that tightens.
 */
export function registered(
  origin: string,
  tools: readonly BridgeTool[],
  options: { overrides?: Record<string, ToolClass>; accepted?: readonly BridgeTool[] } = {},
): TrustTable {
  const accepted = options.accepted ?? tools;
  return {
    records: { [origin]: rowFor(origin, true, options.overrides) },
    known: [origin],
    loaded: true,
    problem: null,
    contracts: { [origin]: Object.fromEntries(accepted.map((t) => [t.name, contractOf(t)])) },
  };
}

/** A person registered `origin` and then switched it off. */
export function switchedOff(origin: string): TrustTable {
  return { records: { [origin]: rowFor(origin, false) }, known: [origin], loaded: true, problem: null, contracts: {} };
}

/** What the shell holds: the origins table, the tab strip and the tools store, each read live. */
export interface ShellSeed {
  table: Read<TrustTable>;
  tabs: Read<readonly Tab[]>;
  byTab: Read<Readonly<Record<number, TabTools>>>;
  /** Run one of the page's tools on a tab (the relay the shell owns). */
  call: RunDeps["call"];
  /** The host state the surface reports; the shell's tab list and focused page when omitted. */
  hostState?: () => Record<string, unknown>;
}

/** The parts of a surface's deps the shell's trust read decides, shared by the panel and voice. */
export type ShellReaders = Required<
  Pick<RunDeps, "focused" | "tab" | "hostState" | "call" | "snapshot" | "manifest" | "disabledOrigins" | "gated">
>;

/** The readers the shipped LIVE deps wire, over `seed` instead of the stores. */
export function shellReaders(seed: ShellSeed): ShellReaders {
  const snapshot = () => snapshotOf(read(seed.table), read(seed.tabs), read(seed.byTab));
  return {
    focused: () => snapshot().focused,
    tab: (tabId) => {
      const tab = read(seed.tabs).find((t) => t.id === tabId);
      return tab ? tabRefOf(tab, read(seed.byTab)) : null;
    },
    hostState:
      seed.hostState ??
      (() => {
        const tabs = read(seed.tabs);
        const focused = tabs.find((t) => t.focused) ?? tabs[0];
        return {
          tabs: tabs.slice(0, 12).map((t) => ({ url: t.url, title: t.title })),
          page_url: focused?.url ?? "",
          page_title: focused?.title ?? "",
        };
      }),
    call: seed.call,
    snapshot,
    manifest: () => snapshot().manifest,
    disabledOrigins: () => disabledOriginsOf(read(seed.table).records, read(seed.tabs), read(seed.byTab)),
    gated: () => gatedListsOf(read(seed.table), read(seed.tabs), read(seed.byTab)),
  };
}

/** The panel's deps: the real client against `daemon`, and the shell's trust read over `seed`. */
export function shellDeps(
  seed: ShellSeed & { daemon: { url: string; token: string }; fetchImpl?: FetchLike },
): RunDeps & ShellReaders {
  const { daemon, fetchImpl } = seed;
  return {
    api: () => new DaemonApi({ url: daemon.url, token: daemon.token }, fetchImpl),
    ...shellReaders(seed),
  };
}

/** The voice store's deps: its own socket, mic and player, and the same trust read over `seed`. */
export function voiceShellDeps(
  seed: ShellSeed,
  voice: Omit<VoiceDeps, keyof ShellReaders>,
): VoiceDeps & Pick<ShellReaders, "snapshot"> {
  // `tab` rides along unread: the voice store finds only the focused tab.
  return { ...voice, ...shellReaders(seed) };
}

/**
 * The ledgerbox page open and focused in one tab, publishing `tools`, under `table` - the seed the
 * ledgerbox suites share. The host state is the one those suites have always reported.
 */
export function pageShell(
  table: TrustTable,
  call: RunDeps["call"],
  tools: readonly BridgeTool[] = PAGE_TOOLS,
): ShellSeed {
  const tab = pageTab();
  return {
    table,
    tabs: [tab],
    byTab: { [tab.id]: pageTabTools(tools) },
    call,
    hostState: () => ({ page_url: tab.url, page_title: tab.title, tabs: [] }),
  };
}

/** The ledgerbox origin registered with every current tool accepted: the suites' default. */
export function registeredPage(tools: readonly BridgeTool[] = PAGE_TOOLS): TrustTable {
  return registered(PAGE_ORIGIN, tools);
}
