"use client";

/**
 * BLUEPRINT — round 4's sheet, evolved by what the archify study taught, in the same grammar.
 *
 * This repository's architecture as a 2D drawing you pan, zoom and re-arrange: nineteen system
 * blocks with ports, orthogonal runs, a ruled sheet, four arrangements of the same blocks, three
 * bands of detail, and one component's pane at the end of it. Round 4 established the grammar and
 * the owner's verdict on round 3 is still the premise — no 3D, no building, a drawing.
 *
 * WHAT ROUND 5 CHANGED, and each of the five is a thing a reader can see:
 *
 * 1. THE NEAR BAND FRAMES THE WHOLE LAYER. Round 4 stood at a fixed 1.3 whatever it opened, which
 *    on a six-system stratum showed about half of it. Regions now balance their rows
 *    (`balancedCols`, three or four across instead of five and one) and the L1 pose FITS the
 *    layer's frame, clamped into the band's interior so rule 14's inverse still holds exactly.
 *    L0 legibility did not pay for it: the sheet got narrower and taller in the same breath, so the
 *    whole-sheet zoom barely moved and a block is still ~145 px wide at L0.
 *
 * 2. RUNS ROUTE AROUND WORDS. `route.ts` replaced round 4's formula with a search: nine candidate
 *    families, a hard feasibility filter, and a lexicographic cost vector with a stable tiebreak
 *    (study §3). No run crosses a region's heading or a block's title bar in any of the four views,
 *    and `test/route.test.ts` fails the build if one ever does. Every run label sits on an opaque
 *    mask and becomes an obstacle for the runs routed after it.
 *
 * 3. THE LEGEND COUNTS AND FILTERS, AND THE TURN IS A STORY. The legend shows only the kinds
 *    present, with counts, and pressing one dims the rest to spatial reference. The turn's twelve
 *    stops carry `past`/`active`/`next` beat states, the Story Trail is drawn as an OVERLAY over
 *    the authored runs — which are never restyled — and the play is finite: one pass, no loop, and
 *    the final beat at frame zero under reduced motion.
 *
 * 4. DETAIL IS A TIER AND INTENT OVERRIDES THE BAND. `data-detail="context|fine"` on every piece of
 *    type, and `data-reveal` from a hover, a focus, the lens or the story re-reveals it at any
 *    zoom. A reader gets detail by travelling OR by pointing, and the two mean the same thing.
 *
 * 5. ONE DETAILS DESTINATION. Hover is a one-hop preview and nothing else: it lights the block and
 *    what it touches, writes one line in the readout, and opens no panel. It is pointer-fine only
 *    and it is suppressed while the filter or the story is doing something stronger. The L2 pane —
 *    the shell's, shared by all three variants — remains the only panel in the app.
 *
 * WHERE THE SIXTEEN RULES ARE. 1/10 inverted (one continuous space, no echo); 2 and 11 by having no
 * `layoutId` at all and measuring the pane out of the part; 3 in the pane's box-then-ink; 4 in
 * `motion.ts`; 5 in the pane's own Escape; 6 in `rig.flyTo`; 7 in `presenceStyle`; 8 in the token
 * file; 9 in the camera's loop stopping when the pose settles; 12 in `poses.ts` having no snap list;
 * 13 in `--at-cs`; 14 and 16 in `poseFor`/`resolve*` being exact inverses, asserted per layer, per
 * component and per view; 15 in `homeZoom`'s clamp and now in `layerZoom`'s fit.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  EDGES,
  NO_LENS,
  SYSTEM_EDGES,
  componentById,
  layerById,
  systemById,
  type Lens,
} from "@/data";

import type { VariantMeta, VariantProps } from "../contract";
import { usePublishViews, type ViewDescriptor } from "../viewBus";

import { Canvas } from "./Canvas";
import { Legend, sameFilter, type Filter } from "./Legend";
import { TurnBar } from "./TurnBar";
import { BlueprintTools } from "./Tools";
import { VIEWS, VIEW_META, planOf, type ViewId } from "./plan";
import { STORY_BLOCKS, blockBeat, useStory } from "./story";
import { TURN, stopAt } from "./turn";
import { useCanvasCamera } from "./useCanvasCamera";
import { useView } from "./useView";

/** What the shell's `set_view` and the mast's switcher are told about this variant. */
export const meta: VariantMeta = { slug: "blueprint", views: VIEWS };

