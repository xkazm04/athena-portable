"use client";

/**
 * THE NODE, AND THE FRAMES AROUND IT. Archify study §2 (node anatomy) and §7.4 (derived groups).
 *
 * ARCHIFY'S ANATOMY, TRANSPOSED, and every clause of it is load-bearing:
 *
 *   · NO TITLE BAR. A title bar spends a quarter of a small box on a strip of chrome; the kind is
 *     carried by the fill and the sigil instead, and the whole box is content.
 *   · AN OPAQUE MASK UNDER THE BOX, so a run that passes behind it never shows through. The router
 *     guarantees no run crosses a node, but a run may pass a hair outside one, and a translucent
 *     panel over a line reads as a line THROUGH the panel.
 *   · THREE TEXT TIERS: a centred label, a muted sublabel, a tiny tag in the kind accent. They
 *     carry `data-detail="context" | "fine"`, which is the semantic-zoom hook — band 0 shows the
 *     label alone, band 1 adds the sublabel, band 2 adds the tag — and INTENT OVERRIDES THE BAND:
 *     hover, focus, the claim lens, a PATH endpoint and the active story beat all re-reveal every
 *     tier at any distance, through `[data-intent]` on the node.
 *
 * TEXT IS SIZED IN WORLD UNITS AND SCALED BY A CLAMPED `--ar-cs` (rule 13, with a correction). Pure
 * screen-space type would make the constraint pass in `layout.ts` meaningless — the columns were
 * widened to fit these labels at THIS size — so the label keeps its world size and is allowed to
 * grow by at most `--ar-cs-max` as the reader pulls back, then clips with an ellipsis rather than
 * overflowing. That is archify's shrink-to-fit floor (§7.8) expressed at the other end: reject the
 * overflow, never draw it.
 *
 * ONE HTML ELEMENT PER NODE, not an SVG group, because a node is a BUTTON: it is focusable, it has
 * a name, Enter opens it, and the arrows rove between nodes. The runs and the frames are SVG
 * underneath; the things a reader operates are DOM controls on top.
 */
import { memo, type CSSProperties } from "react";

import type { Boundary, NodeBox, PartBox } from "./layout";
import { Sigil } from "./Sigil";

const box = (r: { x: number; y: number; w: number; h: number }): CSSProperties => ({
  transform: `translate(${r.x}px, ${r.y}px)`,
  width: `${r.w}px`,
  height: `${r.h}px`,
});

/**
 * A NODE IS NOT A DRAG HANDLE — and this is a kit gap, not a preference.
 *
 * `useCameraRig`'s `onPointerDown` calls `setPointerCapture` on the canvas, and a captured pointer
 * retargets the subsequent `click` to the capturing element: the node's own `onClick` never fires,
 * so a drawing built out of DOM buttons over the kit's rig silently stops responding to the mouse
 * while still responding to Enter. The capture is right for a drag and wrong for a control, and the
 * rig offers no way to say "this pointerdown was not for you".
 *
 * So a node stops the pointer at itself. The camera still pans from the sheet, the gaps between the
 * columns and the inside of every boundary frame, which is most of the drawing; what it no longer
 * does is start a pan on top of a button, which is the behaviour a button should have anyway.
 * Logged in KIT-GAPS as R5-A1.
 */
const holdPointer = (event: { stopPropagation: () => void }) => event.stopPropagation();

/* ------------------------------------------ the frames --------------------------------------- */

export interface FramesProps {
  boundaries: readonly Boundary[];
  open: string | null;
  lit: ReadonlySet<string>;
}

/**
 * The boundaries. A `region` is amber and dashed 8,4; a `security-group` is rose and dashed 4,4 —
 * archify's two, and there is no third. The corner label carries its own opaque mask, which is the
 * one place this drawing puts a rectangle behind text on purpose.
 */
export const Frames = memo(function Frames({ boundaries, open, lit }: FramesProps) {
  return (
    <>
      {boundaries.map((b) => (
        <div
          key={b.id}
          className="ar-frame"
          data-kind={b.kind}
          data-open={open === b.id ? "" : undefined}
          data-lit={lit.has(b.id) ? "" : undefined}
          style={box(b)}
          aria-hidden
        >
          <span className="ar-frame-label">
            <span className="ar-frame-name">{b.label}</span>
            <span className="ar-frame-note" data-detail="context">
              {b.note}
            </span>
          </span>
        </div>
      ))}
    </>
  );
});

