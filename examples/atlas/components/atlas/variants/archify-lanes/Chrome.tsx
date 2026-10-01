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

import { COPY } from "./copy";
import { LANES, type Role } from "./workflow";
import { BEAT_VIEWS, type BeatView, type ChapterView } from "./story";

export type { LanesPreset } from "./copy";
export { COPY } from "./copy";

/* ------------------------------------------ the title ---------------------------------------- */

export const TITLE = COPY.classic.title;
export const SUBTITLE = COPY.classic.subtitle;

export const TitleBand = memo(function TitleBand({
  phase,
  level,
  zoom,
  title = TITLE,
  subtitle = SUBTITLE,
}: {
  phase: string | null;
  level: number;
  zoom: number;
  title?: string;
  subtitle?: string;
}) {
  return (
    <header className="al-title">
      <div className="al-title-text">
        <h1>{title}</h1>
        <p>{subtitle}</p>
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

/* -------------------------------- the editorial rails (round 7) ------------------------------- */

/**
 * FOUR LANE CAPTIONS PINNED OUTSIDE THE WORLD.
 *
 * Round 6 carried this: at L1 the camera frames three of four lanes and the in-world labels leave
 * the screen. The matrix already had the answer — headers that live in screen space, not in the
 * scaled sheet, are legible at every band by construction. Editorial is the drawing that spends
 * that finding: the four owners stay on the left of the board no matter where the camera looks.
 */
export const LaneRail = memo(function LaneRail() {
  return (
    <ol className="al-lane-rail" aria-label="Who owns each row">
      {LANES.map((l) => (
        <li key={l.id} className="al-lane-rail-item" data-variant={l.variant}>
          <span className="al-lane-rail-ord">{l.ord}</span>
          <span className="al-lane-rail-name">{l.label}</span>
          <span className="al-lane-rail-note">{l.note}</span>
        </li>
      ))}
    </ol>
  );
});

/**
 * THE TWELVE STOPS AS A READING COLUMN, always on the page.
 *
 * Classic and signal hide the turn behind a TURN toggle and a story bar. Editorial's thesis is
 * the opposite: the solution is an argument you read, and the diagram illustrates it. Clicking a
 * stop lights that beat on the sheet — the same `set_turn` path the story bar uses — so the two
 * surfaces cannot disagree.
 */
export const ScriptRail = memo(function ScriptRail({
  stop,
  story,
  onStop,
}: {
  stop: number;
  story: boolean;
  onStop: (index: number) => void;
}) {
  return (
    <ol className="al-script" aria-label="How a turn runs, in twelve stops">
      {BEAT_VIEWS.map((b, i) => {
        const on = story && stop === i;
        return (
          <li key={b.index}>
            <button
              type="button"
              className="al-script-stop"
              data-on={on ? "" : undefined}
              data-kind={b.kind}
              aria-current={on ? "step" : undefined}
              onClick={() => onStop(i)}
            >
              <span className="al-script-n">{String(i + 1).padStart(2, "0")}</span>
              <span className="al-script-body">
                <span className="al-script-label">{b.label}</span>
                <span className="al-script-meta">
                  <span className="al-script-where">{b.nodeLabel}</span>
                  <span className="al-script-cite">{b.cite}</span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
});
