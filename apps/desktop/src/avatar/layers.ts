/**
 * A form's layers - ADR 0120 ("Athena has a face"), assets.
 *
 * Each rigged form ships as `public/avatars/<id>/layers.json` plus its PNGs, the glow-being split
 * the spike's prep made (spikes/avatar/t1-rig/prep/split_glow.py): a static backplate, the body,
 * the head, floating parts, eye lights, a seam, and for the origami a hinged aperture. The file is
 * read as it is; this module names the parts of it the renderer uses and fetches the pictures.
 */
import type { FaceAvatarId } from "./types";

export type LayerKind =
  | "static"
  | "body"
  | "head"
  | "float"
  | "eye"
  | "seam"
  | "aperture_upper"
  | "aperture_lower"
  | "aperture_glow"
  | "halo"
  | "pulse";

export interface LayerSpec {
  name: string;
  kind: LayerKind;
  file?: string;
  /** x, y, w, h in source pixels. */
  bbox?: [number, number, number, number];
  depth?: number;
  follow?: number;
  /** `light` adds like light; anything else occludes by its coverage. */
  mode?: string;
  occl?: number;
  gain?: number;
  bloom?: number;
  voice_gain?: number;
  shimmer?: boolean;
  glint?: boolean;
  blink?: "iris" | "dim";
  float?: { amp?: [number, number]; freq?: number; rot_deg?: number; pivot?: [number, number] };
  pulse?: { amp?: number; freq?: number };
  ring_w?: number;
  meta?: { center?: [number, number]; radius?: number; color?: [number, number, number]; core_r?: number };
}

export interface RigSpec {
  head: { center: [number, number]; radius: [number, number]; pivot_y?: number; chin_y: number };
  shimmer?: { center: [number, number]; speed_px_s: number; wavelength_px: number; gain: number };
  tip_pulse?: number;
  glint?: { gain: number; width_px: number };
  aperture?: { seam_y: number; open_frac?: number; top: number; bottom: number; x0: number; x1: number };
}

export interface FormSpec {
  version: number;
  width: number;
  height: number;
  rig_type: string;
  layers: LayerSpec[];
  rig: RigSpec;
}

export interface LoadedForm {
  spec: FormSpec;
  /** Decoded pictures by file name, straight (not premultiplied) alpha. Kept so a lost context can rebuild. */
  images: Map<string, ImageBitmap>;
}

/** Where a form's files are served from, relative to the page (the build uses base "./"). */
export function formBase(avatar: FaceAvatarId, baseURI: string = document.baseURI): string {
  return new URL(`avatars/${avatar}/`, baseURI).href;
}

/** A spec is usable when it is a glow rig with a head and layers; anything else is refused by name. */
export function checkSpec(value: unknown): FormSpec {
  const s = value as Partial<FormSpec> | null;
  if (!s || typeof s !== "object") throw new Error("layers.json is not an object");
  if (s.rig_type !== "glow") throw new Error(`layers.json is a ${String(s.rig_type)} rig, not a glow rig`);
  if (!Array.isArray(s.layers) || s.layers.length === 0) throw new Error("layers.json has no layers");
  if (!s.rig?.head || !(Number(s.width) > 0) || !(Number(s.height) > 0)) throw new Error("layers.json has no head or size");
  return s as FormSpec;
}

const cache = new Map<FaceAvatarId, Promise<LoadedForm>>();

/** Fetch and decode a form once per window; every avatar of that form shares it. */
export function loadForm(avatar: FaceAvatarId): Promise<LoadedForm> {
  let p = cache.get(avatar);
  if (!p) {
    p = fetchForm(avatar);
    cache.set(avatar, p);
    // A failed load is not remembered, so a later mount may try again.
    p.catch(() => cache.delete(avatar));
  }
  return p;
}

async function fetchForm(avatar: FaceAvatarId): Promise<LoadedForm> {
  const base = formBase(avatar);
  const r = await fetch(`${base}layers.json`);
  if (!r.ok) throw new Error(`layers.json for ${avatar}: ${r.status}`);
  const spec = checkSpec(await r.json());
  const images = new Map<string, ImageBitmap>();
  await Promise.all(
    spec.layers
      .filter((l) => l.file)
      .map(async (l) => {
        const file = l.file as string;
        const res = await fetch(base + file);
        if (!res.ok) throw new Error(`${file} for ${avatar}: ${res.status}`);
        images.set(file, await createImageBitmap(await res.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" }));
      }),
  );
  return { spec, images };
}
