/**
 * Per-origin trust — the `origins` table (README section 3.3), as the panel holds it.
 *
 * An origin is in one of three states (ADR 0063). **No row** is first sight: every tool of that
 * app files a card, whatever its flags say. **A row with `enabled: true`** is one the user
 * registered or trusted: its classes are the ones its manifest's flags imply, tightened by the
 * `GATED` pins in `overrides`. **A row with `enabled: false`** is switched off and its tools are
 * refused. `stores/run.ts` turns the table into the lists every request carries to the gate; a
 * pin of `AUTO` or `READ` is never sent, because a pin only tightens. Nothing here decides a
 * class; the gate does (README invariant 3). This store only carries the user's answer to and
 * from SQLite.
 *
 * **Writes for one origin are queued, and a save names only the fields it owns.** Two writers
 * can reach one row at once: a tool pin writing `overrides` while the user's Disable click writes
 * `enabled`. First sight writes nothing: an origin with no row is gated at the gate, and a row
 * appears only when the user answers (ADR 0063). If both read the
 * record, both merge locally and both send a whole row, whichever IPC lands second wins all of
 * it — and an origin the user disabled comes back enabled with no error anywhere. So a patch is
 * applied to the record the *previous* save published, not to the one its caller was holding.
 *
 * **Trust is per origin and per contract (ADR 0100, amending ADR 0063).** Beside each row the
 * store keeps the contract the user accepted for each of that origin's tools (`lib/contract.ts`):
 * the contracts listed when the origin is enabled, and a tool's contract again after an approved
 * call of it ran. A tool whose contract is not the accepted one is sent to the gate as `GATED`
 * (`stores/run.ts`). They live in one `settings` row, written through one queue, because the
 * `origins` table has fixed columns and the store ships no migrations.
 *
 * The table is its own index. There is no settings row listing known origins: a list that can
 * drift from the rows it names, and that a forget can only shorten, is the mistake `originList`
 * exists to not make.
 */
import { create } from "zustand";

import type { BridgeTool } from "@/lib/bridge";
import { contractOf, type ContractTable, type ToolContract } from "@/lib/contract";
import { hasShell, onStoreChanged, type Wire } from "@/lib/ipc";
import { catalogIdOf, derivedIdOf } from "@/lib/manifest";
import {
  blankOrigin,
  originForget,
  originList,
  originRead,
  originWrite,
  settingRead,
  settingWrite,
  SETTING_KEYS,
  type OriginRow,
  type ToolClass,
} from "@/lib/store";
import { useTabs } from "@/stores/tabs";
import { useTools } from "@/stores/tools";

/** The fields one save owns, or a function that derives them from the freshest record. */
export type OriginPatch =
  | Partial<Omit<OriginRow, "origin">>
  | ((current: OriginRow) => Partial<Omit<OriginRow, "origin">>);

/** One in-flight write per origin, so two saves land in call order. */
const queues = new Map<string, Promise<unknown>>();

/** The contracts row is one row for every origin, so its writes share one queue. */
let contractQueue: Promise<unknown> = Promise.resolve();

export interface OriginsState {
  records: Record<string, OriginRow>;
  /** Every origin the table holds, in the order it answered. */
  known: string[];
  /** True once `loadAll` has answered once — not the same fact as "no origin is stored". */
  loaded: boolean;
  /** A sentence when the table could not be read, null when it could. */
  problem: string | null;
  /** The tool contracts the user accepted, by web origin then tool (ADR 0100). */
  contracts: ContractTable;
  load: (origin: string) => Promise<OriginRow>;
  loadAll: () => Promise<void>;
  /** Apply a patch and persist. The only writer. */
  save: (origin: string, patch: OriginPatch) => Promise<OriginRow>;
  setEnabled: (origin: string, enabled: boolean) => Promise<OriginRow>;
  /** `null` clears the override and returns the tool to the class its manifest implies. */
  setOverride: (origin: string, tool: string, cls: ToolClass | null) => Promise<void>;
  /** Delete the row, so the next visit to that origin is a first sight again. */
  forget: (origin: string) => Promise<void>;
  /**
   * Record these tools' current contracts as the accepted ones for a web origin. Called when the
   * origin is enabled and after an approved call of a tool ran; never by a model.
   */
  acceptContracts: (origin: string, tools: readonly BridgeTool[]) => Promise<void>;
}

