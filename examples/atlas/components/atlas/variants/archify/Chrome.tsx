"use client";

/**
 * THE STAGE'S OWN CHROME: PATH / MAP / LENS, the counted legend, the minimap, the route receipt and
 * the story bar. Archify study §4.
 *
 * IT IS IN THE STAGE, NOT IN THE MAST, and that is a contract decision rather than a placement one.
 * The mast belongs to the shell and is the same for all three variants; a control that changes what
 * THIS drawing means — its preset, its theme, its view, its probe — belongs to the drawing, so a
 * reader switching variants sees the controls change with the thing they control. Archify puts the
 * same cluster in the bottom-right corner of the canvas and it is the right corner: it is the one a
 * drawing is least likely to need.
 *
 * ONE DETAILS DESTINATION (study §7.13). Nothing here opens a panel. The legend filters, the
 * minimap moves the camera, PATH prints a receipt of four lines, and everything a reader might want
 * to READ about a part is in the shell's L2 pane, which is the only place prose lives.
 */
import { memo, useMemo } from "react";

import { KINDS, KIND_LABEL, KIND_RULE, type Kind } from "./kinds";
import type { Rect } from "./layout";
import type { Probe } from "./path";
import { receiptOf } from "./path";
import { CHAPTERS, TRAIL_COUNTS, deltaOf, type Beat } from "./story";

/* ------------------------------------------- the legend -------------------------------------- */

export interface LegendProps {
  /** Only kinds present, with counts — archify's `auto` legend (study §2). */
  counts: readonly { kind: Kind; n: number }[];
  picked: readonly Kind[];
  capped: boolean;
  onPick: (kind: Kind) => void;
  active: boolean;
  /**
   * The SHELL's lens — a chosen claim — named here when there is one.
   *
   * Two lenses would be two things called the same word, so the legend says which is which: the
   * chips filter by KIND (this variant's own), and the line above names the CLAIM the shell is
   * holding (every variant's, through `VariantProps.lens`). A reader can have both at once and
   * always knows which mark means which.
   */
  claim: string | null;
}

/**
 * THE LEGEND IS THE FILTER. Archify bridges its static legend to the lens rather than drawing two
 * of them, which removes the commonest architecture-diagram lie: a legend that lists a colour the
 * drawing does not use, or omits one it does.
 *
 * One kind reveals its relationships; two kinds compare the relationships that cross BETWEEN them;
 * a third replaces the older of the two. The cap is 24 runs — past that a "comparison" is a picture
 * of the whole graph again — and when it bites the legend says so rather than quietly truncating.
 */
