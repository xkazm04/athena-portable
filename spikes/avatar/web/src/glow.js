// t1 glow rig: beings made of light on black (layers from prep/split_glow.py).
// Same RigParams contract as rig.js. Every layer is premultiplied light: rgb = emitted light,
// alpha = how much it occludes what is behind. Light elements carry alpha 0, so overlapping light
// adds like light; solid parts (disc, facets, shards) occlude. One program, one draw per layer.
import { shapeFrom } from './visemes.js';

const KIND = { static: 0, body: 1, head: 2, float: 3, eye: 4, seam: 5, aperture_upper: 6, aperture_lower: 7,
  aperture_glow: 8, halo: 9, pulse: 10 };

const VS = `#version 300 es
precision highp float;
precision highp int;
in vec2 a_src;
uniform vec4 u_view;
uniform int u_kind;
uniform float u_depth, u_follow;
uniform vec2 u_headC, u_headR;
uniform float u_pivotY, u_imgH;
uniform vec3 u_ang;          // yaw pitch roll (rad)
uniform float u_breath;      // px
uniform float u_sway;        // rad, body sway about the bottom centre
uniform vec4 u_float;        // dx dy rot(rad) -
uniform vec2 u_floatPivot;
uniform vec4 u_eye;          // cx cy squash -
uniform vec2 u_gaze;         // px
uniform vec4 u_aper;         // top seam bottom lift(px)
out vec2 v_src;
out float v_shade;

vec2 rot(vec2 p, vec2 c, float a) { vec2 r = p - c; float s = sin(a), k = cos(a); return c + vec2(r.x * k - r.y * s, r.x * s + r.y * k); }

void main() {
  vec2 p = a_src;
  v_src = a_src;
  v_shade = 1.0;
  if (u_kind == 0) { gl_Position = vec4(p * u_view.xy + u_view.zw, 0.0, 1.0); return; }
  // local motion of the part itself
  if (u_kind == 4) { p.y = u_eye.y + (p.y - u_eye.y) * (1.0 - u_eye.z); p += u_gaze; }
  if (u_kind == 6) p.y -= u_aper.w * clamp((p.y - u_aper.x) / max(1.0, u_aper.y - u_aper.x), 0.0, 1.0);
  if (u_kind == 7) p.y += u_aper.w * clamp((u_aper.z - p.y) / max(1.0, u_aper.z - u_aper.y), 0.0, 1.0);
  if (u_kind == 3) { p = rot(p, u_floatPivot, u_float.z) + u_float.xy; }

  // head turn: orthographic sphere warp + per-layer depth, weighted by how much the part follows
  float w = u_follow;
  if (u_kind == 1) w = 1.0 - smoothstep(u_pivotY - 0.2 * u_headR.y, u_pivotY + 0.9 * u_headR.y, a_src.y);
  if (u_kind == 0) w = 0.0;
  vec2 u = (p - u_headC) / u_headR;
  float zs = sqrt(max(0.0, 1.0 - dot(u, u)));
  float z = (u_kind == 2 ? zs * 0.6 : 0.0) + u_depth;
  float yaw = u_ang.x * w, pitch = u_ang.y * w, roll = u_ang.z * w;
  float x1 = u.x * cos(yaw) + z * sin(yaw);
  float z1 = -u.x * sin(yaw) + z * cos(yaw);
  float y1 = u.y * cos(pitch) + z1 * sin(pitch);
  vec2 q = mix(p, u_headC + vec2(x1, y1) * u_headR, step(0.001, w));
  q = rot(q, vec2(u_headC.x, u_pivotY), roll);
  // turned surfaces facing the light brighten a touch
  v_shade = 1.0 + 0.6 * (x1 - u.x) * step(0.001, w) * step(1.5, float(u_kind)) * (u_kind == 2 ? 1.0 : 0.4);

  // body: sway about the bottom centre and breathing (top rises, bottom fixed)
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
uniform float u_occl;        // alpha multiplier (0 = pure light)
uniform float u_gain;        // brightness
uniform float u_bloom;
uniform float u_t;
// shimmer: a radial wave across the bright tips, driven by the voice level history
uniform int u_shimmer;
uniform vec3 u_shim;         // cx cy speed(px/s)
uniform vec2 u_shimK;        // wavelength(px) gain
uniform float u_env[48];     // level history, 40 Hz, [0] = now
uniform float u_tipPulse;
// glint: a soft light band sweeping across bright edges
uniform int u_glint;
uniform vec4 u_glintP;       // dir.x dir.y pos width
uniform float u_glintGain;
// procedural parts
uniform vec4 u_ring;         // cx cy r width
uniform vec3 u_ringCol;
uniform vec4 u_aper;         // top seam bottom lift
uniform vec2 u_aperX;        // x0 x1
uniform float u_voice;
uniform vec4 u_eyeP;         // blink cx cy core_r (iris mode)
out vec4 o;

float envAt(float delay) {
  float f = clamp(delay * 40.0, 0.0, 46.99);
  int i = int(floor(f));
  return mix(u_env[i], u_env[i + 1], fract(f));
}

void main() {
  if (u_kind == 9) { // halo ring, analytic so it stays whole when the head moves in front of it
    float d = abs(length(v_src - u_ring.xy) - u_ring.z);
    float core = exp(-pow(d / u_ring.w, 2.0));
    float halo = 0.22 * exp(-d / (u_ring.w * 5.0));
    o = vec4(u_ringCol * (1.25 * core + halo) * u_gain, 0.0);
    return;
  }
  if (u_kind == 8) { // light in the opened aperture
    float g = max(u_aper.w, 0.001);
    float dy = abs(v_src.y - u_aper.y);
    float cx = 0.5 * (u_aperX.x + u_aperX.y), hw = 0.5 * (u_aperX.y - u_aperX.x);
    // the slit tapers to points toward the hexagon's side vertices
    float ax = abs(v_src.x - cx) / hw;
    float across = 1.0 - smoothstep(0.35, 0.9, ax);
    float taper = 1.0 - 0.55 * smoothstep(0.2, 0.9, ax);
    // a thin core of light in the slit plus light catching the two opened edges
    float core = exp(-pow(dy / (g * 0.28 + 0.7), 2.0));
    float rims = 0.45 * exp(-pow((dy - g * taper) / 1.6, 2.0));
    float spill = 0.12 * exp(-dy / (g * 1.5 + 2.0));
    float fill = 0.32 * (1.0 - smoothstep(g * 0.7 * taper, g * 1.0 * taper, dy));   // the open slit glows from inside
    float k = (core + rims + spill + fill) * across * clamp(u_aper.w / 4.0, 0.0, 1.0) * (0.55 + 0.6 * u_voice);
    o = vec4(vec3(0.35, 0.95, 1.0) * k * u_gain, 0.0);
    return;
  }
  vec2 uv = (v_src - u_bbox.xy) / u_bbox.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  vec4 c = texture(u_tex, uv);
  float irisFade = 1.0;
  if (u_kind == 4 && u_eyeP.x > 0.0) {
    // closing iris: what lies beyond the closing radius fades, so the light shrinks to a short line
    float d = length(v_src - u_eyeP.yz);
    irisFade = 1.0 - smoothstep(u_eyeP.w * (2.6 - 1.8 * u_eyeP.x), u_eyeP.w * (3.2 - 1.6 * u_eyeP.x), d) * min(1.0, u_eyeP.x * 2.0);
    c.rgb *= irisFade;
  }
  // light layers fade out toward their crop so blur never shows a box
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
  // solid parts are premultiplied by their coverage so feathered edges blend; light parts are already deltas
  float cov = u_occl > 0.0 ? c.a : 1.0;
  light *= u_gain * v_shade * cov;
  if (u_bloom > 0.0) {
    vec4 b1 = texture(u_tex, uv, 3.0), b2 = texture(u_tex, uv, 5.0);
    light += u_bloom * u_gain * irisFade * (b1.rgb * (u_occl > 0.0 ? b1.a : 1.0) + 0.5 * b2.rgb * (u_occl > 0.0 ? b2.a : 1.0));
  }
  light *= edgeWin;
  o = vec4(light, c.a * u_occl);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
async function loadImage(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}
function gridMesh(x, y, w, h, step) {
  const nx = Math.max(1, Math.min(160, Math.ceil(w / step))), ny = Math.max(1, Math.min(160, Math.ceil(h / step)));
  const pos = new Float32Array((nx + 1) * (ny + 1) * 2);
  let k = 0;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { pos[k++] = x + (w * i) / nx; pos[k++] = y + (h * j) / ny; }
  const idx = new Uint32Array(nx * ny * 6);
  k = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.set([a, b, c, b, d, c], k); k += 6; }
  return { pos, idx };
}
// layer pixels are straight RGB light + coverage alpha; light must not be dimmed by its own coverage,
// so the texture stores rgb as-is and alpha separately (no premultiply on upload)

export async function createGlowRig(canvas, { layersUrl, spec: specIn, zoom = 1, offsetY = 0 } = {}) {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: false, antialias: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 unavailable');
  const base = layersUrl.slice(0, layersUrl.lastIndexOf('/') + 1);
  const spec = specIn || await (await fetch(layersUrl)).json();
  const R = spec.rig, W = spec.width, H = spec.height;
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const U = new Proxy({}, { get: (c, n) => (n in c ? c[n] : (c[n] = gl.getUniformLocation(prog, n))) });
  const aSrc = gl.getAttribLocation(prog, 'a_src');

  const makeTex = (img) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const makeMesh = ({ pos, idx }) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aSrc);
    gl.vertexAttribPointer(aSrc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, n: idx.length };
  };

  await Promise.all(spec.layers.filter((l) => l.file).map(async (l) => { l.tex = makeTex(await loadImage(base + l.file)); }));
  const head = R.head;
  const ap = R.aperture;
  const draw = [];
  let fi = 0;
  for (const l of spec.layers) {
    let bb = l.bbox || [0, 0, W, H];
    if (l.kind === 'halo') {
      const m = l.meta; const r = m.radius + 40;
      bb = [m.center[0] - r, m.center[1] - r, 2 * r, 2 * r];
    }
    if (l.kind === 'aperture_glow') {
      if (!ap) continue;
      bb = [ap.x0 - 10, ap.top - 20, ap.x1 - ap.x0 + 20, ap.bottom - ap.top + 40];
    }
    const step = l.kind === 'static' ? 1e6 : l.kind.startsWith('aperture') ? 2 : 8;
    const d = { ...l, bbox: bb, mesh: makeMesh(gridMesh(...bb, step)) };
    if (l.kind === 'float') {
      const f = l.float || {};
      d.fl = { amp: f.amp || [1, 3], freq: f.freq || 0.15, rot: ((f.rot_deg || 0) * Math.PI) / 180,
        pivot: f.pivot || [bb[0] + bb[2] / 2, bb[1] + bb[3] / 2], phase: 1.7 * fi + 0.4, phase2: 2.3 * fi + 1.1 };
      fi++;
    }
    if (l.kind === 'eye') d.eyeC = l.meta?.center || [bb[0] + bb[2] / 2, bb[1] + bb[3] / 2];
    draw.push(d);
  }

  let frame = { head: { yaw: 0, pitch: 0, roll: 0 }, eyes: { blinkL: 0, blinkR: 0, gazeX: 0, gazeY: 0 }, brow: { raise: 0 }, mouth: { open: 0, visemes: {} } };
  let env = null, envRate = 100;
  const envHist = new Float32Array(48);
  let voiceS = 0, lastT = null, openS = 0;

  const deg = Math.PI / 180;
  let view = [1, 1, 0, 0];
  function layout() {
    const cw = canvas.width, ch = canvas.height;
    const s = (ch / H) * (Number(zoom) || 1);
    const ox = cw / 2 - (W / 2) * s, oy = ch / 2 - (H / 2) * s + offsetY * ch;
    view = [(2 * s) / cw, (-2 * s) / ch, (2 * ox) / cw - 1, 1 - (2 * oy) / ch];
  }
  layout();
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform1i(U.u_tex, 0);

  const levelAt = (t) => {
    if (!env) return Math.max(0, Math.min(1.2, frame.mouth?.open || 0));
    const i = t * envRate;
    const i0 = Math.floor(i);
    if (i0 < 0 || i0 >= env.length - 1) return 0;
    return env[i0] + (env[i0 + 1] - env[i0]) * (i - i0);
  };

  function render(t) {
    const hd = frame.head || {}, ey = frame.eyes || {};
    const sh = shapeFrom(frame.mouth?.visemes);
    const open = typeof frame.mouth?.open === 'number' ? frame.mouth.open : sh.open;
    // smoothed voice level: fast attack, slow release (calm, nothing jittery)
    if (lastT === null || t < lastT || t - lastT > 1) { voiceS = levelAt(t); openS = open; }
    else {
      const dt = t - lastT, lv = Math.min(1.2, levelAt(t));
      voiceS += (lv - voiceS) * (1 - Math.exp(-dt / (lv > voiceS ? 0.03 : 0.14)));
      openS += (open - openS) * (1 - Math.exp(-dt / 0.035));
    }
    lastT = t;
    for (let i = 0; i < 48; i++) envHist[i] = Math.min(1.2, levelAt(t - i / 40));

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform4f(U.u_view, ...view);
    gl.uniform2f(U.u_headC, head.center[0], head.center[1]);
    gl.uniform2f(U.u_headR, head.radius[0], head.radius[1]);
    gl.uniform1f(U.u_pivotY, head.pivot_y ?? head.chin_y);
    gl.uniform1f(U.u_imgH, H);
    gl.uniform3f(U.u_ang, (hd.yaw || 0) * deg, (hd.pitch || 0) * deg, (hd.roll || 0) * deg);
    gl.uniform1f(U.u_breath, (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 5.2)) * H * 0.006);
    gl.uniform1f(U.u_sway, (0.35 * Math.sin(t * 0.37) + 0.2 * Math.sin(t * 0.61 + 1.3)) * deg);
    gl.uniform1f(U.u_t, t);
    gl.uniform1fv(U['u_env[0]'], envHist);
    gl.uniform1f(U.u_voice, voiceS);
    const shim = R.shimmer;
    if (shim) { gl.uniform3f(U.u_shim, shim.center[0], shim.center[1], shim.speed_px_s); gl.uniform2f(U.u_shimK, shim.wavelength_px, shim.gain); }
    gl.uniform1f(U.u_tipPulse, (R.tip_pulse || 0) * Math.sin((2 * Math.PI * t) / 5.2 - 0.6));
    const gp = R.glint;
    if (gp) {
      // the sweep follows the head turn plus a slow drift, so light seems to move over the facets
      const ang = -0.6;
      const dir = [Math.cos(ang), Math.sin(ang)];
      const span = W * 1.4;
      const pos = ((t * 0.045 + (hd.yaw || 0) * 0.02) % 1) * span - span * 0.2 + dir[0] * 0 ;
      gl.uniform4f(U.u_glintP, dir[0], dir[1], pos, gp.width_px);
      gl.uniform1f(U.u_glintGain, gp.gain);
    }
    const lift = ap ? openS * (ap.open_frac || 0.15) * (ap.bottom - ap.top) * (0.75 + 0.35 * Math.min(1, voiceS)) : 0;
    if (ap) { gl.uniform4f(U.u_aper, ap.top, ap.seam_y, ap.bottom, lift); gl.uniform2f(U.u_aperX, ap.x0, ap.x1); }

    for (const l of draw) {
      const kind = KIND[l.kind] ?? 2;
      if (kind === 8 && lift < 0.2) continue;
      gl.uniform1i(U.u_kind, kind);
      gl.uniform1f(U.u_depth, l.depth || 0);
      gl.uniform1f(U.u_follow, l.follow ?? (kind === 0 || kind === 1 ? 0 : 1));
      const isLight = l.mode === 'light' || kind === 8 || kind === 9;
      gl.uniform1f(U.u_occl, isLight ? 0 : (l.occl ?? 1));
      let gain = l.gain ?? 1;
      if (kind === 5) gain *= 0.9 + (l.voice_gain || 2) * Math.max(voiceS * 0.8, openS) * 0.6;
      if (kind === 10) gain *= 1 + (l.pulse?.amp || 0.15) * Math.sin(2 * Math.PI * (l.pulse?.freq || 0.2) * t) + (l.voice_gain || 0) * voiceS;
      if (kind === 9) gain *= 0.92 + 0.08 * Math.sin((2 * Math.PI * t) / 5.2) + 0.12 * voiceS;
      if (kind === 4) {
        const blink = l.name.endsWith('_l') ? (ey.blinkL || 0) : (ey.blinkR || 0);
        if (l.blink === 'iris') {
          gl.uniform4f(U.u_eye, l.eyeC[0], l.eyeC[1], 0.92 * Math.pow(blink, 0.8), 0);
          gl.uniform4f(U.u_eyeP, blink, l.eyeC[0], l.eyeC[1], l.meta?.core_r || 12);
          gain *= 1 - 0.6 * blink;
        } else {
          gl.uniform4f(U.u_eye, l.eyeC[0], l.eyeC[1], 0.35 * blink, 0);
          gl.uniform4f(U.u_eyeP, 0, 0, 0, 1);
          // crisp: bright cyan to dark crystal in the middle of the blink
          gain *= 1 - smoothstep01((blink - 0.25) / 0.4);
        }
        gl.uniform2f(U.u_gaze, (ey.gazeX || 0) * 3.5, (ey.gazeY || 0) * 2.0);
        gain *= 1 + 0.12 * voiceS; // the eyes warm a little while she speaks
      }
      gl.uniform1f(U.u_gain, gain);
      gl.uniform1f(U.u_bloom, l.bloom || 0);
      gl.uniform1i(U.u_shimmer, l.shimmer && shim ? 1 : 0);
      gl.uniform1i(U.u_glint, l.glint && gp ? 1 : 0);
      if (kind === 3 && l.fl) {
        const f = l.fl, w = 2 * Math.PI * f.freq;
        gl.uniform4f(U.u_float, f.amp[0] * Math.sin(w * 0.77 * t + f.phase2), -f.amp[1] * Math.sin(w * t + f.phase), f.rot * Math.sin(w * 0.6 * t + f.phase + 0.8), 0);
        gl.uniform2f(U.u_floatPivot, f.pivot[0], f.pivot[1]);
      }
      if (kind === 9) {
        const m = l.meta;
        gl.uniform4f(U.u_ring, m.center[0], m.center[1], m.radius, Math.max(1.0, l.ring_w || 1.7));
        gl.uniform3f(U.u_ringCol, ...m.color.map((c) => Math.min(1, c * 1.25)));
      }
      if (l.tex) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, l.tex);
        gl.uniform4f(U.u_bbox, ...l.bbox);
      }
      gl.bindVertexArray(l.mesh.vao);
      gl.drawElements(gl.TRIANGLES, l.mesh.n, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }
  return {
    spec,
    setFrame(f) { if (f) frame = f; },
    setEnvelope(e, rate = 100) { env = e; envRate = rate; },
    render,
    reset() { lastT = null; },
    resize() { layout(); },
    dispose() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}
function smoothstep01(x) { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }
