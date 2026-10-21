/**
 * The connectors, as the shell holds them — README section 4; ADR 0021.
 *
 * A mirror of `GET /connectors` and nothing more: the daemon owns the vault, the records and the
 * switches, and every act here is a request that answers with the row as the daemon now has it.
 * The store never derives a standing and never holds a credential — a token or a client secret
 * passes through `connect` once and is not kept, not even in `busy`.
 *
 * `busy` names what is in flight per connector, so a view can say "connecting…" on one card
 * while another is still editable. A refusal lands on the row it was about (`errors`), in the
 * daemon's own words, which never carry a value (the daemon redacts before it answers).
 *
 * `recordsNotice` is the vault's word that its connections file could not be read, verbatim. It
 * comes with the list and with every row a reply carries (each view repeats it), so a connect
 * that answers with a notice raises the banner and one that answers without it lowers it.
 *
 * The OAuth flow is polled from here (`pollFlow`) every 1.5 s while the consent page is open. A
 * read that fails to reach the daemon, or answers 5xx, is shown and asked again; a 4xx refusal or
 * a daemon that went ends the poll. The module's `index.ts` starts a `load` when it mounts and
 * when the daemon becomes ready, so a surface that is not on screen costs nothing.
 *
 * Two windows hold this mirror (ADR 0116, amending 0026). Main's Accounts acts on it; her window
 * reads it only to tell a connector card who it acts as, and only when one arrives (`followCards`).
 * Every act that succeeds says `connectors:changed`, and the other window's mirror, if anyone there
 * has asked for it, reads the list again.
 */
import { create } from "zustand";

import { ApiError, DaemonApi, type ConnectorView } from "@/lib/api";
import { emitConnectorsChanged, hasShell, onConnectorsChanged, type ConnectorsChanged } from "@/lib/ipc";
import { endpoint, useDaemon } from "@/stores/daemon";
import { WAITING_WORD, type ConnectorProblem } from "@/modules/connectors/model";

/** How often the flow is asked where it stands while a consent page is open. */
export const FLOW_POLL_MS = 1500;

export interface ConnectorDeps {
  api: () => DaemonApi | null;
  /** `setTimeout`, so the headless test can drive the poll by hand. */
  wait: (ms: number) => Promise<void>;
  /** Tell the other window an act went through. Absent: nobody is told (the headless default). */
  announce?: (change: ConnectorsChanged) => void;
}

/** This window's mark on what it announces, so it never re-reads on its own word. */
export const CONNECTORS_SOURCE = `w${Math.random().toString(36).slice(2, 10)}`;