export const Legend = memo(function Legend({
  counts,
  picked,
  capped,
  onPick,
  active,
  claim,
}: LegendProps) {
  return (
    <div className="ar-legend" data-active={active ? "" : undefined}>
      <p className="ar-legend-head">
        {active ? (picked.length === 2 ? "Cross-kind" : "Relationships") : "Legend"}
        {capped ? <em> · capped at 24</em> : null}
        {claim ? <em> · claim {claim}</em> : null}
      </p>
      <ul>
        {counts.map(({ kind, n }) => (
          <li key={kind}>
            <button
              type="button"
              className="ar-chip"
              data-node-kind={kind}
              data-picked={picked.includes(kind) ? "" : undefined}
              aria-pressed={picked.includes(kind)}
              title={KIND_RULE[kind]}
              onClick={() => onPick(kind)}
            >
              <span className="ar-swatch" aria-hidden />
              {KIND_LABEL[kind]}
              <b>{n}</b>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});

/* ------------------------------------------- the minimap ------------------------------------- */

export interface MinimapProps {
  bounds: Rect;
  nodes: readonly (Rect & { id: string; kind: Kind })[];
  /** The world rectangle the reader can currently see. */
  viewport: Rect | null;
  onGo: (x: number, y: number) => void;
}

/**
 * MAP. Built at runtime from the same boxes the sheet draws (study §4: "built at runtime so the
 * canonical SVG stays single") — there is no second model of the drawing, and a node added to the
 * model appears in the minimap without anybody remembering to add it.
 */
export const Minimap = memo(function Minimap({ bounds, nodes, viewport, onGo }: MinimapProps) {
  return (
    <div className="ar-minimap">
      <svg
        viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Minimap of the whole sheet. Click to move the camera."
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const scale = Math.min(box.width / bounds.w, box.height / bounds.h);
          const x = bounds.x + bounds.w / 2 + (e.clientX - (box.left + box.width / 2)) / scale;
          const y = bounds.y + bounds.h / 2 + (e.clientY - (box.top + box.height / 2)) / scale;
          onGo(x, y);
        }}
      >
        {nodes.map((n) => (
          <rect key={n.id} data-node-kind={n.kind} x={n.x} y={n.y} width={n.w} height={n.h} />
        ))}
        {viewport ? (
          <rect
            className="ar-minimap-view"
            x={viewport.x}
            y={viewport.y}
            width={viewport.w}
            height={viewport.h}
          />
        ) : null}
      </svg>
    </div>
  );
});

/* ------------------------------------------ PATH's receipt ----------------------------------- */

export interface ProbeReceiptProps {
  probe: Probe | null;
  picking: string | null;
  names: (id: string) => string;
  onClear: () => void;
}

export const ProbeReceipt = memo(function ProbeReceipt({
  probe,
  picking,
  names,
  onClear,
}: ProbeReceiptProps) {
  if (!probe && !picking) return null;
  return (
    <div className="ar-receipt" role="status">
      <p className="ar-receipt-head">Route probe</p>
      {probe ? (
        <>
          <p className="ar-receipt-title">
            {names(probe.from)} to {names(probe.to)}
          </p>
          <ol className="ar-receipt-hops">
            {probe.nodes.map((id) => (
              <li key={id}>{names(id)}</li>
            ))}
          </ol>
          <p className="ar-cite">{receiptOf(probe)}</p>
        </>
      ) : (
        <p className="ar-receipt-title">
          {names(picking!)} → pick the node it should reach
        </p>
      )}
      <button type="button" className="ar-button" onClick={onClear}>
        Clear
      </button>
    </div>
  );
});

/* ------------------------------------------- the story bar ----------------------------------- */

export interface StoryBarProps {
  stop: number;
  chapter: number;
  playing: boolean;
  beat: Beat;
  reduced: boolean;
  onPlay: () => void;
  onStep: (to: number) => void;
  onChapter: (index: number) => void;
}

/**
 * GUIDED VIEWS, archify's own bar: the chapter strip with a delta preview (`≡ + −`), the current
 * beat in words, and the transport. Four chapters, not five, and the note on each is under the 140
 * characters archify's schema allows — a chapter that needs a paragraph is two chapters.
 *
 * THE DELTA PREVIEW IS THE POINT of the strip: before a reader presses play on chapter 3 they can
 * see that it brings four systems in and lets none go, which is a fact about the architecture and
 * not about the animation.
 */
export const StoryBar = memo(function StoryBar({
  stop,
  chapter,
  playing,
  beat,
  reduced,
  onPlay,
  onStep,
  onChapter,
}: StoryBarProps) {
  const deltas = useMemo(() => CHAPTERS.map((_, i) => deltaOf(i)), []);
  return (
    <div className="ar-story">
      <div className="ar-story-now">
        <p className="ar-label">
          Guided views {chapter + 1} / {CHAPTERS.length}
          <em>
            {" "}
            · {TRAIL_COUNTS.authored} of {TRAIL_COUNTS.hops} hops authored
          </em>
        </p>
        <p className="ar-story-beat">
          <b>
            {String(beat.index + 1).padStart(2, "0")} / {12}
          </b>
          {beat.label}
        </p>
        <p className="ar-cite">{beat.cite}</p>
      </div>

      <div className="ar-story-transport">
        <button type="button" className="ar-button" onClick={() => onStep(stop - 1)} aria-label="Previous stop">
          ←
        </button>
        <button type="button" className="ar-button" data-primary="" onClick={onPlay}>
          {playing ? "Pause" : reduced ? "Step" : "Play story"}
        </button>
        <button type="button" className="ar-button" onClick={() => onStep(stop + 1)} aria-label="Next stop">
          →
        </button>
      </div>

      <ul className="ar-story-chapters">
        {CHAPTERS.map((c, i) => (
          <li key={c.id}>
            <button
              type="button"
              className="ar-chapter"
              data-current={i === chapter ? "" : undefined}
              aria-pressed={i === chapter}
              onClick={() => onChapter(i)}
            >
              <span className="ar-chapter-n">{String(i + 1).padStart(2, "0")}</span>
              <span className="ar-chapter-label">{c.label}</span>
              <span className="ar-chapter-delta" aria-label="stays, enters, leaves">
                ≡{deltas[i]!.stay} +{deltas[i]!.enter} −{deltas[i]!.leave}
              </span>
              <span className="ar-chapter-note" data-detail="context">
                {c.note}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});

/* ------------------------------------------- the toolbar ------------------------------------- */

export type Mode = "none" | "path" | "map" | "lens";

export interface ToolbarProps {
  mode: Mode;
  onMode: (mode: Mode) => void;
  preset: string;
  theme: "dark" | "light";
  presets: readonly string[];
  onPreset: (p: string) => void;
  onTheme: () => void;
  zoom: number;
  onZoom: (by: number) => void;
  onHome: () => void;
  story: boolean;
  onStory: () => void;
}

/**
 * PATH / MAP / LENS, plus the preset and the theme — in the stage's own bar, bottom right, exactly
 * where archify puts it. The zoom percentage is a READOUT of the camera rather than a second
 * control surface for it: the wheel is the control, and the number tells a reader which band they
 * are in without naming bands.
 */
export const Toolbar = memo(function Toolbar({
  mode,
  onMode,
  preset,
  theme,
  presets,
  onPreset,
  onTheme,
  zoom,
  onZoom,
  onHome,
  story,
  onStory,
}: ToolbarProps) {
  const toggle = (m: Mode) => onMode(mode === m ? "none" : m);
  return (
    <div className="ar-toolbar" role="toolbar" aria-label="Sheet controls">
      {(["path", "map", "lens"] as const).map((m) => (
        <button
          key={m}
          type="button"
          className="ar-tool"
          data-on={mode === m ? "" : undefined}
          aria-pressed={mode === m}
          onClick={() => toggle(m)}
        >
          {m.toUpperCase()}
        </button>
      ))}
      <span className="ar-tool-rule" aria-hidden />
      <button type="button" className="ar-tool" data-on={story ? "" : undefined} aria-pressed={story} onClick={onStory}>
        STORY
      </button>
      <span className="ar-tool-rule" aria-hidden />
      <label className="ar-select">
        <span className="ar-sr">Preset</span>
        <select value={preset} onChange={(e) => onPreset(e.target.value)}>
          {presets.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="ar-tool" onClick={onTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"}`}>
        {theme === "dark" ? "☾ Dark" : "☀ Light"}
      </button>
      <span className="ar-tool-rule" aria-hidden />
      <button type="button" className="ar-tool" onClick={() => onZoom(-1)} aria-label="Zoom out">
        −
      </button>
      <button type="button" className="ar-tool" onClick={onHome} aria-label="Fit the sheet">
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" className="ar-tool" onClick={() => onZoom(1)} aria-label="Zoom in">
        +
      </button>
    </div>
  );
});

export const ALL_KINDS = KINDS;
