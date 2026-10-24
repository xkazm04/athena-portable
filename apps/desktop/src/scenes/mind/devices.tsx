/**
 * The Devices level under Mind — ADR 0140 ("Pairing + Devices page", UX/UI spec), ADR 0139 words.
 *
 * Every device is a full Athena; this is where one meets the others. Five parts, top to bottom, in
 * the order a person needs them: this computer (its name and whether the private network is
 * ready), the phone ("Let your phone reach Athena here"), adding a computer (a code to read out,
 * or a code to type in), the requests waiting on this person, and "Your other computers" - with,
 * per computer, a box that sends a message into that computer's panel and shows what came back.
 *
 * A pure function of {@link DevicesModel}: the store's mirror of `GET /devices` plus `now`, so the
 * arm delay is a fact of the props and a test renders a request before and after it arms without
 * a timer. Nothing here decides a grant. A pending card's pills can only be *un*ticked - what the
 * other device asked for is the most it can get - and Approve is armed {@link ARM_MS} after the
 * card first showed, so a request that appears under a moving pointer is not approved by the click
 * already on its way. Decline and Revoke act at once: saying no is never the dangerous direction.
 *
 * The phone's QR is not drawn yet: there is no QR encoder in the app and none may be added as a
 * dependency, so the address is shown to open or type on the phone. (ADR 0140 "Risks" notes it.)
 */
import { useState } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import FormField, { TextInput } from "@/components/FormField";
import ProblemNote from "@/components/ProblemNote";
import type { Tone } from "@/components/StatusDot";
import Table, { type Column } from "@/components/Table";
import { GRANTS, overlayWords, type Grant, type OverlayState, type PeerView, type PendingView } from "@/lib/fleet";
import { clockOf, whenAgo } from "@/lib/time";
import { ARM_MS, grantsOf, isArmed, type Conversation, type DevicesState } from "@/stores/devices";

export { ARM_MS };

/** What the level reads: the store's state, the clock, whether setup is wired, and the acts. */
export interface DevicesModel {
  state: Pick<
    DevicesState,
    "view" | "loaded" | "problem" | "busy" | "errors" | "opened" | "seenAt" | "unticked" | "conversations" | "overlay"
  >;
  now: number;
  /** The setup conversation (WP4) is wired: "Set up with Athena" opens it. */
  setup: (() => void) | null;
  actions: Pick<
    DevicesState,
    "load" | "rename" | "setBeacon" | "openPairing" | "join" | "toggleGrant" | "answer" | "revoke" | "send"
  >;
}

/** The plain word for each grant, as a person reads it on a card and in the table. */
export const GRANT_WORDS: Readonly<Record<Grant, string>> = {
  chat: "talk to Athena here",
  approve: "answer approvals",
  memory: "share memory",
};

const OVERLAY_TONE: Readonly<Record<OverlayState, Tone>> = {
  absent: "warning",
  logged_out: "warning",
  up: "success",
};

const KIND_WORD = { pc: "Computer", phone: "Phone" } as const;

export default function DevicesLevel({ model }: { model: DevicesModel }) {
  const { state } = model;
  if (!state.loaded && state.problem) {
    return (
      <ProblemNote
        title="Athena could not read this computer's devices."
        reason={state.problem}
        onRetry={() => void model.actions.load()}
        retryLabel="Read again"
      />
    );
  }
  const view = state.view;
  if (view === null) {
    return (
      <p className="typo-caption" role="status">
        Reading the devices…
      </p>
    );
  }
  return (
    <>
      {state.problem ? (
        <ProblemNote
          title="The list below may be out of date."
          reason={state.problem}
          onRetry={() => void model.actions.load()}
          retryLabel="Read again"
        />
      ) : null}
      <ThisComputer model={model} />
      <Phone model={model} />
      <AddComputer model={model} />
      <Pending model={model} />
      <Peers model={model} />
      <section className="mind__section devices__setup" aria-labelledby="devices-setup">
        <h2 id="devices-setup">Set up with Athena</h2>
        <p className="typo-caption">
          Athena can install the private network, open the firewall and find your other computers, asking you before each
          step.
        </p>
        <Button
          size="sm"
          variant="secondary"
          disabledReason={model.setup ? undefined : "Coming next: the setup conversation is not in this build yet."}
          onClick={() => model.setup?.()}
        >
          Set up with Athena
        </Button>
        <p className="typo-caption">The conversation opens in Athena&apos;s own window. Every change she proposes waits for your approval there.</p>
        <Refusal text={model.state.errors.setup} />
      </section>
    </>
  );
}

