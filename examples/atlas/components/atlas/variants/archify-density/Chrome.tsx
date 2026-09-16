"use client";

/**
 * EVERYTHING AROUND THE DRAWING: the title band, the legend inside the canvas footprint, the
 * camera's controls, and the three cards.
 *
 * Study part 2 §3 lists what round 5's frame was missing and this file is that list: an `h1` at
 * 1.5 rem/700 with a .875 rem subtitle above the canvas, a counted legend INSIDE the canvas rather
 * than floating over the drawing, and `auto-fit minmax(17.5rem, 1fr)` cards below it — archify's 280-unit card floor. Present mode
 * hides the title's subtitle and the cards so the canvas is the slide.
 *
 * THE LEGEND IS A FILTER (study §4: "the static legend is bridged to it so the legend is a
 * filter"). Picking a kind reveals its nodes and dims the rest as spatial reference; picking
 * nothing is the counted legend it also has to be.
 */
import { memo } from "react";

import { KIND_LABEL, KIND_RULE, type Kind } from "./kinds";
import type { Card } from "./sheet";

/* ------------------------------------------- the title ---------------------------------------- */

export const Title = memo(function Title({
  subtitle,
  theme,
  present,
  onTheme,
  onPresent,
}: {
  subtitle: string;
  theme: "dark" | "light";
  present: boolean;
  onTheme: () => void;
  onPresent: () => void;
}) {
  return (
    <div className="ad-title-row">
      <div className="ad-title">
        <h1>Athena, at twelve boxes</h1>
        <p>{subtitle}</p>
      </div>
      {/* Archify puts the preset and the theme at the top right of the reading column, beside the
          title, and the camera's own row at the bottom of the canvas. Both, and in both places. */}
      <div className="ad-controls">
        <button type="button" className="ad-btn" onClick={onTheme}>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
        <button
          type="button"
          className="ad-btn"
          data-on={present ? "" : undefined}
          aria-pressed={present}
          onClick={onPresent}
        >
          Present
        </button>
      </div>
    </div>
  );
});

/* ------------------------------------------ the legend ---------------------------------------- */

export const Legend = memo(function Legend({
  counts,
  picked,
  omitted,
  derived,
  onPick,
}: {
  counts: readonly { kind: Kind; n: number }[];
  picked: readonly Kind[];
  omitted: number;
  derived: number;
  onPick: (kind: Kind) => void;
}) {
  return (
    <p className="ad-legend">
      <span className="ad-legend-title">Legend</span>
      {counts.map(({ kind, n }) => (
        <button
          key={kind}
          type="button"
          className="ad-chip"
          data-node-kind={kind}
          data-on={picked.includes(kind) ? "" : undefined}
          aria-pressed={picked.includes(kind)}
          title={KIND_RULE[kind]}
          onClick={() => onPick(kind)}
        >
          {KIND_LABEL[kind]} <span className="ad-chip-n">{n}</span>
        </button>
      ))}
      <span className="ad-omitted">
        {omitted} authored edges in the passport · {derived} hop README asserts and no edge carries
      </span>
    </p>
  );
});

/* ---------------------------------------- the camera's row ------------------------------------ */

export const Controls = memo(function Controls({
  zoom,
  home,
  onZoom,
  onHome,
}: {
  zoom: number;
  home: number;
  onZoom: (by: number) => void;
  onHome: () => void;
}) {
  return (
    <div className="ad-controls">
      <button type="button" className="ad-btn" onClick={onHome} disabled={zoom <= home + 0.01}>
        Fit
      </button>
      {/* Archify's camera steps in ±0.25 from 1 to 3, and never out below 1. */}
      <button type="button" className="ad-btn" onClick={() => onZoom(-1)} aria-label="Zoom out">
        &minus;
      </button>
      <span className="ad-zoom">{Math.round(zoom * 100)}%</span>
      <button type="button" className="ad-btn" onClick={() => onZoom(1)} aria-label="Zoom in">
        +
      </button>
    </div>
  );
});

/* ------------------------------------------- the cards ---------------------------------------- */

export const Cards = memo(function Cards({
  cards,
  open,
}: {
  cards: readonly Card[];
  /** The node whose layer band the reader is inside — its card is the one that lights. */
  open: string | null;
}) {
  return (
    <div className="ad-cards">
      {cards.map((card) => (
        <section
          key={card.id}
          className="ad-card"
          data-node-kind={card.kind}
          data-open={open === card.node ? "" : undefined}
        >
          <h2>{card.label}</h2>
          <ul>
            {card.bullets.map((b) => (
              <li key={b.text}>{b.text}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
});
