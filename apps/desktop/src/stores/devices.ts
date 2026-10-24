/**
 * The devices, as Main's window holds them — ADR 0140 ("Pairing + Devices page", "Remote acts").
 *
 * A mirror of `GET /devices` and nothing more: the daemon owns the identity, the peers, the
 * pending requests and the beacon, and every act here is a request after which the mirror is read
 * again. The store never mints, never holds a token and never decides a grant; the one thing it
 * keeps of its own is *when* each pending request was first shown (`seenAt`), because the Approve
 * button is armed only {@link ARM_MS} after a person could have read the card - a request that
 * appears under a moving pointer must not be approved by the click that was already on its way.
 *
 * The mirror follows `GET /events` while the Devices level is open (`startDevices`, started by the
 * level's live part and stopped when it goes): every `pair.requested`, `peer.changed` and
 * `pair.opened`, and every reconnect, re-reads the list. The bus is a nudge; the list is the state -
 * with one exception: `pair.opened` (a window Athena opened from the setup conversation) carries
 * the code and the phone's address, which `GET /devices` never lists, so the store keeps them in
 * `opened` exactly as when the person pressed the button here.
 *
 * "Send a message" lives here too (ADR 0140, "Remote acts"): a box per peer that posts
 * `POST /devices/<peer>/message` and reads that device's turn back through
 * `GET /devices/<peer>/turns/<request>`, coming back with `from` when the relay ends quietly, until
 * the tee says `remote.closed`. The composer device chip in her window is deferred (ADR 0140,
 * "Landing overlap"); this box is how a person reaches another computer's panel meanwhile.
 */
import { create } from "zustand";

import { ApiError, DaemonApi } from "@/lib/api";
import {
  followBus,
  type BusEvent,
  type DeviceKind,
  type DevicesView,
  type Grant,
  type OverlayPeers,
  type PairOpened,
  type PairingWindow,
  type PendingView,
  type TurnFrame,
} from "@/lib/fleet";
import { endpoint, useDaemon } from "@/stores/daemon";

/** How long a pending request is shown before its Approve button arms. */
export const ARM_MS = 1500;
/** How many times a relayed turn is read again after a quiet end before the box gives up. */
export const RELAY_ATTEMPTS = 40;
/** How many lines one conversation box keeps; older ones are dropped and counted. */
export const CONVERSATION_CAP = 200;

export interface DevicesDeps {
  api: () => DaemonApi | null;
  now: () => number;
  /** Follow the event bus; returns what stops it. Absent in a test that drives `load` by hand. */
  follow?: (onChange: () => void) => () => void;
}

const LIVE: DevicesDeps = {
  api: () => {
    const found = endpoint(useDaemon.getState());
    return found ? new DaemonApi(found) : null;
  },
  now: () => Date.now(),
  follow: (onChange) =>
    followBus(() => LIVE.api(), devicesHandler(onChange), onChange),
};

/**
 * What the Devices level does with one bus frame: a window Athena opened is kept as this device's
 * own (`pairOpened`), and every frame about pairing or peers re-reads the list.
 */
export function devicesHandler(onChange: () => void): (event: BusEvent) => void {
  return (event) => {
    if (event.kind === "pair.opened") useDevices.getState().pairOpened(event);
    if (event.kind === "pair.requested" || event.kind === "peer.changed" || event.kind === "pair.opened") onChange();
  };
}

let deps: DevicesDeps = LIVE;

export function setDevicesDeps(next: DevicesDeps): void {
  deps = next;
}

/** One line of a conversation with another device's panel. */
export interface ConversationLine {
  kind: "you" | "athena" | "tool" | "card" | "problem";
  text: string;
}

export interface Conversation {
  requestId: string | null;
  phase: "sending" | "waiting" | "done" | "error";
  lines: ConversationLine[];
  /** How many lines were dropped past {@link CONVERSATION_CAP}. */
  dropped: number;
  /** The plain sentence of a refusal or a failure; `null` while all is well. */
  problem: string | null;
}

