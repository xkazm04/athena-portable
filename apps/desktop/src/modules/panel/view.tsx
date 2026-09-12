/**
 * The Panel module's surface — a pure function of `PanelModel`.
 *
 * A conversation, read the way a person reads one: their own lines on the right in a quiet
 * bubble, Athena's on the left as prose, and between them the record of what ran, folded to one
 * line until it is wanted. The cards are the newest thing in the stream and sit at its end, above
 * the composer, so a card that needs an answer is the last thing before the place the answer is
 * typed — never something that scrolled away with the conversation.
 *
 * The composer is docked and always present. A surface whose input appears only in some states is
 * a surface the user has to hunt for, and `disabledReason` on the send button means a disabled
 * control here is never silent about why.
 *
 * Nothing here decides anything: every class, every card and every refusal arrives already
 * decided by the gate. The panel renders what it is told.
 */
import { useEffect, useRef, useState } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import Facts, { Fact } from "@/components/Facts";
import PageShell from "@/components/PageShell";
import ProblemNote from "@/components/ProblemNote";
import StatusDot, { type Tone } from "@/components/StatusDot";
import Table, { type Column } from "@/components/Table";
import type { ToolRow } from "@/lib/api";
import type { DecisionRequested, TurnSummary } from "@/lib/events";
import type { RunPhase, TranscriptEntry } from "@/stores/run";

import { phraseFor, type MessageBlock, type PanelModel, type PanelVoice } from "./model";
import "./panel.css";

export default function PanelView({ model }: { model: PanelModel }) {
  const { actions, blocked, cards, error, host, messages, phase, ready, summary, tools, voice } =
    model;
  const working = phase === "running" || phase === "acting";
  const empty = messages.length === 0 && cards.length === 0 && !error;

  return (
    <PageShell fill>
      <div className="chat">
        <header className="chat__head">
          <h1 className="typo-heading">Athena</h1>
          {host ? <Badge tone="info">{host}</Badge> : <Badge tone="neutral">no page open</Badge>}
          <span className="typo-caption chat__state">{phraseFor(phase)}</span>
          <span className="chat__head-spacer" />
          <ToolDisclosure tools={tools} />
          {messages.length ? (
            <Button size="sm" variant="ghost" onClick={actions.clear}>
              Clear
            </Button>
          ) : null}
        </header>

        <Conversation
          empty={empty}
          host={host}
          messages={messages}
          cards={cards}
          error={error}
          summary={summary}
          working={working}
          phase={phase}
          suggestions={model.suggestions}
          ready={ready}
          onSend={actions.send}
          onAnswer={actions.answer}
        />

        <Composer blocked={blocked} ready={ready} voice={voice} onSend={actions.send} />
      </div>
    </PageShell>
  );
}

// -- the conversation ----------------------------------------------------------------------------

