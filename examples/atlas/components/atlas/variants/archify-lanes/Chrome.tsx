"use client";

/**
 * THE SHEET AROUND THE CANVAS — a title band above, one to three cards below, one control strip.
 *
 * ARCHIFY'S ARTIFACT IS NOT A CANVAS, IT IS A PAGE: a 1.5 rem/700 headline with a .875 rem
 * subtitle, the SVG filling a reading column under it, and `cards` — one to three, two or three
 * bullets each — under that, which the study calls "the side-panel escape hatch for detail that
 * would otherwise become edges" and "the third grouping axis". Round 5 shipped neither, which is
 * two of the items study Part 2 §3 lists under "what reads cheaper in ours".
 *
 * THE CARDS ARE WHERE THE MERGES GO. Twelve nodes for nineteen systems is only honest if the
 * drawing says what it merged and why, and an edge cannot say it. So card one names the four
 * merges, card two states the finding the lane chrome exists to make, and card three is the
 * receipt: the counts a reader can check against the drawing in front of them.
 */
import { memo } from "react";

import type { Role } from "./workflow";
import type { BeatView, ChapterView } from "./story";

/* ------------------------------------------ the title ---------------------------------------- */

export const TITLE = "The turn, in lanes";
export const SUBTITLE =
  "Twelve stops of README §3.2 across four lanes, six columns and three phases. Position is the reading order; there is not one boundary frame.";

export const TitleBand = memo(function TitleBand({
  phase,
  level,
  zoom,
}: {
  phase: string | null;
  level: number;
  zoom: number;
}) {
  return (
    <header className="al-title">
      <div className="al-title-text">
        <h1>{TITLE}</h1>
        <p>{SUBTITLE}</p>
      </div>
      <dl className="al-title-read">
        <div>
          <dt>level</dt>
          <dd>{level}</dd>
        </div>
        <div>
          <dt>phase</dt>
          <dd>{phase ?? "—"}</dd>
        </div>
        <div>
          <dt>scale</dt>
          <dd>{`${Math.round(zoom * 100)}%`}</dd>
        </div>
      </dl>
    </header>
  );
});

/* ------------------------------------------- the cards --------------------------------------- */

export interface Card {
  dot: Role | "kind";
  title: string;
  items: readonly string[];
}

export const CARDS: readonly Card[] = [
  {
    dot: "main",
    title: "Nineteen systems, twelve nodes",
    items: [
      "Desktop surfaces merges the shell, the modules, the studio and the journey.",
      "Channels merges daemon, voice and the MCP channel README names and the tree lacks.",
      "The record merges approvals, the ledger and the brain whose index holds them.",
    ],
  },
  {
    dot: "error",
    title: "The gate is not a layer",
    items: [
      "The bridge (surfaces), the hooks (harness) and the catalog (core) are one rose lane.",
      "Its one exception branch is a decline, and it ends in the closed ERROR_REASONS set.",
    ],
  },
  {
    dot: "async",
    title: "What the drawing claims",
    items: [
      "The main path never climbs a column: the turn descends the stack left to right.",
      "Eight of the ten drawn story hops are authored edges; two are asserted by README alone.",
    ],
  },
];

export const Cards = memo(function Cards({ cards }: { cards: readonly Card[] }) {
  return (
    <section className="al-cards" aria-label="Notes on this drawing">
      {cards.map((c) => (
        <article key={c.title} className="al-card" data-dot={c.dot}>
          <h2>{c.title}</h2>
          <ul>
            {c.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
});

/* ----------------------------------------- the controls -------------------------------------- */

export interface ToolbarProps {
  theme: "dark" | "light";
  onTheme: () => void;
  story: boolean;
  onStory: () => void;
  zoom: number;
  onZoom: (by: number) => void;
  onHome: () => void;
  level: number;
}

export const Toolbar = memo(function Toolbar({
  theme,
  onTheme,
  story,
  onStory,
  zoom,
  onZoom,
  onHome,
  level,
}: ToolbarProps) {
  return (
    <div className="al-toolbar" role="toolbar" aria-label="The lane sheet's controls">
      <button type="button" className="al-tool" data-on={story ? "" : undefined} onClick={onStory}>
        TURN
      </button>
      <button type="button" className="al-tool" onClick={onTheme}>
        {theme === "dark" ? "Dark" : "Light"}
      </button>
      <span className="al-tool-sep" aria-hidden />
      <button type="button" className="al-tool" onClick={() => onZoom(-1)} aria-label="Zoom out">
        −
      </button>
      <button type="button" className="al-tool al-tool-home" onClick={onHome}>
        {`L${level} · ${Math.round(zoom * 100)}%`}
      </button>
      <button type="button" className="al-tool" onClick={() => onZoom(1)} aria-label="Zoom in">
        +
      </button>
    </div>
  );
});

/* ----------------------------------------- the story bar ------------------------------------- */

export interface StoryBarProps {
  stop: number;
  beat: BeatView;
  chapters: readonly ChapterView[];
  chapter: number;
  playing: boolean;
  reduced: boolean;
  counts: { hops: number; authored: number; derived: number; internal: number };
  onPlay: () => void;
  onStep: (to: number) => void;
  onChapter: (index: number) => void;
}

/**
 * The chapter strip and the beat. Under reduced motion `play` becomes `step`, because the static
 * frame has to carry the whole meaning (study §7.9) and a faster animation is the wrong branch.
 */
export const StoryBar = memo(function StoryBar({
  stop,
  beat,
  chapters,
  chapter,
  playing,
  reduced,
  counts,
  onPlay,
  onStep,
  onChapter,
}: StoryBarProps) {
  return (
    <div className="al-story" role="group" aria-label="The turn, as a guided story">
      <div className="al-story-chapters">
        {chapters.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className="al-story-chapter"
            data-on={i === chapter ? "" : undefined}
            onClick={() => onChapter(i)}
            title={c.note}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="al-story-beat">
        <span className="al-story-n">{`${String(stop + 1).padStart(2, "0")} / 12`}</span>
        <span className="al-story-where">{beat.nodeLabel}</span>
        <span className="al-story-what">{beat.label}</span>
        <span className="al-story-cite">{beat.cite}</span>
      </div>
      <div className="al-story-controls">
        <button type="button" className="al-tool" onClick={() => onStep(stop - 1)} aria-label="Previous stop">
          ←
        </button>
        <button type="button" className="al-tool" data-on={playing ? "" : undefined} onClick={onPlay}>
          {reduced ? "Step" : playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="al-tool" onClick={() => onStep(stop + 1)} aria-label="Next stop">
          →
        </button>
        <span className="al-story-receipt">
          {`${counts.authored} of ${counts.hops} hops authored · ${counts.derived} derived · ${counts.internal} inside a node`}
        </span>
      </div>
    </div>
  );
});