export interface DevicesState {
  view: DevicesView | null;
  /** True once `/devices` has answered once - not the same fact as "nothing is paired". */
  loaded: boolean;
  /** Why the list could not be read; `null` when it was. */
  problem: string | null;
  /** What is in flight: `rename`, `beacon`, `pairing`, `join`, `<pairing_id>`, `<peer_id>`. */
  busy: Readonly<Record<string, true>>;
  /** The last refusal per act, in the daemon's words. */
  errors: Readonly<Record<string, string>>;
  /** The window this device opened, per kind: a phone's QR url, or the code another PC types. */
  opened: Readonly<Partial<Record<DeviceKind, PairingWindow>>>;
  /** When each pending request was first shown, by pairing id (ms). */
  seenAt: Readonly<Record<string, number>>;
  /** The grants a person unticked on a pending card, by pairing id. */
  unticked: Readonly<Record<string, readonly Grant[]>>;
  /** Each peer's conversation box. */
  conversations: Readonly<Record<string, Conversation>>;
  /** The private network's other devices, for the join form's pick list; `null` until read. */
  overlay: OverlayPeers | null;

  load: () => Promise<void>;
  rename: (name: string) => Promise<void>;
  setBeacon: (on: boolean) => Promise<void>;
  openPairing: (kind: DeviceKind) => Promise<void>;
  join: (address: string, code: string) => Promise<void>;
  /** Tick or untick a grant on a pending card. Only what was asked can be unticked; nothing added. */
  toggleGrant: (pairingId: string, grant: Grant) => void;
  answer: (pairingId: string, choice: "approve" | "decline") => Promise<void>;
  revoke: (peerId: string) => Promise<void>;
  send: (peerId: string, text: string) => Promise<void>;
  /** Read the private network's other devices. A failure leaves no pick list: the address is typed. */
  findPeers: () => Promise<void>;
  /** Athena opened a pairing window (`pair.opened`): show it as one opened here. */
  pairOpened: (event: PairOpened) => void;
}

export const EMPTY_DEVICES = {
  view: null as DevicesView | null,
  loaded: false,
  problem: null as string | null,
  busy: {} as Record<string, true>,
  errors: {} as Record<string, string>,
  opened: {} as Partial<Record<DeviceKind, PairingWindow>>,
  seenAt: {} as Record<string, number>,
  unticked: {} as Record<string, readonly Grant[]>,
  conversations: {} as Record<string, Conversation>,
  overlay: null as OverlayPeers | null,
};

/** Whether a pending card first shown at `seenAt` may be approved at `now`. */
export function isArmed(seenAt: number | undefined, now: number): boolean {
  return seenAt !== undefined && now - seenAt >= ARM_MS;
}

/** The grants an approval sends: what was asked, less what the person unticked. */
export function grantsOf(pending: PendingView, unticked: readonly Grant[] = []): Grant[] {
  return pending.requested_grants.filter((grant) => !unticked.includes(grant));
}

/** `seenAt` kept for the pending rows still listed, stamped `now` for the new ones. */
export function stampSeen(
  seenAt: Readonly<Record<string, number>>,
  pending: readonly PendingView[],
  now: number,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const row of pending) next[row.pairing_id] = seenAt[row.pairing_id] ?? now;
  return next;
}

/** A refusal in a person's words. The daemon's detail is already plain; a peer's word is kept. */
export function sentenceOf(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.word === "window_closed") {
      return `Athena on ${error.device || "that computer"} is asleep. Open it there and try again.`;
    }
    if (error.word === "peer_unreachable" || error.status === 502) {
      return "That computer did not answer. It may be off, or off the private network.";
    }
    if (error.status === 0) return "Athena is not running here yet.";
    return error.message || error.reason;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Append lines to a conversation, keeping the newest {@link CONVERSATION_CAP}. */
export function appendLines(conversation: Conversation, lines: readonly ConversationLine[]): Conversation {
  const all = [...conversation.lines, ...lines];
  const over = Math.max(0, all.length - CONVERSATION_CAP);
  return { ...conversation, lines: over ? all.slice(over) : all, dropped: conversation.dropped + over };
}

