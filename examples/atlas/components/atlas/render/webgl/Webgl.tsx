"use client";

/**
 * VARIANT 2 — WebGL. The machine as geometry.
 *
 * Strata are slabs, blocks are boxes with real volume and real edges, pipes are tubes swept along
 * the routed polylines, and the turn is a light — an emissive core with a point light inside it
 * that actually illuminates the block it is standing on. Everything occludes everything, which is
 * the one thing the DOM cannot do and the reason this variant exists.
 *
 * `frameloop="demand"`: A SETTLED SCENE DRAWS ZERO FRAMES (formula §1 rule 9, the cost rule
 * tidycrm paid for in round 1). The canvas renders when — and only when — the camera pose or the
 * turn's beat changes, both of which arrive through subscriptions rather than React state. Idle
 * on L0 with the transport paused, this variant costs nothing at all.
 *
 * LABELS ARE CANVAS-TEXTURE SPRITES, and that is a considered answer to the brief's "drei Text or
 * Html — say which". Neither, and here is why: drei's `Text` is troika, whose default font is
 * fetched from a CDN at runtime, and this repository's law is that there is no runtime font
 * request (`app/layout.tsx` self-hosts both faces through `next/font`); shipping a second copy of
 * the typeface as an SDF atlas to satisfy a label is a lot of bytes for eleven words. `Html` is
 * what the HYBRID variant is, and using it here would make two of the three prototypes the same
 * prototype. So a sprite's texture is drawn with the 2D canvas API in the app's own face, which
 * costs one texture per distinct label, always faces the reader, and occludes correctly.
 *
 * THE HONEST WEAKNESS: sprite text is a bitmap. It is crisp at the zoom it was rasterised for and
 * soft when the camera comes closer than that, and it is not selectable, not searchable, and not
 * in the accessibility tree — the DOM rail beside the canvas carries the names for a reader who
 * needs them, which is a second place the same words live.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { DIM, type Block, type Part, type Pipe, type Stratum } from "../../scene/layout";
import { FOV, viewOf } from "../../scene/project";
import { turnAt } from "../../scene/turn";
import type { SceneProps, Weight } from "../contract";
import { composeRefs, useTap } from "../useFrameSize";

/* ------------------------------------- the palette ------------------------------------- */

/**
 * The scene's colours, read out of the cascade once on mount.
 *
 * A WebGL material cannot read a custom property, so the tokens are resolved here — from the real
 * computed style, not from a duplicate table — which keeps `tokens.css` the single authority even
 * for the one surface that cannot use it directly.
 */
function readPalette(): Record<string, THREE.Color> {
  const names = [
    "--at-ground",
    "--at-plane",
    "--at-plane-edge",
    "--at-wall",
    "--at-wall-lit",
    "--at-lid",
    "--at-pipe",
    "--at-pipe-up",
    "--at-plate",
    "--at-plate-2",
    "--at-plate-3",
    "--at-line-3",
    "--at-line-2",
    "--at-line-1",
    "--at-line-0",
    "--at-mark",
  ] as const;
  const style = getComputedStyle(document.documentElement);
  const out: Record<string, THREE.Color> = {};
  for (const name of names) {
    const raw = style.getPropertyValue(name).trim();
    out[name] = new THREE.Color(raw || "#888888");
  }
  return out;
}

type Palette = ReturnType<typeof readPalette>;

/* -------------------------------------- the labels -------------------------------------- */

const LABEL_PX = 128;

/** One label, rasterised in the app's own face. Cached, because a texture is not cheap. */
const textureCache = new Map<string, THREE.CanvasTexture>();

function labelTexture(text: string, colour: string, weight: number): THREE.CanvasTexture {
  const key = `${weight}|${colour}|${text}`;
  const hit = textureCache.get(key);
  if (hit) return hit;
  const face = getComputedStyle(document.documentElement)
    .getPropertyValue("--at-font-draft")
    .trim();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = `${weight} ${LABEL_PX}px ${face || "sans-serif"}`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + LABEL_PX / 2;
  canvas.width = Math.max(2, w);
  canvas.height = Math.ceil(LABEL_PX * 1.4);
  const c2 = canvas.getContext("2d")!;
  c2.font = font;
  c2.textAlign = "center";
  c2.textBaseline = "middle";
  c2.fillStyle = colour;
  c2.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textureCache.set(key, tex);
  return tex;
}