export const useOrigins = create<OriginsState>((set, get) => ({
  records: {},
  known: [],
  loaded: false,
  problem: null,
  contracts: {},

  load: async (origin) => {
    const cached = get().records[origin];
    if (cached) return cached;
    const stored = hasShell() ? await originRead(origin) : null;
    const record: OriginRow = stored
      ? { ...blankOrigin(origin), ...stored, overrides: stored.overrides ?? {} }
      : blankOrigin(origin);
    set((s) => ({ records: { ...s.records, [origin]: record } }));
    return record;
  },

  loadAll: async () => {
    try {
      const [page, contracts] = await Promise.all([
        originList(),
        settingRead<Record<string, Record<string, ToolContract>>>(SETTING_KEYS.toolContracts),
      ]);
      const records: Record<string, OriginRow> = { ...get().records };
      for (const stored of page.rows) {
        records[stored.origin] = {
          ...blankOrigin(stored.origin),
          ...stored,
          overrides: stored.overrides ?? {},
        };
      }
      set({
        records,
        known: page.rows.map((r) => r.origin),
        // An unreadable or malformed row is no accepted contract at all: every tool asks once.
        contracts: contracts !== null && typeof contracts === "object" ? contracts : {},
        loaded: true,
        problem: null,
      });
    } catch (e) {
      // Verbatim: a reason we cannot explain is still a reason, and an unreadable table must not
      // render as an empty one (README section 3.5 — "could not be read" is its own fact).
      set({ loaded: true, problem: e instanceof Error ? e.message : String(e) });
    }
  },

  save: async (origin, patch) => {
    const write = async (): Promise<OriginRow> => {
      // Read inside the queue: the base is whatever the previous save for this origin published,
      // never the snapshot the caller took before it awaited.
      const base = await get().load(origin);
      const fields = typeof patch === "function" ? patch(base) : patch;
      const record: OriginRow = { ...base, ...fields, origin };
      await originWrite(origin, {
        enabled: record.enabled,
        overrides: record.overrides ?? {},
        last_seen: new Date().toISOString(),
      });
      set((s) => ({
        records: { ...s.records, [origin]: record },
        known: s.known.includes(origin) ? s.known : [...s.known, origin],
      }));
      return record;
    };

    // A failed save must not strand the ones behind it, so the chain swallows the prior
    // rejection — the caller of *that* save still sees its own.
    const prior = queues.get(origin) ?? Promise.resolve();
    const next = prior.then(write, write);
    queues.set(origin, next);
    try {
      return await next;
    } finally {
      // Only the tail clears the slot, or a slow save would drop a newer one's ordering.
      if (queues.get(origin) === next) queues.delete(origin);
    }
  },

  setEnabled: async (origin, enabled) => {
    const record = await get().save(origin, { enabled });
    // Trusting an origin is trusting what it registers now: its listed tools' contracts become the
    // accepted ones. A tool it registers later, or rewrites, asks once (ADR 0100).
    if (enabled) {
      for (const [web, tools] of listedAt(origin)) await get().acceptContracts(web, tools);
    }
    return record;
  },

  setOverride: async (origin, tool, cls) => {
    await get().save(origin, (record) => {
      const overrides = { ...record.overrides };
      if (cls === null) delete overrides[tool];
      else overrides[tool] = cls;
      return { overrides };
    });
  },

  forget: async (origin) => {
    await originForget(origin);
    set((s) => {
      const records = { ...s.records };
      delete records[origin];
      return { records, known: s.known.filter((o) => o !== origin) };
    });
    if (get().contracts[origin] !== undefined) {
      await writeContracts((table) => {
        const next = { ...table };
        delete next[origin];
        return next;
      });
    }
  },

  acceptContracts: async (origin, tools) => {
    if (!origin || tools.length === 0) return;
    await writeContracts((table) => {
      const mine = { ...(table[origin] ?? {}) };
      for (const tool of tools) mine[tool.name] = contractOf(tool);
      return { ...table, [origin]: mine };
    });
  },
}));

/**
 * Apply a change to the contracts table and persist it. Queued like a row save, and applied to the
 * table the previous write published, so two acceptances cannot drop each other.
 */
async function writeContracts(change: (table: ContractTable) => ContractTable): Promise<void> {
  const write = async () => {
    const next = change(useOrigins.getState().contracts);
    if (hasShell()) await settingWrite(SETTING_KEYS.toolContracts, next as unknown as Wire);
    useOrigins.setState({ contracts: next });
  };
  const next = contractQueue.then(write, write);
  contractQueue = next;
  await next;
}

/**
 * The open tabs an origin key names, as web origin to the tools each listed. A web origin names
 * its own tabs; a catalog-form key (`host:<app>`) names the tabs whose derived id it is, the same
 * rule `gatedListsOf` applies a catalog-form row by.
 */
function listedAt(key: string): Map<string, BridgeTool[]> {
  const out = new Map<string, BridgeTool[]>();
  const { byTab } = useTools.getState();
  for (const tab of useTabs.getState().tabs) {
    const origin = webOriginOf(tab.url);
    const found = byTab[tab.id];
    if (!origin || !found || found.tools.length === 0) continue;
    const app = catalogIdOf(origin, found.appId);
    const named = key === origin || (key.startsWith("host:") && app !== null && key === `host:${app}` && app === derivedIdOf(origin));
    if (named) out.set(origin, [...(out.get(origin) ?? []), ...found.tools]);
  }
  return out;
}

function webOriginOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

let started = false;

/**
 * Read the table once at launch. Called by `src/app.tsx` and by nothing else: from c22 the panel
 * needs an origin's trust while the user is looking at another module, and a store a view starts
 * stops being true the moment the user leaves that view.
 */
export async function startOrigins(): Promise<void> {
  if (started || !hasShell()) return;
  started = true;
  await useOrigins.getState().loadAll();
  // ADR 0026: the other window may have written an origin. Re-read the table on its word.
  await onStoreChanged((change) => {
    if (change.table === "origins" || (change.table === "settings" && change.key === SETTING_KEYS.toolContracts)) void useOrigins.getState().loadAll();
  });
}
