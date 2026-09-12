/**
 * The Connectors module's surface — a pure function of `ConnectorsModel`.
 *
 * One card per service, and the same order inside every card: what it is and how it stands, what
 * it yields (reads, then writes marked GATED), the two decisions a person makes (may it write at
 * all, and to whom or where), and the way in. The way in is last because a connected service
 * hardly needs it and an unconnected one has nothing above it worth deciding yet.
 *
 * Nothing here is stored and nothing is guessed: the standing word, the seal sentence and the age
 * of the last probe come from the daemon's record through the selector, and a refusal is shown in
 * the daemon's own words. A credential is typed here and sent once; it is never echoed back.
 */
import { useState } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import FormField, { TextInput } from "@/components/FormField";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import PillGroup from "@/components/PillGroup";
import ProblemNote from "@/components/ProblemNote";
import SectionCard from "@/components/SectionCard";
import type { ConnectorToolView } from "@/lib/api";

import "./connectors.css";
import { paragraphsOf, type ConnectorRow, type ConnectorsModel } from "./model";

export default function ConnectorsView({ model }: { model: ConnectorsModel }) {
  const connected = model.rows.filter((r) => r.standing === "connected").length;
  return (
    <PageShell>
      <PageHeader
        eyebrow="Connectors"
        title="Connectors"
        caption="Mail and notes Athena may use from any page, each behind its own switch."
        meta={
          model.ready && model.loaded && !model.problem ? (
            <Badge tone={connected ? "success" : "neutral"}>
              {`${connected} of ${model.rows.length} connected`}
            </Badge>
          ) : null
        }
      />

      {!model.ready ? (
        <ProblemNote
          title="Athena's daemon is not running, so the vault cannot be asked."
          reason="daemon_offline"
          detail="The connectors are listed as soon as it answers. Nothing here is lost in the meantime."
        />
      ) : model.problem ? (
        <ProblemNote
          title="The connector list could not be read."
          reason={model.problem}
          detail="The daemon refused the list; the reason above is its own."
          tone="error"
        />
      ) : !model.loaded ? (
        <p className="typo-caption">Asking the daemon what is connected…</p>
      ) : (
        <div className="connectors">
          {model.rows.map((row) => (
            <ConnectorCard key={row.id} row={row} model={model} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

// -- one card ----------------------------------------------------------------------------------

function ConnectorCard({ row, model }: { row: ConnectorRow; model: ConnectorsModel }) {
  const { actions } = model;
  const on = row.standing === "connected" || row.standing === "off" || row.standing === "broken";
  return (
    <SectionCard
      title={row.label}
      note={row.description}
      action={<Badge tone={row.tone}>{row.busy ? `${row.busy}…` : row.word}</Badge>}
    >
      <p className="typo-body connector__sentence">{row.sentence}</p>
      {row.seal ? <p className="typo-caption">The credential is {row.seal}.</p> : null}
      {!row.sealAvailable ? (
        <p className="typo-caption">
          Nothing on this machine can seal a credential, so nothing will be stored.
        </p>
      ) : null}
      {row.error ? (
        <ProblemNote title={`${row.label} refused.`} reason={row.error} tone="error" />
      ) : null}

      <Tools row={row} />

      {on ? <Decisions row={row} model={model} /> : null}

      {row.standing === "connected" || row.standing === "off" || row.standing === "broken" ? null : (
        <ConnectForm row={row} model={model} />
      )}

      <details className="connector__guide">
        <summary className="typo-caption">How to connect</summary>
        <div className="connector__guide-body">
          {paragraphsOf(row.guide).map((p, i) => (
            <p key={i} className="typo-body">
              {p}
            </p>
          ))}
        </div>
      </details>

      {on || row.standing === "needs-reauth" ? (
        <div className="connector__foot">
          {on ? (
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
          ) : null}
          {on ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => actions.probe(row.id)}
              disabledReason={row.busy ? `${row.busy}…` : undefined}
            >
              Check now
            </Button>
          ) : null}
          <Disconnect row={row} onDisconnect={() => actions.disconnect(row.id)} />
        </div>
      ) : null}
    </SectionCard>
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
  return (
    <div className="connector__decisions">
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
          disabled={Boolean(row.busy)}
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
  const value = draft ?? stored;
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
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setDraft(null);
          }}
        />
        <span className="row">
          <Button
            size="sm"
            variant={dirty ? "primary" : "secondary"}
            disabledReason={dirty ? undefined : "Nothing has been typed that is not stored."}
            onClick={() => {
              onSave(entries);
              setDraft(null);
            }}
          >
            Save the list
          </Button>
          {dirty ? (
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
            hint="Pasted once, probed against the service, then sealed. It is never shown again."
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
        <FormField label="Client secret" hint="Sealed with the grant; never shown again.">
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
      <span className="typo-caption">Disconnect? The sealed credential is destroyed.</span>
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
