/**
 * The constellation, layer 1 of the Devices level — ADR 0140 ("Pairing + Devices page"),
 * fleet-surfaces WP3 (design decision D1: a constellation, not device cards and not a ledger).
 *
 * This computer is the centre. Every paired device sits on an orbit around it, at an angle fixed
 * by its place in a stable order (oldest pairing first), so a device does not wander between two
 * readings of the list. The line from the centre says how the device stands *now*, from the
 * daemon's presence probe (WP2): lit, with a slow flow along it, when Athena there answered; dim
 * when the private network sees the device but Athena there does not answer (asleep); broken when
 * neither (out of reach); a plain hairline before the first probe, and always for a phone, which
 * runs no daemon to answer. A request waiting on this person is a pulsing node that "wants to
 * join"; a computer this one asked to join is a dotted node until the other side answers. Two '+'
 * nodes sit at the foot of the orbit - a phone, a computer - and the pairing wizard grows out of
 * whichever was pressed.
 *
 * Geometry is one coordinate space, {@link SKY}: the lines are an SVG stretched over the stage
 * (`preserveAspectRatio="none"`, strokes that do not scale), and every node is a real `<button>`
 * placed at the same point in percent, so the stage can change its aspect at a narrow width and
 * the nodes stay on their lines. Text is HTML, never SVG text, so it keeps the type ramp and the
 * 12px floor. A visually hidden list says the same things in reading order.
 *
 * Pressing a node opens its details below the stage - an in-layer drawer with a caret under the
 * node, not a route: this computer's name and phone switch, a device's presence, grants, memory,
 * message box and Revoke, a request's approve card, a join's state.
 *
 * A computer's room (device-vitals, ADR 0142) rides on the same nodes: the gate's one word after
 * the caption ("Online · room ok"), and in the drawer the figures behind it (`vitals.tsx`), for
 * this computer and for each paired one. A phone is not measured, so it says nothing of room.
 */
import { useEffect, useState, type ReactNode, type Ref } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import Facts, { Fact } from "@/components/Facts";
import FormField, { TextInput } from "@/components/FormField";
import type { Tone } from "@/components/StatusDot";
import { overlayWords, type DeviceKind, type DevicesView, type JoinView, type OverlayState, type PeerView, type PendingView, type Presence } from "@/lib/fleet";
import { clockOf, whenAgo } from "@/lib/time";
import type { Conversation } from "@/stores/devices";

import type { DevicesModel } from "./devices";
import { HeldLine, VitalsFacts, roomSaid, withRoom } from "./vitals";
import { GRANT_WORDS, JOIN_WORDS, KIND_WORD, PendingCard, Refusal, type Answered } from "./wizard";

/** The stage's coordinate space: its size, the centre, and the orbit's two radii. */
export const SKY = { w: 1000, h: 640, cx: 500, cy: 320, rx: 340, ry: 222 } as const;

/** A point in {@link SKY} units. */
export interface Spot {
  x: number;
  y: number;
}

/** Where the arc of devices starts and how far it runs, in degrees (0 = east, 90 = south). */
const ARC_FROM = 150;
const ARC_SPAN = 240;
/** Past this many, every other node moves to an inner orbit so labels do not touch. */
const ONE_RING = 9;
/** The '+' nodes, at the foot of the orbit, in the gap the arc leaves. */
const ADD_ANGLE: Readonly<Record<DeviceKind, number>> = { phone: 114, pc: 66 };

function onOrbit(degrees: number, scale = 1): Spot {
  const r = (degrees * Math.PI) / 180;
  return { x: Math.round(SKY.cx + SKY.rx * scale * Math.cos(r)), y: Math.round(SKY.cy + SKY.ry * scale * Math.sin(r)) };
}

/** The spots of `count` nodes on the arc, evenly, the first at its western end; one alone is at the top. */
export function orbitSpots(count: number): Spot[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = ARC_FROM + ((i + 0.5) * ARC_SPAN) / count;
    return onOrbit(angle, count > ONE_RING && i % 2 === 1 ? 0.66 : 1);
  });
}

