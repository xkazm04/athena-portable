/**
 * The Connectors module's surface — a pure function of `ConnectorsModel`.
 *
 * Two layers (ADR 0029). The overview is a grid of tiles: each service's emblem, inked when it is
 * connected, its standing and one sentence — the only act is opening one. Its layer holds every
 * write: on the left the two decisions a person makes (may it write at all, and to whom or where)
 * with the switch, the probe and Disconnect, or the way in when it is not connected; on the right
 * what it yields (reads, then writes marked GATED) and the guide.
 *
 * Nothing here is stored and nothing is guessed: the standing word, the seal sentence and the age
 * of the last probe come from the daemon's record through the selector, and a refusal is shown in
 * the daemon's own words. A credential is typed here and sent once; it is never echoed back.
 *
 * Copy that speaks of where a credential rests says "stored on this machine", which is true of
 * every rung; only the seal sentence names a rung, and only it may say "encrypted" — the
 * owner-only file is not. While the vault's records notice stands it is a banner at the top, in
 * its own words, with no way to dismiss it: the rows beneath read unconfirmed until it goes.
 */
import { useState } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import Emblem, { GLYPHS } from "@/components/Emblem";
import FormField, { TextInput } from "@/components/FormField";
import Layer, { LayerColumns } from "@/components/Layer";
import PageHeader from "@/components/PageHeader";
import PageSection from "@/components/PageSection";
import PageShell from "@/components/PageShell";
import PillGroup from "@/components/PillGroup";
import ProblemNote from "@/components/ProblemNote";
import SectionCard from "@/components/SectionCard";
import Tile from "@/components/Tile";
import type { ConnectorToolView } from "@/lib/api";

import "./connectors.css";
import { paragraphsOf, type ConnectorRow, type ConnectorsModel } from "./model";

export default function ConnectorsView({
  model,
  initialOpen = null,
}: {
  model: ConnectorsModel;
  /** Preview only: open this connector's layer on first render. */
  initialOpen?: string | null;
}) {
  const [open, setOpen] = useState<string | null>(initialOpen);
  const connected = model.rows.filter((r) => r.standing === "connected").length;
  // The layer shows the connector as it is now: looked up from the model on every render.
  const current = model.rows.find((r) => r.id === open) ?? null;
  return (
    <PageShell>
      <PageHeader
        eyebrow="Connectors"
        title="Connectors"
        caption="Mail and notes Athena may use from any page, each behind its own switch."
        meta={
          model.ready && model.loaded && !model.problem ? (
            model.recordsNotice ? (
              <Badge tone="warning">connections unconfirmed</Badge>
            ) : (
              <Badge tone={connected ? "success" : "neutral"}>
                {`${connected} of ${model.rows.length} connected`}
              </Badge>
            )
          ) : null
        }
      />

      {model.recordsNotice ? <RecordsNotice notice={model.recordsNotice} /> : null}

      {!model.ready ? (
        <ProblemNote
          title="Athena's daemon is not running, so the vault cannot be asked."
          reason="daemon_offline"
          detail="The connectors are listed as soon as it answers. Nothing here is lost in the meantime."
        />
      ) : model.problem ? (
        <ProblemNote
          title="The connector list could not be read."
          reason={model.problem.reason}
          /* Who is refusing is a different fact from why, and this note used to assert the
             daemon for both — so a bug in this shell's own HTTP client was reported to the
             reader as the vault turning them away. */
          detail={
            model.problem.from === "daemon"
              ? "The daemon refused the list; the reason above is its own."
              : "The request never reached the daemon, so the reason above is this shell's rather than the vault's."
          }
          tone="error"
        />
      ) : !model.loaded ? (
        <p className="typo-caption">Asking the daemon what is connected…</p>
      ) : (
        <div className="connectors-grid">
          {model.rows.map((row) => (
            <Tile
              key={row.id}
              emblem={<Emblem glyph={GLYPHS[row.id] ?? GLYPHS.generic} done={row.standing === "connected"} />}
              title={row.label}
              pill={<Badge tone={row.tone}>{row.busy ? `${row.busy}…` : row.word}</Badge>}
              line={row.sentence}
              foot={<TileFoot row={row} />}
              onOpen={() => setOpen(row.id)}
            />
          ))}
        </div>
      )}

      {current ? (
        <Layer
          eyebrow="Connector"
          title={current.label}
          onClose={() => setOpen(null)}
          actions={<Badge tone={current.tone}>{current.busy ? `${current.busy}…` : current.word}</Badge>}
        >
          <ConnectorLayer row={current} model={model} />
        </Layer>
      ) : null}
    </PageShell>
  );
}

/**
 * The vault's records notice, verbatim, for as long as the vault carries it. No close control on
 * purpose: it goes when the daemon stops saying it, never because it was waved away.
 */
