"use client";

/**
 * THE HEADERS, IN SCREEN SPACE — the one idea that makes a matrix usable at three bands.
 *
 * A row header inside the world has to be either unreadably small at the far band or absurdly
 * large at the near one, and a counter-scaled label in a world-space gutter is the same problem
 * wearing a hat: the gutter itself still scales, so a name that fits at L2 overlaps its
 * neighbours at L0. So the headers are NOT in the world. They are two rails pinned to the top and
 * left edges of the frame, and every entry is positioned each frame by projecting its span
 * through the camera — `projectY` / `projectX` in `poses.ts`, which is the kit's own orthographic
 * line written out and pinned in the test.
 *
 * WHAT FOLLOWS FROM IT, and this is the round-5 finding worth carrying:
 *
 *   · every label is the same size in pixels at every band, with no `--cs` and no quantisation,
 *     because it was never scaled in the first place (rule 13, satisfied by relocation);
 *   · the rail can change GRAIN with the band — six layers, then nineteen systems, then sixty-
 *     eight components — so the header is itself a reading of the semantic zoom rather than a
 *     victim of it;
 *   · a label is drawn only where its span is tall enough to hold one, which is archify's
 *     shrink-to-fit-or-reject rule (study §1) turned into a per-frame test instead of a build
 *     step, because here the available height is the camera's business and changes continuously.
 *
 * ONE SPINE FOR THE KEYBOARD. The ROW rail is interactive: its layer brackets open a layer, its
 * entries open a component, and `useRoving` walks them with the arrows. The COLUMN rail is the
 * same list turned ninety degrees and is `aria-hidden` — a second copy of sixty-eight tab stops
 * would be a worse surface, not a more accessible one.
 *
 * POSITIONS ARE WRITTEN IMPERATIVELY, never through state: this runs on the camera's frame
 * callback. Entries outside the frame are culled to `visibility: hidden` and are not measured, so
 * the near band writes about a dozen transforms a frame and the far band about twenty-five.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRoving, type Focus } from "@athena/demo-kit/zoom";

import { componentById, systemById, type Component } from "@/data";

import {
  AXIS_IDS,
  FIELD,
  LAYER_SPANS,
  M,
  MAX_DEGREE,
  SYSTEM_SPANS,
  inDegree,
  indexOf,
  outDegree,
  type Span,
} from "./matrix";
import { projectX, projectY } from "./poses";
import type { Hover } from "./Field";
import type { MatrixCamera } from "./useMatrixCamera";

/** One thing a rail can head: a layer, a system, or a component. */
interface Entry {
  key: string;
  /** The component id, when this entry IS a component. Layers and systems have none. */
  component: string | null;
  /** The layer id, when this entry is a layer. */
  layer: string | null;
  label: string;
  part: string;
  start: number;
  count: number;
  /** The margin bar, 0..1 of the busiest row. */
  weight: number;
}

const spanEntry = (s: Span, axis: "row" | "col"): Entry => {
  let degree = 0;
  for (let i = s.start; i < s.start + s.count; i += 1) {
    degree += axis === "row" ? outDegree(i) : inDegree(i);
  }
  return {
    key: s.id,
    component: null,
    layer: null,
    label: s.name,
    part: s.part,
    start: s.start,
    count: s.count,
    weight: Math.min(1, degree / (MAX_DEGREE * Math.max(1, s.count))),
  };
};

const componentEntry = (c: Component, i: number, axis: "row" | "col"): Entry => ({
  key: c.id,
  component: c.id,
  layer: null,
  label: c.name,
  part: c.part,
  start: i,
  count: 1,
  weight: (axis === "row" ? outDegree(i) : inDegree(i)) / MAX_DEGREE,
});

/**
 * The minimum extent, in CSS pixels, a span needs before its name is drawn in it.
 *
 * Two numbers because the two tiers hold their names differently: a detail name runs ALONG the
 * rail and needs only its own line height, while a layer name is set across the span and needs
 * enough of the span to spell a word. Under the threshold the bracket stays and the name goes,
 * which is archify's shrink-then-reject (study §1) with the rejection drawn rather than thrown.
 */
const LEGIBLE = 13;
const LEGIBLE_GROUP = 48;

export interface RailProps {
  axis: "row" | "col";
  camera: MatrixCamera;
  band: 0 | 1 | 2;
  focus: Focus;
  lit: ReadonlySet<string>;
  hover: Hover;
  onHover: (hover: Hover) => void;
  onOpenLayer: (layer: string) => void;
  onOpenPart: (id: string) => void;
}

