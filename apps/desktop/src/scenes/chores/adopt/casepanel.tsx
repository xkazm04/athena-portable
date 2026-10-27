/**
 * "Your case", the Adopt studio's right column — ADR 0097, README section 3.5.
 *
 * What is known about the person's case, drawn before it is said: a meter of every slot (filled
 * when confirmed, hatched when guessed, an outline while open) over the slots grouped by kind, each
 * with its value, its status and where it came from. Once she has drafted the brief the slots fold
 * to a line a kind and the brief comes up under them, with Approve; under it all the research
 * lanes with their own status and findings and the harvest in a line.
 */
import { useState, type ReactNode } from "react";

import Button from "@/components/Button";
import StatusDot, { type Tone } from "@/components/StatusDot";
import type {
  Lane,
  LaneKind,
  LaneStatus,
  Slot,
  SlotSource,
  SlotStatus,
} from "@/lib/adopt";

import Rich from "../rich";
import { harvestLine, slotGroups, tally, type BriefEvent } from "./state";

const STATUS_WORD: Record<SlotStatus, string> = {
  open: "open",
  guessed: "my guess",
  confirmed: "confirmed",
};
const SOURCE_WORD: Record<SlotSource, string> = {
  user: "you",
  research: "research",
  memory: "memory",
  document: "document",
  account: "account",
  default: "the playbook",
};
const LANE_TONE: Record<LaneStatus, Tone> = {
  queued: "neutral",
  running: "pending",
  done: "success",
  failed: "error",
  skipped: "neutral",
};

/**
 * The slots. `compact` (once the brief is drafted) folds each group into one line of its values, so
 * the brief comes up beside the conversation; "Show every slot" opens them again.
 */
