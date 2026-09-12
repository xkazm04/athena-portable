/**
 * Per-origin trust — the `origins` table (README section 3.3), as the panel holds it.
 *
 * A page's tools are off until the user says otherwise, and *which* tools and at what class is
 * data the user can see and change: `enabled` is the standing permission and `overrides` is the
 * per-tool class map the gate reads. Nothing here decides a class; the gate does (README
 * invariant 3). This store only carries the user's answer to and from SQLite.
 *
 * **Writes for one origin are queued, and a save names only the fields it owns.** Two writers
 * reach this table at once as soon as c24 exists: the shell's first-sight default writing
 * `GATED` into `overrides` while the user's Disable click writes `enabled`. If both read the
 * record, both merge locally and both send a whole row, whichever IPC lands second wins all of
 * it — and an origin the user disabled comes back enabled with no error anywhere. So a patch is
 * applied to the record the *previous* save published, not to the one its caller was holding.
 *
 * The table is its own index. There is no settings row listing known origins: a list that can
 * drift from the rows it names, and that a forget can only shorten, is the mistake `originList`
 * exists to not make.
 */
import { create } from "zustand";

import { hasShell } from "@/lib/ipc";
import {
  blankOrigin,
  originForget,
  originList,
  originRead,
  originWrite,
  type OriginRow,
  type ToolClass,
} from "@/lib/store";

/** The fields one save owns, or a function that derives them from the freshest record. */
export type OriginPatch =
  | Partial<Omit<OriginRow, "origin">>
  | ((current: OriginRow) => Partial<Omit<OriginRow, "origin">>);

/** One in-flight write per origin, so two saves land in call order. */
const queues = new Map<string, Promise<unknown>>();

export interface OriginsState {
  records: Record<string, OriginRow>;
  /** Every origin the table holds, in the order it answered. */
  known: string[];
  /** True once `loadAll` has answered once — not the same fact as "no origin is stored". */
  loaded: boolean;
  /** A sentence when the table could not be read, null when it could. */
  problem: string | null;
  load: (origin: string) => Promise<OriginRow>;
  loadAll: () => Promise<void>;
  /** Apply a patch and persist. The only writer. */
  save: (origin: string, patch: OriginPatch) => Promise<OriginRow>;
  setEnabled: (origin: string, enabled: boolean) => Promise<OriginRow>;
  /** `null` clears the override and returns the tool to the class its manifest implies. */
  setOverride: (origin: string, tool: string, cls: ToolClass | null) => Promise<void>;
  /** Delete the row, so the next visit to that origin is a first sight again. */
  forget: (origin: string) => Promise<void>;
}

export const useOrigins = create<OriginsState>((set, get) => ({
  records: {},
  known: [],
  loaded: false,
  problem: null,

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
      const page = await originList();
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
      const local: OriginRow = { ...base, ...fields, origin };
      await originWrite(origin, {
        enabled: local.enabled,
        overrides: local.overrides ?? {},
        last_seen: new Date().toISOString(),
      });
      // Read back what the table now holds. The two sightings are the store's own columns —
      // `first_seen` defaults to `datetime('now')` in SQLite and is never sent from here — so a
      // record built only from what was written carries the empty strings `blankOrigin` uses for
      // "not stored yet", and the Origins module renders both dates as an em dash for a row it
      // has just created. A read that fails is not a failed save: the local record stands.
      const stored = await originRead(origin).catch(() => null);
      const record: OriginRow = stored ? { ...local, ...stored, overrides: local.overrides } : local;
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

  setEnabled: (origin, enabled) => get().save(origin, { enabled }),

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
  },
}));

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
}