function Label({
  text,
  at,
  size,
  colour,
  weight = 600,
  opacity = 1,
}: {
  text: string;
  at: [number, number, number];
  size: number;
  colour: string;
  weight?: number;
  opacity?: number;
}) {
  const tex = useMemo(() => labelTexture(text, colour, weight), [colour, text, weight]);
  const aspect = tex.image ? (tex.image as HTMLCanvasElement).width / (tex.image as HTMLCanvasElement).height : 4;
  return (
    <sprite position={at} scale={[size * aspect, size, 1]}>
      <spriteMaterial
        map={tex}
        transparent
        opacity={opacity}
        depthWrite={false}
        toneMapped={false}
      />
    </sprite>
  );
}

/* --------------------------------------- the rig --------------------------------------- */

/**
 * The camera, driven by the contract's rig.
 *
 * The three camera is a slave: `viewOf(pose)` decides where it stands, exactly as it does for the
 * other two variants, and every frame the pose changes the canvas is invalidated once. Nothing
 * here owns a pose, an easing, or an inertia — all three would then be a second camera model.
 */
function Rig({ rig, transport }: Pick<SceneProps, "rig" | "transport">) {
  /* The camera is reached through `get()` rather than held as a value: it is a mutable three
     object living outside React, and moving it is updating an external system — which is what an
     effect is for, and what reading it as a rendered value is not. */
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);

  useLayoutEffect(() => {
    const apply = () => {
      const { camera } = get();
      const view = viewOf(rig.get());
      camera.position.set(view.eye.x, view.eye.y, view.eye.z);
      camera.up.set(0, 1, 0);
      camera.lookAt(view.target.x, view.target.y, view.target.z);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.fov = (FOV * 180) / Math.PI;
        camera.updateProjectionMatrix();
      }
      invalidate();
    };
    apply();
    const offPose = rig.subscribe(apply);
    const offBeat = transport.subscribe(() => invalidate());
    return () => {
      offPose();
      offBeat();
    };
  }, [get, invalidate, rig, size.height, size.width, transport]);

  return null;
}

/* --------------------------------------- the turn --------------------------------------- */

/** The travelling light. It reads the beat in `useFrame`, so React never sees it move. */
function TurnLight({ transport, palette }: { transport: SceneProps["transport"]; palette: Palette }) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const lamp = useRef<THREE.PointLight>(null);
  const mark = palette["--at-mark"]!;

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const f = turnAt(transport.beat());
    g.position.set(f.at.x, f.at.y + DIM.partH, f.at.z);
    /* The gate's wait is the only place the light does something other than travel: it breathes,
       because nothing is happening and the reader has to be told that ON PURPOSE rather than by
       the animation simply stopping, which reads as a bug. */
    const pulse = f.waiting ? 1 + Math.sin(performance.now() / 260) * 0.28 : 1;
    const k = (f.parked ? 1.35 : 1) * pulse;
    g.scale.setScalar(k);
    if (lamp.current) lamp.current.intensity = 260 * k;
    if (core.current) core.current.visible = true;
  });

  return (
    <group ref={group}>
      <mesh ref={core}>
        <sphereGeometry args={[DIM.partH * 0.8, 20, 20]} />
        <meshBasicMaterial color={mark} toneMapped={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[DIM.partH * 1.9, 16, 16]} />
        <meshBasicMaterial color={mark} transparent opacity={0.18} toneMapped={false} depthWrite={false} />
      </mesh>
      <pointLight ref={lamp} color={mark} distance={DIM.stratumGap * 1.4} decay={2} intensity={260} />
    </group>
  );
}

/* ------------------------------------- the geometry ------------------------------------- */

const PlaneSlab = memo(function PlaneSlab({
  stratum,
  w,
  palette,
  onPick,
}: {
  stratum: Stratum;
  w: Weight;
  palette: Palette;
  onPick: () => void;
}) {
  return (
    <group position={[0, stratum.y - DIM.planeH / 2, 0]}>
      <mesh onClick={onPick}>
        <boxGeometry args={[stratum.w, DIM.planeH, stratum.d]} />
        <meshStandardMaterial
          color={w.open ? palette["--at-wall"]! : palette["--at-plane"]!}
          transparent
          opacity={0.35 + 0.45 * w.presence}
          roughness={0.9}
          metalness={0}
        />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(stratum.w, DIM.planeH, stratum.d)]} />
        <lineBasicMaterial
          color={w.lit ? palette["--at-mark"]! : palette["--at-plane-edge"]!}
          transparent
          opacity={0.45 + 0.55 * w.presence}
        />
      </lineSegments>
    </group>
  );
});

