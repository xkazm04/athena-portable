/**
 * The fleet's wire, as the window reads it — ADR 0140 ("Data & API"), `src/athena/peer/devices.py`
 * and `src/athena/peer/remote.py`.
 *
 * Two streams that are not the turn's. `GET /events` carries what happened on the peer side while
 * the window was not asking (a phone asked to pair, a peer was revoked, another device sent a
 * message, a peer answered a card); `GET /devices/<peer>/turns/<request>` carries another device's
 * turn back here. Neither goes through `lib/events.ts`: that decoder is the thirteen channel events
 * and throws on anything else, which is right for a turn and wrong for a notification bus whose
 * kinds a later package may add to. So this file decodes the bus leniently - an unknown kind is
 * `null` and skipped, because the bus is a nudge and `GET /devices` is the state - and the turn
 * stream strictly, through `eventFromJson`, plus the one frame the tee adds: `remote.closed`.
 *
 * The shapes are the Python's, field for field, with absent values `null` (never omitted).
 */
import { eventFromJson, type ChannelEvent } from "@/lib/events";
import type { ExecuteRow } from "@/lib/api";
import type { TaskView } from "@/lib/tasks";
import type { Room, Vitals } from "@/lib/vitals";

export type Grant = "chat" | "approve" | "memory";
export const GRANTS: readonly Grant[] = ["chat", "approve", "memory"];
export type DeviceKind = "pc" | "phone";

/** WP2's replication status for one peer (`replicate.py` `_Status.view`), or `null` before a pull. */
export interface MemoryStatus {
  last_pull_at: string;
  pulled: number;
  conflicts: number;
  deferred: number;
  state: string;
}

/** `PeerRow.view()` plus `memory`. */
export interface PeerView {
  peer_id: string;
  name: string;
  kind: DeviceKind;
  grants: Grant[];
  created: string;
  expires: string | null;
  last_seen: string | null;
  /** Optional: a daemon from before replication sends none, which reads as `null`. */
  memory?: MemoryStatus | null;
  /** The presence probe's last verdict (fleet-surfaces WP2), `null` before the first probe. Optional
   * only because a daemon from before the probe sends none, which reads as `null`. */
  presence?: Presence | null;
  /** When `presence` was last decided (ISO), `null` before the first probe. */
  presence_at?: string | null;
  /** The peer's last vitals off its hello (device-vitals, ADR 0143): `null` for a phone, before the
   * first hello, or when older than 90 s. Optional only because an older daemon sends none. */
  vitals?: Vitals | null;
  /** How the link to this device stands (ADR 0140 "Link state", `peer/link.py`): what the probe saw,
   * which says more than `presence` when there is none to read (the other side removed this
   * device, no key arrived yet, the last hello is too old). Optional only because an older
   * daemon sends none. */
  link?: PeerLink | null;
}

/** The states `peer/link.py` derives. `state` is `null` until there is anything to say. */
export type LinkState = "phone" | "awaiting_key" | "online" | "stale" | "asleep" | "unreachable" | "removed_there";

/** `link.derive()`: the state, since when, and the facts behind it. */
export interface PeerLink {
  state: LinkState | null;
  since: string | null;
  evidence: Record<string, unknown>;
}

/** Online: an authorized hello answered. Asleep: the overlay sees the device, Athena there does not
 * answer. Unreachable: neither. */
export type Presence = "online" | "asleep" | "unreachable";

/** `PairingRecord.pending_view()`. `pair_back` is a PC this one joined, asking to be let in here. */
export interface PendingView {
  pairing_id: string;
  name: string;
  kind: DeviceKind;
  requested_grants: Grant[];
  expires_at: string;
  pair_back: boolean;
  /** Where the request came from, as the daemon's socket said (never the body's); `null` when unknown. */
  address: string | null;
  /** The paired device approving this would overwrite (its token dies), else `null`. */
  replaces: { peer_id: string; name: string } | null;
}

/** `Join.view()`: this PC asking another to let it in. */
export interface JoinView {
  join_id: string;
  address: string;
  name: string;
  state: string;
  expires_at: string;
}

export type OverlayState = "absent" | "logged_out" | "up";

/** `GET /devices`. */
export interface DevicesView {
  ok: boolean;
  /** `vitals` is this PC's own snapshot (ADR 0143), optional only for an older daemon. */
  self: { device_id: string; name: string; vitals?: Vitals | null };
  peers: PeerView[];
  pending: PendingView[];
  beacon: { on: boolean; url: string | null };
  overlay: { state: OverlayState };
  listener: { up: boolean; address: string | null; port: number; error: string | null };
  joining: JoinView[];
}

/**
 * `GET /devices/overlay`: the other devices on this person's private network, online ones first,
 * to pick the first computer's address from on the join form. Bounded; `footer` says what it cut.
 */
export interface OverlayPeers {
  ok: boolean;
  state: "no_overlay" | "logged_out" | "up";
  self_ip: string | null;
  peers: Array<{ name: string; ip: string; os: string; online: boolean }>;
  showing: number;
  total: number;
  footer: string;
}

/** `POST /devices/pairing`. `url` is the phone's QR target; `null` while the listener cannot bind. */
export interface PairingWindow {
  ok: boolean;
  pairing_id: string;
  code: string;
  url: string | null;
  expires_at: string;
}

