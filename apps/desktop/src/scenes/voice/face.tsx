/**
 * Her figure in the Voice depth, and the picker for it (the ADR on Athena's face).
 *
 * With the halo chosen she is the Bell, exactly as before. With a face chosen, the face stands in the
 * Bell's slot at the Bell's size, fed by her live face from her own window (`mainFaceSource`), except
 * in the studio while a preview plays: that voice plays in Main, so the face follows the preview's
 * own level (`previewFaceSource`). One figure per place, so Main draws at most one face at a time.
 */
import { useState } from "react";

import { Avatar } from "@/avatar/Avatar";
import type { AvatarId, FaceSource } from "@/avatar/types";
import Bell, { type Reach } from "@/bell/Bell";
import type { Pose } from "@/bell/pose";
import PillGroup from "@/components/PillGroup";
import { mainFaceSource, previewFaceSource } from "@/lib/face";
import type { VoiceModel } from "@/modules/voice/model";
import { FACE_CHOICES } from "@/scenes/waking/faces";

export interface HerProps {
  avatar: AvatarId;
  pose: Pose;
  reach: readonly Reach[];
  size: number;
  lean?: number;
  /** Where a face reads from; ignored for the halo. */
  source: FaceSource;
}

/** The Bell for the halo, her face for anything else, in the same slot and size; the Bell again where the face cannot draw. */
export function Her({ avatar, pose, reach, size, lean = 0, source }: HerProps) {
  const bell = <Bell pose={pose} reach={reach} lean={lean} size={size} label="Athena" />;
  if (avatar === "halo") return bell;
  return <Avatar avatar={avatar} size={size} source={source} className="vsc-face" fallback={bell} />;
}

/** Her live face, as her own window mirrors it to Main. Made once per mount. */
export function useMainFace(): FaceSource {
  const [source] = useState(mainFaceSource);
  return source;
}

/**
 * The studio's face: the preview's while one plays (its level, `speaking`), her live face otherwise.
 * The player is read through the model's meters, which are the store's own functions over the one
 * preview player: a clip plays exactly while the player has a spectrum to give.
 */
export function useStudioFace(model: VoiceModel): FaceSource {
  const { meters } = model;
  const main = useMainFace();
  const [preview] = useState(() =>
    previewFaceSource({ level: () => meters.level(), playing: () => meters.spectrum() !== null }),
  );
  return model.preview.phase === "playing" ? preview : main;
}

/** How she appears, from Voice settings: the same three choices as the first act's Face step. */
export function FacePicker({ avatar, onAvatar }: { avatar: AvatarId; onAvatar: (next: AvatarId) => void }) {
  return (
    <PillGroup
      ariaLabel="How she appears"
      value={avatar}
      onChange={onAvatar}
      options={FACE_CHOICES.map((c) => ({ value: c.id, label: c.label }))}
    />
  );
}
