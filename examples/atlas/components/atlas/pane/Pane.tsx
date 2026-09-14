"use client";

/**
 * L2 — ONE COMPONENT, AND THE ONLY PLACE IN ATLAS WHERE PROSE IS ALLOWED.
 *
 * That is the round-3 rule and it is a design rule, not a layout convenience: the machine is the
 * argument, and text everywhere else is a label on a part. What it enforces, the claims it
 * carries, who calls it, what it reaches, which ADR decided it, and its path in this repository —
 * six blocks of words, at the one depth where a reader has stopped moving and started reading.
 *
 * IT RISES OUT OF THE PART. The camera holds still at L2 (the rig has already flown to the part
 * and stays there), and the pane grows from the part's own position on screen — `origin` is the
 * middle of the part's client rect, and it becomes the `transform-origin` of a scale. That is
 * rule 3 in its L2 form: the box travels first, the ink arrives after it has landed (`m.inkIn`,
 * delayed by a whole move).
 *
 * STILL NO `layoutId`, AND FOR A BETTER REASON THAN ROUND 3'S. Round 3 could not morph because a
 * `matrix3d` face measures a rectangle that is nowhere near where the reader sees the part. On a
 * 2D sheet `getBoundingClientRect` is honest again — but the part's position comes from the
 * CAMERA, and formula rule 11 says one element has exactly one owner of its transform. So the
 * next level is measured out of it, not morphed through it, which is what rule 11 asks for and is
 * a cheaper thing to be right about than a shared id.
 *
 * It owns its own Escape and hands focus back to whatever opened it (formula §1 rule 5,
 * `useOverlayEscape`).
 *
 * The chips are the fastest path in the app: "this module enforces invariant 2" to "where else is
 * invariant 2 enforced" is one click, and it does not change level — a lens is a way of looking at
 * where you already are.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { motion } from "motion/react";
import { useOverlayEscape, type ZoomNav } from "@athena/demo-kit/zoom";

import {
  adrByN,
  componentById,
  conceptById,
  edgesIn,
  edgesOut,
  layerOfComponent,
  systemById,
  type Component,
  type Lens,
} from "@/data";

import { useAtlasMotion } from "../motion";

export function Pane({
  component,
  nav,
  lens,
  setLens,
  origin,
}: {
  component: Component;
  nav: ZoomNav;
  lens: Lens;
  setLens: (id: string | null) => void;
  /** Measures where the part is on screen, in viewport pixels. Called once, on mount. */
  origin: () => { x: number; y: number } | null;
}) {
  const m = useAtlasMotion();
  const paneRef = useRef<HTMLDivElement | null>(null);

  const overlay = useOverlayEscape({
    onClose: nav.up,
    returnFocusTo: () =>
      document.querySelector<HTMLElement>(`[data-component="${component.id}"]`),
  });

  /* The hook returns focus; TAKING it is the pane's decision, because where it should land differs
     per design. The dialog itself is the standard target: a screen reader reads the pane, Tab then
     lands on its first control, and no focus ring flashes on a control nobody meant to press. */
  useEffect(() => {
    paneRef.current?.focus({ preventScroll: true });
  }, []);

  /* The grow's anchor, measured once, before the browser paints the pane's first frame. Writing
     it as two custom properties on the pane's own node is updating an external system, which is
     what a layout effect is for; making it React state would be a second render behind the one
     that mounted the pane, and the grow would start from the middle of the screen. */
  useLayoutEffect(() => {
    const el = paneRef.current;
    const at = origin();
    if (!el || !at) return;
    el.style.setProperty("--at-pane-ox", `${Math.round(at.x)}px`);
    el.style.setProperty("--at-pane-oy", `${Math.round(at.y)}px`);
    el.dataset.anchored = "";
  }, [origin]);

  const system = systemById(component.system);
  const layer = layerOfComponent(component);
  const out = edgesOut(component.id);
  const into = edgesIn(component.id);

  return (
    <>
      {/* The scrim is a control, not a decoration: clicking it means the same thing Escape does.
          Flat `--at-scrim` — frosted glass is not a thing that happens to paper. */}
      <button
        type="button"
        className="at-scrim"
        aria-label="Close this component"
        tabIndex={-1}
        onClick={() => nav.up()}
      />

      <motion.div
        ref={paneRef}
        className="at-pane"
        role="dialog"
        aria-modal="true"
        aria-label={`${component.part} ${component.name}`}
        data-status={component.status}
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={m.move}
        {...overlay}
      >
        {/* Rule 3: the box travels first and fills after it has landed. */}
        <motion.div
          className="at-pane-ink"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={m.inkIn}
        >
          <header>
            <p className="at-row">
              <span className="at-part">{component.part}</span>
              <span className="at-part">
                {layer?.name} / {system?.name}
                {component.status === "planned" ? " / not in the tree" : ""}
              </span>
            </p>
            <h2 className="at-pane-title">{component.name}</h2>
            <p className="at-cite">
              <span>{component.file}</span>
            </p>
          </header>

          <section className="at-pane-section">
            <h3 className="at-pane-section-head">What it enforces</h3>
            <p className="at-prose">{component.enforces}</p>
          </section>

          <section className="at-pane-section">
            <h3 className="at-pane-section-head">
              Claims it carries <span className="at-fig">{component.concepts.length}</span>
            </h3>
            {component.concepts.length === 0 ? (
              <p className="at-label">
                None on its own &mdash; it is plumbing the claims above and below it depend on.
              </p>
            ) : (
              <ul className="at-chips">
                {component.concepts.map((id) => {
                  const concept = conceptById(id);
                  if (!concept) return null;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        className="at-chip"
                        data-lit={lens.concept?.id === id ? "true" : "false"}
                        onClick={() => setLens(id)}
                      >
                        <span className="at-part">{concept.part}</span> {concept.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="at-pane-section">
            <h3 className="at-pane-section-head">
              Who calls it <span className="at-fig">{into.length}</span>
            </h3>
            {into.length === 0 ? (
              <p className="at-label">Nothing in the model reaches it. It is an entry point.</p>
            ) : (
              into.map((edge) => <Link key={`${edge.from}-${edge.kind}`} id={edge.from} kind={edge.kind} note={edge.note} nav={nav} />)
            )}
          </section>

          <section className="at-pane-section">
            <h3 className="at-pane-section-head">
              What it reaches <span className="at-fig">{out.length}</span>
            </h3>
            {out.length === 0 ? (
              <p className="at-label">Nothing. It bottoms out here.</p>
            ) : (
              out.map((edge) => <Link key={`${edge.to}-${edge.kind}`} id={edge.to} kind={edge.kind} note={edge.note} nav={nav} />)
            )}
          </section>

          <section className="at-pane-section">
            <h3 className="at-pane-section-head">
              Decided in <span className="at-fig">{component.adrs.length}</span>
            </h3>
            {component.adrs.length === 0 ? (
              <p className="at-label">No ADR names it. Its reason is in README alone.</p>
            ) : (
              component.adrs.map((n) => {
                const adr = adrByN(n);
                return (
                  <div key={n} className="at-adr">
                    <span className="at-adr-n">ADR {String(n).padStart(4, "0")}</span>
                    <span className="at-label">{adr?.title ?? "unknown"}</span>
                    <span className="at-cite">
                      <span>{adr?.file ?? ""}</span>
                    </span>
                  </div>
                );
              })
            )}
          </section>

          <footer className="at-pane-foot">
            <span className="at-label">Esc, the scrim, or Close all go back to {layer?.name}.</span>
            <button type="button" className="at-close" onClick={() => nav.up()}>
              Close (Esc)
            </button>
          </footer>
        </motion.div>
      </motion.div>
    </>
  );
}

/** One edge, as a control: the other end is one click away and it opens at L2 directly. */
function Link({
  id,
  kind,
  note,
  nav,
}: {
  id: string;
  kind: string;
  note: string;
  nav: ZoomNav;
}) {
  const other = componentById(id);
  if (!other) return null;
  const layer = layerOfComponent(other);
  return (
    <button
      type="button"
      className="at-link"
      onClick={() => (layer ? nav.openItem(layer.id, other.id) : undefined)}
    >
      <span className="at-link-kind">{kind}</span>
      <span>
        <span className="at-link-name">{other.name}</span>{" "}
        <span className="at-part">{layer?.name}</span>
      </span>
      <span className="at-link-note">{note}</span>
    </button>
  );
}