/** A message another device sent this one (`remote.message`). */
export interface RemoteMessage {
  kind: "remote.message";
  request_id: string;
  peer_id: string;
  peer_name: string;
  text: string;
  target_app: string | null;
}

/** A peer answered one of this device's cards (`remote.decided`): the page here runs the execute. */
export interface RemoteDecided {
  kind: "remote.decided";
  approval_id: string;
  peer_id: string;
  peer_name: string;
  status: "approved" | "declined";
  execute: ExecuteRow[];
  output: string;
}

/**
 * A pairing window Athena opened from the setup conversation (`connector.setup.open_pairing`,
 * ADR 0140 WP4). The tool's answer - an episode, which replicates - never carries the phone's
 * address, whose nonce is a claim credential; the code and the address come to this device's own
 * window here instead, on the loopback bus, so the Devices level can show them.
 */
export interface PairOpened {
  kind: "pair.opened";
  pairing_id: string;
  device_kind: DeviceKind;
  code: string;
  url: string | null;
  expires_at: string;
}

export type BusEvent =
  | RemoteMessage
  | RemoteDecided
  | PairOpened
  | { kind: "peer.changed"; peer_id: string | null }
  | { kind: "pair.requested"; pending: PendingView }
  | { kind: "task.changed"; task: TaskView }
  | { kind: "vitals.changed"; room: Room | null; held: string | null; slots: number }
  | { kind: "sleep.changed" };

const BUS_KINDS = new Set(["remote.message", "remote.decided", "peer.changed", "pair.requested", "pair.opened", "task.changed", "vitals.changed", "sleep.changed"]);

/** One `/events` frame, or `null` for a kind this window does not act on. Never throws on a kind. */
export function busEventFromJson(raw: string): BusEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const kind = (parsed as { kind?: unknown }).kind;
  return typeof kind === "string" && BUS_KINDS.has(kind) ? (parsed as BusEvent) : null;
}

/** The last frame of another device's turn: why the tee closed, and what it kept. */
export interface TurnClosed {
  kind: "remote.closed";
  request_id: string;
  reason: "finished" | "error" | "expired";
  showing: number;
  total: number;
  footer: string;
}

export type TurnFrame = ChannelEvent | TurnClosed;

/** One frame of a relayed turn. A channel event is decoded strictly, as the panel's own are. */
export function turnFrameFromJson(raw: string): TurnFrame {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed === "object" && parsed !== null && (parsed as { kind?: unknown }).kind === "remote.closed") {
    return parsed as TurnClosed;
  }
  return eventFromJson(raw);
}

/** The plain words for the overlay's state (ADR 0139 vocabulary). */
export function overlayWords(state: OverlayState): string {
  switch (state) {
    case "absent":
      return "Not set up";
    case "logged_out":
      return "Signed out";
    case "up":
      return "Ready";
  }
}

/** What `followBus` needs of the daemon client: only its event stream. */
export interface BusSource {
  events(signal?: AbortSignal): AsyncGenerator<BusEvent>;
}

/** How long the follower waits before it reconnects: the `retry: 1000` the daemon sends. */
export const BUS_RETRY_MS = 1000;

type Follower = [on: (event: BusEvent) => void, connected: (() => void) | undefined];

/** The window's one `/events` stream: who listens to it, and what stops it. */
const followers = new Set<Follower>();
let halt: AbortController | null = null;

/**
 * Follow `GET /events` for as long as the window lives: reconnect a second after each end (the
 * daemon ends a quiet stream every 15 s, ADR 0011) or failure, and wait while the daemon is not
 * ready. `connected` is called on each (re)connect, which is when a reader re-reads the state it
 * mirrors, because a frame published between two streams is missed. Returns what stops it.
 *
 * Every caller in a window shares ONE stream, fanned out here: the devices, sleep, tasks and run
 * stores would otherwise hold four long-lived connections of the host's pool of six, and a json
 * call would queue behind nudges. The stream opens with the first follower and closes with the
 * last. One that joins a live stream has read for itself on starting (every holder does), and hears
 * the next reconnect with the rest.
 */
export function followBus(
  source: () => BusSource | null,
  on: (event: BusEvent) => void,
  connected?: () => void,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): () => void {
  const me: Follower = [on, connected];
  followers.add(me);
  if (!halt) {
    const stop = (halt = new AbortController());
    void (async () => {
      while (!stop.signal.aborted) {
        const client = source();
        if (client) {
          try {
            for (const f of followers) f[1]?.();
            for await (const event of client.events(stop.signal)) {
              if (stop.signal.aborted) break;
              // A reader's own bug is said once and costs that reader that frame only: thrown out of
              // this loop it would end the stream for every follower.
              for (const f of followers) {
                try {
                  f[0](event);
                } catch (error) {
                  console.error("[athena] bus:", error);
                }
              }
            }
          } catch {
            // Refused, dropped or aborted: the next pass reconnects, or the loop has been stopped.
          }
        }
        if (!stop.signal.aborted) await wait(BUS_RETRY_MS);
      }
    })();
  }
  return () => {
    if (followers.delete(me) && !followers.size) {
      halt?.abort();
      halt = null;
    }
  };
}
