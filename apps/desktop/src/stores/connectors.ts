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
 * The OAuth flow is polled from here (`pollFlow`) every 1.5 s while the consent page is open;
 * the module's `index.ts` starts a `load` when it mounts and when the daemon becomes ready, so a
 * surface that is not on screen costs nothing.
 */
import { create } from "zustand";

import { ApiError, DaemonApi, type ConnectorView } from "@/lib/api";
import { endpoint, useDaemon } from "@/stores/daemon";

/** How often the flow is asked where it stands while a consent page is open. */
export const FLOW_POLL_MS = 1500;

export interface ConnectorDeps {
  api: () => DaemonApi | null;
  /** `setTimeout`, so the headless test can drive the poll by hand. */
  wait: (ms: number) => Promise<void>;
}

const LIVE: ConnectorDeps = {
  api: () => {
    const found = endpoint(useDaemon.getState());
    return found ? new DaemonApi(found) : null;
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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
  /** Why the list could not be read, verbatim, or null. */
  problem: string | null;
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
  problem: null as string | null,
  busy: {} as Record<string, string>,
  errors: {} as Record<string, string>,
};

export function resetConnectorsForTests(): void {
  deps = LIVE;
  useConnectors.setState({ ...EMPTY });
}

function reasonOf(error: unknown): string {
  if (error instanceof ApiError) return error.message || error.reason;
  return error instanceof Error ? error.message : String(error);
}

export const useConnectors = create<ConnectorsState>((set, get) => {
  const replace = (row: ConnectorView) =>
    set((s) => ({
      items: s.items.some((c) => c.id === row.id)
        ? s.items.map((c) => (c.id === row.id ? row : c))
        : [...s.items, row],
    }));

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
      try {
        const page = await api.connectors();
        set({ items: page.connectors, loaded: true, problem: null });
      } catch (error) {
        // Verbatim: an unreadable list must not render as an empty one.
        set({ loaded: true, problem: reasonOf(error) });
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
      const api = deps.api();
      if (!api) return;
      mark(id, "waiting for consent");
      try {
        for (;;) {
          const reply = await api.connectorAct(id, "flow");
          replace(reply.connector);
          const phase = reply.flow?.phase ?? reply.connector.flow?.phase;
          if (!phase || phase === "done" || phase === "failed") return;
          await deps.wait(FLOW_POLL_MS);
        }
      } catch (error) {
        fail(id, error);
      } finally {
        mark(id, null);
      }
    },
  };
});
