/**
 * The Accounts depth — README sections 3.1, 3.5 and 4, ADR 0021, 0062, 0087 and 0090.
 *
 * Three levels over the Connectors module's own model (`useConnectorsModel`), drawn for the stage.
 * The root is the field of accounts: each one a drawing, with the hovered one's name in display
 * type at the centre of the frame. `accounts/<id>` is one account's own scene: what it is, how it
 * stands, the connect act as three short stages, or, once connected, the credential's seal, the
 * probe, the on and off switch, the writes decision and what it yields. `accounts/<id>/allowlist`
 * is the editor for the recipients or page ids a write may go to.
 *
 * The safety rules of the module survive unchanged and are asserted in view.test.tsx: the vault's
 * records notice is a banner in its own words with no way to dismiss it, and rows read
 * "unconfirmed" while it stands; disconnecting takes two presses; a write is GATED and the writes
 * switch and the list are locked, with the reason, until an account is connected; the list is a
 * draft until Add is pressed, so a half-typed address is never one the gate accepts; a credential
 * is typed here, sent once and never shown back; the seal sentence names its rung, and the
 * owner-only file says it is not encrypted. Standing is read by shape and word, never by colour
 * alone. A pure function of `{ model, path, go }` plus the view's own state (what is hovered, what
 * is typed).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { AccountArt, StandingMark } from "@/art/accounts";
import Button from "@/components/Button";
import FormField, { TextInput } from "@/components/FormField";
import PillGroup from "@/components/PillGroup";
import ProblemNote from "@/components/ProblemNote";
import type { Path } from "@/depth/model";
import {
  paragraphsOf,
  type ConnectorRow,
  type ConnectorsModel,
} from "@/modules/connectors/model";
import type { ConnectorToolView } from "@/lib/api";

import "./accounts.css";

export interface AccountsViewProps {
  model: ConnectorsModel;
  path: Path;
  go: (to: Path) => void;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** What the allow-list is a list of, in the words a person reads. */
const nounOf = (row: ConnectorRow) => (row.egress === "recipients" ? "recipients" : "page ids");

export default function AccountsView({ model, path, go }: AccountsViewProps) {
  const item = path.item;
  const row = item === undefined ? null : (model.rows.find((r) => r.id === item) ?? null);
  const level = item === undefined ? "field" : path.sub?.kind === "allowlist" ? "allowlist" : "item";
  const available = model.ready && !model.problem && model.loaded;

  return (
    <div className="accounts" data-level={level}>
      {model.recordsNotice ? <RecordsNotice notice={model.recordsNotice} /> : null}

      {!model.ready ? (
        <div className="accounts__note">
          <ProblemNote
            title="Athena's daemon is not running, so the vault cannot be asked."
            reason="daemon_offline"
            detail="The connectors are listed as soon as it answers. Nothing here is lost in the meantime."
          />
        </div>
      ) : model.problem ? (
        <div className="accounts__note">
          <ProblemNote
            title="The connector list could not be read."
            reason={model.problem.reason}
            /* Who is refusing is a different fact from why: a bug in this shell's own HTTP client
               must not be reported to the reader as the vault turning them away. */
            detail={
              model.problem.from === "daemon"
                ? "The daemon refused the list; the reason above is its own."
                : "The request never reached the daemon, so the reason above is this shell's rather than the vault's."
            }
            tone="error"
          />
        </div>
      ) : !model.loaded ? (
        <p className="accounts__note typo-caption" role="status">
          Asking the daemon what is connected…
        </p>
      ) : null}

      {available && level === "field" && <Field model={model} go={go} />}
      {available && level !== "field" && row === null && <NotFound id={item ?? ""} go={go} />}
      {available && row !== null && level === "item" && <Item row={row} model={model} go={go} />}
      {available && row !== null && level === "allowlist" && <Allowlist row={row} model={model} go={go} />}
    </div>
  );
}

// -- the vault's notice ------------------------------------------------------------------------------

/**
 * The vault's records notice, verbatim, for as long as the vault carries it. No close control on
 * purpose: it goes when the daemon stops saying it, never because it was waved away.
 */
