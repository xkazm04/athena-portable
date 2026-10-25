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
import { Component, createRef, memo, useEffect, useReducer, useRef, useState, type ReactNode } from "react";

import {
  ROOT_LABEL,
  ROOTS,
  crumbs,
  depthOf,
  formatHash,
  riseLabel,
  shapeOf,
  type DepthState,
  type Labeller,
  type Path,
} from "@/depth/model";

import Bell from "@/bell/Bell";
import type { Pose } from "@/bell/pose";

import Backdrop from "./Backdrop";
import { initLayers, isLive, isSettled, reduceLayers, type Layer } from "./layers";
import type { Still } from "./still";
import "./stage.css";

export interface Presence {
  /** How she is carrying herself; the dock's bell wears it (`bell/pose.ts`). */
  pose: Pose;
  text: string;
  /** Cards waiting on the person. */
  waiting: number;
  /** A chore that came due (ADR 0131): one line in the dock beside her, never a window over the work. */
  notice?: ReactNode;
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

/**
 * How a leaving layer's still is taken (ADR 0193). Not first-frame code: it is fetched once the stage
 * has drawn, long before a person's first move. A move before it lands leaves its layer empty.
 */
let stills: typeof import("./still") | null = null;

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
    void import("./still").then((m) => (stills = m));
  }, []);
  useEffect(() => {
    if (settled && state.from !== null) onSettle(state.seq);
  }, [settled, state.from, state.seq, onSettle]);

  // A stuck move is flushed, so a ghost layer cannot outlive a window that played no animation.
  useEffect(() => {
    if (settled) return;
    const t = setTimeout(() => dispatch({ type: "flush" }), SAFETY_MS);
    return () => clearTimeout(t);
  }, [settled, state.seq]);

  // ---- Escape rises, last: on the window, so it hears the key after every scene's own document
  // listener (a topic's lightbox, a studio's "drop your draft?"). The stage is mounted first, so on
  // the document it would always hear the key first and rise before a scene could claim it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (escapeRises({ key: e.key, defaultPrevented: e.defaultPrevented, targetIsTyping: isTyping(e.target) })) {
        e.preventDefault();
        onRise();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
      {shape === "scene" && (
        <Backdrop depth={depth} move={state.move} seq={state.seq} calm={calm} pose={presence.pose} />
      )}

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
        {/* At the surface there is no crumb, so the space stays (and drags the window) but names no
            landmark: an empty navigation is a stop in a screen reader's list that leads nowhere. */}
        {trail.length === 1 ? (
          <div className="stage__crumbs" data-tauri-drag-region />
        ) : (
          <nav className="stage__crumbs" aria-label="Where you are" data-tauri-drag-region>
            {trail.slice(1).map((c, i, rest) => (
              // Keyed by the place it names: a crumb whose place changed (an across move) is a new
              // crumb and fades in with the move, as a dive's new crumb does; one that still names
              // the same place stays put.
              <span key={formatHash(c.path)} className="stage__crumb">
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
        )}
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
                {isLive(l) && <SceneOf path={l.path} render={renderScene} />}
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
              {presence.notice}
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

/**
 * A layer's scene, drawn again only when its place or the way scenes are drawn changes. The chrome
 * around it re-renders the stage on every change of her presence, a tab or a crumb name, and a scene
 * reads its own stores; without this each of those redrew every layer's whole view.
 */
const SceneOf = memo(function SceneOf({ path, render }: { path: Path; render: (path: Path) => ReactNode }) {
  return <>{render(path)}</>;
});

interface LayerProps {
  layer: Layer;
  isTop: boolean;
  topRef: React.RefObject<HTMLElement | null>;
  onEnded: () => void;
  children: ReactNode;
}

/**
 * One layer of a move. Only a live layer (arriving or at rest) holds its scene. When a move turns it
 * into a leaving layer, its scene is unmounted in that same commit, so its effects, listeners and
 * loops end at the move's start, not at its animationend (ADR 0193). What plays out instead is a
 * still: `getSnapshotBeforeUpdate` copies the layer's DOM before React removes the scene, and the
 * copy is put back before the frame is painted. A class, because that hook is the one moment React
 * offers between a render that drops the scene and the DOM losing it.
 */
class SceneLayer extends Component<LayerProps> {
  private readonly self = createRef<HTMLElement>();

  override getSnapshotBeforeUpdate(prev: LayerProps): Still | null {
    const el = this.self.current;
    return stills && el && isLive(prev.layer) && !isLive(this.props.layer) ? stills.captureStill(el) : null;
  }

  override componentDidUpdate(_prev: LayerProps, _state: unknown, still: Still | null) {
    const el = this.self.current;
    if (!still || !el || !stills) return;
    stills.showStill(el, still);
  }

  private readonly attach = (el: HTMLElement | null) => {
    this.self.current = el;
    if (this.props.isTop) this.props.topRef.current = el;
  };

  private readonly onAnimationEnd = (e: React.AnimationEvent) => {
    if (e.target === e.currentTarget) this.props.onEnded(); // not a child's own animation
  };

  override render() {
    const { layer, isTop, children } = this.props;
    const leaving = !isLive(layer);
    return (
      <section
        ref={this.attach}
        className="stage__layer"
        data-phase={layer.phase}
        data-depth={depthOf(layer.path)}
        tabIndex={isTop ? -1 : undefined}
        aria-hidden={leaving || undefined}
        inert={leaving || undefined}
        onAnimationEnd={this.onAnimationEnd}
      >
        {children}
      </section>
    );
  }
}
