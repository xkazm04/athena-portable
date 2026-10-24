/**
 * The pairing wizard, layer 2 of the Devices level — ADR 0140 ("Pairing + Devices page"),
 * fleet-surfaces WP3 (design decision D1: the wizard grows from the clicked '+' node).
 *
 * It is not a page and not a modal sheet: it grows out of the '+' node that was pressed (its
 * transform origin is that node), the constellation dims behind it, and Back or Escape folds it
 * back into the node, where the keyboard focus lands again. Three steps on a small rail:
 *
 * - **Phone**: Scan (a large QR of the pairing address, the code beside it, and a ring that runs
 *   down to the window's `expires_at`), Approve, Done.
 * - **Computer**: Code (either "show a code on this PC", which the other computer types, or "join
 *   another PC" with its code and an address picked from the private network), Approve, Done.
 *
 * The step is not remembered by a screen: it is read from the devices mirror every render
 * ({@link wizardStep}). A pending request for the window this wizard opened *is* the Approve step,
 * so the wizard moves on by itself the moment `pair.requested` re-reads the list; the request's row
 * leaving the list after an answer *is* Done. The one thing kept here is which branch a computer
 * took and what the person answered - presentation, which nothing else needs (registry:
 * wizard-flows, one model owns every step). Nothing is persisted: the window lives in the daemon,
 * and a reload is a new code.
 *
 * The phone's address is a claim credential (its fragment is the pairing id and nonce). It is drawn
 * in the QR and printed on the one small address line under it, with a Copy button; it is never a
 * title, a tooltip, an accessible name or a log line. `view.beacon.url` is the phone page's plain
 * address and never the QR.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import Button from "@/components/Button";
import Facts, { Fact } from "@/components/Facts";
import FormField, { TextInput } from "@/components/FormField";
import Table, { type Column } from "@/components/Table";
import { GRANTS, type DeviceKind, type Grant, type PairingWindow, type PendingView } from "@/lib/fleet";
import { clockOf, parseStamp } from "@/lib/time";
import { grantsOf, isArmed } from "@/stores/devices";

import type { DevicesModel } from "./devices";
import QrSvg, { qrPicture } from "./qr-svg";

/** The plain word for each grant, as a person reads it on a card and in a device's details. */
export const GRANT_WORDS: Readonly<Record<Grant, string>> = {
  chat: "talk to Athena here",
  approve: "answer approvals",
  memory: "share memory",
};

export const KIND_WORD = { pc: "Computer", phone: "Phone" } as const;

/** How long a pairing window lives (`pairing.py` `WINDOW_TTL_S`): the ring's full turn. */
export const WINDOW_MS = 300_000;

/** Milliseconds left on a window at `now`; 0 once it ran out or when its time cannot be read. */
export function msLeft(window: Pick<PairingWindow, "expires_at">, now: number): number {
  const at = parseStamp(window.expires_at);
  return at === null ? 0 : Math.max(0, at.getTime() - now);
}

