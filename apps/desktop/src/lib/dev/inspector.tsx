/**
 * The dev inspector — README section 3.1 (surfaces), ADR 0086.
 *
 * Click a component, copy its source path. Ctrl+Shift+L (or `;` then `i`) arms it: the cursor
 * becomes a crosshair, hover outlines the element and names its source, and a right-click copies
 * the call site as `src/.../File.tsx:LINE`. Alt+right-click copies the literal element and a row
 * in the HUD copies that enclosing file. Left-click is left alone so the app stays usable while
 * armed. Esc disarms.
 *
 * It is mounted by both windows behind `import.meta.env.DEV`, so a build drops it. Without
 * `ATHENA_INSPECTOR=1` there are no stamps and the HUD says how to relaunch.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import {
  buildChain,
  dedupeChain,
  isLibraryPath,
  isTypingTarget,
  pickDefaultIndex,
  type LocEntry,
} from "./locate";

const Z = 2147483646;
const CHORD_MS = 1500;
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

interface Hover {
  chain: LocEntry[];
  pointer: DOMRect;
  target: DOMRect;
  defaultIndex: number;
}

const box = (r: DOMRect, solid: boolean): CSSProperties => ({
  position: "fixed",
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
  boxSizing: "border-box",
  border: `${solid ? 2 : 1}px ${solid ? "solid" : "dashed"} ${solid ? "var(--accent)" : "var(--status-pending)"}`,
  background: solid ? "var(--wash)" : "transparent",
  borderRadius: 3,
  pointerEvents: "none",
});

export default function Inspector() {
  const [armed, setArmed] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const [copied, setCopied] = useState<{ loc: string; ok: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const chord = useRef(0);

  const copy = useCallback(async (loc: string) => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(loc);
    } catch {
      ok = false;
    }
    setCopied({ loc, ok });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1800);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setArmed((a) => !a);
        return;
      }
      if (e.key === "Escape") return setArmed(false);
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === ";") chord.current = Date.now();
      else if (e.key.toLowerCase() === "i" && Date.now() - chord.current < CHORD_MS) {
        chord.current = 0;
        setArmed((a) => !a);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (!armed) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = "crosshair";
    const inHud = (t: EventTarget | null) =>
      t instanceof Element && t.closest("[data-inspector]") !== null;
    const onMove = (e: MouseEvent) => {
      if (inHud(e.target)) return;
      const chain = buildChain(e.target as Element | null);
      const first = chain[0];
      if (!first) return setHover(null);
      const di = pickDefaultIndex(chain);
      setHover({
        chain,
        pointer: first.el.getBoundingClientRect(),
        target: (chain[di] ?? first).el.getBoundingClientRect(),
        defaultIndex: di,
      });
    };
    const onContext = (e: MouseEvent) => {
      if (inHud(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const chain = buildChain(e.target as Element | null);
      const first = chain[0];
      if (!first) return;
      void copy((e.altKey ? first : (chain[pickDefaultIndex(chain)] ?? first)).loc);
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("contextmenu", onContext, true);
    return () => {
      document.body.style.cursor = prev;
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("contextmenu", onContext, true);
      setHover(null);
    };
  }, [armed, copy]);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!armed) return null;

  const mapped = document.querySelector("[data-loc]") !== null;
  const picked = hover?.chain[hover.defaultIndex]?.loc ?? null;
  const crumbs = hover ? dedupeChain(hover.chain) : [];
  const headColor = copied
    ? copied.ok
      ? "var(--status-success)"
      : "var(--status-error)"
    : "var(--accent)";

  return createPortal(
    <div data-inspector style={{ position: "fixed", inset: 0, zIndex: Z, pointerEvents: "none" }}>
      {hover && hover.defaultIndex !== 0 && <div style={box(hover.pointer, false)} />}
      {hover && <div style={box(hover.target, true)} />}
      {hover && picked && (
        <div
          style={{
            position: "fixed",
            left: Math.max(4, Math.min(hover.pointer.left, window.innerWidth - 260)),
            top: hover.pointer.top > 22 ? hover.pointer.top - 20 : hover.pointer.top + 2,
            padding: "1px 6px",
            borderRadius: 4,
            font: `700 11px/1.4 ${MONO}`,
            whiteSpace: "nowrap",
            color: "var(--primary-fg)",
            background: "var(--accent)",
          }}
        >
          {picked.slice(picked.lastIndexOf("/") + 1)}
        </div>
      )}
      <div
        data-inspector
        style={{
          position: "fixed",
          left: 12,
          bottom: 12,
          maxWidth: 460,
          pointerEvents: "auto",
          padding: "8px 10px",
          font: `12px/1.5 ${MONO}`,
          color: "var(--foreground)",
          background: "var(--card-bg)",
          border: "1px solid var(--line-strong)",
          borderRadius: 8,
          boxShadow: "var(--shadow-elevation-1)",
        }}
      >
        <div style={{ fontWeight: 700, color: headColor }}>
          {copied ? (copied.ok ? "Copied" : "Copy failed") : "Inspector"}
        </div>
        {copied ? (
          <div style={{ wordBreak: "break-all" }}>{copied.loc}</div>
        ) : !mapped ? (
          <div style={{ color: "var(--status-warning)" }}>
            Source mapping is off. Relaunch with <b>pnpm tauri:inspect</b>.
          </div>
        ) : crumbs.length ? (
          crumbs.map((c, i) => (
            <button
              key={`${c.loc}-${i}`}
              type="button"
              onClick={() => void copy(c.loc)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                cursor: "pointer",
                font: "inherit",
                wordBreak: "break-all",
                border: "none",
                borderRadius: 4,
                padding: "2px 4px",
                color: isLibraryPath(c.path) ? "var(--muted)" : "var(--foreground)",
                background: c.loc === picked ? "var(--wash)" : "transparent",
              }}
            >
              {c.loc}
            </button>
          ))
        ) : (
          <div style={{ color: "var(--muted)" }}>Hover a component</div>
        )}
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
          right-click: call site · Alt+right-click: this element · click a row · Esc: exit
        </div>
      </div>
    </div>,
    document.body,
  );
}
