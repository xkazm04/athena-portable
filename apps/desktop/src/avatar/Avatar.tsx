/**
 * `<Avatar>` - Athena's face on any surface. CONTRACT STUB: the props are final; WP-1 replaces the
 * body with the WebGL2 layer rig (lazy chunk, one loop, still in calm mode).
 */
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
}

export function Avatar({ avatar, size, label, className }: AvatarProps) {
  return (
    <div
      className={className}
      role="img"
      aria-label={label ?? "Athena"}
      data-avatar={avatar}
      style={{ width: size, height: size }}
    />
  );
}