const BlockBox = memo(function BlockBox({
  block,
  w,
  parts,
  opened,
  palette,
  onPickBlock,
  onPickPart,
  onHover,
}: {
  block: Block;
  w: Weight;
  parts: { part: Part; w: Weight }[];
  opened: boolean;
  palette: Palette;
  onPickBlock: () => void;
  onPickPart: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  /* A BLOCK IS THE SOLID THING. Everything else in the scene is translucent, so the blocks are
     what a reader's eye lands on and they have to be the lightest surface in the machine. */
  const face = w.live || w.hot ? palette["--at-wall-lit"]! : palette["--at-lid"]!;
  const edge = w.lit ? palette["--at-mark"]! : w.onTurn ? palette["--at-line-1"]! : palette["--at-line-2"]!;
  const geom = useMemo(
    () => new THREE.BoxGeometry(block.w, block.h, block.d),
    [block.d, block.h, block.w],
  );
  /* Rule 3, in three dimensions: an opened block's parts LIFT off its lid, so the container
     moves before the contents are readable, and a reader sees the box open rather than a
     different box appear. */
  const lift = opened ? DIM.partH * 1.4 : 0;

  return (
    <group position={[block.x, block.y, block.z]}>
      <mesh
        position={[0, block.h / 2, 0]}
        geometry={geom}
        onClick={onPickBlock}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(block.id);
        }}
        onPointerOut={() => onHover(null)}
      >
        <meshStandardMaterial
          color={face}
          transparent
          opacity={0.6 + 0.4 * w.presence}
          roughness={0.7}
          metalness={0.08}
        />
      </mesh>
      <lineSegments position={[0, block.h / 2, 0]}>
        <edgesGeometry args={[geom]} />
        <lineBasicMaterial
          color={edge}
          transparent
          opacity={(w.lit || w.live ? 1 : 0.75) * (0.3 + 0.7 * w.presence)}
        />
      </lineSegments>

      {parts.map(({ part, w: pw }) => (
        <group key={part.id} position={[part.x - block.x, part.y - block.y + lift, part.z - block.z]}>
          <mesh
            position={[0, part.h / 2, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onPickPart(part.id);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              onHover(part.id);
            }}
            onPointerOut={() => onHover(null)}
          >
            <boxGeometry args={[part.w, part.h, part.d]} />
            <meshStandardMaterial
              color={
                pw.live || pw.open
                  ? palette["--at-line-0"]!
                  : pw.lit
                    ? palette["--at-mark"]!
                    : pw.hot
                      ? palette["--at-plate-3"]!
                      : palette["--at-plate-2"]!
              }
              emissive={pw.live ? palette["--at-mark"]! : palette["--at-ground"]!}
              emissiveIntensity={pw.live ? 0.8 : 0}
              transparent
              opacity={0.35 + 0.6 * pw.presence}
              roughness={0.6}
              metalness={0.1}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
});

const PipeTube = memo(function PipeTube({
  pipe,
  palette,
  present,
  hot,
}: {
  pipe: Pipe;
  palette: Palette;
  present: number;
  hot: boolean;
}) {
  const geom = useMemo(() => {
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < pipe.points.length; i += 1) {
      const a = pipe.points[i - 1]!;
      const b = pipe.points[i]!;
      if (a.x === b.x && a.y === b.y && a.z === b.z) continue;
      path.add(new THREE.LineCurve3(new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)));
    }
    const radius = Math.min(1.3, 0.4 + pipe.weight * 0.1);
    return new THREE.TubeGeometry(path, Math.max(8, pipe.points.length * 6), radius, 6, false);
  }, [pipe.points, pipe.weight]);

  return (
    <mesh geometry={geom}>
      <meshStandardMaterial
        color={pipe.flow === "reaches" ? palette["--at-pipe-up"]! : palette["--at-pipe"]!}
        transparent
        opacity={(hot ? 1 : 0.7) * (0.25 + 0.75 * present)}
        roughness={0.45}
        metalness={0.25}
      />
    </mesh>
  );
});

/* ------------------------------------- the assembly ------------------------------------- */

export interface MachineOptions {
  wasTap: () => boolean;
  /**
   * Where the words go. `"sprite"` is the webgl variant answering the label question in the
   * scene; `"dom"` is the hybrid variant taking the geometry and leaving the words to the
   * document. One flag rather than two copies of the geometry, because the whole point of the
   * three-way comparison is that only ONE thing differs between two of them.
   */
  labels: "sprite" | "dom";
}

function Machine({ wasTap, labels, ...props }: SceneProps & MachineOptions) {
  const { scene, weights, focus, onOpenStratum, onOpenPart, onHover, transport } = props;
  const palette = useMemo(() => readPalette(), []);
  const ink = useMemo(
    () => ({ mark: `#${palette["--at-mark"]!.getHexString()}`, line: `#${palette["--at-line-0"]!.getHexString()}` }),
    [palette],
  );
  const open = focus.group;
  const live = turnAt(transport.beat());
  /* Presence per block, resolved once, so the pipes can ask about their two ends without
     re-deriving a weight per pipe per render. */
  const presenceOfBlock = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of scene.blocks) m.set(b.id, weights.block(b).presence);
    return m;
  }, [scene.blocks, weights]);
  const layerOfBlock = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of scene.blocks) m.set(b.id, b.layer);
    return m;
  }, [scene.blocks]);

  return (
    <>
      <ambientLight intensity={1.15} />
      <directionalLight position={[80, 220, 140]} intensity={1.9} />
      <directionalLight position={[-120, 40, -80]} intensity={0.5} color={palette["--at-line-2"]!} />

      {scene.strata.map((s) => {
        const w = weights.stratum(s);
        return (
          <group key={s.id}>
            <PlaneSlab
              stratum={s}
              w={w}
              palette={palette}
              onPick={() => wasTap() && onOpenStratum(s.id)}
            />
            {labels === "sprite" ? (
              <Label
                text={s.name}
                at={[-s.w / 2 - DIM.stub, s.y + DIM.blockH * 0.55, s.d / 2 + DIM.stub]}
                size={DIM.blockH * 0.85}
                colour={w.lit ? ink.mark : ink.line}
                opacity={0.35 + 0.65 * w.presence}
              />
            ) : null}
          </group>
        );
      })}

      {scene.pipes.map((p) => (
        <PipeTube
          key={p.id}
          pipe={p}
          palette={palette}
          present={Math.max(presenceOfBlock.get(p.from) ?? 1, presenceOfBlock.get(p.to) ?? 1)}
          hot={layerOfBlock.get(p.from) === open || layerOfBlock.get(p.to) === open}
        />
      ))}

      {scene.blocks.map((b) => {
        const w = weights.block(b);
        const opened = open === b.layer && focus.level > 0;
        return (
          <group key={b.id}>
            <BlockBox
              block={b}
              w={w}
              opened={opened}
              parts={b.parts.map((p) => ({ part: p, w: weights.part(p) }))}
              palette={palette}
              onPickBlock={() => wasTap() && onOpenStratum(b.layer)}
              onPickPart={(id) => wasTap() && onOpenPart(id)}
              onHover={onHover}
            />
            {labels === "sprite" && (opened || w.live) ? (
              <Label
                text={b.name}
                at={[b.x, b.y + b.h + DIM.partH * 3.4, b.z]}
                size={DIM.partH * 2.1}
                colour={w.lit ? ink.mark : ink.line}
                weight={500}
                opacity={0.9}
              />
            ) : null}
          </group>
        );
      })}

      <TurnLight transport={transport} palette={palette} />
      {labels === "sprite" ? (
        <Label
          key={live.stop.index}
          text={live.stop.label}
          at={[live.at.x, live.at.y + DIM.partH * 5.5, live.at.z]}
          size={DIM.partH * 3.2}
          colour={ink.mark}
          weight={600}
        />
      ) : null}
    </>
  );
}