const DESCRIPTORS: readonly ViewDescriptor[] = VIEWS.map((id) => ({
  id,
  label: VIEW_META[id].label,
  note: VIEW_META[id].note,
  runs: VIEW_META[id].runs,
}));

const EMPTY: ReadonlySet<string> = new Set<string>();

export default function Blueprint({
  nav,
  flight,
  focus,
  lens: chosen,
  reduced,
  pane,
  reportOrigin,
}: VariantProps) {
  const lens: Lens = chosen ?? NO_LENS;

  const [view, chooseView] = useView();
  const [hover, setHover] = useState<string | null>(null);
  const [stop, setStopAt] = useState(0);
  const [runsHidden, setRunsHidden] = useState(true);
  const [filter, setFilter] = useState<Filter | null>(null);

  const setStop = useCallback((index: number) => {
    setStopAt(Math.min(TURN.length - 1, Math.max(0, index)));
  }, []);
  const story = useStory(stop, setStop, reduced);
  /* A story is a way of reading the TURN. In any other arrangement its beats name blocks that are
     not on a path, so it is simply not on — and the control that starts it is not there either. */
  const telling = story.on && view === "turn";

  /* ------------------------------------ the camera ------------------------------------ */

  const camera = useCanvasCamera(nav, flight, view);

  /* A view switch is not a level change: the reader keeps their focus and the blocks travel. The
     camera re-frames the same focus in the new arrangement, which is a fly and not a cut. */
  const setView = useCallback(
    (next: string) => {
      if (next === view || !(VIEWS as readonly string[]).includes(next)) return;
      chooseView(next as ViewId);
      camera.refit(next as ViewId);
    },
    [camera, chooseView, view],
  );

  /* The mast's switcher and the shell's `set_view` both read this. Published while mounted. */
  usePublishViews({ views: DESCRIPTORS, current: view, onSet: setView });

  /* -------------------------------------- opening -------------------------------------- */

  const onOpenLayer = useCallback(
    (id: string) => {
      if (nav.state.focus.level >= 1 && nav.state.focus.group === id) return;
      nav.openGroup(id);
    },
    [nav],
  );

  /**
   * Opening a part reports WHERE IT WAS WHEN IT WAS PRESSED, and that is the honest origin.
   *
   * The contract asks a variant for the screen box of the open part so the pane can grow out of it.
   * Measuring it after the fact would measure the part after the camera has flown to it; measuring
   * it at the moment of the press is the rectangle the reader actually pointed at, which is the one
   * the pane should appear to come from (rule 3, rule 11 — measured, never morphed).
   */
  const onOpenPart = useCallback(
    (id: string, at: DOMRect) => {
      const layer = systemById(componentById(id)?.system ?? "")?.layer;
      if (!layer) return;
      reportOrigin(at);
      nav.openItem(layer, id);
    },
    [nav, reportOrigin],
  );

  useEffect(() => {
    if (focus.level < 2) reportOrigin(null);
  }, [focus.level, reportOrigin]);

  /* -------------------------- the filter, the story, and the hop -------------------------- */

  /**
   * WHAT RECEDES, computed once for the whole sheet.
   *
   * Three things can push part of the drawing into the background, and they are strictly ordered
   * (study §4: "hover is suppressed while any stronger mode is active"): the STORY is strongest,
   * then the legend's FILTER, and a hover is only ever a preview of one hop. Ordering them here
   * rather than in the components is what stops two of them fighting over the same opacity.
   */
  const { dimBlocks, dimRuns } = useMemo(() => {
    const plan = planOf(view);
    const blocks = new Set<string>();
    const runs = new Set<string>();

    if (telling) {
      for (const b of plan.blocks) if (!STORY_BLOCKS.has(b.id)) blocks.add(b.id);
      for (const e of plan.edges) if (e.mode !== "path") runs.add(e.id);
      return { dimBlocks: blocks, dimRuns: runs };
    }

    if (!filter) return { dimBlocks: EMPTY, dimRuns: EMPTY };

    const keeps = (id: string): boolean => {
      const block = plan.blocks.find((b) => b.id === id);
      if (!block) return false;
      if (filter.kind === "layer") return block.layer === filter.value;
      if (filter.kind === "status") {
        return block.parts.some((p) => p.status === filter.value) || block.status === filter.value;
      }
      return true;
    };

    for (const b of plan.blocks) if (!keeps(b.id)) blocks.add(b.id);
    for (const e of plan.edges) {
      if (filter.kind === "mode") {
        if (e.mode !== filter.value) runs.add(e.id);
      } else if (!keeps(e.from) || !keeps(e.to)) {
        runs.add(e.id);
      }
    }
    return { dimBlocks: blocks, dimRuns: runs };
  }, [filter, telling, view]);

  /**
   * ONE HOP, AND NO PANEL (item 5, study §4).
   *
   * A hover lights the thing under the pointer and everything exactly one edge away from it. It is
   * a preview of what opening would tell you, it costs nothing to leave, and it is the reason this
   * app needs no second details panel: the question "what does this touch" is answered where the
   * thing is, and the question "what IS this" is answered in the one pane.
   */
  const { hopBlocks, hopRuns } = useMemo(() => {
    if (!hover || telling || filter) return { hopBlocks: EMPTY, hopRuns: EMPTY };
    const blocks = new Set<string>();
    const runs = new Set<string>();
    const component = componentById(hover);

    if (component) {
      blocks.add(component.system);
      for (const e of EDGES) {
        if (e.from !== hover && e.to !== hover) continue;
        runs.add(`${e.from}->${e.to}`);
        const other = componentById(e.from === hover ? e.to : e.from);
        if (other) blocks.add(other.system);
      }
      return { hopBlocks: blocks, hopRuns: runs };
    }

    blocks.add(hover);
    for (const e of SYSTEM_EDGES) {
      if (e.from !== hover && e.to !== hover) continue;
      blocks.add(e.from === hover ? e.to : e.from);
      runs.add(`system:${e.from}->${e.to}`);
    }
    for (const s of TURN) {
      if (s.block === hover) runs.add(`path:${s.block}->${s.block}`);
    }
    return { hopBlocks: blocks, hopRuns: runs };
  }, [filter, hover, telling]);

  /* ------------------------------------- the mount ------------------------------------- */

  const layer = layerById(focus.group);
  const open = componentById(focus.item);
  const here = stopAt(stop);
  const hovered = componentById(hover) ?? systemById(hover ?? "");
  const beat = telling ? blockBeat(here.block, stop) : null;

  return (
    <div
      className="at-stage-in at-bp"
      data-view={view}
      data-band={camera.band}
      data-telling={telling ? "" : undefined}
    >
      <BlueprintTools stop={stop} setStop={setStop} story={story} />

      {/* THE LEGEND IS A BAR, NOT AN OVERLAY (round 5). Round 4's legend floated over the top of
          the sheet and, once it grew counts and became a filter, it covered the first region's
          heading in every view — a control occluding the thing it is a control for. It is a row of
          the stage now, so the drawing starts below it and nothing is hidden. */}
      <Legend
        view={view}
        band={camera.band}
        runsHidden={runsHidden}
        onToggleRuns={() => setRunsHidden((h) => !h)}
        filter={filter}
        setFilter={(next) => setFilter(sameFilter(filter, next) ? null : next)}
      />

      <div className="at-bp-plane">
      <Canvas
        view={view}
        camera={camera}
        focus={focus}
        lens={lens}
        stop={stop}
        story={telling}
        runsHidden={view === "packages" ? runsHidden : false}
        dimBlocks={dimBlocks}
        dimRuns={dimRuns}
        hopBlocks={hopBlocks}
        hopRuns={hopRuns}
        hover={hover}
        onOpenLayer={onOpenLayer}
        onOpenPart={onOpenPart}
        onHover={setHover}
      />

      {/* The reading line: what the camera is looking at, in words. It is also where a hover's one
          hop is spelled out, which is why the hover needs no panel of its own. */}
      <p className="at-readout" data-level={focus.level}>
        <span className="at-readout-level">
          {focus.level === 0
            ? VIEW_META[view].label
            : focus.level === 1
              ? layer?.name
              : open?.name}
        </span>
        <span className="at-label">
          {telling
            ? `${stop + 1}/${TURN.length} · ${here.label}`
            : focus.level === 0
              ? VIEW_META[view].note
              : focus.level === 1
                ? layer?.blurb
                : open?.file}
        </span>
        {hovered ? <span className="at-readout-hover">{hovered.name}</span> : null}
      </p>
      </div>

      {view === "turn" ? <TurnBar stop={stop} setStop={setStop} story={story} /> : null}

      <p className="at-sr" aria-live="polite">
        {view === "turn"
          ? `${telling ? "Telling" : "Stop"} ${stop + 1} of ${TURN.length}: ${here.label}${
              beat ? `, ${beat}` : ""
            }`
          : ""}
      </p>

      {/* The pane is the shell's and it goes last, so it sits over the world. */}
      {pane}
    </div>
  );
}