function RecordsNotice({ notice }: { notice: string }) {
  return (
    <div className="accounts__notice" role="alert">
      <span className="accounts__notice-mark" aria-hidden="true">
        !
      </span>
      <div>
        <p className="accounts__notice-text">{notice}</p>
        <p className="accounts__notice-more">
          Until this notice goes, no connector here is shown as connected: what the records say cannot be
          confirmed.
        </p>
      </div>
    </div>
  );
}

// -- the standing, by shape and word -------------------------------------------------------------------

function Standing({ row }: { row: ConnectorRow }) {
  return (
    <span className="standing" data-standing={row.standing}>
      <StandingMark standing={row.standing} />
      <span className="standing__word">{row.busy ? `${row.busy}…` : row.word}</span>
    </span>
  );
}

// -- the field -------------------------------------------------------------------------------------------

function Field({ model, go }: { model: ConnectorsModel; go: (to: Path) => void }) {
  const [focused, setFocused] = useState<string | null>(null);
  const hovered = model.rows.find((r) => r.id === focused) ?? null;
  const connected = model.rows.filter((r) => r.standing === "connected").length;

  return (
    <section className="reach" aria-label="Accounts">
      <header className="reach__words">
        <p className="accounts__eyebrow">{hovered ? "Open" : "Accounts"}</p>
        <h1 className="accounts__marquee">{hovered ? hovered.label : "Accounts"}</h1>
        <p className="accounts__line" aria-live="polite">
          {hovered
            ? hovered.sentence
            : model.recordsNotice
              ? "connections unconfirmed"
              : model.rows.length === 0
                ? "The daemon lists no connectors."
                : `${connected} of ${model.rows.length} connected. Mail and notes Athena may use from any page, each behind its own switch.`}
        </p>
        {hovered ? (
          <p className="accounts__word">
            <Standing row={hovered} />
          </p>
        ) : null}
      </header>

      <ul className="reach__cards" data-hovering={hovered !== null} aria-label="Connectors">
        {model.rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className="card focus-ring"
              data-go={row.id}
              data-standing={row.standing}
              data-on={focused === row.id}
              onMouseEnter={() => setFocused(row.id)}
              onMouseLeave={() => setFocused((f) => (f === row.id ? null : f))}
              onFocus={() => setFocused(row.id)}
              onBlur={() => setFocused((f) => (f === row.id ? null : f))}
              onClick={() => go({ root: "accounts", item: row.id })}
            >
              <AccountArt id={row.id} lit={row.standing === "connected"} size={236} />
              <span className="card__name">{row.label}</span>
              <Standing row={row} />
              <span className="card__chips">
                <span className="acc-chip">{plural(row.reads.length, "read")}</span>
                <span className="acc-chip acc-chip--gated">{`${plural(row.writes.length, "write")}, gated`}</span>
                {row.writes.length && row.standing === "connected" ? (
                  <span className="acc-chip">{row.writesEnabled ? "writes on" : "writes off"}</span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className="accounts__fine">Drawings are stylised and are not the services' own marks.</p>
    </section>
  );
}

function NotFound({ id, go }: { id: string; go: (to: Path) => void }) {
  return (
    <section className="notfound" role="status">
      <h1 className="accounts__marquee">No such account</h1>
      <p className="accounts__line">
        The daemon lists nothing called <code className="typo-code">{id}</code>.
      </p>
      <Button variant="secondary" onClick={() => go({ root: "accounts" })}>
        Back to the accounts
      </Button>
    </section>
  );
}

// -- one account -----------------------------------------------------------------------------------------

function Item({ row, model, go }: { row: ConnectorRow; model: ConnectorsModel; go: (to: Path) => void }) {
  const { actions } = model;
  // Connected on the record (on, off or broken alike), even while a records notice stands.
  const on = row.connected;

  return (
    <section className="item" aria-label={row.label}>
      <div className="item__stage">
        <div className="item__art">
          <AccountArt id={row.id} lit={row.standing === "connected"} size={300} />
          <p className="accounts__fine">A stylised drawing, not the service's own mark.</p>
        </div>
        <p className="accounts__eyebrow">Account</p>
        <h1 className="accounts__marquee">{row.label}</h1>
        <p className="item__standing">
          <Standing row={row} />
        </p>
        <p className="accounts__line">{row.description}</p>
        <p className="item__sentence">{row.sentence}</p>
      </div>

      <div className="item__act">
        {row.error ? <ProblemNote title={`${row.label} refused.`} reason={row.error} tone="error" /> : null}

        {on ? (
          <Panel title="In use" note="Athena calls it only while it is on.">
            {row.seal ? <p className="typo-caption">The credential is {row.seal}.</p> : null}
            {!row.sealAvailable ? (
              <p className="typo-caption">
                This machine has no safe place to keep a credential, so nothing will be stored.
              </p>
            ) : null}
            {row.healthNote ? (
              <p className="typo-caption accounts__healthnote" role="note">
                {row.healthNote}
              </p>
            ) : null}
            <div className="act-row">
              <span className="typo-title">Athena may call it</span>
              <PillGroup
                ariaLabel={`${row.label} switch`}
                value={row.enabled ? "on" : "off"}
                onChange={(next) => actions.setEnabled(row.id, next === "on")}
                disabled={Boolean(row.busy)}
                options={[
                  { value: "on", label: "on", hint: "Athena may call this connector." },
                  { value: "off", label: "off", hint: "Connected, but nothing runs." },
                ]}
              />
            </div>
            <div className="act-row">
              <span className="typo-caption">
                {row.probedAge ? `Last checked ${row.probedAge}.` : "Not checked yet."}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => actions.probe(row.id)}
                disabledReason={row.busy ? `${row.busy}…` : undefined}
              >
                Check now
              </Button>
              <Disconnect row={row} onDisconnect={() => actions.disconnect(row.id)} />
            </div>
          </Panel>
        ) : (
          <Panel title="Connect" note="Probed before it is stored on this machine.">
            <Connect row={row} model={model} />
            {row.standing === "needs-reauth" ? (
              <div className="act-row">
                <Disconnect row={row} onDisconnect={() => actions.disconnect(row.id)} />
              </div>
            ) : null}
          </Panel>
        )}

        {row.egress ? <Decisions row={row} model={model} go={go} /> : null}

        <Panel title="What it yields">
          <div className="tools">
            <ToolList title="Reads" tools={row.reads} gated={false} />
            <ToolList title="Writes" tools={row.writes} gated />
          </div>
        </Panel>

        <details className="guide">
          <summary className="guide__summary focus-ring">How to connect</summary>
          <div className="guide__body">
            {paragraphsOf(row.guide).map((p, i) => (
              <GuideParagraph key={i} text={p} />
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">{title}</h2>
        {note ? <span className="panel__note">{note}</span> : null}
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );
}

/** A guide paragraph that numbers its steps inline ("1. Open … 2. Copy …") reads as a list. */
function GuideParagraph({ text }: { text: string }) {
  const steps = text.split(/\s+(?=\d+\.\s)/).filter(Boolean);
  if (steps.length < 2 || !/^\d+\.\s/.test(steps[0]!)) return <p className="typo-body">{text}</p>;
  return (
    <ol className="guide__steps">
      {steps.map((step, i) => (
        <li key={i} className="typo-body">
          {step.replace(/^\d+\.\s/, "")}
        </li>
      ))}
    </ol>
  );
}

// -- the tools ------------------------------------------------------------------------------------------

function ToolList({ title, tools, gated }: { title: string; tools: readonly ConnectorToolView[]; gated: boolean }) {
  return (
    <div className="tools__col">
      <span className="typo-label tools__title">{title}</span>
      {tools.length ? (
        <ul className="tools__list">
          {tools.map((tool) => (
            <li key={tool.name} className="tools__tool">
              <span className="tools__line">
                <code className="typo-code">{tool.name}</code>
                {gated ? (
                  <span className="gated">
                    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
                      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
                      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                    GATED
                  </span>
                ) : null}
              </span>
              <span className="typo-caption">{tool.description}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="typo-caption">none</span>
      )}
    </div>
  );
}

// -- the decisions --------------------------------------------------------------------------------------

function Decisions({ row, model, go }: { row: ConnectorRow; model: ConnectorsModel; go: (to: Path) => void }) {
  const { actions } = model;
  const noun = nounOf(row);
  // Not connected: shown as they stand, but not changeable, and the reason is said beside them.
  const locked = Boolean(row.disabledReason);
  return (
    <Panel title="Decisions" note="The gate reads these on every call.">
      {locked ? <p className="typo-caption accounts__locked">{row.disabledReason}</p> : null}
      <div className="act-row act-row--top">
        <div className="act-row__words">
          <span className="typo-title">Writes</span>
          <span className="typo-caption">
            {row.writesEnabled
              ? "A write still waits for your card; this switch is what lets it run at all."
              : "Off: every write is refused before a card is filed."}
          </span>
        </div>
        <PillGroup
          ariaLabel={`${row.label} writes`}
          value={row.writesEnabled ? "on" : "off"}
          onChange={(next) => actions.setWrites(row.id, next === "on")}
          disabled={Boolean(row.busy) || locked}
          options={[
            { value: "off", label: "off", hint: "Reads only." },
            { value: "on", label: "on", hint: "Writes run after your approval, to the list below." },
          ]}
        />
      </div>
      <div className="act-row act-row--top">
        <div className="act-row__words">
          <span className="typo-title">{`Allowed ${noun}`}</span>
          <span className="typo-caption">
            {row.allowlist.length
              ? `${row.allowlist.length} allowed. A write to anything else is refused.`
              : `None yet, so every write is refused. One ${noun === "recipients" ? "address" : "page id"} per line.`}
          </span>
          {row.allowlist.length ? (
            <ul className="entries entries--peek" aria-label={`Allowed ${noun}, as saved`}>
              {row.allowlist.slice(0, 3).map((e) => (
                <li key={e} className="entry">
                  <code className="typo-code">{e}</code>
                </li>
              ))}
              {row.allowlist.length > 3 ? (
                <li className="typo-caption">{`(showing 3 of ${row.allowlist.length})`}</li>
              ) : null}
            </ul>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => go({ root: "accounts", item: row.id, sub: { kind: "allowlist" } })}
        >
          {`Edit the ${noun}`}
        </Button>
      </div>
    </Panel>
  );
}

// -- the allow-list ---------------------------------------------------------------------------------------

/**
 * One entry per row, and a draft box. A draft until Add is pressed: the list is read by the gate on
 * every write, and a half-typed address must never be one it accepts. Add and Remove save the whole
 * list through the one `setAllowlist` action.
 */
export function Allowlist({ row, model, go }: { row: ConnectorRow; model: ConnectorsModel; go: (to: Path) => void }) {
  const { actions } = model;
  const noun = nounOf(row);
  const [draft, setDraft] = useState("");
  const locked = Boolean(row.disabledReason);
  const busy = Boolean(row.busy);
  const parsed = draft
    .split(/[\n,]/)
    .map((e) => e.trim())
    .filter(Boolean);
  const fresh = parsed.filter((e, i) => !row.allowlist.includes(e) && parsed.indexOf(e) === i);

  const add = () => {
    if (locked || busy || fresh.length === 0) return;
    actions.setAllowlist(row.id, [...row.allowlist, ...fresh]);
    setDraft("");
  };

  return (
    <section className="list" aria-label={`Allowed ${noun}`}>
      <header className="list__head">
        <p className="accounts__eyebrow">{`${row.label} writes`}</p>
        <h1 className="accounts__marquee">{`Allowed ${noun}`}</h1>
        <p className="accounts__line">
          {row.allowlist.length
            ? `${row.allowlist.length} allowed. A write to anything else is refused.`
            : `None yet, so every write is refused. One ${noun === "recipients" ? "address" : "page id"} per line.`}
        </p>
        <p className="typo-caption">
          {row.writesEnabled
            ? "A write still waits for your card; the writes switch is on."
            : "Off: every write is refused before a card is filed."}
        </p>
      </header>

      <div className="list__editor">
        {row.error ? <ProblemNote title={`${row.label} refused.`} reason={row.error} tone="error" /> : null}
        {locked ? <p className="typo-caption accounts__locked">{row.disabledReason}</p> : null}

        <ul className="entries" aria-label={`Allowed ${noun}, as saved`}>
          {row.allowlist.map((e) => (
            <li key={e} className="entry">
              <code className="typo-code">{e}</code>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${e}`}
                onClick={() => actions.setAllowlist(row.id, row.allowlist.filter((x) => x !== e))}
                disabledReason={locked ? row.disabledReason : busy ? `${row.busy}…` : undefined}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>

        <FormField
          label={`Add ${noun === "recipients" ? "a recipient" : "a page id"}`}
          hint={
            draft.trim() !== ""
              ? "Not on the list until you press Add. Escape drops what you typed."
              : "A draft until you press Add; separate several with commas."
          }
          action={
            <Button
              variant="primary"
              onClick={add}
              disabledReason={
                locked
                  ? row.disabledReason
                  : busy
                    ? `${row.busy}…`
                    : fresh.length
                      ? undefined
                      : draft.trim()
                        ? "That is already on the list."
                        : "Type something first."
              }
            >
              Add
            </Button>
          }
        >
          {(input) => (
            <TextInput
              {...input}
              autoComplete="off"
              value={draft}
              disabled={locked}
              title={locked ? row.disabledReason : undefined}
              placeholder={noun === "recipients" ? "ap@northwind.example" : "32 hex characters"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                } else if (e.key === "Escape") {
                  // The first Escape drops the draft; with nothing to drop the field lets go, so
                  // the next Escape is the stage's and rises a level.
                  if (draft !== "") setDraft("");
                  else e.currentTarget.blur();
                }
              }}
            />
          )}
        </FormField>

        <span>
          <Button variant="ghost" size="sm" onClick={() => go({ root: "accounts", item: row.id })}>
            {`Back to ${row.label}`}
          </Button>
        </span>
      </div>
    </section>
  );
}

// -- the way in -----------------------------------------------------------------------------------------------

/**
 * Connecting as a short staged act: get the credential, give it, and (for OAuth) consent. The rail
 * shows where the person is; the stage underneath is only the step in front of them. The guide for
 * getting the credential is one tap away on the account's own scene.
 *
 * A grant that needs reconnecting, whose client the vault still keeps, is one press (ADR 0117): the
 * first two steps are already done, Reconnect asks for the consent alone, and no client value is
 * typed or sent. "Use a different client" brings back the two fields, and a pasted pair wins.
 */
function Connect({ row, model }: { row: ConnectorRow; model: ConnectorsModel }) {
  const { actions } = model;
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [different, setDifferent] = useState(false);
  const busy = Boolean(row.busy);
  const flow = row.flow;
  const waiting = flow !== null && (flow.phase === "awaiting_consent" || flow.phase === "exchanging");
  const oauth = row.auth === "oauth";
  const stages = oauth ? ["Register a client", "Give the pair", "Consent"] : ["Get the token", "Paste it", "Probed, then stored"];
  const kept = oauth && row.reconnect && !different;
  const at = waiting || busy || kept ? 2 : 1;
  const consentOpen = busy || waiting ? "A consent page is open; finish it in the browser first." : undefined;

  const rail = (
    <ol className="stages" aria-label="Steps to connect">
      {stages.map((label, i) => (
        <li
          key={label}
          className="stages__step"
          data-state={i < at ? "done" : i === at ? "now" : "next"}
          aria-current={i === at ? "step" : undefined}
        >
          <span className="stages__n" aria-hidden="true">
            {i < at ? "✓" : i + 1}
          </span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );

  // Enter and the button share one door: a key press is refused for the reason the button shows,
  // so nothing is sent a second time while a connect or a consent page is in flight.
  if (!oauth) {
    const send = () => {
      if (busy || !token.trim()) return;
      actions.connect(row.id, { token: token.trim() });
      setToken("");
    };
    return (
      <div className="connect">
        {rail}
        <div className="connect__fields">
          <FormField
            label="Integration token"
            hint="Pasted once, probed against the service, then stored on this machine. It is never shown again."
          >
            {(input) => (
              <TextInput
                {...input}
                type="password"
                autoComplete="off"
                value={token}
                placeholder="ntn_…"
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                }}
              />
            )}
          </FormField>
          <Button
            variant="primary"
            onClick={send}
            disabledReason={busy ? `${row.busy}…` : token.trim() ? undefined : "Paste the token first."}
          >
            Connect
          </Button>
        </div>
      </div>
    );
  }

  const start = () => {
    if (consentOpen || !clientId.trim()) return;
    actions.connect(row.id, { client_id: clientId.trim(), client_secret: clientSecret.trim() });
    setClientSecret("");
  };
  return (
    <div className="connect">
      {rail}
      {waiting ? (
        <div className="consent" role="status">
          <span className="consent__pulse" aria-hidden="true" />
          <div className="consent__words">
            <span className="standing">
              <span className="standing__word">
                {flow.phase === "awaiting_consent" ? "waiting for consent" : "exchanging the code"}
              </span>
            </span>
            <span className="typo-caption">{flow.detail}</span>
            {flow.authorize_url ? (
              <a className="typo-caption consent__link" href={flow.authorize_url} target="_blank" rel="noreferrer">
                Open the consent page again
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
      {flow && flow.phase === "failed" ? (
        <ProblemNote title="The consent did not complete." reason={flow.detail} tone="warning" />
      ) : null}
      {kept ? (
        <>
          <p className="typo-caption">
            The client you connected with is still kept on this machine, so only Google's consent is needed.
          </p>
          <div className="act-row">
            <Button variant="primary" onClick={() => actions.connect(row.id, { reuse_client: true })} disabledReason={consentOpen}>
              Reconnect
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDifferent(true)}>
              Use a different client
            </Button>
            <span className="typo-caption">Your browser opens Google's consent page.</span>
          </div>
        </>
      ) : (
        <>
          <div className="connect__fields">
            <FormField label="Client id" hint="Your own OAuth client, registered once in the Google Cloud console.">
              {(input) => (
                <TextInput
                  {...input}
                  autoComplete="off"
                  value={clientId}
                  placeholder="….apps.googleusercontent.com"
                  onChange={(e) => setClientId(e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Client secret" hint="Kept on this machine with the grant; never shown again.">
              {(input) => (
                <TextInput
                  {...input}
                  type="password"
                  autoComplete="off"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") start();
                  }}
                />
              )}
            </FormField>
          </div>
          <div className="act-row">
            <Button
              variant="primary"
              onClick={start}
              disabledReason={consentOpen ?? (clientId.trim() ? undefined : "Paste the client id first.")}
            >
              Connect with Google
            </Button>
            {row.reconnect ? (
              <Button size="sm" variant="ghost" onClick={() => setDifferent(false)}>
                Use the kept client
              </Button>
            ) : null}
            <span className="typo-caption">Your browser opens Google's consent page.</span>
          </div>
        </>
      )}
    </div>
  );
}

/** Two presses, on purpose: the second names what the first meant. */
export function Disconnect({ row, onDisconnect }: { row: ConnectorRow; onDisconnect: () => void }) {
  const [asked, setAsked] = useState(false);
  const slot = useRef<HTMLSpanElement>(null);
  const moved = useRef(false);
  // The pressed button is replaced by the question, so focus would fall to the document: the safe
  // answer (Keep it) takes it, and Disconnect takes it back when the question is withdrawn.
  useEffect(() => {
    if (!moved.current) return;
    const buttons = slot.current?.querySelectorAll("button");
    (asked ? buttons?.[buttons.length - 1] : buttons?.[0])?.focus();
  }, [asked]);
  const ask = (next: boolean) => {
    moved.current = true;
    setAsked(next);
  };
  if (!asked) {
    return (
      <span ref={slot}>
        <Button size="sm" variant="ghost" onClick={() => ask(true)} disabledReason={row.busy ? `${row.busy}…` : undefined}>
          Disconnect
        </Button>
      </span>
    );
  }
  return (
    <span ref={slot} className="confirm" role="group" aria-label="Confirm disconnect">
      <span className="typo-caption">Disconnect? The stored credential is destroyed.</span>
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          setAsked(false);
          onDisconnect();
        }}
      >
        Yes, disconnect
      </Button>
      <Button size="sm" variant="ghost" onClick={() => ask(false)}>
        Keep it
      </Button>
    </span>
  );
}
