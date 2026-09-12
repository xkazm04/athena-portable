/**
 * The Panel module's surface — a pure function of `PanelModel`.
 *
 * **The cards come first, above the transcript.** A card is the only thing on this surface waiting
 * on the user, and a card that scrolled away with the conversation is a card answered late or not
 * at all — which in this system means a turn that silently did nothing. It is the one ordering
 * decision in this file that is not aesthetic.
 *
 * The composer is last and always present. A surface whose input appears only in some states is a
 * surface the user has to hunt for, and `disabledReason` on the send button means a disabled
 * control here is never silent about why.
 */
import { useState } from "react";

import Badge from "@/components/Badge";
import type { Tone } from "@/components/StatusDot";
import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import Facts, { Fact } from "@/components/Facts";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import ProblemNote from "@/components/ProblemNote";
import SectionCard from "@/components/SectionCard";
import Table, { type Column } from "@/components/Table";
import type { ToolRow } from "@/lib/api";
import type { DecisionRequested } from "@/lib/events";
import type { TranscriptEntry } from "@/stores/run";

import { phraseFor, type PanelModel } from "./model";

export default function PanelView({ model }: { model: PanelModel }) {
  const { actions, blocked, cards, error, origin, phase, ready, summary, tools, transcript } = model;

  return (
    <PageShell fill>
      <PageHeader
        eyebrow="Athena"
        title="What she is doing"
        caption="Every action passes the gate before it happens."
        meta={
          <Facts layout="inline">
            <Fact label="Page" value="code">
              {origin ?? "none open"}
            </Fact>
            <Fact label="State">{phraseFor(phase)}</Fact>
          </Facts>
        }
        action={
          transcript.length ? (
            <Button size="sm" variant="ghost" onClick={actions.clear}>
              Clear
            </Button>
          ) : undefined
        }
      />

      {cards.length ? (
        <div className="panel-cards">
          {cards.map((card) => (
            <DecisionCard key={card.id} card={card} onAnswer={actions.answer} />
          ))}
        </div>
      ) : null}

      {error ? (
        <ProblemNote
          title="The turn stopped before it finished."
          reason={error.reason}
          detail={error.detail}
          tone={error.reason === "user_denied" ? "warning" : "error"}
        />
      ) : null}

      <Transcript entries={transcript} phase={phase} />

      {summary ? <Cost summary={summary} /> : null}

      <Composer blocked={blocked} ready={ready} onSend={actions.send} />

      <ToolList tools={tools} />
    </PageShell>
  );
}

// -- the card ------------------------------------------------------------------------------------

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
    <SectionCard
      title={card.action}
      note={card.rationale || undefined}
      action={<Badge tone="warning">GATED</Badge>}
    >
      <div className="panel-card__body">
        {params.length ? (
          <Facts>
            {params.map(([key, value]) => (
              <Fact key={key} label={key} value="code">
                {typeof value === "string" ? value : JSON.stringify(value)}
              </Fact>
            ))}
          </Facts>
        ) : (
          <p className="typo-body-sm">No parameters.</p>
        )}
        <div className="panel-card__answers">
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
        </div>
      </div>
    </SectionCard>
  );
}

// -- the transcript ------------------------------------------------------------------------------

function Transcript({ entries, phase }: { entries: readonly TranscriptEntry[]; phase: string }) {
  if (!entries.length) {
    return (
      <EmptyState
        glyph="◆"
        title="Nothing said yet"
        line="Ask about the page you have open. Athena reads it, proposes, and waits for you."
      />
    );
  }
  return (
    <SectionCard posture="flat" padded={false}>
      <ol className="transcript">
        {entries.map((entry) => (
          <li key={entry.id} className={`transcript__row transcript__row--${entry.kind}`}>
            {entry.tier !== undefined ? (
              <Badge tone={entry.ok === false ? "error" : "neutral"}>{`tier ${entry.tier}`}</Badge>
            ) : null}
            <p className={entry.kind === "tool" ? "typo-code-sm" : "typo-body"}>{entry.text}</p>
          </li>
        ))}
        {phase === "running" || phase === "acting" ? (
          <li className="transcript__row transcript__row--working">
            <p className="typo-body-sm">
              {phase === "acting" ? "acting on the page…" : "thinking…"}
            </p>
          </li>
        ) : null}
      </ol>
    </SectionCard>
  );
}

/** What the turn cost, from the ledger row it wrote (README section 2, invariant 6). */
function Cost({ summary }: { summary: NonNullable<PanelModel["summary"]> }) {
  const cost =
    summary.cost_usd === null
      ? "not reported"
      : `$${summary.cost_usd.toFixed(4)}${summary.cost_estimated ? " (estimated)" : ""}`;
  return (
    <Facts layout="inline">
      <Fact label="Engine" value="code">
        {summary.model || summary.engine}
      </Fact>
      <Fact label="Rounds">{String(summary.rounds)}</Fact>
      <Fact label="Tokens">{String(summary.input_tokens + summary.output_tokens)}</Fact>
      <Fact label="Cost">{cost}</Fact>
    </Facts>
  );
}

// -- the composer --------------------------------------------------------------------------------

function Composer({
  blocked,
  ready,
  onSend,
}: {
  blocked: string;
  ready: boolean;
  onSend: (message: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const send = () => {
    const text = draft.trim();
    if (!text || blocked) return;
    setDraft("");
    onSend(text);
  };

  return (
    <div className="composer">
      <textarea
        className="composer__field typo-body focus-ring"
        rows={3}
        value={draft}
        placeholder={ready ? "Ask Athena about this page" : blocked}
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
  );
}

// -- the tool list -------------------------------------------------------------------------------

const TONE: Record<ToolRow["class"], Tone> = {
  GATED: "warning",
  READ: "info",
  AUTO: "success",
};

/**
 * Every name this page offers, with the class the catalog gave it.
 *
 * Act 1 of the demo is this list. The class is a word rather than an icon, because `GATED` is a
 * promise to the user about what cannot happen without them, and a promise worth making is worth
 * spelling.
 */
function ToolList({ tools }: { tools: readonly ToolRow[] }) {
  const columns: Column<ToolRow>[] = [
    {
      key: "class",
      head: "Class",
      render: (tool) => <Badge tone={TONE[tool.class]}>{tool.class}</Badge>,
    },
    { key: "name", head: "Name", render: (tool) => <code className="typo-code-sm">{tool.name}</code> },
    { key: "tier", head: "Tier", render: (tool) => `tier ${tool.tier}` },
    { key: "description", head: "What it does", render: (tool) => tool.description },
  ];
  return (
    <SectionCard title="What this page offers" note="Decided by the catalog, not by this panel.">
      <Table
        columns={columns}
        rows={tools}
        rowKey={(tool) => tool.name}
        empty="This page has registered no tools."
      />
    </SectionCard>
  );
}