/* ------------------------------------------- the node ---------------------------------------- */

export type Intent = "focus" | "hover" | "lens" | "path" | "story" | undefined;

export interface SystemNodeProps {
  node: NodeBox;
  /** The layer this node belongs to is open: its components are drawn instead of its label. */
  open: boolean;
  intent: Intent;
  /** `dim` is the LENS's spatial reference — present, legible, not the subject. */
  dim: boolean;
  /** The node's OWN id. What the stage does with it — open its layer, or pick it for PATH — is
      the stage's business; a node that reported only its layer could not be a PATH endpoint. */
  onOpen: (id: string) => void;
  onHover: (id: string | null) => void;
}

export const SystemNode = memo(function SystemNode({
  node,
  open,
  intent,
  dim,
  onOpen,
  onHover,
}: SystemNodeProps) {
  return (
    <div
      className="ar-node"
      data-node-id={node.id}
      data-node-kind={node.kind}
      data-status={node.status}
      data-open={open ? "" : undefined}
      data-intent={intent}
      data-dim={dim ? "" : undefined}
      data-trust={node.trust ? "" : undefined}
      data-roving=""
      style={box(node)}
      tabIndex={0}
      role="button"
      aria-label={`${node.text.label} — ${node.text.sublabel}. ${node.parts.length} components.`}
      aria-expanded={open}
      onPointerDown={holdPointer}
      onClick={() => onOpen(node.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(node.id);
        }
      }}
      onPointerEnter={() => onHover(node.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(node.id)}
      onBlur={() => onHover(null)}
    >
      <span className="ar-mask" aria-hidden />
      <Sigil kind={node.kind} />
      <span className="ar-tag" data-detail="fine">
        {node.text.tag}
      </span>
      {open ? null : (
        <span className="ar-body">
          <span className="ar-label">{node.text.label}</span>
          <span className="ar-sub" data-detail="context">
            {node.text.sublabel}
          </span>
        </span>
      )}
      {open ? (
        <span className="ar-open-name" aria-hidden>
          {node.text.label}
        </span>
      ) : null}

      {/* THE GHOST CELLS. At band 0 a node still occupies the space its components will need —
          the geometry is one plan at every distance, which is what makes `poseFor` and `resolve*`
          exact inverses (rule 14) — and an empty box that size would be a lie about how much is
          inside it. So the slots are drawn, unlabelled, in their own kinds' colours: a reader can
          count the modules in a system from across the sheet, and the band change is the moment
          they gain names rather than the moment they appear. Archify's "S3 Buckets" node lists its
          buckets for the same reason. */}
      {open
        ? null
        : node.parts.map((p) => (
            <span
              key={p.id}
              className="ar-ghost"
              data-node-kind={p.kind}
              data-status={p.status}
              style={box({ x: p.x - node.x, y: p.y - node.y, w: p.w, h: p.h })}
              aria-hidden
            />
          ))}
    </div>
  );
});

/* ------------------------------------------ the part ----------------------------------------- */

export interface PartNodeProps {
  part: PartBox;
  intent: Intent;
  dim: boolean;
  onOpen: (id: string) => void;
  onHover: (id: string | null) => void;
}

/**
 * A component, drawn inside its system's node once the layer is open — "nodes inside a node's
 * region", which is the level-of-detail move archify leaves to the viewer because its IR has no
 * recursive containment. The part is the same anatomy at a smaller size, which is what makes the
 * band change read as a zoom rather than as a different drawing.
 */
export const PartNode = memo(function PartNode({
  part,
  intent,
  dim,
  onOpen,
  onHover,
}: PartNodeProps) {
  return (
    <div
      className="ar-part"
      data-component={part.id}
      data-node-id={part.id}
      data-node-kind={part.kind}
      data-status={part.status}
      data-intent={intent}
      data-dim={dim ? "" : undefined}
      data-roving=""
      style={box(part)}
      tabIndex={0}
      role="button"
      aria-label={`${part.text.label} — ${part.text.tag}`}
      onPointerDown={holdPointer}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(part.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onOpen(part.id);
        }
      }}
      onPointerEnter={() => onHover(part.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(part.id)}
      onBlur={() => onHover(null)}
    >
      <span className="ar-mask" aria-hidden />
      <Sigil kind={part.kind} size="part" />
      <span className="ar-body">
        <span className="ar-label">{part.text.label}</span>
        <span className="ar-sub" data-detail="fine">
          {part.text.tag}
        </span>
      </span>
    </div>
  );
});
