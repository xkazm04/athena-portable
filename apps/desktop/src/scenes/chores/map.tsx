/**
 * The edge map — README section 3.5, ADR 0040, 0089 and 0096.
 *
 * The ledger's second view: the playbooks the rail and the job chips leave, each where it sits
 * between how hard it is for anyone else and how much it is worth to the person, the corner the
 * cycles push into marked "only Athena". It was the field's hero; the ledger made it a view of the
 * same rows, so a mark and a row are one playbook and one pick. A click or Space on a mark picks it
 * (the preview follows), Enter opens the chore, as it always did. Marks are real buttons and the
 * plot is HTML, so its type never shrinks with the frame. Nothing here holds state.
 */
import type { KeyboardEvent } from "react";

import StatusDot from "@/components/StatusDot";
import type { PlaybookView } from "@/modules/playbooks/model";

import { EDGE_FROM, NUMBERED_MARKS, markLabel, markPoints, markSize, pct } from "./model";

const TICKS = [1, 2, 3, 4, 5];

export default function EdgeMap({
  items,
  selectedId,
  onSelect,
  onOpen,
}: {
  /** The ledger's rows, in its order: a mark's number is its row's. */
  items: readonly PlaybookView[];
  selectedId: string | null;
  onSelect: (view: PlaybookView) => void;
  onOpen: (view: PlaybookView) => void;
}) {
  const many = items.length > NUMBERED_MARKS;
  const points = markPoints(items);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, view: PlaybookView) => {
    // Enter on a native button would click it, which picks; on a mark it opens, as it always has.
    if (e.key !== "Enter") return;
    e.preventDefault();
    onOpen(view);
  };

  return (
    <figure className="ch-map" data-many={many ? "" : undefined}>
      <div className="ch-map__frame" role="group" aria-label="Playbooks by difficulty for others and usefulness">
        <svg className="ch-map__ground" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <rect
            className="ch-map__edge"
            x={pct(EDGE_FROM)}
            y="0"
            width={100 - pct(EDGE_FROM)}
            height={100 - pct(EDGE_FROM)}
            rx="1.5"
          />
          {TICKS.map((t) => (
            <g key={t}>
              <line x1={pct(t)} x2={pct(t)} y1="0" y2="100" className="ch-map__grid" />
              <line x1="0" x2="100" y1={100 - pct(t)} y2={100 - pct(t)} className="ch-map__grid" />
            </g>
          ))}
        </svg>
        <span className="ch-map__zone">Only Athena</span>
        {TICKS.map((t) => (
          <span key={t}>
            <span className="ch-map__tick ch-map__tick--x" style={{ left: `${pct(t)}%` }} aria-hidden="true">
              {t}
            </span>
            <span className="ch-map__tick ch-map__tick--y" style={{ bottom: `${pct(t)}%` }} aria-hidden="true">
              {t}
            </span>
          </span>
        ))}
        <span className="ch-map__axis ch-map__axis--x">Difficulty for anyone else →</span>
        <span className="ch-map__axis ch-map__axis--y">Usefulness to you →</span>
        {items.map((v, i) => (
          <button
            key={v.id}
            type="button"
            className="ch-mark focus-ring"
            data-verdict={v.verdict.word}
            aria-pressed={v.id === selectedId}
            style={{
              left: `${pct(points[i]!.x)}%`,
              bottom: `${pct(points[i]!.y)}%`,
              ["--size" as string]: `${markSize(v.point.weight, many)}px`,
            }}
            aria-label={markLabel(v)}
            onClick={() => onSelect(v)}
            onKeyDown={(e) => onKeyDown(e, v)}
          >
            {many ? null : <span aria-hidden="true">{i + 1}</span>}
          </button>
        ))}
      </div>
      <figcaption className="ch-legend">
        <span>
          <span className="ch-swatch" aria-hidden="true" /> only Athena: hard for anyone else, worth real money
        </span>
        <span>
          <StatusDot tone="success" /> exceeds the bar
        </span>
        <span>
          <StatusDot tone="info" /> meets it
        </span>
        <span>
          <StatusDot tone="warning" /> falls short
        </span>
        <span>
          <StatusDot tone="neutral" /> not benched
        </span>
        <span>size: value a year · Enter opens one</span>
      </figcaption>
    </figure>
  );
}