export function Rail({
  axis,
  camera,
  band,
  focus,
  lit,
  hover,
  onHover,
  onOpenLayer,
  onOpenPart,
}: RailProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const cells = useRef(new Map<string, HTMLElement>());
  const written = useRef(new Map<string, string>());

  /** Tier A is always the six layers. Tier B follows the band: systems, then components. */
  const layers = useMemo(() => LAYER_SPANS.map((s) => ({ ...spanEntry(s, axis), layer: s.id })), [axis]);
  const detail = useMemo<Entry[]>(() => {
    if (band < 2) return SYSTEM_SPANS.map((s) => spanEntry(s, axis));
    return AXIS_IDS.map((id, i) => {
      const c = componentById(id);
      return c ? componentEntry(c, i, axis) : null;
    }).filter((e): e is Entry => e !== null);
  }, [axis, band]);

  const register = useCallback((key: string) => {
    return (el: HTMLElement | null) => {
      if (el) cells.current.set(key, el);
      else cells.current.delete(key);
    };
  }, []);

  /* ------------------------------------ the projection ------------------------------------ */

  const entries = useMemo(() => [...layers, ...detail], [detail, layers]);
  const { rig, frame, frameTick } = camera;

  useEffect(() => {
    /* The cache below skips a write whose value has not changed; a new tier is a new set of
       elements with no styles at all, so the cache has to be forgotten with them. */
    written.current.clear();
    const place = (pose: { zoom: number; pan: { x: number; y: number } }) => {
      const box = frame.current;
      const extent = axis === "row" ? box.h : box.w;
      if (extent <= 0) return;
      const unit = M.cell * pose.zoom;
      for (const entry of entries) {
        const el = cells.current.get(entry.key);
        if (!el) continue;
        const world = (axis === "row" ? FIELD.y : FIELD.x) + entry.start * M.cell;
        const at =
          axis === "row"
            ? projectY(world, pose as never, box)
            : projectX(world, pose as never, box);
        const size = unit * entry.count;
        const gone = at + size < 0 || at > extent;
        const next = gone ? "gone" : `${Math.round(at * 10) / 10}|${Math.round(size * 10) / 10}`;
        if (written.current.get(entry.key) === next) continue;
        written.current.set(entry.key, next);
        if (gone) {
          el.style.visibility = "hidden";
          continue;
        }
        el.style.visibility = "";
        el.style.transform =
          axis === "row" ? `translateY(${at}px)` : `translateX(${at}px)`;
        el.style.setProperty("--wc-ext", `${size}px`);
        if (size < (entry.layer === null ? LEGIBLE : LEGIBLE_GROUP)) el.dataset.tight = "";
        else delete el.dataset.tight;
      }
    };
    /* `subscribe` calls back immediately with the pose the rig already has, which covers the
       mount; `frameTick` covers the resize, where nothing moved but the box. */
    place(rig.get());
    return rig.subscribe(place);
  }, [axis, entries, frame, frameTick, rig]);

  /* -------------------------------------- interaction -------------------------------------- */

  const roving = useRoving(railRef, { selector: "[data-rove]", columns: 1 });
  const interactive = axis === "row";

  const focusIndex = focus.level === 2 ? indexOf(focus.item) : -1;
  /** Exactly one tab stop in the detail tier; the arrows do the rest. */
  const stop = useMemo(() => {
    if (detail.length === 0) return null;
    if (band === 2 && focusIndex >= 0) return AXIS_IDS[focusIndex] ?? detail[0]?.key ?? null;
    return detail[0]?.key ?? null;
  }, [band, detail, focusIndex]);

  const open = useCallback(
    (entry: Entry) => {
      if (entry.component) {
        onOpenPart(entry.component);
        return;
      }
      if (entry.layer) {
        onOpenLayer(entry.layer);
        return;
      }
      const layer = systemById(entry.key)?.layer;
      if (layer) onOpenLayer(layer);
    },
    [onOpenLayer, onOpenPart],
  );

  const hotIndex = hover?.kind === "axis" ? hover.index : hover?.kind === "mark" ? (axis === "row" ? hover.row : hover.col) : -1;

  const body = (tier: "layer" | "detail", list: Entry[]) =>
    list.map((entry) => {
      const inside = hotIndex >= entry.start && hotIndex < entry.start + entry.count;
      const isFocus = focusIndex >= entry.start && focusIndex < entry.start + entry.count;
      const isOpen = entry.layer !== null && focus.level >= 1 && focus.group === entry.layer;
      const isLit = entry.component ? lit.has(entry.component) : false;
      const Tag = interactive ? "button" : "span";
      return (
        <Tag
          key={entry.key}
          ref={register(entry.key) as never}
          type={interactive ? "button" : undefined}
          className="wc-rail-cell"
          data-tier={tier}
          data-hot={inside ? "" : undefined}
          data-focus={isFocus ? "" : undefined}
          data-open={isOpen ? "" : undefined}
          data-lit={isLit ? "" : undefined}
          data-rove={interactive && tier === "detail" ? "" : undefined}
          tabIndex={interactive ? (tier === "layer" ? 0 : entry.key === stop ? 0 : -1) : undefined}
          onPointerEnter={interactive ? () => onHover({ kind: "axis", index: entry.start }) : undefined}
          onFocus={interactive ? () => onHover({ kind: "axis", index: entry.start }) : undefined}
          onClick={interactive ? () => open(entry) : undefined}
        >
          <span className="wc-rail-bar" style={{ "--wc-w": entry.weight } as never} aria-hidden />
          <span className="wc-rail-name">
            <span className="wc-rail-part">{entry.part}</span>
            {entry.label}
          </span>
        </Tag>
      );
    });

  return (
    <div
      className="wc-rail"
      data-axis={axis}
      data-band={band}
      ref={railRef}
      onKeyDown={interactive ? roving.onKeyDown : undefined}
      onPointerLeave={interactive ? () => onHover(null) : undefined}
      aria-hidden={interactive ? undefined : true}
      aria-label={interactive ? "The axis: every module, in stack order. Enter opens one." : undefined}
    >
      <div className="wc-rail-tier" data-tier="layer">
        {body("layer", layers)}
      </div>
      <div className="wc-rail-tier" data-tier="detail">
        {body("detail", detail)}
      </div>
    </div>
  );
}