/** Device pixel ratio: never below one, never above two. Three is a lot of fragment for no eye. */
const DPR: [number, number] = [1, 2];

export function Webgl(props: SceneProps & { labels?: "sprite" | "dom"; children?: React.ReactNode }) {
  const { labels = "sprite", children, ...scene } = props;
  const tap = useTap();

  useEffect(() => {
    /* Every label texture belongs to this mount. Dropping the cache on unmount is what stops the
       variant switcher from leaking a texture set per switch. */
    return () => {
      for (const tex of textureCache.values()) tex.dispose();
      textureCache.clear();
    };
  }, []);

  return (
    <div
      className="at-gl"
      data-labels={labels}
      {...props.rig.bind}
      {...tap.handlers}
      ref={composeRefs<HTMLDivElement>(props.rig.bind.ref)}
      role="application"
      aria-label="The machine. Drag to orbit, wheel to zoom, Home to reset."
    >
      <Canvas
        frameloop="demand"
        dpr={DPR}
        gl={{ antialias: true, alpha: true }}
        camera={{ fov: (FOV * 180) / Math.PI, near: 1, far: 2000 }}
      >
        <Rig rig={props.rig} transport={props.transport} />
        <Machine {...scene} wasTap={tap.wasTap} labels={labels} />
      </Canvas>
      {children}
    </div>
  );
}
