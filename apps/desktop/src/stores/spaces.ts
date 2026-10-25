/**
 * The person's projects and the one she is in — README section 3.5, ADR 0225.
 *
 * The list is the daemon's (`GET /spaces`, through `lib/spaces.ts`); this store only mirrors it and
 * keeps one fact of its own: which space every turn is filed under (`activeId`, `CORE` for Athena's
 * core). That fact is the `settings` row `active_space_id`, so both windows read the same answer:
 * Main's pill writes it, and her window, where the run store sends `/run`, re-reads it on
 * `store:changed` (ADR 0026).
 *
 * **A switch never lands mid-turn.** Memory a turn writes is stamped with the space it ran in, so a
 * turn that started in one project must finish there. While a turn runs a switch is held in
 * `pending` and applied the moment it ends. Which window knows a turn runs is not this store's to
 * decide: each root binds its own signal (`startSpaces`) — her window the run store's phase, Main
 * the status Rust mirrors of her — so this module imports neither.
 *
 * **Fail closed.** An active id that names no space in a list the daemon actually answered is
 * core, and the row is put back to core: a space erased in the other window, or a row from a brain
 * that no longer has it, must never stamp a turn with a space nobody can see. A list that could not
 * be read proves nothing, so it changes nothing but `problem`.
 *
 * **Off the first frame.** In Main this module arrives after first paint, with the bar's pill that
 * starts it (`console/bar-pill.tsx`); what the first frame draws of the projects is the mirror
 * `stores/spaces-glance.ts`, which this store fills on every change.
 */
import { create } from "zustand";

import { hasShell, onStoreChanged } from "@/lib/ipc";
import {
  CORE,
  SpacesApi,
  type SpaceErased,
  type SpaceInput,
  type SpaceMemoryKind,
  type SpaceMemoryPage,
  type SpacePatch,
  type SpaceSummary,
  type SpacesClient,
} from "@/lib/spaces";
import { SETTING_KEYS, settingRead, settingWrite } from "@/lib/store";
import { endpoint, useDaemon } from "@/stores/daemon";
import { useSpacesGlance, type SpacesGlance } from "@/stores/spaces-glance";

export interface SpacesState {
  spaces: readonly SpaceSummary[];
  /** The first list has answered (even with none). */
  loaded: boolean;
  /** Why the list could not be read, verbatim; "" when it could. */
  problem: string;
  /** The space every turn is filed under; `CORE` ("") for Athena's core. */
  activeId: string;
  /** A switch asked for while a turn runs, applied when it ends; `null` when none waits. */
  pending: string | null;
  load: () => Promise<void>;
  create: (input: SpaceInput) => Promise<SpaceSummary>;
  update: (id: string, patch: SpacePatch) => Promise<SpaceSummary>;
  erase: (id: string) => Promise<SpaceErased>;
  /** Enter a space (or `CORE`). Held in `pending` while a turn runs. */
  setActive: (id: string) => void;
  memory: (id: string, kind?: SpaceMemoryKind) => Promise<SpaceMemoryPage>;
  promote: (id: string, memId: string) => Promise<void>;
  /** Link a chore case to a space, or `CORE` to unlink it. */
  linkCase: (caseId: string, spaceId: string) => Promise<void>;
}

/** Whether a turn runs in this window's view, and a way to hear the moment it ends. */
export interface TurnSignal {
  busy: () => boolean;
  /** Call `f` each time a running turn ends; answers the unsubscribe. */
  onIdle: (f: () => void) => () => void;
}

/** No turn ever runs: a window (or a test) that bound nothing switches at once. */
const NO_TURN: TurnSignal = { busy: () => false, onIdle: () => () => {} };

let client: SpacesClient = new SpacesApi(() => endpoint(useDaemon.getState()));
let turn: TurnSignal = NO_TURN;
let stopTurn: () => void = () => {};
/** What the end of a turn does; set by the store's constructor below. */
let turnEnded: () => void = () => {};
/** Whether the switch waiting in `pending` was the person's here (written to the row) or read from it. */
let pendingWrites = false;

const say = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Newest first, as `GET /spaces` orders them, with `s` in place of the row of the same id. */
function withRow(spaces: readonly SpaceSummary[], s: SpaceSummary): SpaceSummary[] {
  return [s, ...spaces.filter((x) => x.id !== s.id)];
}

