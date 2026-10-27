/**
 * The water a skin draws for itself — README section 3.1, ADR 0142. One lazy chunk for every skin
 * that has a layer of its own (Loop Tide's current, Wavefront's field), so the first frame carries a
 * single loader for them, not one per skin.
 */
import type { Pose } from "@/bell/pose";
import type { Move } from "@/depth/model";
import type { Skin } from "@/stores/shell";

import LoopCurrent from "./LoopCurrent";
import WavefrontField from "./WavefrontField";

export default function SkinWater({ skin, ...water }: { skin: Skin; pose: Pose; move: Move; seq: number; calm: boolean }) {
  if (skin === "loop-tide") return <LoopCurrent {...water} />;
  if (skin === "wavefront") return <WavefrontField {...water} />;
  return null;
}
