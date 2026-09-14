"use client";

/**
 * `constellation` — semantic zoom. The concept: can camera distance BE the level?
 *
 * THE PICTURE. One field. Every applicant in the database is a point on it,
 * placed by the two facts this app exists to keep apart — how well they scored
 * (x, on the rubric's own 0-4 baseline) and how much of the rubric their
 * application actually speaks to (y, quoted sentences). The field is divided
 * into labelled vertical bands, one per group, in pipeline order, so a stage is
 * a REGION rather than a colour; the role is the colour. `./field.ts` holds
 * every coordinate and `test/dir.test.ts` pins them.
 *
 * THE MOVE, AND THERE IS ONLY ONE. The wheel. Come in past the first band and
 * the region under the camera IS the open group — the kit dispatches
 * `nav.openGroup`, so tools, Escape, focus and the flight stay the single truth
 * — and the points in it stop being dots and become monogram chips. Come in past
 * the second and the point under the camera is the open item, and the dossier
 * grows out of its card. Go back out and the levels unwind in the same order.
 * Clicking does exactly the same thing by flying the camera there instead, which
 * is what `poseFor` is: one set of poses, two ways in.
 *
 * WHAT IT COSTS AT REST. Nothing. The rig writes the scene's transform and one
 * data attribute directly on the DOM; no component re-renders while the wheel is
 * turning, and when the reader stops there is no frame loop at all.
 *
 * THE HONEST LIMIT, stated here rather than discovered in review: a field is a
 * comparison surface and this database is small. Forty points across ten bands
 * is a picture you can read; four hundred across forty is a cloud, and the
 * answer for that is not in this prototype.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  REST_POSE,
  poseToTransform,
  useCameraRig,
  useSemanticZoom,
  type CameraPose,
  type Focus,
} from "@athena/demo-kit/zoom";

import { Carousel } from "../../Carousel";
import { Face } from "../../marks/Face";
import { fmtScore } from "../../format";
import type { DirProps } from "../contract";
import {
  FIELD_H,
  FIELD_W,
  ZOOM_BAND,
  ZOOM_CARD,
  bandAt,
  bandPose,
  bandsOf,
  evidenceCeiling,
  fieldBounds,
  gutterEdge,
  pointAt,
  pointOf,
  pointPose,
  waitCeiling,
  type FieldPoint,
} from "./field";

/**
 * When a point stops being a dot and becomes a monogram.
 *
 * Below the L1 band, deliberately: the chip has to arrive BEFORE the level
 * changes or the level change is the first thing that happens, and the whole
 * claim of this direction is that the surface tells you what is about to happen
 * while you are still moving the camera.
 */
const GRAIN_CHIP = ZOOM_BAND * 0.62;

