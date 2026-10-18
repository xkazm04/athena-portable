/**
 * The glow-being renderer - ADR 0120 ("Athena has a face"), the rig.
 *
 * A port of the spike's glow rig (spikes/avatar/web/src/glow.js) to TypeScript: beings made of light
 * on black, drawn in WebGL2 with one program and one draw per layer. Light layers carry alpha 0, so
 * overlapping light adds like light; solid parts (the owl's disc, the origami's facets and shards)
 * occlude by their coverage. On top of the layers: head parallax (an orthographic sphere warp with
 * per-layer depth), the analytic halo ring (whole even when the head moves in front of it), bloom
 * from the textures' mip chain, eye lights that close as an iris (owl) or dim as a facet (origami),
 * the owl's seam and the ripple that runs out along its fibre tips with the voice, the origami's
 * hinged hex mouth with light in its slit and a glint sweeping its facets, floating crest, shards
 * and tufts, and breathing. Everything that moves by time is scaled by the pose's `activity`, so
 * a settled face draws exactly its rest frame.
 *
 * No allocation per frame. A lost context is waited out and rebuilt from the decoded pictures.
 */
import type { Pose } from "./driver";
import type { LayerKind, LayerSpec, LoadedForm } from "./layers";

const KIND: Record<LayerKind, number> = {
  static: 0,
  body: 1,
  head: 2,
  float: 3,
  eye: 4,
  seam: 5,
  aperture_upper: 6,
  aperture_lower: 7,
  aperture_glow: 8,
  halo: 9,
  pulse: 10,
};

