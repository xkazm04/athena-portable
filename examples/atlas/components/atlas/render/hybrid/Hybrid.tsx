"use client";

/**
 * VARIANT 3 — HYBRID. Geometry from WebGL, words from the document.
 *
 * The premise of this one is that the two techniques are good at opposite halves of the problem
 * and neither half is optional. WebGL knows what is in front of what; the DOM knows what a word
 * is. So the machine, the pipes and the travelling light are the SAME three scene as variant 2 —
 * literally, the same component with `labels="dom"` — and every label is an absolutely-positioned
 * DOM node placed by `project()` from the rig's pose, which is the same pinhole the three camera
 * is built from.
 *
 * WHY THIS IS NOT `drei/Html`. `Html` mounts one positioned wrapper per label and transforms it
 * inside the fiber render loop; with the transport running that is a layout write per label per
 * frame. The projection here is one `viewOf()` and one `project()` per visible label into a
 * single `transform`, written imperatively, on a list that changes only when the level does —
 * about eight nodes at L0 and thirty at L1, not sixty-eight.
 *
 * WHAT THE READER GETS that variant 2 cannot give them: the names are real text. Selectable,
 * searchable with the browser's own find, in the accessibility tree, and crisp at every zoom
 * because they are type rather than a bitmap of type. What they lose relative to variant 1: the
 * labels float in front of the machine with no depth of their own, so a label belonging to a
 * block at the back can overprint a block at the front. `data-behind` fades the ones whose
 * anchor is far away, which softens it without solving it.
 */
import { memo, useCallback, useEffect, useMemo, useRef } from "react";

import { DIM, type Vec3 } from "../../scene/layout";
import { project, viewOf } from "../../scene/project";
import { turnAt } from "../../scene/turn";
import type { SceneProps } from "../contract";
import { useFrameSize } from "../useFrameSize";
import { Webgl } from "../webgl/Webgl";

/** One thing that wants a word on it. */
interface Anchor {
  id: string;
  at: Vec3;
  text: string;
  kind: "stratum" | "block" | "stop";
  lit: boolean;
  onPick?: () => void;
}

export function Hybrid(props: SceneProps) {
  const { scene, weights, focus, transport, rig, onOpenStratum, onHover } = props;
  const layerRef = useRef<HTMLDivElement | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const size = useFrameSize(layerRef);
  const open = focus.group;

  /**
   * WHICH WORDS EXIST AT THIS LEVEL — the brief's rule that prose lives at L2 and labels
   * elsewhere are short names, made into a list.
   *
   *   L0  six stratum names, and the turn's one stop label
   *   L1  the open stratum's block names as well
   *
   * Part names are never here: sixty-eight of them at once is the density the round-2 review
   * already called out, and a part says its name on hover and in the pane.
   */
  const anchors = useMemo<Anchor[]>(() => {
    const out: Anchor[] = [];
    for (const s of scene.strata) {
      const w = weights.stratum(s);
      if (w.presence < 0.1) continue;
      out.push({
        id: `stratum:${s.id}`,
        at: { x: -s.w / 2 - DIM.stub * 2, y: s.y + DIM.blockH * 0.6, z: s.d / 2 },
        text: s.name,
        kind: "stratum",
        lit: w.lit,
        onPick: () => onOpenStratum(s.id),
      });
    }
    if (focus.level > 0) {
      for (const b of scene.blocks) {
        if (b.layer !== open) continue;
        const w = weights.block(b);
        out.push({
          id: `block:${b.id}`,
          at: { x: b.x, y: b.y + b.h + DIM.partH * 3, z: b.z },
          text: b.name,
          kind: "block",
          lit: w.lit,
        });
      }
    }
    return out;
  }, [focus.level, onOpenStratum, open, scene.blocks, scene.strata, weights]);

  /* One imperative pass over the anchors plus the moving stop label. No React per frame. */
  const draw = useCallback(() => {
    if (size.h === 0) return;
    const view = viewOf(rig.get());
    for (const a of anchors) {
      const el = nodes.current.get(a.id);
      if (!el) continue;
      const p = project(a.at, view, size);
      el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      el.style.opacity = p.visible ? "1" : "0";
      /* Depth is the only cue a flat label has: the far half of the machine's own depth range
         reads as behind, and steps back. */
      el.dataset.behind = p.depth > DIM.planeW ? "" : "false";
    }
    const stop = nodes.current.get("stop");
    if (stop) {
      const f = turnAt(transport.beat());
      const p = project({ ...f.at, y: f.at.y + DIM.partH * 3 }, view, size);
      stop.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      stop.style.opacity = p.visible ? "1" : "0";
      stop.textContent = f.stop.label;
      stop.dataset.kind = f.stop.kind;
      stop.dataset.parked = f.parked ? "" : "false";
    }
  }, [anchors, rig, size, transport]);

  useEffect(() => {
    draw();
    const offPose = rig.subscribe(draw);
    const offBeat = transport.subscribe(draw);
    return () => {
      offPose();
      offBeat();
    };
  }, [draw, rig, transport]);

  return (
    <Webgl {...props} labels="dom">
      <div className="at-hy-labels" ref={layerRef} aria-hidden={false}>
        {anchors.map((a) => (
          <Word
            key={a.id}
            anchor={a}
            attach={(el) => {
              if (el) nodes.current.set(a.id, el);
              else nodes.current.delete(a.id);
            }}
            onHover={onHover}
          />
        ))}
        <p
          className="at-hy-stop"
          ref={(el) => {
            if (el) nodes.current.set("stop", el);
            else nodes.current.delete("stop");
          }}
        />
      </div>
    </Webgl>
  );
}

const Word = memo(function Word({
  anchor,
  attach,
  onHover,
}: {
  anchor: Anchor;
  attach: (el: HTMLElement | null) => void;
  onHover: (id: string | null) => void;
}) {
  const id = anchor.id.split(":")[1] ?? "";
  if (anchor.onPick) {
    return (
      <button
        type="button"
        ref={attach}
        className="at-hy-word"
        data-kind={anchor.kind}
        data-lit={anchor.lit ? "" : undefined}
        onClick={anchor.onPick}
        onPointerEnter={() => onHover(id)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover(id)}
        onBlur={() => onHover(null)}
      >
        {anchor.text}
      </button>
    );
  }
  return (
    <span
      ref={attach}
      className="at-hy-word"
      data-kind={anchor.kind}
      data-lit={anchor.lit ? "" : undefined}
    >
      {anchor.text}
    </span>
  );
});
