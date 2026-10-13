/**
 * The stage — README section 3.1 and 3.5, ADR 0087, 0088 and 0089.
 *
 * Everything that stays while the depth changes: the water (`Backdrop`), the way back (Rise, the
 * breadcrumb, Escape), where you are (the gauge), and Athena one click away (the dock). Between
 * them sits the scene host, which plays a move as two layers (`layers.ts`). A view like the
 * modules' own: a pure function of props, no store, no Tauri, so the preview harness renders it
 * and a test can drive it. `Live` wiring belongs to the app root.
 *
 * Two shapes (ADR 0088). `scene` owns the window. `page` is the thin band above a native page
 * webview: the water, the gauge, the scenes and the dock are not drawn, because Rust has clipped
 * this document to the band and a page lives below it.
 *
 * Escape is the one way back. It rises a level, it is never a way to close the window, and it
 * leaves a text field to the field's own Escape.
 */
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";

import {
  ROOT_LABEL,
  ROOTS,
  crumbs,
  depthOf,
  riseLabel,
  shapeOf,
  type DepthState,
  type Labeller,
  type Path,
} from "@/depth/model";

import Bell from "@/bell/Bell";
import type { Pose } from "@/bell/pose";

import Backdrop from "./Backdrop";
import { initLayers, isSettled, reduceLayers, type Layer } from "./layers";
import "./stage.css";

export interface Presence {
  /** How she is carrying herself; the dock's bell wears it (`bell/pose.ts`). */
  pose: Pose;
  text: string;
  /** Cards waiting on the person. */
  waiting: number;
}

export interface StageProps {
  state: DepthState;
  renderScene: (path: Path) => ReactNode;
  label?: Labeller;
  presence: Presence;
  calm: boolean;
  onGo: (to: Path) => void;
  onRise: () => void;
  onSurface: () => void;
  onSettle: (seq: number) => void;
  /**
   * In the page shape, the second row of the band above the page: the tab strip, the address
   * field and the tools indicator (the 40 px `--strip-height` that `layout.rs` reserves).
   */
  band?: ReactNode;
  /** Right-hand controls (a note, the window buttons). Anything that must stay out of the way. */
  trailing?: ReactNode;
}

/** A move that never ends (a hidden window plays no animation events) is settled after this. */
const SAFETY_MS = 900;

/** Should this key press rise a level? Pure, so the rule is testable without a DOM. */
export function escapeRises(e: { key: string; defaultPrevented: boolean; targetIsTyping: boolean }): boolean {
  return e.key === "Escape" && !e.defaultPrevented && !e.targetIsTyping;
}

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