const VS = `#version 300 es
precision highp float;
precision highp int;
in vec2 a_src;
uniform vec4 u_view;
uniform int u_kind;
uniform float u_depth, u_follow;
uniform vec2 u_headC, u_headR;
uniform float u_pivotY, u_imgH;
uniform vec3 u_ang;
uniform float u_breath;
uniform float u_sway;
uniform vec4 u_float;
uniform vec2 u_floatPivot;
uniform vec4 u_eye;
uniform vec2 u_gaze;
uniform vec4 u_aper;
out vec2 v_src;
out float v_shade;

vec2 rot(vec2 p, vec2 c, float a) { vec2 r = p - c; float s = sin(a), k = cos(a); return c + vec2(r.x * k - r.y * s, r.x * s + r.y * k); }

void main() {
  vec2 p = a_src;
  v_src = a_src;
  v_shade = 1.0;
  if (u_kind == 0) { gl_Position = vec4(p * u_view.xy + u_view.zw, 0.0, 1.0); return; }
  if (u_kind == 4) { p.y = u_eye.y + (p.y - u_eye.y) * (1.0 - u_eye.z); p += u_gaze; }
  if (u_kind == 6) p.y -= u_aper.w * clamp((p.y - u_aper.x) / max(1.0, u_aper.y - u_aper.x), 0.0, 1.0);
  if (u_kind == 7) p.y += u_aper.w * clamp((u_aper.z - p.y) / max(1.0, u_aper.z - u_aper.y), 0.0, 1.0);
  if (u_kind == 3) { p = rot(p, u_floatPivot, u_float.z) + u_float.xy; }

  float w = u_follow;
  if (u_kind == 1) w = 1.0 - smoothstep(u_pivotY - 0.2 * u_headR.y, u_pivotY + 0.9 * u_headR.y, a_src.y);
  vec2 u = (p - u_headC) / u_headR;
  float zs = sqrt(max(0.0, 1.0 - dot(u, u)));
  float z = (u_kind == 2 ? zs * 0.6 : 0.0) + u_depth;
  float yaw = u_ang.x * w, pitch = u_ang.y * w, roll = u_ang.z * w;
  float x1 = u.x * cos(yaw) + z * sin(yaw);
  float z1 = -u.x * sin(yaw) + z * cos(yaw);
  float y1 = u.y * cos(pitch) + z1 * sin(pitch);
  vec2 q = mix(p, u_headC + vec2(x1, y1) * u_headR, step(0.001, w));
  q = rot(q, vec2(u_headC.x, u_pivotY), roll);
  v_shade = 1.0 + 0.6 * (x1 - u.x) * step(0.001, w) * step(1.5, float(u_kind)) * (u_kind == 2 ? 1.0 : 0.4);

  float body = clamp((u_imgH - a_src.y) / u_imgH, 0.0, 1.0);
  q = rot(q, vec2(u_headC.x, u_imgH * 1.1), u_sway * (u_kind == 1 ? 1.0 : 0.8));
  q.y -= u_breath * body;
  gl_Position = vec4(q * u_view.xy + u_view.zw, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_src;
in float v_shade;
uniform int u_kind;
uniform sampler2D u_tex;
uniform vec4 u_bbox;
uniform float u_occl;
uniform float u_gain;
uniform float u_bloom;
uniform float u_t;
uniform int u_shimmer;
uniform vec3 u_shim;
uniform vec2 u_shimK;
uniform float u_env[48];
uniform float u_tipPulse;
uniform int u_glint;
uniform vec4 u_glintP;
uniform float u_glintGain;
uniform vec4 u_ring;
uniform vec3 u_ringCol;
uniform vec4 u_aper;
uniform vec2 u_aperX;
uniform float u_voice;
uniform vec4 u_eyeP;
out vec4 o;

float envAt(float delay) {
  float f = clamp(delay * 40.0, 0.0, 46.99);
  int i = int(floor(f));
  return mix(u_env[i], u_env[i + 1], fract(f));
}

void main() {
  if (u_kind == 9) {
    float d = abs(length(v_src - u_ring.xy) - u_ring.z);
    float core = exp(-pow(d / u_ring.w, 2.0));
    float halo = 0.22 * exp(-d / (u_ring.w * 5.0));
    o = vec4(u_ringCol * (1.25 * core + halo) * u_gain, 0.0);
    return;
  }
  if (u_kind == 8) {
    float g = max(u_aper.w, 0.001);
    float dy = abs(v_src.y - u_aper.y);
    float cx = 0.5 * (u_aperX.x + u_aperX.y), hw = 0.5 * (u_aperX.y - u_aperX.x);
    float ax = abs(v_src.x - cx) / hw;
    float across = 1.0 - smoothstep(0.35, 0.9, ax);
    float taper = 1.0 - 0.55 * smoothstep(0.2, 0.9, ax);
    float core = exp(-pow(dy / (g * 0.28 + 0.7), 2.0));
    float rims = 0.45 * exp(-pow((dy - g * taper) / 1.6, 2.0));
    float spill = 0.12 * exp(-dy / (g * 1.5 + 2.0));
    float fill = 0.32 * (1.0 - smoothstep(g * 0.7 * taper, g * 1.0 * taper, dy));
    float k = (core + rims + spill + fill) * across * clamp(u_aper.w / 4.0, 0.0, 1.0) * (0.55 + 0.6 * u_voice);
    o = vec4(vec3(0.35, 0.95, 1.0) * k * u_gain, 0.0);
    return;
  }
  vec2 uv = (v_src - u_bbox.xy) / u_bbox.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  vec4 c = texture(u_tex, uv);
  float irisFade = 1.0;
  if (u_kind == 4 && u_eyeP.x > 0.0) {
    float d = length(v_src - u_eyeP.yz);
    irisFade = 1.0 - smoothstep(u_eyeP.w * (2.6 - 1.8 * u_eyeP.x), u_eyeP.w * (3.2 - 1.6 * u_eyeP.x), d) * min(1.0, u_eyeP.x * 2.0);
    c.rgb *= irisFade;
  }
  float edgeWin = u_occl > 0.0 ? 1.0 : smoothstep(0.0, 0.12, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  vec3 light = c.rgb;
  float lmax = max(light.r, max(light.g, light.b));
  if (u_shimmer == 1) {
    float tip = smoothstep(0.14, 0.55, lmax);
    float r = length(v_src - u_shim.xy);
    float lev = envAt(r / u_shim.z);
    float wave = 0.55 + 0.45 * sin(6.2831853 * (r / u_shimK.x - u_t * u_shim.z / u_shimK.x));
    light *= 1.0 + tip * (u_shimK.y * lev * wave + u_tipPulse);
  }
  if (u_glint == 1) {
    float edge = smoothstep(0.18, 0.6, lmax);
    float s = dot(v_src, u_glintP.xy) - u_glintP.z;
    light *= 1.0 + u_glintGain * edge * exp(-pow(s / u_glintP.w, 2.0));
  }
  float cov = u_occl > 0.0 ? c.a : 1.0;
  light *= u_gain * v_shade * cov;
  if (u_bloom > 0.0) {
    vec4 b1 = textureLod(u_tex, uv, 3.0), b2 = textureLod(u_tex, uv, 5.0);
    light += u_bloom * u_gain * irisFade * (b1.rgb * (u_occl > 0.0 ? b1.a : 1.0) + 0.5 * b2.rgb * (u_occl > 0.0 ? b2.a : 1.0));
  }
  light *= edgeWin;
  o = vec4(light, c.a * u_occl);
}`;