function Refusal({ text }: { text: string | undefined }) {
  if (!text) return null;
  return (
    <p className="typo-caption field__error" role="alert">
      {text}
    </p>
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
  return (
    <section className="mind__section" aria-labelledby="devices-self">
      <h2 id="devices-self">This computer</h2>
      <div className="mind__row">
        <Badge tone={OVERLAY_TONE[view.overlay.state]} title="The private network this computer talks to the others over">
          {`Private network: ${overlayWords(view.overlay.state)}`}
        </Badge>
        {view.listener.error ? <span className="typo-caption">Athena could not listen: {view.listener.error}</span> : null}
      </div>
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
    </section>
  );
}

function Phone({ model }: { model: DevicesModel }) {
  const view = model.state.view!;
  const on = view.beacon.on;
  const opened = model.state.opened.phone;
  const busy = Boolean(model.state.busy.beacon);
  return (
    <section className="mind__section" aria-labelledby="devices-phone">
      <h2 id="devices-phone">Let your phone reach Athena here</h2>
      <p className="typo-caption">
        While this window is open, your phone can chat with Athena on this computer and answer her approvals, from any
        network, over the private network.
      </p>
      <div className="mind__row">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className="pill focus-ring"
          disabled={busy}
          onClick={() => void model.actions.setBeacon(!on)}
        >
          {on ? "On" : "Off"}
        </button>
        {on && view.overlay.state !== "up" ? (
          <span className="typo-caption">On, but the private network is {overlayWords(view.overlay.state).toLowerCase()}.</span>
        ) : null}
      </div>
      <Refusal text={model.state.errors.beacon} />
      {/* Open whoever opened it: the button here (beacon on) or Athena in the setup conversation. */}
      {opened ? (
        opened.url ? (
          <div className="devices__pairing">
            <p className="typo-body">On your phone, open this address (it works once, for five minutes):</p>
            <code className="mind__path">{opened.url}</code>
            <p className="typo-caption">
              A QR code to scan is coming next. Code: <strong>{opened.code}</strong>
            </p>
            <Button size="sm" variant="ghost" onClick={() => void model.actions.openPairing("phone")}>
              A new address
            </Button>
          </div>
        ) : (
          <p className="typo-caption">
            Athena cannot listen for the phone until the private network is ready on this computer.
          </p>
        )
      ) : null}
    </section>
  );
}

function AddComputer({ model }: { model: DevicesModel }) {
  const view = model.state.view!;
  const opened = model.state.opened.pc;
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const ready = address.trim() !== "" && code.trim() !== "";
  const picks = joinPicks(model.state.overlay);
  return (
    <section className="mind__section" aria-labelledby="devices-add">
      <h2 id="devices-add">Add a computer</h2>
      <div className="mind__row">
        <Button
          size="sm"
          variant="secondary"
          disabledReason={model.state.busy["pairing.pc"] ? "Opening…" : undefined}
          onClick={() => void model.actions.openPairing("pc")}
        >
          Show a code for the other computer
        </Button>
        {opened ? (
          <span className="typo-body">
            Type <strong className="devices__code">{opened.code}</strong> on the other computer, with this one&apos;s
            address {view.listener.address ?? "(not listening yet)"}. It works for five minutes.
          </span>
        ) : null}
      </div>
      <Refusal text={model.state.errors["pairing.pc"]} />
      <div className="devices__join">
        <FormField label="The other computer's address" hint="Its private-network address, like 100.64.0.7.">
          {(input) => <TextInput {...input} value={address} onChange={(e) => setAddress(e.target.value)} />}
        </FormField>
        {picks.rows.length ? (
          <div className="mind__row devices__picks" role="group" aria-label="Computers on your private network">
            <span className="typo-caption">On your private network:</span>
            {picks.rows.map((p) => (
              <Button key={p.ip} size="sm" variant={address.trim() === p.ip ? "primary" : "ghost"} onClick={() => setAddress(p.ip)}>
                {`${p.name} (${p.ip})`}
              </Button>
            ))}
            {picks.footer ? <span className="typo-caption">{picks.footer}</span> : null}
          </div>
        ) : null}
        <FormField
          label="I have a code"
          error={model.state.errors.join ?? null}
          action={
            <Button
              size="sm"
              variant={ready ? "primary" : "secondary"}
              disabledReason={ready ? undefined : "Type the address and the code first."}
              onClick={() => {
                void model.actions.join(address, code);
                setCode("");
              }}
            >
              Ask to join
            </Button>
          }
        >
          {(input) => <TextInput {...input} value={code} onChange={(e) => setCode(e.target.value)} />}
        </FormField>
      </div>
      {view.joining.length > 0 ? (
        <ul className="devices__joining">
          {view.joining.map((j) => (
            <li key={j.join_id} className="typo-caption">
              {j.name || j.address}: {JOIN_WORDS[j.state] ?? j.state}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Phones never hold the code a computer types: they are not offered as the first computer. */
const PHONE_OS = new Set(["ios", "android"]);

/**
 * The join form's pick list (WP5): the online computers on the private network, as `GET
 * /devices/overlay` named them, with its own footer when the daemon cut the list. Empty when the
 * route was not read - the address is then typed, as before.
 */
export function joinPicks(overlay: DevicesModel["state"]["overlay"]): { rows: Array<{ name: string; ip: string }>; footer: string } {
  if (!overlay || overlay.state !== "up") return { rows: [], footer: "" };
  const rows = overlay.peers.filter((p) => p.online && p.ip && !PHONE_OS.has(p.os.toLowerCase()));
  return { rows: rows.map((p) => ({ name: p.name, ip: p.ip })), footer: overlay.footer };
}

const JOIN_WORDS: Readonly<Record<string, string>> = {
  pending: "waiting for the person there to approve",
  claimed: "let in; approve it back below",
  declined: "declined there",
  expired: "the code ran out; ask for a new one",
};

function Pending({ model }: { model: DevicesModel }) {
  const pending = model.state.view!.pending;
  return (
    <section className="mind__section" aria-labelledby="devices-pending">
      <h2 id="devices-pending">Waiting for you</h2>
      {pending.length === 0 ? (
        <EmptyState
          glyph="◇"
          title="No requests"
          line="A device you are pairing shows up here, and nothing is let in until you approve it."
        />
      ) : (
        <ul className="devices__cards">
          {pending.map((row) => (
            <PendingCard key={row.pairing_id} model={model} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PendingCard({ model, row }: { model: DevicesModel; row: PendingView }) {
  const off = model.state.unticked[row.pairing_id] ?? [];
  const armed = isArmed(model.state.seenAt[row.pairing_id], model.now);
  const busy = Boolean(model.state.busy[row.pairing_id]);
  const granted = grantsOf(row, off);
  const who = row.pair_back ? `${row.name}, which this computer joined, asks to be let in here too` : `${row.name} asks to be let in`;
  return (
    <li className="devices__card" data-armed={armed ? "1" : undefined}>
      <p className="typo-heading">{who}</p>
      <p className="typo-caption">
        {KIND_WORD[row.kind]}. The request lapses at {clockOf(row.expires_at)} if nobody answers.
      </p>
      <div className="pill-group" role="group" aria-label={`What ${row.name} may do`}>
        {GRANTS.filter((g) => row.requested_grants.includes(g)).map((grant) => (
          <button
            key={grant}
            type="button"
            role="checkbox"
            aria-checked={!off.includes(grant)}
            className="pill focus-ring"
            onClick={() => model.actions.toggleGrant(row.pairing_id, grant)}
          >
            {GRANT_WORDS[grant]}
          </button>
        ))}
      </div>
      <div className="mind__row">
        <Button
          size="sm"
          variant="primary"
          disabledReason={
            busy
              ? "Answering…"
              : !armed
                ? "Read the request first; Approve wakes in a moment."
                : granted.length === 0
                  ? "Leave at least one thing ticked, or decline."
                  : undefined
          }
          onClick={() => void model.actions.answer(row.pairing_id, "approve")}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabledReason={busy ? "Answering…" : undefined}
          onClick={() => void model.actions.answer(row.pairing_id, "decline")}
        >
          Decline
        </Button>
      </div>
      <Refusal text={model.state.errors[row.pairing_id]} />
    </li>
  );
}

function memoryWords(peer: PeerView, now: number): string {
  const memory = peer.memory ?? null;
  if (memory === null) return "-";
  const when = memory.last_pull_at ? whenAgo(memory.last_pull_at, now) : "never";
  return `${memory.state}, ${memory.pulled} pulled, ${when}`;
}

function Peers({ model }: { model: DevicesModel }) {
  const view = model.state.view!;
  const columns: Column<PeerView>[] = [
    { key: "name", head: "Name", render: (p) => p.name },
    { key: "kind", head: "Kind", render: (p) => KIND_WORD[p.kind] },
    { key: "grants", head: "May", render: (p) => (p.grants.length ? p.grants.map((g) => GRANT_WORDS[g]).join(", ") : "-") },
    { key: "seen", head: "Last seen", render: (p) => (p.last_seen ? whenAgo(p.last_seen, model.now) : "never") },
    { key: "memory", head: "Memory", render: (p) => memoryWords(p, model.now) },
    {
      key: "revoke",
      head: "",
      align: "right",
      render: (p) => (
        <Button
          size="sm"
          variant="ghost"
          disabledReason={model.state.busy[p.peer_id] ? "Revoking…" : undefined}
          onClick={() => void model.actions.revoke(p.peer_id)}
        >
          Revoke
        </Button>
      ),
    },
  ];
  const computers = view.peers.filter((p) => p.kind === "pc");
  return (
    <section className="mind__section" aria-labelledby="devices-peers">
      <h2 id="devices-peers">Your other computers</h2>
      <Table
        columns={columns}
        rows={view.peers}
        rowKey={(p) => p.peer_id}
        empty="No other device is paired yet. Show a code above, or turn the phone on."
        caption="Devices this computer lets in"
      />
      {view.peers.map((p) => (
        <Refusal key={p.peer_id} text={model.state.errors[p.peer_id]} />
      ))}
      {computers.map((peer) => (
        <MessageBox key={peer.peer_id} model={model} peer={peer} />
      ))}
    </section>
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