export default function Stage(props: StageProps) {
  const { state, renderScene, label, presence, calm, onGo, onRise, onSurface, onSettle, band, trailing } = props;
  const shape = shapeOf(state.path);
  const depth = depthOf(state.path);

  // ---- layers: derived during render so a new move never shows a frame of the old one
  const [layers, dispatch] = useReducer(reduceLayers, undefined, () => initLayers(state.path, state.seq));
  const [seen, setSeen] = useState(state.seq);
  if (seen !== state.seq) {
    setSeen(state.seq);
    dispatch({ type: "move", seq: state.seq, path: state.path, move: state.move, calm });
  }

  const settled = isSettled(layers);
  useEffect(() => {
    if (settled && state.from !== null) onSettle(state.seq);
  }, [settled, state.from, state.seq, onSettle]);

  // A stuck move is flushed, so a ghost layer cannot outlive a window that played no animation.
  useEffect(() => {
    if (settled) return;
    const t = setTimeout(() => dispatch({ type: "flush" }), SAFETY_MS);
    return () => clearTimeout(t);
  }, [settled, state.seq]);

  // ---- Escape rises
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (escapeRises({ key: e.key, defaultPrevented: e.defaultPrevented, targetIsTyping: isTyping(e.target) })) {
        e.preventDefault();
        onRise();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onRise]);

  // ---- focus follows the move, so a keyboard user is never left on a layer that went away
  const top = useRef<HTMLElement>(null);
  useEffect(() => {
    if (state.seq > 0 && shape === "scene") top.current?.focus({ preventScroll: true });
  }, [state.seq, shape]);

  const trail = crumbs(state.path, label);
  const rise = riseLabel(state.path, label);

  return (
    <div
      className="stage"
      data-depth={depth}
      data-shape={shape}
      data-move={state.move}
      data-pose={presence.pose}
    >
      {shape === "scene" && <Backdrop depth={depth} move={state.move} seq={state.seq} calm={calm} />}

      {/* Where you are, said once per move. The scenes are not a live region: a whole scene read out
          on every change is noise, and a person who has just dived wants to hear the place. */}
      <p className="stage__announce" role="status" aria-live="polite">
        {trail.map((c) => c.label).join(", ")}
      </p>

      <header className="stage__top" data-tauri-drag-region>
        {rise !== null && (
          <button type="button" className="stage__rise focus-ring" onClick={onRise}>
            <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
              <path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>
              Rise to <b>{rise}</b>
            </span>
          </button>
        )}
        <button type="button" className="stage__brand focus-ring" onClick={onSurface} aria-label="Athena, back to the surface">
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
            <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="var(--primary)" />
            <g fill="none" stroke="var(--primary-fg)" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8.6 24.4 16 7.4l7.4 17" />
              <path d="M11.9 19.2l3.2 3 5.2-6.2" strokeWidth="2.3" />
            </g>
          </svg>
          <span>Athena</span>
        </button>
        <nav className="stage__crumbs" aria-label="Where you are" data-tauri-drag-region>
          {trail.length > 1 &&
            trail.slice(1).map((c, i, rest) => (
              <span key={c.depth} className="stage__crumb">
                <span aria-hidden="true">/</span>
                {i === rest.length - 1 ? (
                  <b aria-current="location">{c.label}</b>
                ) : (
                  <button type="button" className="focus-ring" onClick={() => onGo(c.path)}>
                    {c.label}
                  </button>
                )}
              </span>
            ))}
        </nav>
        <div className="stage__trailing">{trailing}</div>
      </header>

      {shape === "page" && band !== undefined && <div className="stage__band">{band}</div>}

      {shape === "scene" && (
        <>
          <aside className="stage__gauge" aria-hidden="true">
            <div className="stage__rail">
              {[0, 1, 2, 3].map((d) => (
                <i key={d} data-reached={d <= depth} />
              ))}
              <b />
            </div>
          </aside>

          <main className="stage__scenes">
            {layers.map((l, i) => (
              <SceneLayer
                key={l.key}
                layer={l}
                isTop={i === layers.length - 1}
                topRef={top}
                onEnded={() => dispatch({ type: "ended", key: l.key })}
              >
                {renderScene(l.path)}
              </SceneLayer>
            ))}
          </main>

          {depth > 0 && (
            <footer className="stage__dock">
              <button type="button" className="stage__dock-athena focus-ring" onClick={onSurface}>
                <span className="stage__dock-bell">
                  <Bell pose={presence.pose} reach={[]} size={34} />
                </span>
                <span>
                  <b>Athena</b>
                  <small>{presence.text}</small>
                </span>
                {presence.waiting > 0 && <em>{presence.waiting} waiting</em>}
              </button>
              <nav className="stage__roots" aria-label="Depths">
                {ROOTS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className="focus-ring"
                    aria-current={state.path.root === r ? "true" : undefined}
                    onClick={() => onGo({ root: r })}
                  >
                    {ROOT_LABEL[r]}
                  </button>
                ))}
              </nav>
            </footer>
          )}
        </>
      )}
    </div>
  );
}

function SceneLayer({
  layer,
  isTop,
  topRef,
  onEnded,
  children,
}: {
  layer: Layer;
  isTop: boolean;
  topRef: React.RefObject<HTMLElement | null>;
  onEnded: () => void;
  children: ReactNode;
}) {
  const leaving = layer.phase.startsWith("leave-");
  const onAnimationEnd = (e: React.AnimationEvent) => {
    if (e.target === e.currentTarget) onEnded(); // not a child's own animation
  };
  return (
    <section
      ref={isTop ? (topRef as React.RefObject<HTMLElement>) : undefined}
      className="stage__layer"
      data-phase={layer.phase}
      data-depth={depthOf(layer.path)}
      tabIndex={isTop ? -1 : undefined}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
      onAnimationEnd={onAnimationEnd}
    >
      {children}
    </section>
  );
}
