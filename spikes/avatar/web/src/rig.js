// t1-rig runtime: a layered 2D portrait deformed per layer in a WebGL2 vertex shader.
// One program, one draw per layer, no per-frame allocation. All motion is a deformation field over
// source-pixel space so neighbouring layers move together and the hairline cannot tear; layers
// differ only by depth (parallax) and by the few fields that belong to them (lips, iris, hair).
import { shapeFrom } from './visemes.js';

const KIND = {
  static: 0, body: 1, neck: 2, head: 3, hair_back: 4, hair_front: 5, eye_white: 6, iris: 7,
  lip_upper: 8, lip_lower: 9, mouth_hole: 10, lid: 11, backdrop: 12,
};
const HEADLIKE = new Set(['head', 'hair_back', 'hair_front', 'eye_white', 'iris', 'lip_upper', 'lip_lower', 'mouth_hole', 'lid']);

const VS = `#version 300 es
precision highp float;
precision highp int;
in vec2 a_src;
uniform vec4 u_view;          // clip = src * u_view.xy + u_view.zw
uniform int u_kind;
uniform float u_depth;
uniform vec2 u_headC, u_headR;
uniform float u_chinY, u_crownY, u_imgH;
uniform vec3 u_ang;           // yaw pitch roll, radians
uniform float u_breath;       // px, already scaled
uniform vec2 u_spring;        // px offset of the hair tips
uniform vec2 u_hair;          // root y, length
uniform vec4 u_browA, u_browB;// cx cy w amp
uniform float u_brow;
uniform vec4 u_mouth;         // cx, -, x0, x1
uniform float u_line[16];
uniform vec4 u_mouthP;        // upper_h lower_h band openPx
uniform vec4 u_mshape;        // open wide round press
uniform float u_bite;
out vec2 v_src;
out float v_shade;
out float v_s;
out float v_gap;

float lineAt(float x) {
  float u = clamp((x - u_mouth.z) / max(1.0, u_mouth.w - u_mouth.z), 0.0, 1.0) * 15.0;
  int i = int(floor(u)); int j = min(i + 1, 15);
  return mix(u_line[i], u_line[j], fract(u));
}

// lower/upper lip displacement (y) at x, before shaping
void lipDisp(vec2 p, out float upper, out float lower, out float dy0) {
  float hw = 0.5 * (u_mouth.w - u_mouth.z);
  float cx = 0.5 * (u_mouth.z + u_mouth.w);
  float L = lineAt(p.x);
  float hu = u_mouthP.x, hl = u_mouthP.y, openPx = u_mouthP.w;
  dy0 = p.y - L;
  float dxn = (p.x - cx) / hw;
  float corner = pow(max(0.0, 1.0 - dxn * dxn), 0.6);
  float open = u_mshape.x;
  float R = u_headR.x;
  float fxJaw = 1.0 - smoothstep(0.45 * R, 0.92 * R, abs(p.x - cx));
  float lipZone = 1.0 - smoothstep(hl, hl * 3.0, dy0);
  lower = open * openPx * (lipZone * corner + (1.0 - lipZone) * 0.85 * fxJaw);
  lower -= u_bite * hl * 0.45 * corner * lipZone;
  float upperZone = 1.0 - smoothstep(hu, hu * 3.0, -dy0);
  upper = -open * openPx * 0.12 * corner * upperZone;
}

vec2 mouthField(vec2 p, float sMode) {
  float upper, lower, dy0;
  lipDisp(p, upper, lower, dy0);
  float b = u_mouthP.z;
  float s = sMode < -0.5 ? smoothstep(-b, b, dy0) : sMode;
  v_s = s;
  v_gap = lower - upper;
  float dy = mix(upper, lower, s);
  float hw = 0.5 * (u_mouth.w - u_mouth.z);
  float cx = 0.5 * (u_mouth.z + u_mouth.w);
  float zx = (p.x - cx) / (1.5 * hw);
  float zy = dy0 / (2.5 * max(u_mouthP.x, u_mouthP.y));
  float zone = exp(-(zx * zx + zy * zy) * 2.0);
  float dx = (p.x - cx) * (u_mshape.y * 0.13 - u_mshape.z * 0.2) * zone;
  dy += dy0 * (u_mshape.z * 0.2 - u_mshape.w * 0.25) * zone;
  return vec2(dx, dy);
}

vec2 browField(vec2 p, vec4 B) {
  vec2 d = (p - B.xy) / vec2(1.1 * B.z, 0.9 * B.z);
  return vec2(0.0, -u_brow * B.w * exp(-dot(d, d) * 1.6));
}

void main() {
  vec2 p = a_src;
  v_s = 0.0; v_gap = 0.0; v_shade = 1.0;
  if (u_kind == 12 || u_kind == 0) {
    v_src = p;
    gl_Position = vec4(p * u_view.xy + u_view.zw, 0.0, 1.0);
    return;
  }
  bool headLike = u_kind >= 3;

  // 1. local fields in head space
  if (headLike && u_kind != 4) {
    float sMode = u_kind == 8 ? 0.0 : (u_kind == 9 ? 1.0 : -1.0);
    if (u_kind != 7 && u_kind != 11 && u_kind != 6) p += mouthField(p, sMode);
    p += browField(p, u_browA) + browField(p, u_browB);
  }
  if (u_kind == 4 || u_kind == 5) {
    float w = smoothstep(u_hair.x, u_hair.x + u_hair.y, p.y);
    p += u_spring * pow(w, 1.4);
  }

  // 2. head rotation: orthographic sphere warp + per-layer depth, attenuated through the neck
  float wHead = headLike ? 1.0 : 1.0 - smoothstep(u_chinY - 0.05 * u_headR.y, u_chinY + 0.6 * u_headR.y, p.y);
  // hair that falls past the chin rests on the shoulders: it follows the head less the lower it hangs
  if (u_kind == 4) wHead = 1.0 - 0.8 * smoothstep(u_chinY, u_chinY + 1.0 * u_headR.y, p.y);
  vec2 u = (p - u_headC) / u_headR;
  float zs = sqrt(max(0.0, 1.0 - dot(u, u)));
  float z = (u_kind == 4 ? 0.0 : zs) + u_depth;
  if (!headLike) z = 0.0;
  float yaw = u_ang.x * wHead, pitch = u_ang.y * wHead, roll = u_ang.z * wHead;
  float cy = cos(yaw), sy = sin(yaw), cp = cos(pitch), sp = sin(pitch);
  float x1 = u.x * cy + z * sy;
  float z1 = -u.x * sy + z * cy;
  float y1 = u.y * cp + z1 * sp;
  float z2 = -u.y * sp + z1 * cp;
  vec2 q = u_headC + vec2(x1, y1) * u_headR;
  // a touch of perspective: nearer points spread out
  q = u_headC + (q - u_headC) * (1.0 + 0.04 * (z2 - z) * wHead);
  if (headLike) {
    vec3 L = normalize(vec3(-0.45, -0.55, 0.7));
    vec3 n0 = vec3(u, zs);
    vec3 n1 = vec3(u.x * cy + zs * sy, 0.0, -u.x * sy + zs * cy);
    n1.y = u.y * cp + n1.z * sp; n1.z = -u.y * sp + n1.z * cp;
    v_shade = 1.0 + 0.22 * (dot(n1, L) - dot(n0, L)) * step(0.001, zs);
  }
  // roll about the neck pivot
  vec2 piv = vec2(u_headC.x, u_chinY);
  float cr = cos(roll), sr = sin(roll);
  vec2 r = q - piv;
  q = piv + vec2(r.x * cr - r.y * sr, r.x * sr + r.y * cr);

  // 3. body: a slight follow of the head, and breathing (shoulders and head rise, hips fixed)
  float body = clamp((u_imgH - a_src.y) / max(1.0, u_imgH - u_chinY), 0.0, 1.0);
  q.x += sin(u_ang.x) * u_headR.x * 0.06 * body * (1.0 - wHead);
  q.y -= u_breath * body;

  v_src = a_src;
  gl_Position = vec4(q * u_view.xy + u_view.zw, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_src;
in float v_shade;
in float v_s;
in float v_gap;
uniform int u_kind;
uniform sampler2D u_tex;      // layer texture (premultiplied)
uniform vec4 u_bbox;          // x y w h of u_tex in source px
uniform sampler2D u_tex2;     // eye mask (iris) / unused
uniform vec4 u_bbox2;
uniform vec2 u_gaze;          // px
uniform float u_alpha;
uniform float u_bias;
uniform vec4 u_edgeFade;      // backdrop/static: x0 x1 fade
// mouth hole
uniform vec4 u_mouth;
uniform vec4 u_mshape;
uniform vec4 u_mouthP;
uniform float u_teeth;
uniform vec3 u_lipCol;
uniform float u_mouthW;
// lids
uniform float u_eyeTop[32];
uniform float u_eyeBot[32];
uniform vec4 u_eyeX;          // L x0 x1, R x0 x1
uniform vec2 u_blink;
uniform vec2 u_eyeH;
uniform vec2 u_eyeL;
out vec4 o;

vec4 tex(sampler2D t, vec4 bb, vec2 p, float bias) {
  vec2 uv = (p - bb.xy) / bb.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return texture(t, uv, bias);
}
float arr(float a[32], int base, float u) {
  float f = clamp(u, 0.0, 1.0) * 15.0;
  int i = int(floor(f)); int j = min(i + 1, 15);
  return mix(a[base + i], a[base + j], fract(f));
}

void main() {
  if (u_kind == 10) { // procedural mouth interior
    float hw = 0.5 * (u_mouth.w - u_mouth.z);
    float cx = 0.5 * (u_mouth.z + u_mouth.w);
    float dxn = (v_src.x - cx) / hw;
    float gap = max(v_gap, 0.001);
    float yPx = v_s * gap;                     // px below the upper lip edge
    vec3 throat = u_lipCol * 0.18 + vec3(0.03, 0.0, 0.01);
    vec3 col = mix(u_lipCol * 0.42, throat, smoothstep(0.0, 0.8, 1.0 - abs(dxn)) * smoothstep(0.0, 0.5, v_s));
    // tongue
    float tg = smoothstep(0.55, 0.95, v_s) * (1.0 - smoothstep(0.35, 0.8, abs(dxn))) * smoothstep(0.25, 0.6, u_mshape.x);
    col = mix(col, u_lipCol * vec3(0.95, 0.55, 0.58) * 0.75, tg);
    // upper teeth
    float th = u_mouthW * 0.15 * u_teeth + 0.06 * gap;
    float teeth = (1.0 - smoothstep(th * 0.7, th, yPx)) * (1.0 - smoothstep(0.3, 0.8, abs(dxn)));
    // teeth sit in shadow: darker toward the corners and right under the lip, faint gaps between them
    float gaps = 1.0 - 0.12 * pow(abs(cos(dxn * 9.5)), 24.0) * (1.0 - abs(dxn));
    vec3 tcol = vec3(0.80, 0.76, 0.70) * (0.55 + 0.45 * (1.0 - abs(dxn) * abs(dxn))) * (0.7 + 0.3 * smoothstep(0.0, th * 0.6, yPx)) * gaps;
    col = mix(col, tcol, teeth * step(0.02, u_teeth));
    // lower teeth, only when wide open
    float lth = u_mouthW * 0.07 * u_teeth * smoothstep(0.35, 0.8, u_mshape.x);
    float lteeth = smoothstep(gap - lth, gap - lth * 0.6, yPx) * (1.0 - smoothstep(0.4, 0.75, abs(dxn)));
    col = mix(col, vec3(0.74, 0.70, 0.64) * 0.75, lteeth * 0.6);
    // lip shadow at the top edge
    col *= 0.6 + 0.4 * smoothstep(0.0, u_mouthW * 0.04, yPx);
    // only the stretched band between the lips is the opening; what lies beyond it belongs under the lips
    float ha = smoothstep(0.0, 0.05, v_s) * (1.0 - smoothstep(0.95, 1.0, v_s));
    o = vec4(col, 1.0) * ha * u_alpha;
    return;
  }
  if (u_kind == 11) { // eyelids
    int e = v_src.x < 0.5 * (u_eyeX.y + u_eyeX.z) ? 0 : 1;
    float x0 = e == 0 ? u_eyeX.x : u_eyeX.z, x1 = e == 0 ? u_eyeX.y : u_eyeX.w;
    float uu = (v_src.x - x0) / max(1.0, x1 - x0);
    if (uu < 0.0 || uu > 1.0) discard;
    float top = arr(u_eyeTop, e * 16, uu), bot = arr(u_eyeBot, e * 16, uu);
    float blink = e == 0 ? u_blink.x : u_blink.y;
    float H = e == 0 ? u_eyeH.x : u_eyeH.y;
    float L = e == 0 ? u_eyeL.x : u_eyeL.y;     // upper lash/lid-margin band thickness
    float C = top + (bot - top) * 0.74;          // where the lids meet when closed
    float E = mix(top + L, max(C, top + L), blink); // lower edge of the upper lid
    float lowY = mix(bot, max(C, top + L), blink);
    float crease = top - 0.45 * H;
    float y = v_src.y;
    float ys;
    vec4 c;
    if (y >= crease && y <= E) {
      if (y > E - L) ys = top + L - (E - y);    // the lash band rides the lid edge rigidly
      else ys = crease + (y - crease) * (top - crease) / max(0.5, (E - L) - crease);
      c = tex(u_tex, u_bbox, vec2(v_src.x, ys), 0.0);
      c.rgb *= 1.0 - 0.15 * smoothstep(E - L, E, y) * blink;
    } else if (y > lowY && y < bot + 0.3 * H) {
      float lb = bot + 0.3 * H;
      ys = bot + (y - lowY) * (lb - bot) / max(0.5, lb - lowY);
      c = tex(u_tex, u_bbox, vec2(v_src.x, ys), 0.0);
    } else if (y > E && y < E + 0.12 * H) {
      float a = 0.3 * blink * (1.0 - (y - E) / (0.12 * H));
      o = vec4(0.0, 0.0, 0.0, a);
      return;
    } else discard;
    float edge = smoothstep(0.0, 0.08, uu) * smoothstep(1.0, 0.92, uu);
    o = c * mix(1.0, edge, 0.0) * u_alpha;
    return;
  }
  vec4 c;
  if (u_kind == 7) {
    c = tex(u_tex, u_bbox, v_src - u_gaze, 0.0);
    c *= tex(u_tex2, u_bbox2, v_src, 0.0).a;
  } else {
    c = tex(u_tex, u_bbox, v_src, u_bias);
  }
  if (u_kind == 0 && u_edgeFade.z > 0.0) {
    c *= smoothstep(u_edgeFade.x, u_edgeFade.x + u_edgeFade.z, v_src.x) * smoothstep(u_edgeFade.y, u_edgeFade.y - u_edgeFade.z, v_src.x);
  }
  if (u_kind == 12) c.rgb *= 0.97;
  c.rgb *= v_shade;
  o = c * u_alpha;
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
  return s;
}

async function loadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return createImageBitmap(await res.blob(), { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' });
}

function gridMesh(x, y, w, h, step) {
  const nx = Math.max(1, Math.min(200, Math.ceil(w / step)));
  const ny = Math.max(1, Math.min(200, Math.ceil(h / step)));
  const pos = new Float32Array((nx + 1) * (ny + 1) * 2);
  let k = 0;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { pos[k++] = x + (w * i) / nx; pos[k++] = y + (h * j) / ny; }
  const idx = new Uint32Array(nx * ny * 6);
  k = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.set([a, b, c, b, d, c], k); k += 6;
  }
  return { pos, idx };
}

// mouth-hole mesh: rows follow the lip line so the opening is resolved however the line curves
function holeMesh(rig) {
  const m = rig.mouth;
  const nx = 48;
  const offs = [];
  const b = m.band;
  for (let i = 0; i <= 6; i++) offs.push(-m.upper_h * 0.7 + (i / 6) * (m.upper_h * 0.7 - b));
  for (let i = 1; i <= 12; i++) offs.push(-b + (2 * b * i) / 12);
  for (let i = 1; i <= 6; i++) offs.push(b + (i / 6) * (m.lower_h * 0.7 - b));
  const ny = offs.length - 1;
  const pos = new Float32Array((nx + 1) * (ny + 1) * 2);
  const lineAt = (x) => {
    const u = Math.min(1, Math.max(0, (x - m.x0) / (m.x1 - m.x0))) * 15;
    const i = Math.floor(u), j = Math.min(15, i + 1);
    return m.line[i] + (m.line[j] - m.line[i]) * (u - i);
  };
  let k = 0;
  const cx = (m.x0 + m.x1) / 2, hw = (m.x1 - m.x0) / 2;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const inset = 0;
    const x = m.x0 + inset + ((m.x1 - m.x0 - 2 * inset) * i) / nx;
    const dxn = (x - cx) / hw;
    const kk = Math.sqrt(Math.max(0, 1 - dxn * dxn));
    const off = offs[j];
    const kb = 0.35 + 0.65 * kk;
    const y = lineAt(x) + (Math.abs(off) <= b + 1e-6 ? off * kb : Math.sign(off) * (b * kb + (Math.abs(off) - b) * kk));
    pos[k++] = x; pos[k++] = y;
  }
  const idx = new Uint32Array(nx * ny * 6);
  k = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, bb = a + 1, c = a + nx + 1, d = c + 1;
    idx.set([a, bb, c, bb, d, c], k); k += 6;
  }
  return { pos, idx };
}

export async function createRig(canvas, { layersUrl, fit = 'height', zoom = 1, offsetY = 0 } = {}) {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: false, antialias: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 unavailable');
  const base = layersUrl.slice(0, layersUrl.lastIndexOf('/') + 1);
  const spec = await (await fetch(layersUrl)).json();
  const R = spec.rig;
  const W = spec.width, H = spec.height;

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const U = new Proxy({}, { get: (c, n) => (n in c ? c[n] : (c[n] = gl.getUniformLocation(prog, n))) });
  const aSrc = gl.getAttribLocation(prog, 'a_src');

  function makeTex(img) {
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
  }
  function makeMesh({ pos, idx }) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aSrc);
    gl.vertexAttribPointer(aSrc, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, n: idx.length };
  }

  // textures
  const byName = {};
  await Promise.all(spec.layers.filter((l) => l.file).map(async (l) => {
    l.tex = makeTex(await loadImage(base + l.file));
    byName[l.name] = l;
  }));
  const eyeMask = spec.layers.find((l) => l.kind === 'eye_mask');
  const lidSrc = spec.layers.find((l) => l.kind === 'lid_source');
  const bg = spec.layers.find((l) => l.kind === 'static');

  // derived rig constants
  const head = R.head;
  const mouth = R.mouth;
  if (mouth) {
    mouth.w = mouth.x1 - mouth.x0;
    mouth.band = Math.max(2.5, 0.22 * Math.min(mouth.upper_h, mouth.lower_h));
    mouth.openPx = mouth.open_px || Math.max(0.3 * mouth.w, 0.1 * head.radius[1]);
  }
  // meshes
  const draw = [];
  if (bg) draw.push({ ...bg, kind: 'backdrop', mesh: makeMesh(gridMesh(...bg.bbox, 1e6)) });
  for (const l of spec.layers) {
    if (l.kind === 'eye_mask' || l.kind === 'lid_source') continue;
    let mesh;
    if (l.kind === 'mouth_hole') { if (!R.mouth) continue; mesh = makeMesh(holeMesh(R)); }
    else if (l.kind === 'lid') {
      if (!R.eyes?.length || !lidSrc) continue;
      const xs = R.eyes.flatMap((e) => [e.x0, e.x1]);
      const tops = R.eyes.flatMap((e) => e.top), bots = R.eyes.flatMap((e) => e.bottom);
      const hmax = Math.max(...R.eyes.map((e) => e.h));
      const x0 = Math.min(...xs) - 2, x1 = Math.max(...xs) + 2;
      const y0 = Math.min(...tops) - 0.5 * hmax, y1 = Math.max(...bots) + 0.4 * hmax;
      mesh = makeMesh(gridMesh(x0, y0, x1 - x0, y1 - y0, 4));
      l.tex = lidSrc.tex; l.bbox = lidSrc.bbox;
    } else if (l.kind === 'iris') {
      const bb = eyeMask ? eyeMask.bbox : l.bbox;
      const x0 = Math.min(bb[0], l.bbox[0]) - 4, y0 = Math.min(bb[1], l.bbox[1]) - 4;
      const x1 = Math.max(bb[0] + bb[2], l.bbox[0] + l.bbox[2]) + 4, y1 = Math.max(bb[1] + bb[3], l.bbox[1] + l.bbox[3]) + 4;
      mesh = makeMesh(gridMesh(x0, y0, x1 - x0, y1 - y0, 6));
    } else if (l.kind === 'static') {
      mesh = makeMesh(gridMesh(...l.bbox, 1e6));
    } else {
      const fine = HEADLIKE.has(l.kind) ? 6 : 12;
      mesh = makeMesh(gridMesh(...l.bbox, fine));
    }
    draw.push({ ...l, mesh });
  }

  for (const e of R.eyes || []) e.h = e.h || Math.max(...e.bottom.map((b, i) => b - e.top[i]));
  const eyeTop = new Float32Array(32), eyeBot = new Float32Array(32), eyeX = [0, 0, 0, 0], eyeH = [1, 1], eyeL = [1, 1];
  const eyes = [...(R.eyes || [])].sort((a, b) => a.x0 - b.x0);
  eyes.slice(0, 2).forEach((e, i) => {
    eyeTop.set(e.top, i * 16); eyeBot.set(e.bottom, i * 16);
    eyeX[i * 2] = e.x0; eyeX[i * 2 + 1] = e.x1; eyeH[i] = e.h; eyeL[i] = e.lash ?? 0.2 * e.h;
  });
  if (eyes.length === 1) { eyeTop.set(eyes[0].top, 16); eyeBot.set(eyes[0].bottom, 16); eyeX[2] = eyes[0].x0; eyeX[3] = eyes[0].x1; eyeH[1] = eyes[0].h; eyeL[1] = eyeL[0]; }
  const irisTravel = eyes.length ? eyes.reduce((s, e) => s + (e.x1 - e.x0), 0) / eyes.length : 20;
  const brows = (R.brows || []).slice(0, 2);
  const browAmp = 0.05 * head.radius[1];

  // hair springs: front and back, simulated in px at 240 Hz
  const hairFront = draw.find((l) => l.kind === 'hair_front');
  const hairBack = draw.find((l) => l.kind === 'hair_back');
  const springs = {
    front: { f: 3.0, z: 0.3, x: [0, 0], v: [0, 0], tipDy: hairFront ? hairFront.bbox[1] + hairFront.bbox[3] - head.chin_y : -head.radius[1], gain: 1.3 },
    back: { f: 1.8, z: 0.22, x: [0, 0], v: [0, 0], tipDy: hairBack ? hairBack.bbox[1] + hairBack.bbox[3] - head.chin_y : head.radius[1], gain: 1.8 },
  };
  for (const l of draw) {
    if (l.kind === 'hair_back') { const root = head.crown_y + 0.35 * head.radius[1]; l.hair = [root, Math.max(20, l.bbox[1] + l.bbox[3] - root)]; }
    if (l.kind === 'hair_front') { const root = head.crown_y; l.hair = [root, Math.max(20, l.bbox[1] + l.bbox[3] - root)]; }
  }

  let frame = { head: { yaw: 0, pitch: 0, roll: 0 }, eyes: { blinkL: 0, blinkR: 0, gazeX: 0, gazeY: 0 }, brow: { raise: 0 }, mouth: { open: 0, visemes: {} } };
  let simT = null;
  let prevAng = [0, 0, 0];
  let curAng = [0, 0, 0];
  const deg = Math.PI / 180;

  function anchorOf(ang) {
    // px displacement of the hair mass due to head pose (approximate, linearised)
    return [Math.sin(ang[0]) * head.radius[0] * 0.55, Math.sin(ang[1]) * head.radius[1] * 0.35];
  }
  function stepPhysics(t) {
    const dt = 1 / 240;
    if (simT === null || t < simT - 1e-6 || t - simT > 5) { simT = t; for (const s of Object.values(springs)) { s.x = [0, 0]; s.v = [0, 0]; s.hv = null; } prevAng = curAng.slice(); return; }
    const steps = Math.min(2400, Math.round((t - simT) / dt));
    const a0 = prevAng, a1 = curAng;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const ang = [a0[0] + (a1[0] - a0[0]) * k, a0[1] + (a1[1] - a0[1]) * k, a0[2] + (a1[2] - a0[2]) * k];
      const kp = (i - 1) / steps;
      const angP = [a0[0] + (a1[0] - a0[0]) * kp, a0[1] + (a1[1] - a0[1]) * kp, a0[2] + (a1[2] - a0[2]) * kp];
      const h = anchorOf(ang), hp = anchorOf(angP);
      const tt = simT + i * dt;
      for (const s of Object.values(springs)) {
        const w = 2 * Math.PI * s.f;
        // gravity pulls the tips back toward vertical against the roll
        const eq = [s.tipDy * Math.sin(ang[2]) * 0.35, 0];
        const wind = [0.35 * Math.sin(tt * 1.3 + s.f) + 0.2 * Math.sin(tt * 2.7), 0.12 * Math.sin(tt * 1.9)];
        const hv = [(h[0] - hp[0]) / dt, (h[1] - hp[1]) / dt];
        const ha = s.hv ? [(hv[0] - s.hv[0]) / dt, (hv[1] - s.hv[1]) / dt] : [0, 0];
        s.hv = hv;
        for (let d = 0; d < 2; d++) {
          // offset of the tip from its head-carried rest: x'' = -w^2 (x - eq) - 2 z w x' - h''
          const acc = -w * w * (s.x[d] - eq[d]) - 2 * s.z * w * s.v[d] - ha[d] * s.gain + wind[d] * w * w;
          s.v[d] += acc * dt;
          s.x[d] += s.v[d] * dt;
        }
      }
    }
    simT += steps * dt;
    prevAng = curAng.slice();
  }

  // view
  let view = [1, 1, 0, 0];
  function layout() {
    const cw = canvas.width, ch = canvas.height;
    let s = fit === 'height' ? ch / H : Math.min(cw / W, ch / H);
    // 'auto': frame head and shoulders - the head (crown to chin) fills ~44 % of the frame height
    const z = zoom === 'auto' ? Math.min(3.5, Math.max(1, (0.44 * H) / Math.max(1, R.head.chin_y - Math.min(R.head.crown_y, R.head.center[1] - R.head.radius[1])))) : Number(zoom) || 1;
    s *= z;
    // zoom > 1 frames the head: the view centre moves from the image centre to the head centre
    const k = Math.min(1, Math.max(0, z - 1));
    const fx = W / 2 + (R.head.center[0] - W / 2) * k, fy = H / 2 + (R.head.center[1] + R.head.radius[1] * 0.6 - H / 2) * k;
    const ox = cw / 2 - fx * s, oy = ch / 2 - fy * s + offsetY * ch;
    // src -> pixels -> clip
    view = [(2 * s) / cw, (-2 * s) / ch, (2 * ox) / cw - 1, 1 - (2 * oy) / ch];
    const sc = Math.max(cw / W, ch / H) * 1.04;
    viewCover = [(2 * sc) / cw, (-2 * sc) / ch, (2 * ((cw - W * sc) / 2)) / cw - 1, 1 - (2 * ((ch - H * sc) / 2)) / ch];
    edgeFade = W * s < cw - 1 ? [0, W, W * 0.06] : [0, W, 0];
  }
  let viewCover = view, edgeFade = [0, 0, 0];
  layout();

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform1i(U.u_tex, 0);
  gl.uniform1i(U.u_tex2, 1);

  function render(t) {
    const hd = frame.head || {};
    curAng = [(hd.yaw || 0) * deg, (hd.pitch || 0) * deg, (hd.roll || 0) * deg];
    stepPhysics(t);
    const ey = frame.eyes || {};
    const vis = frame.mouth?.visemes;
    const sh = shapeFrom(vis);
    const open = typeof frame.mouth?.open === 'number' ? frame.mouth.open : sh.open;
    const breath = (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 4.6)) * head.radius[1] * 0.018 + Math.sin(t * 0.21) * 0.3;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.06, 0.06, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.u_headC, head.center[0], head.center[1]);
    gl.uniform2f(U.u_headR, head.radius[0], head.radius[1]);
    gl.uniform1f(U.u_chinY, head.chin_y);
    gl.uniform1f(U.u_crownY, head.crown_y);
    gl.uniform1f(U.u_imgH, H);
    gl.uniform3f(U.u_ang, curAng[0], curAng[1], curAng[2]);
    gl.uniform1f(U.u_breath, breath);
    const bA = brows[0] ? [brows[0].center[0], brows[0].center[1], brows[0].w, browAmp] : [0, -1e4, 1, 0];
    const bB = brows[1] ? [brows[1].center[0], brows[1].center[1], brows[1].w, browAmp] : [0, -1e4, 1, 0];
    gl.uniform4f(U.u_browA, ...bA);
    gl.uniform4f(U.u_browB, ...bB);
    gl.uniform1f(U.u_brow, frame.brow?.raise || 0);
    if (mouth) {
      gl.uniform4f(U.u_mouth, mouth.center[0], mouth.center[1], mouth.x0, mouth.x1);
      gl.uniform1fv(U['u_line[0]'], mouth.line);
      gl.uniform4f(U.u_mouthP, mouth.upper_h, mouth.lower_h, mouth.band, mouth.openPx);
      gl.uniform1f(U.u_mouthW, mouth.w);
      gl.uniform3f(U.u_lipCol, ...(mouth.lip_rgb || [0.62, 0.3, 0.32]));
    } else {
      gl.uniform4f(U.u_mouth, 0, -1e4, -2e4, -1e4);
      gl.uniform4f(U.u_mouthP, 1, 1, 1, 0);
    }
    gl.uniform4f(U.u_mshape, Math.max(0, Math.min(1, open)), sh.wide, sh.round, sh.press);
    gl.uniform1f(U.u_bite, sh.bite);
    gl.uniform1f(U.u_teeth, Math.min(1, sh.teeth + (sh.sum > 0 ? 0 : 0.5)));
    const gz = [ (ey.gazeX || 0) * irisTravel * 0.17, (ey.gazeY || 0) * irisTravel * 0.07 ];
    gl.uniform2f(U.u_gaze, gz[0], gz[1]);
    // the upper lid follows a downward gaze a little
    const lidFollow = Math.max(0, ey.gazeY || 0) * 0.18;
    const bl = Math.min(1, (ey.blinkL || 0) + lidFollow), br = Math.min(1, (ey.blinkR || 0) + lidFollow);
    // eyes are sorted by x: image-left is the subject's right eye
    gl.uniform2f(U.u_blink, br, bl);
    gl.uniform1fv(U['u_eyeTop[0]'], eyeTop);
    gl.uniform1fv(U['u_eyeBot[0]'], eyeBot);
    gl.uniform4f(U.u_eyeX, ...eyeX);
    gl.uniform2f(U.u_eyeH, eyeH[0], eyeH[1]);
    gl.uniform2f(U.u_eyeL, eyeL[0], eyeL[1]);
    gl.uniform1f(U.u_alpha, 1);

    for (const l of draw) {
      const kind = KIND[l.kind] ?? 3;
      if (kind === KIND.lid && Math.max(bl, br) < 0.01) continue;
      if (kind === KIND.mouth_hole && open < 0.005) continue;
      gl.uniform1i(U.u_kind, kind);
      gl.uniform1f(U.u_depth, l.depth || 0);
      gl.uniform4f(U.u_view, ...(kind === KIND.backdrop ? viewCover : view));
      gl.uniform1f(U.u_bias, kind === KIND.backdrop ? 5.0 : 0.0);
      gl.uniform4f(U.u_edgeFade, ...(kind === KIND.static ? edgeFade : [0, 0, 0]), 0);
      if (l.hair) {
        const s = l.kind === 'hair_front' ? springs.front : springs.back;
        gl.uniform2f(U.u_spring, s.x[0], s.x[1]);
        gl.uniform2f(U.u_hair, l.hair[0], l.hair[1]);
      } else gl.uniform2f(U.u_spring, 0, 0);
      if (l.tex) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, l.tex);
        gl.uniform4f(U.u_bbox, ...l.bbox);
      }
      if (kind === KIND.iris && eyeMask) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, eyeMask.tex);
        gl.uniform4f(U.u_bbox2, ...eyeMask.bbox);
      }
      gl.bindVertexArray(l.mesh.vao);
      gl.drawElements(gl.TRIANGLES, l.mesh.n, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  return {
    spec,
    setFrame(f) { if (f) frame = f; },
    render,
    reset() { simT = null; },
    resize() { layout(); },
    get springs() { return springs; },
    dispose() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}