export const ADD_SPOT: Readonly<Record<DeviceKind, Spot>> = { phone: onOrbit(ADD_ANGLE.phone), pc: onOrbit(ADD_ANGLE.pc) };

/** A spot in percent of the stage, for a node's `left`/`top` and the wizard's transform origin. */
export function percentOf(spot: Spot): { x: number; y: number } {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { x: round((spot.x / SKY.w) * 100), y: round((spot.y / SKY.h) * 100) };
}

export type SkyNode =
  | { key: string; role: "peer"; peer: PeerView; at: Spot }
  | { key: string; role: "joining"; join: JoinView; at: Spot }
  | { key: string; role: "pending"; pending: PendingView; at: Spot };

/**
 * Every node but the centre and the '+' pair, in orbit order: the paired devices, oldest first
 * (ties by id), then this computer's own asks, then the requests waiting here.
 */
export function skyNodes(view: DevicesView): SkyNode[] {
  const peers = [...view.peers].sort((a, b) => a.created.localeCompare(b.created) || a.peer_id.localeCompare(b.peer_id));
  const joining = [...view.joining].sort((a, b) => a.join_id.localeCompare(b.join_id));
  const pending = [...view.pending].sort((a, b) => a.pairing_id.localeCompare(b.pairing_id));
  const spots = orbitSpots(peers.length + joining.length + pending.length);
  let i = 0;
  return [
    ...peers.map((peer) => ({ key: peer.peer_id, role: "peer" as const, peer, at: spots[i++]! })),
    ...joining.map((join) => ({ key: join.join_id, role: "joining" as const, join, at: spots[i++]! })),
    ...pending.map((row) => ({ key: row.pairing_id, role: "pending" as const, pending: row, at: spots[i++]! })),
  ];
}

/** The key of the centre node in `selected`. */
export const SELF = "self";

/** How often an open computer's figures are read again: the presence probe's hello beat. */
export const VITALS_REREAD_MS = 30_000;

/** How a presence reads: one word, its hue, and the line's state. `null` is "not checked yet". */
const PRESENCE: Readonly<Record<Presence | "none", { word: string; tone: Tone }>> = {
  online: { word: "Online", tone: "success" },
  asleep: { word: "Asleep", tone: "neutral" },
  unreachable: { word: "Out of reach", tone: "warning" },
  none: { word: "Not checked yet", tone: "neutral" },
};

const presenceOf = (peer: PeerView): Presence | "none" => peer.presence ?? "none";

const OVERLAY_TONE: Readonly<Record<OverlayState, Tone>> = {
  absent: "warning",
  logged_out: "warning",
  up: "success",
};

/** The node's caption: how it stands, in a few words. A phone is never probed, so it says when it was seen. */
export function presenceCaption(peer: PeerView, now: number): string {
  const seen = peer.last_seen ? `seen ${whenAgo(peer.last_seen, now)}` : "not seen yet";
  switch (peer.presence ?? null) {
    case "online":
      return "Online";
    case "asleep":
      return `Asleep · ${seen}`;
    case "unreachable":
      return `Out of reach · ${seen}`;
    case null:
      return seen.charAt(0).toUpperCase() + seen.slice(1);
  }
}

/** The memory line under a computer: when it last pulled, or the replication's own word when not ok. */
function memoryCaption(peer: PeerView, now: number): string | null {
  const memory = peer.memory ?? null;
  if (memory === null) return null;
  if (memory.state !== "ok") return `Memory: ${memory.state}`;
  return memory.last_pull_at ? `Memory synced ${whenAgo(memory.last_pull_at, now)}` : "Memory not synced yet";
}