function RecordsNotice({ notice }: { notice: string }) {
  return (
    <div className="problem-note problem-note--warning connectors__notice" role="alert">
      <span className="problem-note__mark typo-heading" aria-hidden="true">
        !
      </span>
      <div className="problem-note__body">
        <p className="typo-body connectors__notice-text">{notice}</p>
        <p className="typo-caption">
          Until this notice goes, no connector here is shown as connected: what the records say cannot be
          confirmed.
        </p>
      </div>
    </div>
  );
}

function TileFoot({ row }: { row: ConnectorRow }) {
  return (
    <>
      <span className="connector-chip">{plural(row.reads.length, "read")}</span>
      <span className="connector-chip connector-chip--gated">{`${plural(row.writes.length, "write")}, gated`}</span>
      {row.writes.length && row.standing === "connected" ? (
        <span className="connector-chip">{row.writesEnabled ? "writes on" : "writes off"}</span>
      ) : null}
    </>
  );
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** A guide paragraph that numbers its steps inline ("1. Open … 2. Copy …") reads as a list. */
function GuideParagraph({ text }: { text: string }) {
  const steps = text.split(/\s+(?=\d+\.\s)/).filter(Boolean);
  if (steps.length < 2 || !/^\d+\.\s/.test(steps[0])) return <p className="typo-body">{text}</p>;
  return (
    <ol className="connector__steps">
      {steps.map((step, i) => (
        <li key={i} className="typo-body">
          {step.replace(/^\d+\.\s/, "")}
        </li>
      ))}
    </ol>
  );
}

// -- one connector's layer -------------------------------------------------------------------------

/** What is set on the left, what it yields and how to connect on the right (ADR 0029). */
function ConnectorLayer({ row, model }: { row: ConnectorRow; model: ConnectorsModel }) {
  const { actions } = model;
  // Connected on the record (on, off or broken alike), even while a records notice stands.
  const on = row.connected;
  return (
    <LayerColumns
      left={
        <>
          <div className="connector-hero">
            <Emblem glyph={GLYPHS[row.id] ?? GLYPHS.generic} done={row.standing === "connected"} size={72} />
            <div className="stack" style={{ gap: 4 }}>
              <p className="typo-body">{row.description}</p>
              <p className="typo-title">{row.sentence}</p>
              {row.seal ? <p className="typo-caption">The credential is {row.seal}.</p> : null}
              {!row.sealAvailable ? (
                <p className="typo-caption">
                  This machine has no safe place to keep a credential, so nothing will be stored.
                </p>
              ) : null}
              {row.healthNote ? (
                <p className="typo-caption connector__note" role="note">
                  {row.healthNote}
                </p>
              ) : null}
            </div>
          </div>
          {row.error ? (
            <ProblemNote title={`${row.label} refused.`} reason={row.error} tone="error" />
          ) : null}

          {on ? (
            <PageSection title="Decisions" note="The gate reads these on every call.">
              <Decisions row={row} model={model} />
              <div className="connector__foot">
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
            </PageSection>
          ) : (
            <>
              <PageSection title="Connect" note="Probed before it is stored on this machine.">
                <ConnectForm row={row} model={model} />
                {row.standing === "needs-reauth" ? (
                  <div className="connector__foot">
                    <Disconnect row={row} onDisconnect={() => actions.disconnect(row.id)} />
                  </div>
                ) : null}
              </PageSection>
              {row.egress ? (
                <PageSection title="Decisions" note="The gate reads these on every call.">
                  <Decisions row={row} model={model} />
                </PageSection>
              ) : null}
            </>
          )}
        </>
      }
      right={
        <>
          <SectionCard title="What it yields" posture="flat">
            <Tools row={row} />
          </SectionCard>
          <SectionCard title="How to connect" posture="flat">
            <div className="connector__guide-body">
              {paragraphsOf(row.guide).map((p, i) => (
                <GuideParagraph key={i} text={p} />
              ))}
            </div>
          </SectionCard>
        </>
      }
    />
  );
}

// -- the tools -------------------------------------------------------------------------------

function Tools({ row }: { row: ConnectorRow }) {
  return (
    <div className="connector__tools">
      <ToolList title="Reads" tools={row.reads} gated={false} />
      <ToolList title="Writes" tools={row.writes} gated />
    </div>
  );
}

function ToolList({
  title,
  tools,
  gated,
}: {
  title: string;
  tools: readonly ConnectorToolView[];
  gated: boolean;
}) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="typo-label muted">{title}</span>
      {tools.length ? (
        <ul className="connector__list">
          {tools.map((tool) => (
            <li key={tool.name} className="connector__tool">
              <code className="typo-code">{tool.name}</code>
              {gated ? <Badge tone="warning">GATED</Badge> : null}
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

// -- the two decisions ---------------------------------------------------------------------------

function Decisions({ row, model }: { row: ConnectorRow; model: ConnectorsModel }) {
  const { actions } = model;
  if (!row.egress) return null;
  const noun = row.egress === "recipients" ? "recipients" : "page ids";
  // Not connected: shown as they stand, but not changeable, and the reason is said beside them.
  const locked = Boolean(row.disabledReason);
  return (
    <div className="connector__decisions">
      {locked ? <p className="typo-caption connector__disabled-reason">{row.disabledReason}</p> : null}
      <div className="connector__decision">
        <div className="stack" style={{ gap: 2 }}>
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
      <Allowlist row={row} noun={noun} onSave={(entries) => actions.setAllowlist(row.id, entries)} />
    </div>
  );
}

/**
 * One entry per line. A draft until saved: the list is read by the gate on every write, and a
 * half-typed address must never be one it accepts.
 */
function Allowlist({
  row,
  noun,
  onSave,
}: {
  row: ConnectorRow;
  noun: string;
  onSave: (entries: string[]) => void;
}) {
  const stored = row.allowlist.join("\n");
  const [draft, setDraft] = useState<string | null>(null);
  const locked = Boolean(row.disabledReason);
  const value = locked ? stored : (draft ?? stored);
  const dirty = draft !== null && draft.trim() !== stored.trim();
  const entries = value
    .split(/[\n,]/)
    .map((e) => e.trim())
    .filter(Boolean);
  return (
    <div className="connector__decision">
      <div className="stack" style={{ gap: 2 }}>
        <span className="typo-title">Allowed {noun}</span>
        <span className="typo-caption">
          {row.allowlist.length
            ? `${row.allowlist.length} allowed. A write to anything else is refused.`
            : `None yet, so every write is refused. One ${noun === "recipients" ? "address" : "page id"} per line.`}
        </span>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <textarea
          className="input connector__allowlist focus-ring"
          aria-label={`Allowed ${noun}`}
          value={value}
          spellCheck={false}
          disabled={locked}
          title={locked ? row.disabledReason : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setDraft(null);
          }}
        />
        <span className="row">
          <Button
            size="sm"
            variant={dirty ? "primary" : "secondary"}
            disabledReason={
              locked ? row.disabledReason : dirty ? undefined : "Nothing has been typed that is not stored."
            }
            onClick={() => {
              onSave(entries);
              setDraft(null);
            }}
          >
            Save the list
          </Button>
          {dirty && !locked ? (
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Discard
            </Button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

// -- the way in ------------------------------------------------------------------------------------

function ConnectForm({ row, model }: { row: ConnectorRow; model: ConnectorsModel }) {
  const { actions } = model;
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const busy = Boolean(row.busy);
  const flow = row.flow;
  const waiting = flow !== null && (flow.phase === "awaiting_consent" || flow.phase === "exchanging");

  if (row.auth === "token") {
    const send = () => {
      if (!token.trim()) return;
      actions.connect(row.id, { token: token.trim() });
      setToken("");
    };
    return (
      <div className="connector__connect">
        <div className="connector__fields">
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
    if (!clientId.trim()) return;
    actions.connect(row.id, { client_id: clientId.trim(), client_secret: clientSecret.trim() });
    setClientSecret("");
  };
  return (
    <div className="connector__connect">
      {waiting ? (
        <div className="connector__flow">
          <Badge tone="pending">
            {flow.phase === "awaiting_consent" ? "waiting for consent" : "exchanging the code"}
          </Badge>
          <span className="typo-caption">{flow.detail}</span>
          {flow.authorize_url ? (
            <a
              className="typo-caption connector__link"
              href={flow.authorize_url}
              target="_blank"
              rel="noreferrer"
            >
              Open the consent page again
            </a>
          ) : null}
        </div>
      ) : null}
      {flow && flow.phase === "failed" ? (
        <ProblemNote title="The consent did not complete." reason={flow.detail} tone="warning" />
      ) : null}
      <div className="connector__fields">
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
      <span className="row">
        <Button
          variant="primary"
          onClick={start}
          disabledReason={
            busy || waiting
              ? "A consent page is open; finish it in the browser first."
              : clientId.trim()
                ? undefined
                : "Paste the client id first."
          }
        >
          Connect with Google
        </Button>
        <span className="typo-caption">Your browser opens Google's consent page.</span>
      </span>
    </div>
  );
}

/** Two presses, on purpose: the second names what the first meant. */
function Disconnect({ row, onDisconnect }: { row: ConnectorRow; onDisconnect: () => void }) {
  const [asked, setAsked] = useState(false);
  if (!asked) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setAsked(true)}
        disabledReason={row.busy ? `${row.busy}…` : undefined}
      >
        Disconnect
      </Button>
    );
  }
  return (
    <span className="row">
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
      <Button size="sm" variant="ghost" onClick={() => setAsked(false)}>
        Keep it
      </Button>
    </span>
  );
}