export interface GlowRenderer {
  /** Draw one frame of `pose`. A lost context draws nothing until it is restored. */
  render(pose: Pose): void;
  /** Re-fit after the canvas's backing size changed. */
  resize(): void;
  /** True while the GPU context is gone. */
  readonly lost: boolean;
  dispose(): void;
}

interface DrawLayer {
  spec: LayerSpec;
  kind: number;
  bbox: [number, number, number, number];
  tex: WebGLTexture | null;
  vao: WebGLVertexArrayObject;
  count: number;
  float?: { amp: [number, number]; freq: number; rot: number; pivot: [number, number]; phase: number; phase2: number };
  eyeC?: [number, number];
  right?: boolean;
}

/** A grid over a box, `step` px per cell (at most 160 a side): the mesh the vertex shader warps. */
export function gridMesh(x: number, y: number, w: number, h: number, step: number) {
  const nx = Math.max(1, Math.min(160, Math.ceil(w / step)));
  const ny = Math.max(1, Math.min(160, Math.ceil(h / step)));
  const pos = new Float32Array((nx + 1) * (ny + 1) * 2);
  let k = 0;
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      pos[k++] = x + (w * i) / nx;
      pos[k++] = y + (h * j) / ny;
    }
  const idx = new Uint32Array(nx * ny * 6);
  k = 0;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      idx[k++] = a;
      idx[k++] = b;
      idx[k++] = c;
      idx[k++] = b;
      idx[k++] = d;
      idx[k++] = c;
    }
  return { pos, idx };
}

const smooth01 = (x: number) => {
  const y = Math.min(1, Math.max(0, x));
  return y * y * (3 - 2 * y);
};
const DEG = Math.PI / 180;

/** Hand the main thread back between pieces of setup, so no one piece is a long task (ADR 0089). */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Make a renderer for `form` on `canvas`. Rejects when WebGL2 is not there (the caller shows
 * nothing and warns once). Setup is cut into pieces with the main thread handed back between them
 * (the program, each texture, the meshes), because done at once it measured a 61 ms task. The
 * shaders compile in parallel where the driver offers it. `onRestored` is called after a lost
 * context came back and was rebuilt, so the caller can draw again.
 */