function Conversation({
  empty,
  host,
  messages,
  cards,
  error,
  summary,
  working,
  phase,
  suggestions,
  ready,
  onSend,
  onAnswer,
}: {
  empty: boolean;
  host: string | null;
  messages: readonly MessageBlock[];
  cards: readonly DecisionRequested[];
  error: PanelModel["error"];
  summary: TurnSummary | null;
  working: boolean;
  phase: RunPhase;
  suggestions: readonly string[];
  ready: boolean;
  onSend: (message: string) => void;
  onAnswer: (id: string, choice: string) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const count = messages.length + cards.length;
  useEffect(() => {
    // The newest thing is what the person is waiting for; keep it in view as it arrives.
    end.current?.scrollIntoView({ block: "end" });
  }, [count, working]);

  if (empty) {
    return (
      <div className="chat__scroll">
        <Opening host={host} suggestions={suggestions} ready={ready} onSend={onSend} />
      </div>
    );
  }

  const lastAthena = [...messages].reverse().findIndex((b) => b.kind === "assistant");
  const costAfter = lastAthena === -1 ? -1 : messages.length - 1 - lastAthena;

  return (
    <div className="chat__scroll">
      <ol className="chat__stream" aria-live="polite">
        {messages.map((block, index) => (
          <li key={block.id} className={`chat__block chat__block--${block.kind}`}>
            <Block block={block} />
            {index === costAfter && summary && !working ? <Cost summary={summary} /> : null}
          </li>
        ))}
        {cards.map((card) => (
          <li key={card.id} className="chat__block chat__block--card">
            <DecisionCard card={card} onAnswer={onAnswer} />
          </li>
        ))}
        {error ? (
          <li className="chat__block chat__block--error">
            <ProblemNote
              title="The turn stopped before it finished."
              reason={error.reason}
              detail={error.detail}
              tone={error.reason === "user_denied" ? "warning" : "error"}
            />
          </li>
        ) : null}
        {working ? (
          <li className="chat__block chat__block--assistant">
            <Working phase={phase} />
          </li>
        ) : null}
      </ol>
      <div ref={end} />
    </div>
  );
}

function Block({ block }: { block: MessageBlock }) {
  switch (block.kind) {
    case "user":
      return <p className="chat__bubble typo-body">{block.text}</p>;
    case "assistant":
      return (
        <div className="chat__reply">
          <span className="chat__mark" aria-hidden="true">
            ◆
          </span>
          <div className="chat__prose typo-body">
            {block.text.split(/\n{2,}/).map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </div>
      );
    case "activity":
      return <Activity steps={block.steps} />;
  }
}

/**
 * What ran, folded. A chip per step says the name and whether it was allowed; the fold opens to
 * the lines themselves, in the tool's own words, for the person who wants to see what came back.
 */
function Activity({ steps }: { steps: readonly TranscriptEntry[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="chat__activity">
      <button
        type="button"
        className="chat__fold focus-ring"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="typo-label">
          {steps.length === 1 ? "1 step" : `${steps.length} steps`}
        </span>
        <span className="chat__chips">
          {steps.map((step) => (
            <span key={step.id} className="chat__chip typo-label">
              <StatusDot tone={step.ok === false ? "error" : "success"} />
              <span className="truncate">{nameOf(step.text)}</span>
              {step.tier !== undefined ? <span className="muted">{`t${step.tier}`}</span> : null}
            </span>
          ))}
        </span>
      </button>
      {open ? (
        <ol className="chat__steps">
          {steps.map((step) => (
            <li key={step.id} className="typo-code chat__step" data-ok={step.ok !== false}>
              {step.text}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** `host.ledgerbox.chase → …` reads as `chase` on a chip; the whole line is under the fold. */
function nameOf(line: string): string {
  const [name] = line.split(" → ");
  const parts = name.trim().split(".");
  return parts.length > 2 ? parts.slice(2).join(".") : name.trim();
}

function Working({ phase }: { phase: RunPhase }) {
  return (
    <div className="chat__reply chat__reply--working">
      <span className="chat__mark" aria-hidden="true">
        ◆
      </span>
      <span className="chat__dots" role="status" aria-label={phraseFor(phase)}>
        <i />
        <i />
        <i />
      </span>
      <span className="typo-caption">{phase === "acting" ? "acting on the page" : "thinking"}</span>
    </div>
  );
}

/** What the turn cost, from the ledger row it wrote (README section 2, invariant 6). */
function Cost({ summary }: { summary: TurnSummary }) {
  const cost =
    summary.cost_usd === null
      ? "cost not reported"
      : `$${summary.cost_usd.toFixed(4)}${summary.cost_estimated ? " estimated" : ""}`;
  const rounds = summary.rounds === 1 ? "1 round" : `${summary.rounds} rounds`;
  return (
    <p className="typo-caption chat__cost">
      {`${summary.model || summary.engine}, ${rounds}, ${summary.input_tokens + summary.output_tokens} tokens, ${cost}`}
    </p>
  );
}

// -- the opening -----------------------------------------------------------------------------------

function Opening({
  host,
  suggestions,
  ready,
  onSend,
}: {
  host: string | null;
  suggestions: readonly string[];
  ready: boolean;
  onSend: (message: string) => void;
}) {
  return (
    <div className="chat__opening">
      <span className="chat__mark chat__mark--large" aria-hidden="true">
        ◆
      </span>
      <h2 className="typo-heading-lg">
        {host ? `What should Athena do on ${host}?` : "Open a page, then ask."}
      </h2>
      <p className="typo-caption">
        She reads the page, proposes, and waits for you before anything that cannot be undone.
      </p>
      <div className="chat__suggestions">
        {suggestions.map((line) => (
          <button
            key={line}
            type="button"
            className="chat__suggestion focus-ring typo-body"
            disabled={!ready}
            onClick={() => onSend(line)}
          >
            {line}
          </button>
        ))}
      </div>
    </div>
  );
}

// -- the card --------------------------------------------------------------------------------------

/**
 * One decision, with the parameters the approval was actually filed for.
 *
 * The parameters are not a detail to fold away. The gate replays with the row's own parameters
 * (README section 3.2 step 6), so what is printed here is exactly what will run.
 */
function DecisionCard({
  card,
  onAnswer,
}: {
  card: DecisionRequested;
  onAnswer: (id: string, choice: string) => void;
}) {
  const params = Object.entries(card.params);
  return (
    <section className="chat__card" aria-label={`Approval: ${card.action}`}>
      <header className="chat__card-head">
        <span className="typo-title">{card.action}</span>
        <Badge tone="warning">waiting on you</Badge>
      </header>
      {card.rationale ? <p className="typo-body">{card.rationale}</p> : null}
      {params.length ? (
        <Facts>
          {params.map(([key, value]) => (
            <Fact key={key} label={key} value="code">
              {typeof value === "string" ? value : JSON.stringify(value)}
            </Fact>
          ))}
        </Facts>
      ) : (
        <p className="typo-caption">No parameters.</p>
      )}
      <div className="chat__answers">
        {card.options.map((option) => (
          <Button
            key={option.id}
            variant={option.id === "approve" ? "primary" : "secondary"}
            size="sm"
            onClick={() => onAnswer(card.id, option.id)}
          >
            {option.label || option.id}
          </Button>
        ))}
        {card.surface === "voice" ? (
          <span className="typo-caption">or say approve, or decline</span>
        ) : null}
      </div>
    </section>
  );
}

// -- the composer ----------------------------------------------------------------------------------

function Composer({
  blocked,
  ready,
  voice,
  onSend,
}: {
  blocked: string;
  ready: boolean;
  voice: PanelVoice;
  onSend: (message: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const listening = voice.phase === "listening";

  const send = () => {
    const text = draft.trim();
    if (!text || blocked) return;
    setDraft("");
    onSend(text);
  };

  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 6 * 24 + 20)}px`;
  }, [draft]);

  const placeholder = listening
    ? voice.partial || "Listening…"
    : ready
      ? "Ask Athena about this page"
      : blocked;

  return (
    <div className="chat__composer">
      <div className="chat__field-wrap" data-listening={listening}>
        <textarea
          ref={field}
          className="chat__field typo-body focus-ring"
          rows={1}
          value={draft}
          placeholder={placeholder}
          aria-label="Message to Athena"
          disabled={!ready}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <Button variant="primary" onClick={send} disabledReason={blocked || undefined}>
          Send
        </Button>
      </div>
      <p className="typo-caption chat__hint">
        {voice.available
          ? "Enter sends, Shift+Enter breaks a line, hold Ctrl+Space to talk"
          : "Enter sends, Shift+Enter breaks a line"}
      </p>
    </div>
  );
}

// -- the tool list ---------------------------------------------------------------------------------

const TONE: Record<ToolRow["class"], Tone> = {
  GATED: "warning",
  READ: "info",
  AUTO: "success",
};

/**
 * Every name this page offers, with the class the catalog gave it, behind one line that says how
 * many. Act 1 of the demo is this list, so it is one click away and never hidden; but it is a
 * reference and not the conversation, so it does not sit in the stream.
 */
function ToolDisclosure({ tools }: { tools: readonly ToolRow[] }) {
  const [open, setOpen] = useState(false);
  const label =
    tools.length === 0
      ? "This page offers no tools"
      : tools.length === 1
        ? "This page offers 1 tool"
        : `This page offers ${tools.length} tools`;
  const columns: Column<ToolRow>[] = [
    {
      key: "class",
      head: "Class",
      render: (tool) => <Badge tone={TONE[tool.class]}>{tool.class}</Badge>,
    },
    { key: "name", head: "Name", render: (tool) => <code className="typo-code">{tool.name}</code> },
    { key: "tier", head: "Tier", render: (tool) => `tier ${tool.tier}` },
    { key: "description", head: "What it does", render: (tool) => tool.description },
  ];
  return (
    <div className="chat__tools">
      <button
        type="button"
        className="chat__tools-toggle focus-ring typo-caption"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open ? (
        <div className="chat__tools-sheet">
          <Table
            columns={columns}
            rows={tools}
            rowKey={(tool) => tool.name}
            empty="This page has registered no tools. The generic hands still reach it."
            caption="Decided by the catalog, not by this panel."
          />
        </div>
      ) : null}
    </div>
  );
}