export const useSpaces = create<SpacesState>((set, get) => {
  const known = (id: string) => id === CORE || get().spaces.some((s) => s.id === id);

  /** Make `id` the active space now. An id the list does not name is core (fail closed). */
  const commit = (id: string, write: boolean) => {
    const next = known(id) ? id : CORE;
    pendingWrites = false;
    set({ activeId: next, pending: null });
    if (write && hasShell()) {
      settingWrite(SETTING_KEYS.activeSpaceId, next).catch((e: unknown) =>
        console.error(`[spaces] write ${SETTING_KEYS.activeSpaceId}: ${say(e)}`),
      );
    }
  };

  /** Switch now, or hold the switch until the running turn ends. */
  const request = (id: string, write: boolean) => {
    if (!turn.busy()) {
      if (id !== get().activeId || get().pending !== null) commit(id, write);
      return;
    }
    // Asking for the space the turn already runs in withdraws a waiting switch.
    pendingWrites = write;
    set({ pending: id === get().activeId ? null : id });
  };

  // The turn that ends is the moment a held switch lands.
  turnEnded = () => {
    const waiting = get().pending;
    if (waiting !== null) commit(waiting, pendingWrites);
  };

  return {
    spaces: [],
    loaded: false,
    problem: "",
    activeId: CORE,
    pending: null,

    async load() {
      let spaces: SpaceSummary[];
      try {
        spaces = await client.list();
      } catch (error) {
        set({ loaded: true, problem: say(error) });
        return;
      }
      set({ spaces, loaded: true, problem: "" });
      // The row is the person's choice; without a shell (the preview, a test) the store's own is.
      let row: string | null = null;
      if (hasShell()) {
        try {
          const read = await settingRead<string>(SETTING_KEYS.activeSpaceId);
          row = typeof read === "string" ? read : CORE;
        } catch (error) {
          console.error(`[spaces] read ${SETTING_KEYS.activeSpaceId}: ${say(error)}`);
        }
      }
      const wanted = row ?? get().activeId;
      const resolved = known(wanted) ? wanted : CORE;
      if (row !== null && resolved !== row) {
        // A space that is gone: the row goes back to core too, so the other window agrees.
        settingWrite(SETTING_KEYS.activeSpaceId, CORE).catch((e: unknown) =>
          console.error(`[spaces] write ${SETTING_KEYS.activeSpaceId}: ${say(e)}`),
        );
      }
      const waiting = get().pending;
      if (waiting !== null && !known(waiting)) set({ pending: null });
      // A switch the person asked for here and is waiting on is not undone by a re-read.
      if (get().pending === null || !pendingWrites) request(resolved, false);
    },

    async create(input) {
      const made = await client.create(input);
      set((s) => ({ spaces: withRow(s.spaces, made) }));
      return made;
    },

    async update(id, patch) {
      const next = await client.update(id, patch);
      set((s) => ({ spaces: withRow(s.spaces, next) }));
      return next;
    },

    async erase(id) {
      const erased = await client.erase(id);
      set((s) => ({ spaces: s.spaces.filter((x) => x.id !== id) }));
      if (get().pending === id) set({ pending: null });
      // Its memory is gone with it: the active space cannot be one that no longer exists, so this
      // is not held for the turn's end (the daemon refused the erase while a turn ran in it).
      if (get().activeId === id) commit(CORE, true);
      return erased;
    },

    setActive(id) {
      if (known(id)) {
        request(id, true);
        return;
      }
      // Made in the other window a moment ago, perhaps: read the list once, then decide.
      void get()
        .load()
        .then(() => {
          if (known(id)) request(id, true);
        });
    },

    memory: (id, kind) => client.memory(id, kind),

    async promote(id, memId) {
      await client.promote(id, memId);
      // The counts moved: a fact left the space for core.
      await get().load();
    },

    async linkCase(caseId, spaceId) {
      await client.linkCase(caseId, spaceId);
      // Nothing local is patched: the case is the daemon's, and its chooser asks for it again. The
      // spaces' chore counts did move, so the list is read once more.
      await get().load();
    },
  };
});

/** The space a summary list names, or null. */
export const spaceById = (spaces: readonly SpaceSummary[], id: string): SpaceSummary | null =>
  spaces.find((s) => s.id === id) ?? null;

/**
 * What the first frame reads of this store (`stores/spaces-glance.ts`). A list that could not be
 * read is said as such, even after an earlier one answered. The names are rebuilt only when the
 * list itself moved, so a held switch does not hand the surface a new list.
 */
export function glanceOf(
  s: Pick<SpacesState, "spaces" | "loaded" | "problem" | "activeId" | "pending">,
  names: SpacesGlance["names"] = s.spaces.map((x) => ({ id: x.id, name: x.name })),
): Omit<SpacesGlance, "enter"> {
  return {
    names,
    loaded: s.loaded && s.problem === "",
    failed: s.problem !== "",
    activeId: s.activeId,
    pending: s.pending,
  };
}

useSpacesGlance.setState({ ...glanceOf(useSpaces.getState()), enter: (id) => useSpaces.getState().setActive(id) });
useSpaces.subscribe((s, prev) =>
  useSpacesGlance.setState(glanceOf(s, s.spaces === prev.spaces ? useSpacesGlance.getState().names : undefined)),
);

/** Bind the window's turn signal. Replaces any earlier one. */
export function bindTurn(signal: TurnSignal): void {
  stopTurn();
  turn = signal;
  stopTurn = signal.onIdle(() => turnEnded());
}

let started = false;

/**
 * Bind the turn signal and read the list each time the daemon comes up, and the row again whenever
 * the other window writes it. Called by her window's root and by Main's bar pill, which is drawn on
 * every scene (the day-zero rule of README section 3.5), and by nothing else: the pill and the run's
 * `space_id` must be right on every scene.
 */
export async function startSpaces(signal: TurnSignal = NO_TURN): Promise<void> {
  if (started) return;
  started = true;
  bindTurn(signal);
  const ready = () => endpoint(useDaemon.getState()) !== null;
  if (ready()) void useSpaces.getState().load();
  useDaemon.subscribe((s, prev) => {
    if (endpoint(s) !== null && endpoint(prev) === null) void useSpaces.getState().load();
  });
  if (!hasShell()) return;
  await onStoreChanged((change) => {
    if (change.table === "settings" && change.key === SETTING_KEYS.activeSpaceId && ready()) {
      void useSpaces.getState().load();
    }
  });
}

/** Tests: a client over a fake fetch, no turn bound, and the store back to its first state. */
export function resetSpacesForTests(fake?: SpacesClient): void {
  client = fake ?? new SpacesApi(() => endpoint(useDaemon.getState()));
  stopTurn();
  turn = NO_TURN;
  stopTurn = () => {};
  pendingWrites = false;
  started = false;
  useSpaces.setState({ spaces: [], loaded: false, problem: "", activeId: CORE, pending: null });
}
