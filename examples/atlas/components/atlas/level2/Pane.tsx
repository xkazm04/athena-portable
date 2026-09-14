"use client";

/**
 * L2 — one component: what it enforces, which claims it carries, who calls it, what it calls, and
 * the ADR that decided it.
 *
 * It owns its own Escape and hands focus back to the row it grew out of (formula §1 rule 5,
 * `useOverlayEscape`), and it holds that row's shared id for as long as it is up (rule 2). It is
 * NOT inside an `AnimatePresence`: on close it has to release the id in the same commit the row
 * takes it back, or there are two claimants and the box does not morph home.
 *
 * The chips are the fastest path in the app: "this module enforces invariant 2" to "where else is
 * invariant 2 enforced" is one click, and it does not change level — a lens is a way of looking at
 * where you already are.
 */
import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { useOverlayEscape, useSharedIdentity, type ZoomNav } from "@athena/demo-kit/zoom";

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

import { partId, useAtlasMotion } from "../motion";

export function Pane({
  component,
  nav,
  lens,
  setLens,
}: {
  component: Component;
  nav: ZoomNav;
  lens: Lens;
  setLens: (id: string | null) => void;
}) {
  const m = useAtlasMotion();
  const box = useSharedIdentity(partId(component.id), true);
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
        key={box.key}
        layoutId={box.layoutId}
        className="at-pane"
        role="dialog"
        aria-modal="true"
        aria-label={`${component.part} ${component.name}`}
        data-status={component.status}
        tabIndex={-1}
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

          <section className="at-block">
            <h3 className="at-block-head">What it enforces</h3>
            <p className="at-prose">{component.enforces}</p>
          </section>

          <section className="at-block">
            <h3 className="at-block-head">
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

          <section className="at-block">
            <h3 className="at-block-head">
              Who calls it <span className="at-fig">{into.length}</span>
            </h3>
            {into.length === 0 ? (
              <p className="at-label">Nothing in the model reaches it. It is an entry point.</p>
            ) : (
              into.map((edge) => <Link key={`${edge.from}-${edge.kind}`} id={edge.from} kind={edge.kind} note={edge.note} nav={nav} />)
            )}
          </section>

          <section className="at-block">
            <h3 className="at-block-head">
              What it reaches <span className="at-fig">{out.length}</span>
            </h3>
            {out.length === 0 ? (
              <p className="at-label">Nothing. It bottoms out here.</p>
            ) : (
              out.map((edge) => <Link key={`${edge.to}-${edge.kind}`} id={edge.to} kind={edge.kind} note={edge.note} nav={nav} />)
            )}
          </section>

          <section className="at-block">
            <h3 className="at-block-head">
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
        <span className="at-part-name">{other.name}</span>{" "}
        <span className="at-part">{layer?.name}</span>
      </span>
      <span className="at-link-note">{note}</span>
    </button>
  );
}
