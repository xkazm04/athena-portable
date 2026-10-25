/**
 * Her face on the surface (the ADR on Athena's face), fed by her live face from her own window.
 *
 * Its own chunk, fetched only when a face is chosen: the surface is the first frame Main draws, and
 * the face's signal plumbing (`lib/face`) is no part of that frame for the person who keeps the halo
 * (ADR 0095's first-paint budget). Until it arrives the Bell stays where it is, and where the face
 * cannot draw the Bell comes back (`fallback`), so her slot is never an empty box.
 */
import { useState, type ReactNode } from "react";

import { Avatar } from "@/avatar/Avatar";
import type { FaceAvatarId } from "@/avatar/types";
import { mainFaceSource } from "@/lib/face";

export default function SurfaceFace({
  avatar,
  size,
  label,
  fallback,
}: {
  avatar: FaceAvatarId;
  size: number;
  label: string;
  fallback?: ReactNode;
}) {
  // Made once, subscribed only while the face is drawn.
  const [source] = useState(mainFaceSource);
  return <Avatar avatar={avatar} size={size} source={source} label={label} className="surface__face" fallback={fallback} />;
}