/** What one relayed frame adds to the box: text, a tool's line, a card waiting over there. */
export function linesOf(frame: TurnFrame, deviceName: string): ConversationLine[] {
  switch (frame.kind) {
    case "text.delta":
      return [{ kind: "athena", text: frame.text }];
    case "tool.result":
      return [{ kind: "tool", text: `${frame.name}: ${frame.ok ? "done" : (frame.error ?? "refused")}` }];
    case "decision.requested":
      return [{ kind: "card", text: `Waiting for an approval on ${deviceName}: ${frame.action}` }];
    case "decision.resolved":
      return [{ kind: "card", text: `Answered: ${frame.choice}` }];
    case "turn.error":
      return [{ kind: "problem", text: `It stopped: ${frame.detail || frame.reason}` }];
    case "remote.closed":
      return frame.footer ? [{ kind: "tool", text: frame.footer }] : [];
    default:
      return [];
  }
}

export const useDevices = create<DevicesState>((set, get) => {
  const api = () => deps.api();
  const notReady = () => new ApiError(0, "not_ready", "Athena is not running here yet.");

  /** One act: mark it busy, run it, read the list again, and put a refusal where it belongs. */
  async function act(key: string, run: (client: DaemonApi) => Promise<unknown>): Promise<boolean> {
    const client = api();
    if (!client) {
      set((s) => ({ errors: { ...s.errors, [key]: sentenceOf(notReady()) } }));
      return false;
    }
    set((s) => ({ busy: { ...s.busy, [key]: true }, errors: without(s.errors, key) }));
    let ok = true;
    try {
      await run(client);
    } catch (error) {
      ok = false;
      set((s) => ({ errors: { ...s.errors, [key]: sentenceOf(error) } }));
    } finally {
      set((s) => ({ busy: without(s.busy, key) }));
    }
    await get().load();
    return ok;
  }

  const talk = (peerId: string, change: (c: Conversation) => Conversation) =>
    set((s) => {
      const current = s.conversations[peerId] ?? { requestId: null, phase: "done", lines: [], dropped: 0, problem: null };
      return { conversations: { ...s.conversations, [peerId]: change(current) } };
    });

  return {
    ...EMPTY_DEVICES,

    async load() {
      const client = api();
      if (!client) {
        set({ problem: "Athena is not running here yet.", loaded: false });
        return;
      }
      try {
        const view = await client.devices();
        set((s) => ({
          view,
          loaded: true,
          problem: null,
          seenAt: stampSeen(s.seenAt, view.pending, deps.now()),
        }));
      } catch (error) {
        set({ problem: sentenceOf(error) });
      }
    },

    async rename(name) {
      await act("rename", (client) => client.renameSelf(name));
    },

    async setBeacon(on) {
      await act("beacon", async (client) => {
        await client.setBeacon(on);
        // The phone's QR is a pairing window of its own: open one when the beacon goes on.
        if (on) {
          const opened = await client.openPairing("phone");
          set((s) => ({ opened: { ...s.opened, phone: opened } }));
        } else {
          set((s) => ({ opened: { ...s.opened, phone: undefined } }));
        }
      });
    },

    async openPairing(kind) {
      await act(`pairing.${kind}`, async (client) => {
        const opened = await client.openPairing(kind);
        set((s) => ({ opened: { ...s.opened, [kind]: opened } }));
      });
    },

    async join(address, code) {
      await act("join", (client) => client.join(address.trim(), code.trim(), ["chat", "approve", "memory"]));
    },

    toggleGrant(pairingId, grant) {
      const pending = get().view?.pending.find((p) => p.pairing_id === pairingId);
      if (!pending || !pending.requested_grants.includes(grant)) return;
      set((s) => {
        const off = s.unticked[pairingId] ?? [];
        const next = off.includes(grant) ? off.filter((g) => g !== grant) : [...off, grant];
        return { unticked: { ...s.unticked, [pairingId]: next } };
      });
    },

    async answer(pairingId, choice) {
      const state = get();
      const pending = state.view?.pending.find((p) => p.pairing_id === pairingId);
      if (!pending) return;
      // The arm delay is the store's rule as well as the button's: an early approve is not sent.
      if (choice === "approve" && !isArmed(state.seenAt[pairingId], deps.now())) return;
      const grants = choice === "approve" ? grantsOf(pending, state.unticked[pairingId]) : null;
      if (choice === "approve" && grants?.length === 0) {
        set((s) => ({ errors: { ...s.errors, [pairingId]: "Leave at least one thing ticked, or decline." } }));
        return;
      }
      const ok = await act(pairingId, (client) => client.answerPending(pairingId, choice, grants));
      if (ok) set((s) => ({ unticked: without(s.unticked, pairingId) }));
    },

    async findPeers() {
      // An older daemon, no overlay, no answer: no pick list, and the address is typed as before.
      const overlay = await api()
        ?.overlayPeers()
        .catch(() => null);
      set({ overlay: overlay ?? null });
    },

    pairOpened({ device_kind: kind, pairing_id, code, url, expires_at }) {
      // Only a kind this level draws; the daemon's own frame, so its fields are taken as given.
      if (kind === "pc" || kind === "phone") {
        set((s) => ({ opened: { ...s.opened, [kind]: { ok: true, pairing_id, code, url: url ?? null, expires_at } } }));
      }
    },

    async revoke(peerId) {
      await act(peerId, (client) => client.revoke(peerId));
    },

    async send(peerId, text) {
      const words = text.trim();
      if (!words) return;
      const client = api();
      const name = get().view?.peers.find((p) => p.peer_id === peerId)?.name ?? "that computer";
      talk(peerId, (c) => appendLines({ ...c, phase: "sending", problem: null, requestId: null }, [{ kind: "you", text: words }]));
      if (!client) {
        talk(peerId, (c) => ({ ...c, phase: "error", problem: sentenceOf(notReady()) }));
        return;
      }
      let requestId: string;
      try {
        requestId = (await client.sendMessage(peerId, words)).request_id;
      } catch (error) {
        talk(peerId, (c) => ({ ...c, phase: "error", problem: sentenceOf(error) }));
        return;
      }
      talk(peerId, (c) => ({ ...c, phase: "waiting", requestId }));
      let from = 0;
      for (let attempt = 0; attempt < RELAY_ATTEMPTS; attempt += 1) {
        let closed = false;
        try {
          for await (const frame of client.turn(peerId, requestId, from)) {
            if (frame.kind === "remote.closed") closed = true;
            else from += 1;
            const lines = linesOf(frame, name);
            if (lines.length) talk(peerId, (c) => appendLines(c, lines));
            if (closed) break;
          }
        } catch (error) {
          talk(peerId, (c) => ({ ...c, phase: "error", problem: sentenceOf(error) }));
          return;
        }
        if (closed) {
          talk(peerId, (c) => ({ ...c, phase: "done" }));
          return;
        }
      }
      talk(peerId, (c) => ({ ...c, phase: "error", problem: `${name} has not finished; it is still working there.` }));
    },
  };
});

let stopDevices: (() => void) | null = null;

/** Read the list now and follow the bus until the returned function is called. Idempotent. */
export function startDevices(): () => void {
  if (stopDevices) return stopDevices;
  void useDevices.getState().load();
  // Once per opening, not per nudge: it asks the overlay, and the list of addresses rarely moves.
  void useDevices.getState().findPeers();
  const unfollow = deps.follow?.(() => void useDevices.getState().load()) ?? (() => {});
  stopDevices = () => {
    unfollow();
    stopDevices = null;
  };
  return stopDevices;
}

export function resetDevicesForTests(): void {
  stopDevices?.();
  deps = LIVE;
  useDevices.setState({ ...EMPTY_DEVICES });
}

function without<T>(map: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const next = { ...map };
  delete next[key];
  return next;
}
