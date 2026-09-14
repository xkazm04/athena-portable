"use client";

/**
 * L1 — one layer, its systems laid side by side, and what it connects to.
 *
 * The head is the band the reader opened, arrived at its final size: it claims the layer's shared
 * id (rule 2) and it is the only thing that travels. The columns arrive AFTER it has landed —
 * `m.inkIn` is delayed by a whole `move`, which is rule 3 (box, then ink) in one prop.
 *
 * Edges are drawn in the MARGIN, never across the plate: `up` on the left, `down` on the right,
 * so an edge running the wrong way up README §3.1's stack would show as a tick on the wrong side.
 * Both rails are derived from the component edges in `data/edges.ts`; there is no second list.
 */
import { motion } from "motion/react";
import { presenceOf, sharedIdentity, type ZoomNav } from "@athena/demo-kit/zoom";

import {
  componentsOf,
  componentsOfLayer,
  layerById,
  layerLinks,
  litIn,
  systemsOf,
  type Lens,
} from "@/data";

import { bandId, partId, useAtlasMotion } from "../motion";

export function Layer({
  layerId,
  nav,
  lens,
  echo = false,
}: {
  layerId: string | null;
  nav: ZoomNav;
  lens: Lens;
  echo?: boolean;
}) {
  const m = useAtlasMotion();
  const focus = nav.state.focus;
  const marked = nav.state.highlight;
  const layer = layerById(layerId);
  if (!layer) return null;

  const systems = systemsOf(layer.id);
  const parts = componentsOfLayer(layer.id);
  const links = layerLinks(layer.id);
  /* The head owns the band's id unless this is the outgoing copy — one claimant, always. */
  const box = sharedIdentity(bandId(layer.id), !echo);

  return (
    <div className="at-l1">
      <motion.div
        key={box.key}
        layoutId={box.layoutId}
        className="at-l1-head"
        transition={m.move}
        {...(echo ? {} : { tabIndex: -1, "data-arrival": "" })}
      >
        <div>
          <h1 className="at-l1-title">{layer.name}</h1>
          <p className="at-l1-blurb">{layer.blurb}</p>
        </div>
        <div className="at-band-figs">
          <span className="at-fig">
            {systems.length} systems &middot; {parts.length} components
          </span>
          {lens.concept ? (
            <span className="at-band-lit">
              {parts.reduce((n, c) => n + (lens.components.has(c.id) ? 1 : 0), 0)} lit by{" "}
              {lens.concept.part}
            </span>
          ) : null}
        </div>
      </motion.div>

      {/* Rule 3: the ink waits for the box. One delayed transition, not a chain of timers. */}
      <motion.div
        className="at-l1-body"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={m.inkIn}
      >
        <aside>
          <p className="at-edges-title">Reaches up</p>
          <ul className="at-edges">
            {links.up.length === 0 ? (
              <li className="at-edge-none">nothing above</li>
            ) : (
              links.up.map((l) => (
                <li key={l.layer} className="at-edge at-edge-up">
                  <span>{l.layer}</span>
                  <span className="at-fig">{l.weight}</span>
                </li>
              ))
            )}
          </ul>
        </aside>

        <ul className="at-systems">
          {systems.map((system) => {
            const members = componentsOf(system.id);
            const litHere = litIn(lens, system.id);
            return (
              <li
                key={system.id}
                className="at-system"
                data-lit={marked.has(system.id) ? "true" : "false"}
                data-status={system.status}
              >
                <div>
                  <span className="at-row">
                    <span className="at-part">{system.part}</span>
                    <span className="at-fig">
                      {members.length}
                      {lens.concept && litHere > 0 ? ` · ${litHere} lit` : ""}
                    </span>
                  </span>
                  <p className="at-system-name">{system.name}</p>
                  <p className="at-system-blurb">{system.blurb}</p>
                  <p className="at-cite">
                    <span>{system.home}</span>
                  </p>
                </div>

                <ul className="at-parts">
                  {members.map((component) => {
                    /*
                     * Rule 2 again, one level down: the row holds the component's id unless the
                     * pane has it. `sharedIdentity` (the pure function) inside a list, the hook
                     * for the single element in `level2/Pane.tsx`.
                     */
                    const rowBox = sharedIdentity(
                      partId(component.id),
                      !echo && focus.item !== component.id,
                    );
                    return (
                      <motion.li
                        key={rowBox.key}
                        layoutId={rowBox.layoutId}
                        /* Rule 7: presence comes from the model. The group is the layer and the
                           item is the component, exactly as `emphasis()` takes them — so opening
                           a component recedes its siblings without this file deciding by how much. */
                        animate={{ ...presenceOf(focus, layer.id, component.id) }}
                        transition={m.move}
                      >
                        {echo ? (
                          <div className="at-part-row">
                            <span className="at-part-name">{component.name}</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="at-part-row"
                            data-component={component.id}
                            data-lit={marked.has(component.id) ? "true" : "false"}
                            data-open={focus.item === component.id ? "true" : "false"}
                            data-status={component.status}
                            onClick={() => nav.openItem(layer.id, component.id)}
                          >
                            <span className="at-row">
                              <span className="at-part">{component.part}</span>
                              {component.status === "planned" ? (
                                <span className="at-part">planned</span>
                              ) : null}
                            </span>
                            <span className="at-part-name">{component.name}</span>
                            <span className="at-cite">
                              <span>{component.file}</span>
                            </span>
                          </button>
                        )}
                      </motion.li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>

        <aside>
          <p className="at-edges-title">Depends on</p>
          <ul className="at-edges">
            {links.down.length === 0 ? (
              <li className="at-edge-none">nothing below &mdash; contracts import nothing</li>
            ) : (
              links.down.map((l) => (
                <li key={l.layer} className="at-edge at-edge-down">
                  <span>{l.layer}</span>
                  <span className="at-fig">{l.weight}</span>
                </li>
              ))
            )}
          </ul>
        </aside>
      </motion.div>
    </div>
  );
}
