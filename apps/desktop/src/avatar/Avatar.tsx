/**
 * `<Avatar>` - Athena's face on any surface (ADR 0120, "Athena has a face").
 *
 * A box of `size` CSS pixels holding one canvas. Everything that draws is in `./runtime`, imported
 * with `import()` when the first avatar mounts, so a window that shows no face pays nothing for one
 * and a window that does pays after its first paint. Until the form's layers are decoded the box is
 * empty and transparent. When WebGL2 is not there, or the form cannot load, the runtime says why
 * once in the console and the box shows `fallback` in place of the canvas (the Bell, the seal): one
 * state change when the face is found unavailable, so nobody gets a blank where she stood. Without
 * a fallback the box stays empty. The face never re-renders React otherwise: signals go from
 * `source` straight to the runtime.
 * `data-face` on the box reads loading | ready | unavailable, `data-face-loop` running | still.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { FaceAvatarId, FaceSource } from "./types";

export interface AvatarProps {
  /** Which rigged form to draw. A surface whose setting is "halo" renders no Avatar at all. */
  avatar: FaceAvatarId;
  /** Square-ish box the face is fitted into, in CSS pixels (width; height follows the art). */
  size: number;
  /** Where the face signal comes from. */
  source: FaceSource;
  /** Accessible label; the default names her form. */
  label?: string;
  className?: string;
  /** What stands in the box when the face cannot draw here; it carries its own label. */
  fallback?: ReactNode;
}

const FORM_NAMES: Record<FaceAvatarId, string> = {
  "b04-owl": "Athena, an owl of light",
  "d08-origami": "Athena, an origami figure of light",
};

type Handle = { resize(size: number): void; dispose(): void };

export function Avatar({ avatar, size, source, label, className, fallback }: AvatarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<Handle | null>(null);
  const sizeRef = useRef(size);
  // The form found not to draw here; a different form gets its own try.
  const [failed, setFailed] = useState<FaceAvatarId | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    let cancelled = false;
    const onUnavailable = () => {
      if (!cancelled) setFailed(avatar);
    };
    import("./runtime").then(
      ({ startFace }) => {
        if (cancelled) return;
        handleRef.current = startFace({ root, canvas, avatar, source, size: sizeRef.current, onUnavailable });
      },
      (error: unknown) => {
        root.setAttribute("data-face", "unavailable");
        console.warn(`[athena] her face is not drawn here: the runtime did not load (${String(error)}).`);
        onUnavailable();
      },
    );
    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [avatar, source]);

  useEffect(() => {
    sizeRef.current = size;
    handleRef.current?.resize(size);
  }, [size]);

  if (failed === avatar && fallback !== undefined) {
    return (
      <div className={className} data-avatar={avatar} data-face="unavailable" style={{ width: size, position: "relative" }}>
        {fallback}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={className}
      role="img"
      aria-label={label ?? FORM_NAMES[avatar]}
      data-avatar={avatar}
      data-face="loading"
      style={{ width: size, height: size, position: "relative" }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ display: "block", width: "100%", height: "100%", visibility: "hidden", background: "transparent" }}
      />
    </div>
  );
}