const LIVE: ConnectorDeps = {
  api: () => {
    const found = endpoint(useDaemon.getState());
    return found ? new DaemonApi(found) : null;
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  announce: (change) => void emitConnectorsChanged(change).catch(() => {}),
};

let deps: ConnectorDeps = LIVE;

export function setConnectorDeps(next: ConnectorDeps): void {
  deps = next;
}

export interface SettingsPatch {
  enabled?: boolean;
  writes_enabled?: boolean;
  allowlist?: string[];
}

export interface ConnectorsState {
  items: readonly ConnectorView[];
  /** True once `/connectors` has answered once — not the same fact as "nothing is connected". */
  loaded: boolean;
  /** Why the list could not be read, and whether the daemon is the one saying so. */
  problem: ConnectorProblem | null;
  /** The vault's `records_notice`, verbatim: "" unless its connections file could not be read. */
  recordsNotice: string;
  /** What is in flight per connector: "connecting", "disconnecting", "probing", "saving". */
  busy: Readonly<Record<string, string>>;
  /** The last refusal per connector, in the daemon's words. Cleared by the next act. */
  errors: Readonly<Record<string, string>>;
  load: () => Promise<void>;
  connect: (id: string, body: Record<string, unknown>) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  probe: (id: string) => Promise<void>;
  settings: (id: string, patch: SettingsPatch) => Promise<void>;
  /** Poll a consent flow until it is done or failed. Resolves when it settles. */
  pollFlow: (id: string) => Promise<void>;
}

const EMPTY = {
  items: [] as readonly ConnectorView[],
  loaded: false,
  problem: null as ConnectorProblem | null,
  recordsNotice: "",
  busy: {} as Record<string, string>,
  errors: {} as Record<string, string>,
};

/**
 * Ordering between the list and the rows (async-ui-states state-model): every row a reply writes
 * is stamped, and a list read keeps any row written after it was asked; only the newest list read
 * may write at all.
 */
let stamp = 0;
const rowStamps = new Map<string, number>();
let newestList = 0;

export { WAITING_WORD };
/** The poll that owns each connector; a newer poll takes it and the older one stops (one flow per connector). */
const polls = new Map<string, number>();
let pollSeq = 0;

export function resetConnectorsForTests(): void {
  deps = LIVE;
  asked.clear();
  polls.clear();
  pollSeq = 0;
  stamp = 0;
  rowStamps.clear();
  newestList = 0;
  useConnectors.setState({ ...EMPTY });
}

const announce = (id: string) => deps.announce?.({ id, from: CONNECTORS_SOURCE });

function reasonOf(error: unknown): string {
  if (error instanceof ApiError) return error.message || error.reason;
  return error instanceof Error ? error.message : String(error);
}

/**
 * The same reason, plus who is giving it.
 *
 * An `ApiError` is only ever constructed from a response, so it is proof the daemon answered.
 * Anything else — a transport failure, or a bug in this shell such as the unbound `fetch` default
 * that `lib/api.ts` carried — means the request never got there, and the surface must not report
 * it as a refusal.
 */
function problemOf(error: unknown): ConnectorProblem {
  return {
    reason: reasonOf(error),
    from: error instanceof ApiError ? "daemon" : "client",
  };
}

export const useConnectors = create<ConnectorsState>((set, get) => {
  // The reply's view replaces the item whole — its `connection.health_detail` included, which
  // is how a connect's own word reaches the layer — and its notice is the vault's current one.
  const replace = (row: ConnectorView) => {
    rowStamps.set(row.id, ++stamp);
    set((s) => ({
      items: s.items.some((c) => c.id === row.id)
        ? s.items.map((c) => (c.id === row.id ? row : c))
        : [...s.items, row],
      recordsNotice: typeof row.records_notice === "string" ? row.records_notice : s.recordsNotice,
    }));
  };

  const mark = (id: string, what: string | null) =>
    set((s) => {
      const busy = { ...s.busy };
      if (what === null) delete busy[id];
      else busy[id] = what;
      return { busy };
    });

  const clearError = (id: string) =>
    set((s) => {
      const errors = { ...s.errors };
      delete errors[id];
      return { errors };
    });

  const fail = (id: string, error: unknown) =>
    set((s) => ({ errors: { ...s.errors, [id]: reasonOf(error) } }));

  /** One act, with the busy word around it and the daemon's row after it. */
  async function act(
    id: string,
    what: string,
    run: (api: DaemonApi) => Promise<{ connector: ConnectorView }>,
  ): Promise<boolean> {
    const api = deps.api();
    if (!api) {
      fail(id, "the daemon is not ready");
      return false;
    }
    clearError(id);
    mark(id, what);
    try {
      const reply = await run(api);
      replace(reply.connector);
      announce(id);
      return true;
    } catch (error) {
      fail(id, error);
      return false;
    } finally {
      mark(id, null);
    }
  }

  return {
    ...EMPTY,

    async load() {
      const api = deps.api();
      if (!api) {
        set({ loaded: false, problem: null });
        return;
      }
      const mine = ++newestList;
      const askedAt = stamp;
      try {
        const page = await api.connectors();
        // A newer read was asked meanwhile: its answer is the one that may write.
        if (mine !== newestList) return;
        set((s) => ({
          // A row an act or the flow poll wrote after this read was asked is newer than the list.
          items: page.connectors.map((c) =>
            (rowStamps.get(c.id) ?? 0) > askedAt ? (s.items.find((x) => x.id === c.id) ?? c) : c,
          ),
          loaded: true,
          problem: null,
          recordsNotice: typeof page.records_notice === "string" ? page.records_notice : "",
        }));
      } catch (error) {
        if (mine !== newestList) return;
        // Verbatim: an unreadable list must not render as an empty one.
        set({ loaded: true, problem: problemOf(error) });
      }
    },

    async connect(id, body) {
      const ok = await act(id, "connecting", (api) => api.connectorAct(id, "connect", body));
      if (!ok) return;
      const row = get().items.find((c) => c.id === id);
      if (row?.flow && (row.flow.phase === "awaiting_consent" || row.flow.phase === "exchanging")) {
        await get().pollFlow(id);
      }
    },

    disconnect: (id) => act(id, "disconnecting", (api) => api.connectorAct(id, "disconnect")).then(() => {}),

    probe: (id) => act(id, "probing", (api) => api.connectorAct(id, "probe")).then(() => {}),

    settings: (id, patch) =>
      act(id, "saving", (api) => api.connectorAct(id, "settings", { ...patch })).then(() => {}),

    async pollFlow(id) {
      if (!deps.api()) return;
      // Single-flight: the daemon replaces an open flow with a newer one, so a second connect
      // leaves the older poll watching a flow that is gone. The newest poll owns the connector.
      const mine = ++pollSeq;
      polls.set(id, mine);
      const current = () => polls.get(id) === mine;
      mark(id, WAITING_WORD);
      // The reason a failed read put up, so the next good read takes down that one and no other.
      let shown: string | null = null;
      try {
        for (;;) {
          // Asked each time: the poll ends when the daemon goes, never asking nobody.
          const api = deps.api();
          if (!api) return;
          let reply: Awaited<ReturnType<DaemonApi["connectorAct"]>>;
          try {
            reply = await api.connectorAct(id, "flow");
          } catch (error) {
            if (!current()) return;
            fail(id, error);
            // The daemon answered and refused (a 4xx): the flow is not there to wait for. A read
            // that never reached it, or a 5xx, is not the consent ending: the person may be in the
            // browser right now, so the poll says so and asks again (as the voice install poll does).
            if (error instanceof ApiError && error.status < 500) return;
            shown = reasonOf(error);
            await deps.wait(FLOW_POLL_MS);
            continue;
          }
          if (!current()) return;
          if (shown !== null && get().errors[id] === shown) clearError(id);
          shown = null;
          replace(reply.connector);
          const phase = reply.flow?.phase ?? reply.connector.flow?.phase;
          if (!phase || phase === "done" || phase === "failed") {
            announce(id);
            return;
          }
          await deps.wait(FLOW_POLL_MS);
          if (!current()) return;
        }
      } finally {
        if (current()) {
          polls.delete(id);
          mark(id, null);
        }
      }
    },
  };
});

/**
 * Re-read the list when the other window says a connector moved (ADR 0116). Its own word is
 * skipped, and so is a mirror nobody in this window has asked for: it reads when it is asked.
 */
export function reloadOnConnectorsChanged(change: ConnectorsChanged): void {
  if (change.from === CONNECTORS_SOURCE || !useConnectors.getState().loaded) return;
  void useConnectors.getState().load();
}

/** The connector cards already read for, by card id; pruned to the cards still waiting. */
const asked = new Set<string>();

/**
 * Her window's mirror (ADR 0116): one `GET /connectors` for each connector card that arrives, so
 * the card names the account as the vault holds it now, and none for a page's card. A card the
 * 30 s re-poll hands back is not a new arrival. `read` and `subscribe` are the run store's cards,
 * passed in so this store does not import the turn. Returns what to undo.
 */
export function followCards(
  read: () => readonly { id: string; origin: string }[],
  subscribe: (f: () => void) => () => void,
): () => void {
  const check = () => {
    const cards = read();
    const waiting = new Set(cards.map((c) => c.id));
    for (const id of asked) if (!waiting.has(id)) asked.delete(id);
    const fresh = cards.filter((c) => c.origin.startsWith("connector:") && !asked.has(c.id));
    // Not ready: nothing is marked, so the next change of the cards asks again.
    if (!fresh.length || !deps.api()) return;
    fresh.forEach((c) => asked.add(c.id));
    void useConnectors.getState().load();
  };
  const stop = subscribe(check);
  check();
  return stop;
}

let started = false;

/** Listen for `connectors:changed`. Called by both window roots; a no-op without a shell. */
export async function startConnectors(): Promise<void> {
  if (started || !hasShell()) return;
  started = true;
  await onConnectorsChanged(reloadOnConnectorsChanged);
}
