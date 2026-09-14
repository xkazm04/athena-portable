"use client";

/**
 * Put every L1 label on the slab the scene is drawing for it, every frame the
 * camera moves, and never through React.
 *
 * WHY THE LABELS ARE DOM. The alternative was billboards — three sprites, or
 * `drei`'s `Text`. Three reasons decided it, in this order:
 *
 *   1. THE TYPE IS THE SHEET'S. Every word on this app is set in the broadsheet
 *      ramp out of `style/base/tokens.css`: one label style, a figure face with
 *      tabular numerals, an ink floor at 7.5:1 that `design/` treats as law. A
 *      sprite carries a texture, so it would either need an SDF atlas of three
 *      typefaces (a second type system that cannot read a token) or canvas text
 *      (a third). The one place this direction already writes a colour twice —
 *      `INK` in `l0/contract.ts` — is a documented exception and it is not
 *      worth a fourth.
 *   2. A SPRITE IS NOT REACHABLE. L1 is one tab stop with a roving tabindex and
 *      arrow keys across the grid, and every cell has an `aria-label` a screen
 *      reader reads. A canvas has one focusable node and no accessible tree.
 *      Round 1's review scored this app 1 on user control; sprites would hand
 *      that point back.
 *   3. THE MORPH NEEDS A BOX. L1 -> L2 is a `layoutId` morph from the cell to
 *      the dossier (formula §1 rule 2), and motion measures DOM rectangles.
 *
 * The cost is honest and is written here rather than hidden: the labels do not
 * occlude. A slab behind another slab still has its label drawn on top of
 * everything, so this works because at L1 the reader is inside one octant
 * looking at one layer of slabs, and it would not work for a scene with depth
 * in front of the labels. `--depth` is written anyway, so a future sort has the
 * number it needs.
 *
 * WRITTEN STRAIGHT ONTO THE NODES, as custom properties, for the reason round
 * 2's `useLanding.ts` gave and this inherits: a projection is a measurement of
 * a camera that has already moved, and feeding it back through a render would
 * put a frame between the camera being somewhere and the labels being there.
 * At sixty frames a second that frame is the whole effect.
 */
import { useEffect, type RefObject } from "react";

import type { CameraRig } from "@athena/demo-kit/zoom";
import { basisOf, eyeOf, faceOf, FACING_FLOOR, project } from "../space/camera";
import { boxOf, slotOf, slotWorld } from "../space/geometry";

/**
 * The width a label is authored at, in CSS pixels.
 *
 * The scale written below is the projected slab's width over this, so at the
 * pose `poseFor` flies to the factor is about one and the type is at the size
 * `style/` set it in. Zooming past that is the reader asking for bigger type,
 * which is what a semantic zoom should give them.
 */
export const LABEL_W = 132;

export function useProjector(
  rig: CameraRig,
  frame: RefObject<HTMLElement | null>,
  cells: RefObject<HTMLElement | null>,
  database: { id: string; tables: ReadonlyArray<{ ident: string }> } | undefined,
  active: boolean,
): void {
  const group = database?.id;
  const idents = database?.tables.map((t) => t.ident).join(",");

  useEffect(() => {
    const box = frame.current;
    const root = cells.current;
    if (!active || !box || !root || !group || !idents) return;

    const cell = boxOf(group);
    const face = faceOf(group);
    const basis = basisOf(face.yaw, face.pitch);
    const list = idents.split(",");
    const at = list.map((_, i) => slotOf(i, list.length, cell));

    const write = () => {
      const rect = box.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const pose = rig.get();
      /*
       * HOW SQUARE-ON THE SLABS ARE. They stand in the plane the camera flew in
       * along, so a reader who has orbited a long way round is looking at a rank
       * of cards edge-on — and a label projected onto an edge-on card is a
       * column of type on top of the next column of type. Below the floor the
       * labels are simply not drawn: the slabs are still there, still in their
       * places, and turning back brings the words back.
       */
      const view = eyeOf(pose).basis.dir;
      const facingOn =
        Math.abs(view.x * basis.dir.x + view.y * basis.dir.y + view.z * basis.dir.z) >= FACING_FLOOR;
      for (let i = 0; i < list.length; i += 1) {
        const node = root.querySelector<HTMLElement>(`[data-slot="${list[i]}"]`);
        if (!node) continue;
        const slot = at[i]!;
        const p = project(slotWorld(slot, cell, basis), pose, { w: rect.width, h: rect.height });
        // Behind the camera, or edge-on enough that the slab has no face left:
        // the label is taken out rather than drawn at a size nobody asked for.
        const facing = p.scale > 0 && facingOn;
        node.dataset.behind = facing ? "false" : "true";
        if (!facing) continue;
        node.style.setProperty("--px", `${p.x.toFixed(1)}px`);
        node.style.setProperty("--py", `${p.y.toFixed(1)}px`);
        node.style.setProperty("--ps", ((slot.w * p.scale) / LABEL_W).toFixed(4));
        // The card is the slab's FACE, so it wears the slab's proportions. A
        // database with seven tables is dealt three rows instead of two and its
        // slabs are shorter; a card sized from a constant would hang off them.
        node.style.setProperty("--ar", (slot.h / slot.w).toFixed(4));
        node.style.setProperty("--depth", p.depth.toFixed(3));
      }
    };

    write();
    const off = rig.subscribe(write);
    const observer = new ResizeObserver(write);
    observer.observe(box);
    return () => {
      off();
      observer.disconnect();
    };
  }, [active, cells, frame, group, idents, rig]);
}