/** A six-character code read out in two halves, `7Q4K2P` as `7Q4-K2P`. The daemon ignores the dash. */
export function groupCode(code: string): string {
  return /^[A-Z0-9]{6}$/i.test(code) ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
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

export const JOIN_WORDS: Readonly<Record<string, string>> = {
  pending: "waiting for the person there to approve",
  claimed: "let in; approve it back here",
  declined: "declined there",
  expired: "the code ran out; ask for a new one",
};

/** What a person answered in this wizard, so the request leaving the list reads as Done. */
export interface Answered {
  pairingId: string;
  name: string;
  choice: "approve" | "decline";
}

/** Which way a computer pairs: this one shows a code, or this one types the other's. */
export type PcBranch = "show" | "join" | null;

export type Step = "choose" | "code" | "join" | "approve" | "done";

/**
 * The step, read from the mirror. Pure, so a test renders every step from a fixture and the
 * wizard cannot disagree with the list it is drawn over.
 */
export function wizardStep(
  kind: DeviceKind,
  branch: PcBranch,
  state: DevicesModel["state"],
  answered: Answered | null,
): { step: Step; pending: PendingView | null } {
  const pending = state.view?.pending ?? [];
  if (answered) {
    const row = pending.find((p) => p.pairing_id === answered.pairingId);
    return row ? { step: "approve", pending: row } : { step: "done", pending: null };
  }
  if (kind === "pc" && branch === null) return { step: "choose", pending: null };
  if (kind === "pc" && branch === "join") {
    // The computer this one joined asks back (`pair_back`): the one named in a join, else any.
    const names = new Set((state.view?.joining ?? []).map((j) => j.name));
    const back = pending.find((p) => p.pair_back && names.has(p.name)) ?? pending.find((p) => p.pair_back);
    return back ? { step: "approve", pending: back } : { step: "join", pending: null };
  }
  const opened = state.opened[kind];
  const row = opened ? pending.find((p) => p.pairing_id === opened.pairing_id) : undefined;
  return row ? { step: "approve", pending: row } : { step: "code", pending: null };
}

const RAIL: Readonly<Record<DeviceKind, readonly string[]>> = {
  phone: ["Scan", "Approve", "Done"],
  pc: ["Code", "Approve", "Done"],
};

const RAIL_AT: Readonly<Record<Step, number>> = { choose: 0, code: 0, join: 0, approve: 1, done: 2 };

/** The window's clock: the model's `now`, moved on every second while the wizard is open. */
function useClock(base: number): number {
  const [tick, setTick] = useState(base);
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(base, tick);
}

/** A refusal in the daemon's words, under the control that made it. */
export function Refusal({ text }: { text: string | undefined | null }) {
  if (!text) return null;
  return (
    <p className="typo-caption field__error" role="alert">
      {text}
    </p>
  );
}

/**
 * One pending request: who asks, what it may do, Approve and Decline. The pills can only be
 * *un*ticked - what the other device asked for is the most it can get - and Approve is armed
 * {@link ARM_MS} after the card first showed, so a request that appears under a moving pointer is
 * not approved by the click already on its way. Decline acts at once: saying no is never the
 * dangerous direction. Drawn in the wizard's Approve step and in a pending node's details.
 */
export function PendingCard({
  model,
  row,
  now = model.now,
  onAnswered,
}: {
  model: DevicesModel;
  row: PendingView;
  now?: number;
  onAnswered?: (answer: Answered) => void;
}) {
  const off = model.state.unticked[row.pairing_id] ?? [];
  const armed = isArmed(model.state.seenAt[row.pairing_id], now);
  const busy = Boolean(model.state.busy[row.pairing_id]);
  const granted = grantsOf(row, off);
  const who = row.pair_back ? `${row.name}, which this computer joined, asks to be let in here too` : `${row.name} asks to be let in`;
  const answer = (choice: "approve" | "decline") => {
    onAnswered?.({ pairingId: row.pairing_id, name: row.name, choice });
    void model.actions.answer(row.pairing_id, choice);
  };
  return (
    <div className="devices__card" data-armed={armed ? "1" : undefined}>
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
          onClick={() => answer("approve")}
        >
          Approve
        </Button>
        <Button size="sm" variant="secondary" disabledReason={busy ? "Answering…" : undefined} onClick={() => answer("decline")}>
          Decline
        </Button>
      </div>
      <Refusal text={model.state.errors[row.pairing_id]} />
    </div>
  );
}

/**
 * The countdown ring: a lens of paper with the code in it, and around it an arc that runs down
 * from a full turn to nothing as the window's five minutes pass. Under a minute it turns to the
 * warning hue; at nothing the paper greys out and `over` (the "New code" button) sits on it.
 */
export function CountdownLens({
  window,
  now,
  children,
  over,
}: {
  window: Pick<PairingWindow, "expires_at">;
  now: number;
  children: ReactNode;
  over: ReactNode;
}) {
  const left = msLeft(window, now);
  const share = Math.min(1, left / WINDOW_MS);
  const expired = left <= 0;
  return (
    <div className="lens" data-expired={expired ? "1" : undefined} data-low={!expired && left < 60_000 ? "1" : undefined}>
      <svg className="lens__ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle className="lens__track" cx="50" cy="50" r="48" pathLength={100} />
        <circle className="lens__left" cx="50" cy="50" r="48" pathLength={100} strokeDasharray={`${(share * 100).toFixed(2)} 100`} />
      </svg>
      <div className="lens__paper">{children}</div>
      {expired ? <div className="lens__over">{over}</div> : null}
    </div>
  );
}

/** "4:32 left", or that it ran out. A timer, so assistive tech reads it when asked, not each second. */
function Remaining({ window, now }: { window: Pick<PairingWindow, "expires_at">; now: number }) {
  const left = msLeft(window, now);
  if (left <= 0) {
    return (
      <p className="typo-caption lens__time" role="timer">
        This code ran out.
      </p>
    );
  }
  const seconds = Math.ceil(left / 1000);
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} left`;
  return (
    <p className="typo-caption lens__time" role="timer">
      {text}
    </p>
  );
}

/** A window that can still be shown: there, not run out, and not one this person already answered. */
export function isLive(window: PairingWindow | undefined, now: number, spent: readonly string[]): window is PairingWindow {
  return window !== undefined && msLeft(window, now) > 0 && !spent.includes(window.pairing_id);
}

export interface WizardProps {
  model: DevicesModel;
  kind: DeviceKind;
  /** The '+' node it grows from, in percent of the stage: the transform origin. */
  origin: { x: number; y: number };
  /** Pairing ids answered here this visit: their windows are spent and a new code is minted. */
  spent: readonly string[];
  onAnswered: (answer: Answered) => void;
  /** The fold back into the node finished: unmount, and return the focus to the node. */
  onClosed: () => void;
  /** The branch a computer starts on (tests and previews); a person starts at the choice. */
  initialBranch?: PcBranch;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex="0"]';

/** How long the fold may take before it is called done anyway (a hidden window plays nothing). */
const FOLD_SAFETY_MS = 700;

export default function Wizard({ model, kind, origin, spent, onAnswered, onClosed, initialBranch = null }: WizardProps) {
  const now = useClock(model.now);
  const [branch, setBranch] = useState<PcBranch>(initialBranch);
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [closing, setClosing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const { step, pending } = wizardStep(kind, branch, model.state, answered);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(onClosed, FOLD_SAFETY_MS);
    return () => clearTimeout(timer);
  }, [closing, onClosed]);

  const close = () => setClosing(true);
  const answer = (a: Answered) => {
    setAnswered(a);
    onAnswered(a);
  };
  const mint = () => void model.actions.openPairing(kind);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      // Claimed here, so the stage under it does not also rise a level.
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    // The wizard keeps the keyboard: Tab wraps around its own controls, not out to the dimmed sky.
    const stops = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last) return;
    const here = document.activeElement;
    if (e.shiftKey && (here === first || here === heading.current)) last.focus();
    else if (!e.shiftKey && here === last) first.focus();
    else return;
    e.preventDefault();
  };

  const title =
    step === "approve" && pending
      ? `${pending.name} wants to join`
      : step === "done" && answered
        ? answered.choice === "approve"
          ? `${answered.name} is in`
          : `${answered.name} was not let in`
        : step === "choose"
          ? "Which computer shows the code?"
          : step === "join"
            ? "Type the other computer's code"
            : kind === "phone"
              ? "Scan this with your phone"
              : "Type this on the other computer";

  return (
    <div
      ref={box}
      className="cwizard"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cwizard-title"
      data-kind={kind}
      data-step={step}
      data-closing={closing ? "1" : undefined}
      style={{ transformOrigin: `${origin.x}% ${origin.y}%` }}
      onKeyDown={onKeyDown}
      onAnimationEnd={(e) => {
        if (closing && e.target === box.current) onClosed();
      }}
    >
      <header className="cwizard__head">
        <div className="cwizard__titles">
          <p className="mind__eyebrow">{kind === "phone" ? "Add a phone" : "Add a computer"}</p>
          <h3 id="cwizard-title" ref={heading} tabIndex={-1} className="cwizard__title">
            {title}
          </h3>
        </div>
        <button type="button" className="cwizard__close focus-ring" aria-label="Fold the wizard back into the devices" onClick={close}>
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>
      <ol className="rail" aria-label="Steps">
        {RAIL[kind].map((label, i) => {
          const at = RAIL_AT[step];
          return (
            <li
              key={label}
              className="rail__step"
              data-state={i < at ? "done" : i === at ? "now" : "next"}
              aria-current={i === at ? "step" : undefined}
            >
              <span className="rail__dot" aria-hidden="true" />
              <span className="rail__label">{label}</span>
            </li>
          );
        })}
      </ol>
      <div className="cwizard__body">
        {step === "approve" && pending ? (
          <PendingCard model={model} row={pending} now={now} onAnswered={answer} />
        ) : step === "done" && answered ? (
          <Done model={model} kind={kind} answered={answered} onClose={close} />
        ) : step === "choose" ? (
          <Choose
            onShow={() => {
              setBranch("show");
              if (!isLive(model.state.opened.pc, now, spent)) mint();
            }}
            onJoin={() => setBranch("join")}
          />
        ) : step === "join" ? (
          <Join model={model} onBack={() => setBranch(null)} />
        ) : kind === "phone" ? (
          <PhoneCode model={model} now={now} spent={spent} onMint={mint} />
        ) : (
          <PcCode model={model} now={now} spent={spent} onMint={mint} onBack={() => setBranch(null)} />
        )}
      </div>
    </div>
  );
}

/** No live window yet: it is being made, it could not be, or the person asks for one. */
function NoWindow({ model, kind, onMint }: { model: DevicesModel; kind: DeviceKind; onMint: () => void }) {
  const busy = Boolean(model.state.busy[`pairing.${kind}`]);
  return (
    <div className="cwizard__none">
      <div className="lens lens--empty" aria-hidden="true">
        <svg className="lens__ring" viewBox="0 0 100 100" focusable="false">
          <circle className="lens__track" cx="50" cy="50" r="48" pathLength={100} />
        </svg>
        <div className="lens__paper" />
      </div>
      <div className="cwizard__words">
        <p className="typo-body">{busy ? "Making a code…" : "A code works once, for five minutes."}</p>
        <Button variant="primary" disabledReason={busy ? "Making a code…" : undefined} onClick={onMint}>
          Show a code
        </Button>
        <Refusal text={model.state.errors[`pairing.${kind}`]} />
      </div>
    </div>
  );
}

function PhoneCode({ model, now, spent, onMint }: { model: DevicesModel; now: number; spent: readonly string[]; onMint: () => void }) {
  const opened = model.state.opened.phone;
  // Drawn once per address, not once per second of the countdown.
  const url = opened?.url ?? null;
  const picture = useMemo(() => (url ? qrPicture(url) : null), [url]);
  if (!opened || spent.includes(opened.pairing_id)) return <NoWindow model={model} kind="phone" onMint={onMint} />;
  const code = groupCode(opened.code);
  const busy = Boolean(model.state.busy["pairing.phone"]);
  // A window that ran out is dead: its address and code are not offered any more, only a new one.
  const over = msLeft(opened, now) <= 0;
  const fresh = (
    <Button size="sm" variant="primary" disabledReason={busy ? "Making a code…" : undefined} onClick={onMint}>
      New code
    </Button>
  );
  return (
    <div className="cwizard__code">
      <CountdownLens window={opened} now={now} over={fresh}>
        {picture ? <QrSvg picture={picture} label="The QR code that pairs your phone" /> : <span className="lens__code">{code}</span>}
      </CountdownLens>
      <div className="cwizard__words">
        {over ? (
          <p className="typo-body">The phone can no longer use this code. Make a new one; it works for five minutes.</p>
        ) : url === null ? (
          <p className="typo-body">
            Athena cannot listen for the phone until the private network is ready on this computer. The code is{" "}
            <strong className="devices__code">{code}</strong>.
          </p>
        ) : (
          <>
            <p className="typo-body">Point your phone&apos;s camera at the code. Athena&apos;s page opens there and asks this computer to let it in.</p>
            <p className="typo-caption" data-need="overlay">
              The page opens only on your private network: the phone needs the Tailscale app, signed in to the same account as this
              computer. On the phone&apos;s Wi-Fi alone it will not load.
            </p>
            <p className="cwizard__codeline">
              <span className="typo-caption">Code</span> <strong className="devices__code">{code}</strong>
            </p>
            {picture ? null : <p className="typo-caption">The picture cannot be drawn here; open the address below on the phone.</p>}
            <AddressLine url={url} />
          </>
        )}
        <Remaining window={opened} now={now} />
        {over ? null : <p className="typo-caption">Next: you approve it here. The wizard moves on by itself when the phone asks.</p>}
        <Refusal text={model.state.errors["pairing.phone"]} />
      </div>
    </div>
  );
}

/** The phone's address on one small line, to copy when no camera is at hand. */
function AddressLine({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard
      ?.writeText(url)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };
  return (
    <div className="cwizard__address">
      <code className="cwizard__url">{url}</code>
      <Button size="sm" variant="ghost" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function Choose({ onShow, onJoin }: { onShow: () => void; onJoin: () => void }) {
  return (
    <div className="cwizard__choices">
      <button type="button" className="choice focus-ring" onClick={onShow}>
        <svg className="choice__art" viewBox="0 0 64 40" aria-hidden="true" focusable="false">
          <rect x="4" y="6" width="34" height="22" rx="3" />
          <path d="M15 34h12M21 28v6" />
          <path className="choice__code" d="M10 17h4M17 17h4M24 17h4M31 17h2" />
          <path className="choice__arrow" d="M44 17h14M53 12l5 5-5 5" />
        </svg>
        <span className="choice__title">Show a code on this PC</span>
        <span className="choice__line">The other computer types it, and you approve it here.</span>
      </button>
      <button type="button" className="choice focus-ring" onClick={onJoin}>
        <svg className="choice__art" viewBox="0 0 64 40" aria-hidden="true" focusable="false">
          <rect x="26" y="6" width="34" height="22" rx="3" />
          <path d="M37 34h12M43 28v6" />
          <path className="choice__code" d="M32 17h4M39 17h4M46 17h4M53 17h2" />
          <path className="choice__arrow" d="M20 17H6M11 12l-5 5 5 5" />
        </svg>
        <span className="choice__title">Join another PC</span>
        <span className="choice__line">It shows a code; you type it here, with its address.</span>
      </button>
    </div>
  );
}

function PcCode({
  model,
  now,
  spent,
  onMint,
  onBack,
}: {
  model: DevicesModel;
  now: number;
  spent: readonly string[];
  onMint: () => void;
  onBack: () => void;
}) {
  const opened = model.state.opened.pc;
  const view = model.state.view!;
  if (!opened || spent.includes(opened.pairing_id)) return <NoWindow model={model} kind="pc" onMint={onMint} />;
  const busy = Boolean(model.state.busy["pairing.pc"]);
  const fresh = (
    <Button size="sm" variant="primary" disabledReason={busy ? "Making a code…" : undefined} onClick={onMint}>
      New code
    </Button>
  );
  return (
    <div className="cwizard__code">
      <CountdownLens window={opened} now={now} over={fresh}>
        <span className="lens__code">{groupCode(opened.code)}</span>
      </CountdownLens>
      <div className="cwizard__words">
        <p className="typo-body">On the other computer, open Mind, then Devices, press + PC and choose Join another PC. Type there:</p>
        <Facts>
          <Fact label="This computer's address" value="code">
            {view.listener.address ?? "not listening yet"}
          </Fact>
          <Fact label="The code" value="code">
            {groupCode(opened.code)}
          </Fact>
        </Facts>
        {view.listener.error ? <p className="typo-caption">Athena could not listen: {view.listener.error}</p> : null}
        <Remaining window={opened} now={now} />
        <p className="typo-caption">Next: you approve it here. The wizard moves on by itself when it asks.</p>
        <Refusal text={model.state.errors["pairing.pc"]} />
        <Button size="sm" variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}

function Join({ model, onBack }: { model: DevicesModel; onBack: () => void }) {
  const view = model.state.view!;
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const ready = address.trim() !== "" && code.trim() !== "";
  const picks = joinPicks(model.state.overlay);
  const columns: Column<{ name: string; ip: string }>[] = [
    { key: "name", head: "Computer", render: (p) => p.name },
    { key: "ip", head: "Address", render: (p) => <span className="typo-code">{p.ip}</span> },
  ];
  return (
    <div className="cwizard__join">
      {picks.rows.length ? (
        <div className="cwizard__picks">
          <Table
            columns={columns}
            rows={picks.rows}
            rowKey={(p) => p.ip}
            selectedKey={address.trim() || null}
            onSelect={(p) => setAddress(p.ip)}
            empty="No other computer is online on your private network."
            caption="On your private network: pick one, or type its address"
          />
          {picks.footer ? <p className="typo-caption">{picks.footer}</p> : null}
        </div>
      ) : null}
      <FormField label="The other computer's address" hint="Its private-network address, like 100.64.0.7.">
        {(input) => <TextInput {...input} value={address} onChange={(e) => setAddress(e.target.value)} />}
      </FormField>
      <FormField
        label="The code it shows"
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
      {view.joining.length > 0 ? (
        <ul className="cwizard__joining" aria-label="Asked so far">
          {view.joining.map((j) => (
            <li key={j.join_id} className="typo-caption" data-state={j.state}>
              <span className="cwizard__beat" aria-hidden="true" />
              {j.name || j.address}: {JOIN_WORDS[j.state] ?? j.state}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="typo-caption">Next: the person there approves, and that computer asks back to be let in here. You approve that too.</p>
      <Button size="sm" variant="ghost" onClick={onBack}>
        Back
      </Button>
    </div>
  );
}

function Done({ model, kind, answered, onClose }: { model: DevicesModel; kind: DeviceKind; answered: Answered; onClose: () => void }) {
  const refused = model.state.errors[answered.pairingId];
  const lettingIn = answered.choice === "approve" && !refused;
  const beaconOff = kind === "phone" && !model.state.view?.beacon.on;
  return (
    <div className="cwizard__done" data-in={lettingIn ? "1" : undefined}>
      <svg className="done__mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <circle cx="24" cy="24" r="21" />
        {lettingIn ? <path className="done__tick" d="M15 25l6 6 12-13" pathLength={1} /> : <path className="done__tick" d="M17 17l14 14M31 17L17 31" pathLength={1} />}
      </svg>
      <div className="cwizard__words">
        {lettingIn ? (
          <p className="typo-body">It is one of your devices now; it shows on the orbit around this computer.</p>
        ) : (
          <p className="typo-body">Nothing was let in. A new code starts again.</p>
        )}
        {lettingIn && beaconOff ? (
          <p className="typo-caption">
            For the phone to reach Athena from now on, turn on &ldquo;Let your phone reach Athena here&rdquo; in this computer&apos;s details.
          </p>
        ) : null}
        <Refusal text={refused} />
        <Button variant="primary" onClick={onClose}>
          Back to the devices
        </Button>
      </div>
    </div>
  );
}
