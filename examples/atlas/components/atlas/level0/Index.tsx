"use client";

/**
 * L0 — the index plate: what this repository claims, over what it is made of.
 *
 * Two regions on one sheet. The concept index is the population; the six-band stack is the
 * machine. Choosing a concept does NOT change level — it sets the lens, and the stack marks up in
 * place, which is the whole argument of this level: the claim and the machine are the same
 * drawing.
 *
 * `echo` renders the same markup inert and ID-FREE (formula §1 rule 1 and rule 2): the outgoing
 * copy must drop its `layoutId`s in the same commit the arriving layer claims them, or there are
 * two claimants for one id and motion animates neither.
 */
import { motion } from "motion/react";
import { presenceOf, sharedIdentity, type ZoomNav } from "@athena/demo-kit/zoom";

import { CONCEPTS, LAYERS, componentsOfLayer, litInLayer, systemsOf, type Lens } from "@/data";

import { bandId, useAtlasMotion } from "../motion";

export function Index({
  nav,
  lens,
  setLens,
  echo = false,
}: {
  nav: ZoomNav;
  lens: Lens;
  setLens: (id: string | null) => void;
  echo?: boolean;
}) {
  const m = useAtlasMotion();
  const focus = nav.state.focus;
  const marked = nav.state.highlight;

  return (
    <div className="at-l0">
      <section className="at-l0-head">
        <h1 className="at-l0-title">Six layers, seventeen claims</h1>
        <p className="at-prose">
          What this repository is made of, and what it claims. Choose a claim and every layer marks
          up with how many of its components carry it; open a layer to compare its systems.
        </p>
      </section>

      {/* ----------------------------------------------------------- the stack -- */}
      <section>
        <h2 className="at-label" id="at-stack-head">
          The stack &mdash; README &sect;3.1, surfaces at the top
        </h2>
        <ul className="at-stack" aria-labelledby="at-stack-head">
          {LAYERS.map((layer, i) => {
            /*
             * Rule 2: the band holds the layer's shared id while L0 is the live level. The L1
             * head takes it in the same commit, and the key flips with ownership so motion
             * re-reads the id — it reads `layoutId` only at mount.
             */
            const box = sharedIdentity(bandId(layer.id), !echo && focus.level === 0);
            const systems = systemsOf(layer.id);
            const parts = componentsOfLayer(layer.id);
            const lit = litInLayer(lens, layer.id);
            const Box = echo ? "div" : "button";
            return (
              <motion.li
                key={box.key}
                layoutId={box.layoutId}
                /* Spread, not passed straight in: the kit's `Presence` is an `interface`, and an
                   interface has no implicit index signature, so motion's `Target` rejects it.
                   (KIT-GAPS.md, 2026-09-14, #1 — the template does this and would not typecheck.) */
                animate={{ ...presenceOf(focus, layer.id) }}
                transition={m.move}
              >
                <Box
                  {...(echo
                    ? {}
                    : {
                        type: "button" as const,
                        onClick: () => nav.openGroup(layer.id),
                        ...(i === 0 ? { "data-arrival": "" } : {}),
                      })}
                  className="at-band"
                  data-layer={layer.id}
                >
                  <span className="at-band-name">{layer.name}</span>
                  <span className="at-band-blurb">{layer.blurb}</span>
                  <span className="at-band-figs">
                    <span className="at-fig">
                      {systems.length} sys &middot; {parts.length} parts
                    </span>
                    {lens.concept ? (
                      <span className="at-band-lit">
                        <span className="at-band-bar" aria-hidden>
                          <i style={{ width: `${(lit / Math.max(1, parts.length)) * 100}%` }} />
                        </span>
                        <span>
                          {lit} lit
                          <span className="sr-only">
                            {" "}
                            by {lens.concept.name} in {layer.name}
                          </span>
                        </span>
                      </span>
                    ) : null}
                  </span>
                </Box>
              </motion.li>
            );
          })}
        </ul>
      </section>
      {/* ---------------------------------------------------------- the index -- */}
      <section>
        <h2 className="at-label" id="at-index-head">
          The index &mdash; what this repository claims
        </h2>
        <ul className="at-index" aria-labelledby="at-index-head">
          {CONCEPTS.map((concept) => {
            const lit = marked.has(concept.id) || lens.concept?.id === concept.id;
            const Box = echo ? "div" : "button";
            return (
              <li key={concept.id}>
                <Box
                  {...(echo ? {} : { type: "button" as const, onClick: () => setLens(concept.id) })}
                  className="at-cell at-concept"
                  data-kind={concept.kind}
                  data-lit={lit ? "true" : "false"}
                  {...(echo ? {} : { "aria-pressed": lit })}
                >
                  <span className="at-row">
                    <span className="at-part">{concept.part}</span>
                    <span className="at-part">{concept.kind}</span>
                  </span>
                  <span className="at-name">{concept.name}</span>
                  <span className="at-concept-claim">{concept.claim}</span>
                  <span className="at-cite">
                    <span>{concept.source}</span>
                  </span>
                </Box>
              </li>
            );
          })}
        </ul>
      </section>

    </div>
  );
}