export function Constellation(props: DirProps) {
  const { groups, nav, flight, focus, lit, onOpenGroup, onOpenItem, presence } = props;
  const level = focus.level;
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);

  const bands = useMemo(() => bandsOf(groups), [groups]);
  const ceiling = useMemo(() => evidenceCeiling(groups), [groups]);
  /* The gutter's own scale: the longest an unread application has been standing
     there. Measured across the WHOLE field, like the evidence ceiling, so a wait
     means the same height in every band. */
  const longestWait = useMemo(() => waitCeiling(groups), [groups]);

  /** Every point on the field, once, with the group it belongs to. */
  const plotted = useMemo(
    () =>
      groups.flatMap((g, i) =>
        g.candidates.map((candidate) => ({
          group: g.id,
          roleId: g.role.id,
          candidate,
          point: pointOf(candidate, bands[i]!, ceiling, longestWait),
        })),
      ),
    [bands, ceiling, groups, longestWait],
  );
  const byGroup = useMemo(() => {
    const map = new Map<string, { key: string; point: FieldPoint }[]>();
    for (const p of plotted) {
      const list = map.get(p.group) ?? [];
      list.push({ key: p.candidate.id, point: p.point });
      map.set(p.group, list);
    }
    return map;
  }, [plotted]);

  const rig = useCameraRig({
    initial: REST_POSE,
    bounds: fieldBounds(),
    drag: "pan",
    wheel: "zoom",
    inertia: 0,
    snap: null,
    keyboard: true,
    reducedMotion: "user",
    flyToken: "--bd-dur-4",
  });

  /*
   * THE POSE, AND THE GRAIN, WITHOUT A RENDER.
   *
   * The transform goes straight onto the element and the grain — dot, chip —
   * onto a data attribute the stylesheet keys off, written only when it CHANGES.
   * Forty points re-rendered on every frame of a wheel gesture is the "unseen
   * layers cost nothing" rule failing from the other end, and nothing about this
   * surface's OUTPUT depends on the pose: only these two strings do.
   */
  const grain = useRef<string>("dot");
  useEffect(
    () =>
      rig.subscribe((pose) => {
        const el = sceneRef.current;
        if (!el) return;
        el.style.transform = poseToTransform(pose);
        const next = pose.zoom >= GRAIN_CHIP ? "chip" : "dot";
        if (next !== grain.current) {
          grain.current = next;
          el.dataset.grain = next;
        }
      }),
    [rig],
  );

  const resolveGroup = useCallback(
    (pose: CameraPose): string | null => bandAt(pose.pan, bands)?.id ?? null,
    [bands],
  );

  const resolveItem = useCallback(
    (pose: CameraPose, group: string): string | null =>
      pointAt(pose.pan, byGroup.get(group) ?? []),
    [byGroup],
  );

  const poseFor = useCallback(
    (at: Focus): Partial<CameraPose> => {
      if (at.level === 0) return REST_POSE;
      const band = bands.find((b) => b.id === at.group) ?? null;
      if (at.level === 1 || !at.item) return bandPose(band);
      const found = plotted.find((p) => p.candidate.id === at.item);
      return found ? pointPose(found.point) : bandPose(band);
    },
    [bands, plotted],
  );

  useSemanticZoom(nav, rig, {
    bands: [ZOOM_BAND, ZOOM_CARD],
    resolveGroup,
    resolveItem,
    poseFor,
    flight,
  });


  /*
   * FOCUS FOLLOWS THE LEVEL, on the way out.
   *
   * The kit owns L2's focus return (`useOverlayEscape`, rule 5) and owns nothing
   * for L0 ⇄ L1 — round 3's own kit list has that as item 3 and it did not land
   * with the camera. So each direction writes it, and this is the second of the
   * two copies in this app: a reader who Escapes out of a group lands back on the
   * control they opened it with, not on the document.
   *
   * `focus()` and not a click, so `:focus-visible` stays false when the level was
   * changed with a pointer and no ring flashes. A LAYOUT effect for the read and a
   * passive one for the write: the selector has to be built from `from` on the
   * frame the level changes, and the node it names only exists after the paint.
   */
  const restore = useRef<string | null>(null);
  const { from, to } = flight;
  useLayoutEffect(() => {
    if (from === to) return;
    if (from.level === 1 && to.level === 0 && from.group) {
      const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(from.group) : from.group;
      restore.current = `[data-group="${esc}"]`;
      nav.highlight([from.group]);
    } else if (nav.state.highlight.size > 0) {
      nav.highlight([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);
  useEffect(() => {
    const sel = restore.current;
    restore.current = null;
    if (sel) viewRef.current?.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true });
  });

  const open = groups.find((g) => g.id === focus.group);
  const { ref: rigRef, ...rigProps } = rig.bind;

  return (
    <div className="bd-stage bd-field" data-level={level} ref={viewRef}>
      <div className="bd-field-view">
        <div
          className="bd-field-scene"
          data-grain="dot"
          ref={(el) => {
            sceneRef.current = el;
            rigRef(el);
          }}
          {...rigProps}
          style={{ inlineSize: `${FIELD_W}px`, blockSize: `${FIELD_H}px` }}
          aria-label="Every applicant as a point. Wheel in to open the region under the camera."
        >
          {bands.map((band) => {
            const near = presence(band.id);
            return (
              <div
                key={band.id}
                className="bd-region"
                data-open={band.id === focus.group || undefined}
                data-lit={lit.has(band.id) ? "true" : undefined}
                style={{
                  left: `${band.x0 * 100}%`,
                  inlineSize: `${(band.x1 - band.x0) * 100}%`,
                  opacity: near.opacity,
                }}
              >
                {/* The gutter: the strip where an unscored application stands,
                    off the score axis entirely rather than drawn as a zero. */}
                <span
                  className="bd-region-gutter"
                  style={{
                    inlineSize: `${((gutterEdge(band) - band.x0) / (band.x1 - band.x0)) * 100}%`,
                  }}
                  aria-hidden
                />
                <button
                  type="button"
                  className="bd-region-head"
                  data-group={band.id}
                  onClick={() => onOpenGroup(band.id)}
                  aria-label={`Open ${band.roleTitle} at ${band.stageLabel}`}
                >
                  <span className="bd-region-stage">{band.stageLabel}</span>
                  <span className="bd-region-role">{band.roleTitle}</span>
                </button>
              </div>
            );
          })}

          {plotted.map(({ candidate, point, group, roleId }) => (
            <button
              key={candidate.id}
              type="button"
              className="bd-point"
              data-role-id={roleId}
              data-candidate={candidate.id}
              data-unscored={!candidate.scored || undefined}
              data-borderline={candidate.borderline || undefined}
              title={`${candidate.name} · ${candidate.line}`}
              style={{
                left: `${point.x * 100}%`,
                top: `${(1 - point.y) * 100}%`,
              }}
              onClick={() => {
                nav.hover(candidate.id);
                if (focus.group === group) onOpenItem(group, candidate.id);
                else onOpenGroup(group);
              }}
            >
              <span className="bd-point-dot" aria-hidden />
              <span className="bd-point-chip" aria-hidden>
                <Face id={candidate.id} initials={candidate.initials} className="bd-mono" />
              </span>
              <span className="bd-point-name">
                {candidate.name}
                <i>{fmtScore(candidate.scored, candidate.overall)}</i>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* The two axes, said in words. A scatter whose axes are not named is a
          decoration, which is the charge §1c already upheld against the tick line. */}
      <p className="bd-field-axes" aria-hidden>
        <span>← thin · weighted score · strong →</span>
        <span>↑ evidence · {ceiling} quoted sentences at the top</span>
        <span>
          the ruled strip is the unread — neither axis applies, longest wait ({longestWait} days) at
          the top
        </span>
      </p>

      {level >= 1 && open ? (
        <div className="bd-layer bd-field-deck">
          <Carousel
            key={open.id}
            role={open.role}
            column={open.column}
            focusId={nav.state.hover}
            owns={level === 1}
            onFocus={(id) => nav.hover(id)}
            onOpen={(id) => {
              nav.hover(id);
              onOpenItem(open.id, id);
            }}
          />
        </div>
      ) : null}

      {level === 0 ? (
        <p className="bd-cam-hint" aria-hidden>
          wheel in — the region under the camera opens · Esc to come back out
        </p>
      ) : null}
    </div>
  );
}