/** The memory fact in full: state, how many pulled, when. A dash before the first pull. */
export function memoryWords(peer: PeerView, now: number): string {
  const memory = peer.memory ?? null;
  if (memory === null) return "-";
  const when = memory.last_pull_at ? whenAgo(memory.last_pull_at, now) : "never";
  return `${memory.state}, ${memory.pulled} pulled, ${when}`;
}

function nodeLabel(node: SkyNode, now: number): string {
  switch (node.role) {
    case "peer": {
      const { peer } = node;
      return `${peer.name}, ${KIND_WORD[peer.kind].toLowerCase()}, ${presenceSaid(peer, now)}. Show its details.`;
    }
    case "joining":
      return `${node.join.name || node.join.address}, a computer this one asked to join: ${JOIN_WORDS[node.join.state] ?? node.join.state}. Show the request.`;
    case "pending":
      return `${node.pending.name}, a ${KIND_WORD[node.pending.kind].toLowerCase()}, wants to join. Answer it.`;
  }
}

/** A computer or a phone, drawn small. */
export function DeviceGlyph({ kind }: { kind: DeviceKind }) {
  return (
    <svg className="cnode__glyph" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      {kind === "pc" ? (
        <>
          <rect x="4" y="6" width="24" height="16" rx="2.5" />
          <path d="M12 27h8M16 22v5" />
        </>
      ) : (
        <>
          <rect x="10" y="3.5" width="12" height="25" rx="3" />
          <path d="M14.5 24.5h3" />
        </>
      )}
    </svg>
  );
}

/** The line from the centre to one node, in the node's state. A broken line has a gap at its middle. */
function Link({ to, state }: { to: Spot; state: string }) {
  const { cx, cy } = SKY;
  if (state === "unreachable") {
    const at = (t: number) => ({ x: Math.round(cx + (to.x - cx) * t), y: Math.round(cy + (to.y - cy) * t) });
    const a = at(0.44);
    const b = at(0.56);
    return (
      <g className="sky__link" data-state={state}>
        <line x1={cx} y1={cy} x2={a.x} y2={a.y} vectorEffect="non-scaling-stroke" />
        <line x1={b.x} y1={b.y} x2={to.x} y2={to.y} vectorEffect="non-scaling-stroke" />
      </g>
    );
  }
  return (
    <g className="sky__link" data-state={state}>
      <line x1={cx} y1={cy} x2={to.x} y2={to.y} vectorEffect="non-scaling-stroke" />
      {state === "online" ? <line className="sky__flow" x1={cx} y1={cy} x2={to.x} y2={to.y} vectorEffect="non-scaling-stroke" /> : null}
    </g>
  );
}

function linkState(node: SkyNode): string {
  if (node.role === "peer") return presenceOf(node.peer);
  return node.role;
}

/** One node: a disc with the glyph, the name and a caption, placed on its spot. */
function Node({
  at,
  className,
  label,
  selected,
  attrs,
  onClick,
  disc,
  name,
  caption,
  extra,
  buttonRef,
}: {
  at: Spot;
  className: string;
  label: string;
  selected: boolean;
  attrs?: Record<string, string | undefined>;
  onClick: () => void;
  disc: ReactNode;
  name: string;
  caption: string | null;
  extra?: string | null;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const { x, y } = percentOf(at);
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`cnode ${className} focus-ring`}
      style={{ left: `${x}%`, top: `${y}%` }}
      aria-label={label}
      aria-expanded={selected}
      data-selected={selected ? "1" : undefined}
      onClick={onClick}
      {...attrs}
    >
      <span className="cnode__disc">{disc}</span>
      <span className="cnode__name">{name}</span>
      {caption ? <span className="cnode__caption">{caption}</span> : null}
      {extra ? <span className="cnode__caption">{extra}</span> : null}
    </button>
  );
}

export interface ConstellationProps {
  model: DevicesModel;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onAdd: (kind: DeviceKind) => void;
  /** The wizard is open: the sky dims, and nothing in it takes the focus or a click. */
  dim: boolean;
  /** The '+' nodes, so the wizard can hand the focus back to the one it grew from. */
  addRef: (kind: DeviceKind) => Ref<HTMLButtonElement>;
}