export function SlotsBoard({
  slots,
  compact = false,
}: {
  slots: readonly Slot[];
  compact?: boolean;
}) {
  const t = tally(slots);
  const groups = slotGroups(slots);
  const [all, setAll] = useState(false);
  const folded = compact && !all;
  return (
    <section className="ad-panel ad-slots" aria-labelledby="ad-slots-h">
      <div className="ad-panel__head">
        <h2 id="ad-slots-h" className="ad-h2">
          Your case
        </h2>
        {slots.length ? (
          <p className="ad-count">
            <span className="ad-count__n">{t.confirmed + t.guessed}</span>
            <span className="ad-count__of">{` of ${slots.length} known`}</span>
          </p>
        ) : null}
      </div>
      {slots.length === 0 ? (
        <p className="ad-note">
          She is reading the playbook for what she needs to know.
        </p>
      ) : (
        <>
          <div
            className="ad-meter"
            role="img"
            aria-label={`${t.confirmed} confirmed, ${t.guessed} guessed, ${t.open} open`}
          >
            {slots.map((s) => (
              <i
                key={s.id}
                className="ad-meter__seg"
                data-status={s.status}
                title={`${s.label}: ${STATUS_WORD[s.status]}`}
              />
            ))}
          </div>
          <p className="ad-legend" aria-hidden="true">
            <span>
              <i className="ad-meter__seg" data-status="confirmed" /> confirmed
            </span>
            <span>
              <i className="ad-meter__seg" data-status="guessed" /> my guess
            </span>
            <span>
              <i className="ad-meter__seg" data-status="open" /> open
            </span>
          </p>
          {folded ? (
            <ul className="ad-folded">
              {groups.map((g) => (
                <li key={g.kind} className="ad-folded__row" data-kind={g.kind}>
                  <span className="ad-group__h">
                    <KindGlyph kind={g.kind} />
                    {g.label}
                  </span>
                  <span className="ad-folded__values">
                    {g.slots.map((x) => (
                      <span
                        key={x.id}
                        className="ad-folded__v"
                        data-status={x.status}
                        title={`${x.label}: ${STATUS_WORD[x.status]}`}
                      >
                        {x.value || x.label}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            groups.map((g) => (
              <div key={g.kind} className="ad-group" data-kind={g.kind}>
                <h3 className="ad-group__h">
                  <KindGlyph kind={g.kind} />
                  {g.label}
                </h3>
                <ul className="ad-tiles">
                  {g.slots.map((x) => (
                    <li key={x.id} className="ad-tile" data-status={x.status}>
                      <span className="ad-tile__top">
                        <span className="ad-tile__label">{x.label}</span>
                        <span className="ad-pill" data-status={x.status}>
                          {STATUS_WORD[x.status]}
                        </span>
                      </span>
                      {x.value ? (
                        <span className="ad-tile__value">{x.value}</span>
                      ) : null}
                      {x.status !== "open" ? (
                        <span className="ad-src">{`from ${SOURCE_WORD[x.source]}`}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          {compact ? (
            <button
              type="button"
              className="ad-link focus-ring ad-slots__more"
              aria-expanded={all}
              onClick={() => setAll((v) => !v)}
            >
              {all ? "Fold the slots" : `Show every slot (${slots.length})`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

export function ResearchTray({ lanes }: { lanes: readonly Lane[] }) {
  if (lanes.length === 0) return null;
  return (
    <section className="ad-panel ad-research" aria-labelledby="ad-research-h">
      <div className="ad-panel__head">
        <h2 id="ad-research-h" className="ad-h2">
          Looking it up
        </h2>
        <p className="ad-note ad-harvest">{harvestLine(lanes)}</p>
      </div>
      <ul className="ad-lanes">
        {lanes.map((l) => (
          <li key={l.id} className="ad-lane" data-status={l.status}>
            <span className="ad-lane__icon" aria-hidden="true">
              <LaneGlyph kind={l.kind} />
            </span>
            <div className="ad-lane__body">
              <p className="ad-lane__title">
                {l.title}
                <span className="ad-lane__status">
                  <StatusDot tone={LANE_TONE[l.status]} />
                  {l.status}
                </span>
              </p>
              {l.status === "running" ? (
                <span className="ad-lane__bar" aria-hidden="true" />
              ) : null}
              {l.summary ? (
                <p className="ad-lane__summary">{l.summary}</p>
              ) : null}
              {l.findings.length ? (
                <ul className="ad-findings">
                  {l.findings.map((f, i) => (
                    <li key={i}>
                      {f.text}
                      {f.source_url ? (
                        <>
                          {" "}
                          <a
                            className="ad-link"
                            href={f.source_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {hostOf(f.source_url)} ↗
                          </a>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || "source";
  } catch {
    return "source";
  }
}

export function BriefCard({
  brief,
  slots,
  can,
  why,
  approved,
  onApprove,
  children,
}: {
  brief: BriefEvent;
  slots: readonly Slot[];
  can: boolean;
  why: string;
  approved: boolean;
  onApprove: () => void;
  children?: ReactNode;
}) {
  const guessed = brief.open_slot_ids
    .map((id) => slots.find((s) => s.id === id)?.label ?? "")
    .filter(Boolean);
  return (
    <section
      className="ad-panel ad-brief"
      data-approved={approved ? "" : undefined}
      aria-labelledby="ad-brief-h"
    >
      <div className="ad-panel__head">
        <h2 id="ad-brief-h" className="ad-h2">
          The brief
        </h2>
        <span className="ad-rev">
          {approved ? `draft ${brief.rev} · approved` : `draft ${brief.rev}`}
        </span>
      </div>
      <Rich md={brief.md} className="ad-brief__md" />
      {guessed.length ? (
        <p className="ad-note">{`Still her guess: ${guessed.join(", ")}.`}</p>
      ) : null}
      {approved ? (
        <p className="ad-note">
          Approved. The run plays in the conversation; nothing is sent.
        </p>
      ) : (
        <div className="ad-brief__go">
          <Button
            variant="primary"
            onClick={onApprove}
            disabledReason={can ? undefined : why}
          >
            Approve
          </Button>
          <p className="ad-note">
            Approving rehearses it on a world shaped like yours; nothing is
            sent.
          </p>
        </div>
      )}
      {children}
    </section>
  );
}

function KindGlyph({ kind }: { kind: string }) {
  const path: Record<string, string> = {
    portal: "M2 4h12v9H2zM2 7h12",
    gate: "M8 2l6 6-6 6-6-6z",
    fact: "M3 3h10v10H3zM5.5 6.5h5M5.5 9.5h3",
    trap: "M8 2l6.5 11.5h-13zM8 6.5v3.5M8 12v.5",
  };
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="ad-glyph"
    >
      <path
        d={path[kind] ?? path.fact}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LaneGlyph({ kind }: { kind: LaneKind }) {
  const path: Record<LaneKind, string> = {
    rules:
      "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM1.5 8h13M8 1.5c2 2 2.5 4 2.5 6.5S10 12.5 8 14.5M8 1.5C6 3.5 5.5 5.5 5.5 8S6 12.5 8 14.5",
    accounts: "M2 4h12v8H2zM2 4l6 5 6-5",
    memory:
      "M8 2.5a4 4 0 0 0-4 4c0 1.5.8 2.5 1.5 3.2V12h5V9.7c.7-.7 1.5-1.7 1.5-3.2a4 4 0 0 0-4-4zM6 14h4",
    document: "M4 1.5h5.5L12 4v10.5H4zM9.5 1.5V4H12M6 8h4M6 10.5h4",
  };
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={path[kind]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