export async function createGlowRenderer(
  canvas: HTMLCanvasElement,
  form: LoadedForm,
  onRestored: () => void = () => {},
): Promise<GlowRenderer> {
  const { spec, images } = form;
  const R = spec.rig;
  const W = spec.width;
  const H = spec.height;
  const opts: WebGLContextAttributes = { alpha: false, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: false };
  const first = canvas.getContext("webgl2", opts);
  if (!first) throw new Error("WebGL2 unavailable");
  const gl: WebGL2RenderingContext = first;

  let lost = false;
  let disposed = false;
  let prog: WebGLProgram | null = null;
  let U: Record<string, WebGLUniformLocation | null> = {};
  let draws: DrawLayer[] = [];
  /** Everything `build` made, so `dispose` can free it without losing the context (a StrictMode
   *  remount draws on the same canvas, and so the same context, a moment later). */
  let owned: { textures: WebGLTexture[]; buffers: WebGLBuffer[]; vaos: WebGLVertexArrayObject[]; shaders: WebGLShader[] } = {
    textures: [],
    buffers: [],
    vaos: [],
    shaders: [],
  };
  const view = new Float32Array(4);

  function free() {
    for (const t of owned.textures) gl.deleteTexture(t);
    for (const b of owned.buffers) gl.deleteBuffer(b);
    for (const v of owned.vaos) gl.deleteVertexArray(v);
    for (const s of owned.shaders) gl.deleteShader(s);
    if (prog) gl.deleteProgram(prog);
    owned = { textures: [], buffers: [], vaos: [], shaders: [] };
    draws = [];
  }

  async function build() {
    const p = gl.createProgram();
    if (!p) throw new Error("WebGL2 could not make a program");
    const parallel = gl.getExtension("KHR_parallel_shader_compile") as { COMPLETION_STATUS_KHR: number } | null;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    if (!vs || !fs) throw new Error("WebGL2 could not make a shader");
    owned.shaders.push(vs, fs);
    gl.shaderSource(vs, VS);
    gl.shaderSource(fs, FS);
    gl.compileShader(vs);
    gl.compileShader(fs);
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (parallel) {
      for (let i = 0; i < 400 && !gl.getProgramParameter(p, parallel.COMPLETION_STATUS_KHR); i++) await breathe();
    }
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const why = gl.getShaderInfoLog(vs) || gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(p) || "program did not link";
      throw new Error(why);
    }
    prog = p;
    gl.useProgram(prog);
    U = {};
    const aSrc = gl.getAttribLocation(prog, "a_src");

    const textures = new Map<string, WebGLTexture>();
    for (const [file, img] of images) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (t) {
        textures.set(file, t);
        owned.textures.push(t);
      }
      await breathe();
    }

    const ap = R.aperture;
    draws = [];
    let fi = 0;
    for (const l of spec.layers) {
      let bb: [number, number, number, number] = l.bbox ?? [0, 0, W, H];
      if (l.kind === "halo") {
        const m = l.meta ?? {};
        const r = (m.radius ?? 0) + 40;
        const c = m.center ?? [W / 2, H / 2];
        bb = [c[0] - r, c[1] - r, 2 * r, 2 * r];
      }
      if (l.kind === "aperture_glow") {
        if (!ap) continue;
        bb = [ap.x0 - 10, ap.top - 20, ap.x1 - ap.x0 + 20, ap.bottom - ap.top + 40];
      }
      if (l.file && !textures.has(l.file)) continue;
      const step = l.kind === "static" ? 1e6 : l.kind.startsWith("aperture") ? 2 : 8;
      const { pos, idx } = gridMesh(bb[0], bb[1], bb[2], bb[3], step);
      const vao = gl.createVertexArray();
      const vbo = gl.createBuffer();
      const ibo = gl.createBuffer();
      owned.vaos.push(vao);
      owned.buffers.push(vbo, ibo);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(aSrc);
      gl.vertexAttribPointer(aSrc, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      const d: DrawLayer = {
        spec: l,
        kind: KIND[l.kind] ?? 2,
        bbox: bb,
        tex: l.file ? (textures.get(l.file) ?? null) : null,
        vao,
        count: idx.length,
      };
      if (l.kind === "float") {
        const f = l.float ?? {};
        d.float = {
          amp: f.amp ?? [1, 3],
          freq: f.freq ?? 0.15,
          rot: ((f.rot_deg ?? 0) * Math.PI) / 180,
          pivot: f.pivot ?? [bb[0] + bb[2] / 2, bb[1] + bb[3] / 2],
          phase: 1.7 * fi + 0.4,
          phase2: 2.3 * fi + 1.1,
        };
        fi++;
      }
      if (l.kind === "eye") {
        d.eyeC = l.meta?.center ?? [bb[0] + bb[2] / 2, bb[1] + bb[3] / 2];
        d.right = !l.name.endsWith("_l");
      }
      draws.push(d);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(loc("u_tex"), 0);
    layout();
  }

  function loc(name: string): WebGLUniformLocation | null {
    if (!(name in U)) U[name] = prog ? gl.getUniformLocation(prog, name) : null;
    return U[name];
  }

  function layout() {
    const cw = canvas.width || 1;
    const ch = canvas.height || 1;
    // fit the square art into the box, centred
    const s = Math.min(cw / W, ch / H);
    const ox = cw / 2 - (W / 2) * s;
    const oy = ch / 2 - (H / 2) * s;
    view[0] = (2 * s) / cw;
    view[1] = (-2 * s) / ch;
    view[2] = (2 * ox) / cw - 1;
    view[3] = 1 - (2 * oy) / ch;
  }

  const onLost = (e: Event) => {
    e.preventDefault(); // ask for it back
    lost = true;
  };
  const onRestore = () => {
    if (disposed) return;
    // the old handles died with the context; drop them, do not delete them
    owned = { textures: [], buffers: [], vaos: [], shaders: [] };
    prog = null;
    build().then(
      () => {
        if (disposed) return;
        lost = false;
        onRestored();
      },
      (error: unknown) =>
        console.warn(`[athena] the face could not be rebuilt after the GPU reset: ${error instanceof Error ? error.message : String(error)}`),
    );
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestore);

  await build();

  function render(pose: Pose) {
    if (lost || disposed || gl.isContextLost()) return;
    const t = pose.t;
    const act = pose.activity;
    const voice = pose.voice;
    const head = R.head;
    const ap = R.aperture;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform4fv(loc("u_view"), view);
    gl.uniform2f(loc("u_headC"), head.center[0], head.center[1]);
    gl.uniform2f(loc("u_headR"), head.radius[0], head.radius[1]);
    gl.uniform1f(loc("u_pivotY"), head.pivot_y ?? head.chin_y);
    gl.uniform1f(loc("u_imgH"), H);
    gl.uniform3f(loc("u_ang"), pose.yaw * DEG, pose.pitch * DEG, pose.roll * DEG);
    gl.uniform1f(loc("u_breath"), act * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 5.2)) * H * 0.006);
    gl.uniform1f(loc("u_sway"), act * (0.35 * Math.sin(t * 0.37) + 0.2 * Math.sin(t * 0.61 + 1.3)) * DEG);
    gl.uniform1f(loc("u_t"), t);
    gl.uniform1fv(loc("u_env[0]"), pose.history);
    gl.uniform1f(loc("u_voice"), voice);
    const shim = R.shimmer;
    if (shim) {
      gl.uniform3f(loc("u_shim"), shim.center[0], shim.center[1], shim.speed_px_s);
      gl.uniform2f(loc("u_shimK"), shim.wavelength_px, shim.gain);
    }
    gl.uniform1f(loc("u_tipPulse"), act * (R.tip_pulse ?? 0) * Math.sin((2 * Math.PI * t) / 5.2 - 0.6));
    const gp = R.glint;
    if (gp) {
      // the sweep drifts slowly and follows the head turn, so light seems to move over the facets
      const ang = -0.6;
      const span = W * 1.4;
      const at = (((t * 0.045 + pose.yaw * 0.02) % 1) + 1) % 1;
      gl.uniform4f(loc("u_glintP"), Math.cos(ang), Math.sin(ang), at * span - span * 0.2, gp.width_px);
      gl.uniform1f(loc("u_glintGain"), gp.gain);
    }
    const lift = ap ? pose.open * (ap.open_frac ?? 0.15) * (ap.bottom - ap.top) * (0.75 + 0.35 * Math.min(1, voice)) : 0;
    if (ap) {
      gl.uniform4f(loc("u_aper"), ap.top, ap.seam_y, ap.bottom, lift);
      gl.uniform2f(loc("u_aperX"), ap.x0, ap.x1);
    }
    const pulse = pose.pulse;

    for (const d of draws) {
      const l = d.spec;
      const kind = d.kind;
      if (kind === 8 && lift < 0.2) continue;
      gl.uniform1i(loc("u_kind"), kind);
      gl.uniform1f(loc("u_depth"), l.depth ?? 0);
      gl.uniform1f(loc("u_follow"), l.follow ?? (kind === 0 || kind === 1 ? 0 : 1));
      const isLight = l.mode === "light" || kind === 8 || kind === 9;
      gl.uniform1f(loc("u_occl"), isLight ? 0 : (l.occl ?? 1));
      let gain = l.gain ?? 1;
      if (kind === 5) gain *= (0.9 + (l.voice_gain ?? 2) * Math.max(voice * 0.8, pose.open) * 0.6) * (1 + 0.25 * pulse);
      if (kind === 10)
        gain *=
          1 +
          act * (l.pulse?.amp ?? 0.15) * Math.sin(2 * Math.PI * (l.pulse?.freq ?? 0.2) * t) +
          (l.voice_gain ?? 0) * voice +
          0.2 * pulse;
      if (kind === 9) gain *= 0.92 + act * 0.08 * Math.sin((2 * Math.PI * t) / 5.2) + 0.12 * voice + 0.15 * pulse;
      if (kind === 4 && d.eyeC) {
        const blink = d.right ? pose.blinkR : pose.blinkL;
        if (l.blink === "iris") {
          gl.uniform4f(loc("u_eye"), d.eyeC[0], d.eyeC[1], 0.92 * Math.pow(blink, 0.8), 0);
          gl.uniform4f(loc("u_eyeP"), blink, d.eyeC[0], d.eyeC[1], l.meta?.core_r ?? 12);
          gain *= 1 - 0.6 * blink;
        } else {
          gl.uniform4f(loc("u_eye"), d.eyeC[0], d.eyeC[1], 0.35 * blink, 0);
          gl.uniform4f(loc("u_eyeP"), 0, 0, 0, 1);
          // a facet: bright light to dark crystal in the middle of the blink
          gain *= 1 - smooth01((blink - 0.25) / 0.4);
        }
        gl.uniform2f(loc("u_gaze"), pose.gazeX * 3.5, pose.gazeY * 2.0);
        gain *= (1 + 0.12 * voice) * (1 + 0.08 * pulse); // the eyes warm a little while she speaks
      }
      gl.uniform1f(loc("u_gain"), gain);
      gl.uniform1f(loc("u_bloom"), l.bloom ?? 0);
      gl.uniform1i(loc("u_shimmer"), l.shimmer && shim ? 1 : 0);
      gl.uniform1i(loc("u_glint"), l.glint && gp ? 1 : 0);
      if (kind === 3 && d.float) {
        const f = d.float;
        const w = 2 * Math.PI * f.freq;
        gl.uniform4f(
          loc("u_float"),
          act * f.amp[0] * Math.sin(w * 0.77 * t + f.phase2),
          act * -f.amp[1] * Math.sin(w * t + f.phase),
          act * f.rot * Math.sin(w * 0.6 * t + f.phase + 0.8),
          0,
        );
        gl.uniform2f(loc("u_floatPivot"), f.pivot[0], f.pivot[1]);
      }
      if (kind === 9) {
        const m = l.meta ?? {};
        const c = m.center ?? [W / 2, H / 2];
        const col = m.color ?? [0.13, 0.83, 0.93];
        gl.uniform4f(loc("u_ring"), c[0], c[1], m.radius ?? 0, Math.max(1.0, l.ring_w ?? 1.7));
        gl.uniform3f(loc("u_ringCol"), Math.min(1, col[0] * 1.25), Math.min(1, col[1] * 1.25), Math.min(1, col[2] * 1.25));
      }
      if (d.tex) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, d.tex);
        gl.uniform4f(loc("u_bbox"), d.bbox[0], d.bbox[1], d.bbox[2], d.bbox[3]);
      }
      gl.bindVertexArray(d.vao);
      gl.drawElements(gl.TRIANGLES, d.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  return {
    render,
    resize: layout,
    get lost() {
      return lost || gl.isContextLost();
    },
    dispose() {
      disposed = true;
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestore);
      if (!gl.isContextLost()) free();
    },
  };
}