export default function Constellation({ model, selected, onSelect, onAdd, dim, addRef }: ConstellationProps) {
  const view = model.state.view!;
  const nodes = skyNodes(view);
  const lonely = nodes.length === 0;
  const toggle = (key: string) => onSelect(selected === key ? null : key);
  const centre = { x: SKY.cx, y: SKY.cy };
  return (
    <div className="sky" data-dim={dim ? "1" : undefined} data-lonely={lonely ? "1" : undefined} inert={dim}>
      <svg className="sky__lines" viewBox={`0 0 ${SKY.w} ${SKY.h}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <ellipse className="sky__orbit" cx={SKY.cx} cy={SKY.cy} rx={SKY.rx} ry={SKY.ry} vectorEffect="non-scaling-stroke" />
        <ellipse className="sky__orbit sky__orbit--inner" cx={SKY.cx} cy={SKY.cy} rx={SKY.rx * 0.5} ry={SKY.ry * 0.5} vectorEffect="non-scaling-stroke" />
        {nodes.map((node) => (
          <Link key={node.key} to={node.at} state={linkState(node)} />
        ))}
      </svg>
      {lonely ? (
        <p className="sky__invite typo-body">
          Only this computer so far. Add your phone or another computer, and they share one Athena: one memory, one set of approvals.
        </p>
      ) : null}
      <div className="sky__nodes" role="group" aria-label="Your devices, around this computer">
        <Node
          at={centre}
          className="cnode--self"
          label={`${view.self.name}, this computer. Private network: ${overlayWords(view.overlay.state).toLowerCase()}.${selfRoom(view)} Show its details.`}
          selected={selected === SELF}
          attrs={{ "data-overlay": view.overlay.state }}
          onClick={() => toggle(SELF)}
          disc={<DeviceGlyph kind="pc" />}
          name={view.self.name}
          caption={withRoom(`This computer · network ${overlayWords(view.overlay.state).toLowerCase()}`, view.self.vitals)}
        />
        {nodes.map((node) => {
          const common = { at: node.at, label: nodeLabel(node, model.now), selected: selected === node.key, onClick: () => toggle(node.key) };
          if (node.role === "peer") {
            return (
              <Node
                key={node.key}
                {...common}
                className="cnode--peer"
                attrs={{ "data-presence": presenceOf(node.peer), "data-kind": node.peer.kind }}
                disc={<DeviceGlyph kind={node.peer.kind} />}
                name={node.peer.name}
                caption={withRoom(presenceCaption(node.peer, model.now), node.peer.vitals)}
                extra={node.peer.kind === "pc" ? memoryCaption(node.peer, model.now) : null}
              />
            );
          }
          if (node.role === "joining") {
            return (
              <Node
                key={node.key}
                {...common}
                className="cnode--joining"
                attrs={{ "data-state": node.join.state }}
                disc={<DeviceGlyph kind="pc" />}
                name={node.join.name || node.join.address}
                caption={node.join.state === "pending" ? "asked to join it" : (JOIN_WORDS[node.join.state] ?? node.join.state)}
              />
            );
          }
          return (
            <Node
              key={node.key}
              {...common}
              className="cnode--pending"
              attrs={{ "data-kind": node.pending.kind }}
              disc={<DeviceGlyph kind={node.pending.kind} />}
              name={node.pending.name}
              caption="wants to join"
            />
          );
        })}
        {(["phone", "pc"] as const).map((kind) => {
          const { x, y } = percentOf(ADD_SPOT[kind]);
          return (
            <button
              key={kind}
              ref={addRef(kind)}
              type="button"
              className="cnode cnode--add focus-ring"
              data-kind={kind}
              style={{ left: `${x}%`, top: `${y}%` }}
              aria-label={kind === "phone" ? "Add a phone: show a code to scan" : "Add a computer: show or type a code"}
              aria-haspopup="dialog"
              onClick={() => onAdd(kind)}
            >
              <span className="cnode__disc">
                <svg className="cnode__plus" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                  <path d="M16 9v14M9 16h14" />
                </svg>
              </span>
              <span className="cnode__name">{kind === "phone" ? "+ phone" : "+ PC"}</span>
            </button>
          );
        })}
      </div>
      {nodes.some((n) => n.role === "peer") ? (
        <ul className="sky__legend" aria-hidden="true">
          <li data-state="online">online</li>
          <li data-state="asleep">asleep</li>
          <li data-state="unreachable">out of reach</li>
        </ul>
      ) : null}
    </div>
  );
}

/** The same devices as a list, in reading order, for a screen reader; drawn nowhere. */
export function DevicesList({ model }: { model: DevicesModel }) {
  const view = model.state.view!;
  const nodes = skyNodes(view);
  return (
    <ul className="devices__sr" aria-label="Your devices as a list">
      <li>{`${view.self.name}: this computer. Private network: ${overlayWords(view.overlay.state)}.${selfRoom(view)}`}</li>
      {nodes.map((node) => (
        <li key={node.key}>
          {node.role === "peer"
            ? `${node.peer.name}: ${KIND_WORD[node.peer.kind].toLowerCase()}, ${presenceSaid(node.peer, model.now)}. May ${
                node.peer.grants.map((g) => GRANT_WORDS[g]).join(", ") || "do nothing"
              }.${node.peer.kind === "pc" ? ` Memory: ${memoryWords(node.peer, model.now)}.` : ""}`
            : node.role === "joining"
              ? `${node.join.name || node.join.address}: asked to join it, ${JOIN_WORDS[node.join.state] ?? node.join.state}.`
              : `${node.pending.name}: a ${KIND_WORD[node.pending.kind].toLowerCase()} that wants to join, waiting for you.`}
        </li>
      ))}
    </ul>
  );
}

/** This computer's room as a sentence of its own, " Room ok." or nothing. */
function selfRoom(view: DevicesView): string {
  const room = roomSaid(view.self.vitals);
  return room ? ` ${room.charAt(0).toUpperCase()}${room.slice(1)}.` : "";
}

/** A peer's presence as read aloud, its room after it: "online, room is tight". */
function presenceSaid(peer: PeerView, now: number): string {
  const presence = presenceCaption(peer, now).toLowerCase();
  const room = roomSaid(peer.vitals);
  return room ? `${presence}, ${room}` : presence;
}

/** Where the drawer's caret points: the selected node's centre, in percent of the stage's width. */
export function caretOf(view: DevicesView, selected: string): number {
  if (selected === SELF) return 50;
  const node = skyNodes(view).find((n) => n.key === selected);
  return node ? percentOf(node.at).x : 50;
}

/**
 * The details of the selected node, under the stage. `null` when the selection is gone (a peer
 * revoked, a request answered elsewhere): the drawer simply is not there.
 */
export function Drawer({
  model,
  selected,
  onClose,
  onAnswered,
}: {
  model: DevicesModel;
  selected: string;
  onClose: () => void;
  onAnswered?: (answer: Answered) => void;
}) {
  const view = model.state.view!;
  const node = selected === SELF ? null : skyNodes(view).find((n) => n.key === selected);
  const computer = selected === SELF || (node?.role === "peer" && node.peer.kind === "pc");
  const { load } = model.actions;
  // The bus says a room's word when it changes, not its figures (ADR 0142): while a computer's
  // figures are open, the list is read again on the beat of the hello that carries a peer's.
  useEffect(() => {
    if (!computer) return;
    const timer = setInterval(() => void load(), VITALS_REREAD_MS);
    return () => clearInterval(timer);
  }, [computer, load]);
  if (selected !== SELF && !node) return null;
  const caret = caretOf(view, selected);
  const head =
    selected === SELF
      ? { name: view.self.name, kind: "pc" as DeviceKind, note: "This computer" }
      : node!.role === "peer"
        ? { name: node!.peer.name, kind: node!.peer.kind, note: KIND_WORD[node!.peer.kind] }
        : node!.role === "pending"
          ? { name: node!.pending.name, kind: node!.pending.kind, note: "Wants to join" }
          : { name: node!.join.name || node!.join.address, kind: "pc" as DeviceKind, note: "Asked to join it" };
  return (
    <section className="cdrawer" aria-labelledby="cdrawer-name" style={{ ["--caret" as string]: `${caret}%` }}>
      <header className="cdrawer__head">
        <span className="cdrawer__disc" aria-hidden="true">
          <DeviceGlyph kind={head.kind} />
        </span>
        <div className="cdrawer__titles">
          <p className="typo-caption">{head.note}</p>
          <h3 id="cdrawer-name" className="cdrawer__name">
            {head.name}
          </h3>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </header>
      {selected === SELF ? (
        <ThisComputer model={model} />
      ) : node!.role === "peer" ? (
        <PeerDetails model={model} peer={node!.peer} />
      ) : node!.role === "pending" ? (
        <PendingCard model={model} row={node!.pending} onAnswered={onAnswered} />
      ) : (
        <Facts>
          <Fact label="Its address" value="code">
            {node!.join.address}
          </Fact>
          <Fact label="Where it stands">{JOIN_WORDS[node!.join.state] ?? node!.join.state}</Fact>
          <Fact label="The ask lapses at">{clockOf(node!.join.expires_at)}</Fact>
        </Facts>
      )}
    </section>
  );
}

function ThisComputer({ model }: { model: DevicesModel }) {
  const view = model.state.view!;
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? view.self.name;
  const typed = draft?.trim() ?? "";
  const dirty = draft !== null && typed !== "" && typed !== view.self.name;
  const commit = () => {
    if (!dirty) return;
    void model.actions.rename(typed);
    setDraft(null);
  };
  const on = view.beacon.on;
  return (
    <div className="cdrawer__body">
      <div className="mind__row">
        <Badge tone={OVERLAY_TONE[view.overlay.state]} title="The private network this computer talks to the others over">
          {`Private network: ${overlayWords(view.overlay.state)}`}
        </Badge>
        {view.listener.up && view.listener.address ? (
          <span className="typo-caption">{`Listening at ${view.listener.address}:${view.listener.port}`}</span>
        ) : null}
        {view.listener.error ? <span className="typo-caption">Athena could not listen: {view.listener.error}</span> : null}
      </div>
      <Facts>
        <VitalsFacts vitals={view.self.vitals} presence="online" now={model.now} />
      </Facts>
      <HeldLine vitals={view.self.vitals} />
      <FormField
        label="Its name"
        hint="What your other devices call this one."
        error={model.state.errors.rename ?? null}
        action={
          <Button
            size="sm"
            variant={dirty ? "primary" : "secondary"}
            disabledReason={dirty ? undefined : model.state.busy.rename ? "Renaming…" : "Type a new name first."}
            onClick={commit}
          >
            Rename
          </Button>
        }
      >
        {(input) => (
          <TextInput
            {...input}
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setDraft(null);
            }}
          />
        )}
      </FormField>
      <div className="cdrawer__beacon">
        <div>
          <p className="typo-body">Let your phone reach Athena here</p>
          <p className="typo-caption">
            While this window is open, a paired phone can chat with Athena on this computer and answer her approvals, from any
            network, over the private network.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Let your phone reach Athena here"
          className="pill focus-ring"
          disabled={Boolean(model.state.busy.beacon)}
          onClick={() => void model.actions.setBeacon(!on)}
        >
          {on ? "On" : "Off"}
        </button>
      </div>
      {on && view.overlay.state !== "up" ? (
        <p className="typo-caption">On, but the private network is {overlayWords(view.overlay.state).toLowerCase()}.</p>
      ) : null}
      <Refusal text={model.state.errors.beacon} />
    </div>
  );
}

function PeerDetails({ model, peer }: { model: DevicesModel; peer: PeerView }) {
  const presence = PRESENCE[presenceOf(peer)];
  return (
    <div className="cdrawer__body">
      <Facts>
        <Fact label="Kind">{KIND_WORD[peer.kind]}</Fact>
        <Fact label="Now">
          <Badge tone={presence.tone}>{peer.kind === "phone" && !peer.presence ? "Not probed (a phone)" : presence.word}</Badge>
          {peer.presence_at ? <span className="typo-caption">{` changed ${whenAgo(peer.presence_at, model.now)}`}</span> : null}
        </Fact>
        <Fact label="Last seen">{peer.last_seen ? whenAgo(peer.last_seen, model.now) : "never"}</Fact>
        <Fact label="May">{peer.grants.length ? peer.grants.map((g) => GRANT_WORDS[g]).join(", ") : "-"}</Fact>
        <Fact label="Memory">{memoryWords(peer, model.now)}</Fact>
        {peer.kind === "pc" ? <VitalsFacts vitals={peer.vitals} presence={peer.presence ?? null} now={model.now} /> : null}
      </Facts>
      {peer.kind === "pc" ? <HeldLine vitals={peer.vitals} /> : null}
      {peer.kind === "pc" ? <MessageBox model={model} peer={peer} /> : null}
      <div className="mind__row">
        <Button
          size="sm"
          variant="secondary"
          disabledReason={model.state.busy[peer.peer_id] ? "Revoking…" : undefined}
          onClick={() => void model.actions.revoke(peer.peer_id)}
        >
          Revoke
        </Button>
        <span className="typo-caption">It is let in no more, at once; pair it again to undo.</span>
      </div>
      <Refusal text={model.state.errors[peer.peer_id]} />
    </div>
  );
}

const IDLE: Conversation = { requestId: null, phase: "done", lines: [], dropped: 0, problem: null };

function MessageBox({ model, peer }: { model: DevicesModel; peer: PeerView }) {
  const [draft, setDraft] = useState("");
  const conversation = model.state.conversations[peer.peer_id] ?? IDLE;
  const working = conversation.phase === "sending" || conversation.phase === "waiting";
  const send = () => {
    if (!draft.trim() || working) return;
    void model.actions.send(peer.peer_id, draft);
    setDraft("");
  };
  return (
    <div className="devices__message" aria-label={`Send a message to ${peer.name}`} role="group">
      <FormField
        label={`Send a message to ${peer.name}`}
        hint="Athena there runs it in her own window, with her own approvals, and her reply shows here."
        action={
          <Button
            size="sm"
            variant="primary"
            disabledReason={working ? "Waiting for the answer…" : draft.trim() ? undefined : "Type a message first."}
            onClick={send}
          >
            Send
          </Button>
        }
      >
        {(input) => (
          <TextInput
            {...input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
          />
        )}
      </FormField>
      {conversation.lines.length > 0 || conversation.problem ? (
        <div className="devices__reply" aria-live="polite">
          {conversation.dropped > 0 ? (
            <p className="typo-caption">
              (showing {conversation.lines.length} of {conversation.lines.length + conversation.dropped})
            </p>
          ) : null}
          {conversation.lines.map((line, n) => (
            <p key={n} className={`devices__line devices__line--${line.kind} typo-body`}>
              {line.kind === "you" ? `You: ${line.text}` : line.text}
            </p>
          ))}
          {conversation.phase === "waiting" ? (
            <p className="typo-caption" role="status">
              {peer.name} is working…
            </p>
          ) : null}
          <Refusal text={conversation.problem ?? undefined} />
        </div>
      ) : null}
    </div>
  );
}
