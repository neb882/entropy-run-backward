/* gfx: a small shared WebGL2 renderer for the sky.
   HDR scene of additive sprites (plus 'dark' dust), progressive bloom, exponential tone map, optional point-mass lensing.
   Everything is in device pixels with a top-left origin; callers position points themselves. No rAF loop of its own. */
(() => {
'use strict';
const ENT = (window.ENT = window.ENT || {});

const BG = [5 / 255, 6 / 255, 9 / 255];          // #050609, the floor of the tone-mapped output
const LEVELS = 4;                                  // bloom pyramid: 1/2, 1/4, 1/8, 1/16
const MIN_PX = 2.0;                                // sprites smaller than this are drawn at this size with their energy conserved
const FP = 7, FS = 9;                              // floats per point / per smudge

/* ---------------------------------------------------------------- shaders */
const VS_SPRITE = `#version 300 es
precision highp float;
layout(location=0) in vec2 aC;
layout(location=1) in vec3 iP;     // x, y, size
layout(location=2) in vec4 iCol;   // r, g, b, a
layout(location=3) in vec2 iAS;    // angle, squash (smudges only)
uniform vec2 uRes; uniform float uSpread; uniform float uSmudge;
out vec2 vUV; out vec4 vCol; out float vPx;
void main() {
  float s = max(iP.z, 0.0);
  float sq = uSmudge > 0.5 ? clamp(iAS.y, 0.01, 1.0) : 1.0;
  float ang = uSmudge > 0.5 ? iAS.x : 0.0;
  float ma = max(s, ${MIN_PX.toFixed(1)}), mi = max(s * sq, ${MIN_PX.toFixed(1)});
  float e = (s * s * sq) / (ma * mi);
  vec2 c = aC * vec2(ma, mi) * 0.5 * uSpread;
  float ca = cos(ang), sa = sin(ang);
  vec2 p = iP.xy + vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y);
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
  vUV = aC * uSpread; vCol = vec4(iCol.rgb, iCol.a * e); vPx = 0.5 * mi;
}`;

const FS_SPRITE = `#version 300 es
precision highp float;
in vec2 vUV; in vec4 vCol; in float vPx;
uniform int uShape; uniform int uDark; uniform float uOut; uniform float uSpread;
out vec4 o;
float soft(float r2) { return r2 >= 1.0 ? 0.0 : (exp(-4.5 * r2) - 0.011109) * 1.011234; }
void main() {
  float r2 = dot(vUV, vUV), f;
  if (uShape == 0) {
    if (r2 >= 1.0) discard;
    f = soft(r2);
  } else if (uShape == 1) {           // star: soft core, faint halo, four thin diffraction spikes
    vec2 q = abs(vUV);
    float t = max(0.55 / vPx, 0.035); // spike half-thickness in uv units (about one device pixel)
    float lx = max(0.0, 1.0 - q.x / uSpread), ly = max(0.0, 1.0 - q.y / uSpread);
    float sp = exp(-(q.y * q.y) / (t * t)) * lx * lx * lx + exp(-(q.x * q.x) / (t * t)) * ly * ly * ly;
    float halo = exp(-r2 * 0.9) * max(0.0, 1.0 - sqrt(r2) / uSpread);
    f = soft(r2) + 0.09 * sp * min(1.0, 2.2 / vPx + 0.35) + 0.035 * halo;
  } else {                            // disc: hard anti-aliased edge
    f = clamp((1.0 - sqrt(r2)) * vPx + 0.5, 0.0, 1.0);
    if (f <= 0.0) discard;
  }
  if (uDark == 1) {
    float k = clamp(vCol.a * f, 0.0, 1.0);
    o = vec4(clamp(vCol.rgb, 0.0, 1.0) * k, k);
  } else {
    o = vec4(vCol.rgb * (vCol.a * f * uOut), 0.0);
    if (uOut < 1.0) {   // 8-bit fallback: dither each sprite so faint overlapping light accumulates instead of rounding away
      float h = fract(sin(dot(gl_FragCoord.xy + vUV * 41.0, vec2(12.9898, 78.233))) * 43758.5453);
      o.rgb = max(o.rgb + (h - 0.5) / 255.0, 0.0);
    }
  }
}`;

const VS_FULL = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const FS_PRE = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uT; uniform vec2 uTx; uniform float uIn, uTh, uKnee;
out vec4 o;
void main() {
  vec3 c = (texture(uT, vUV + uTx * vec2(-1, -1)).rgb + texture(uT, vUV + uTx * vec2(1, -1)).rgb +
            texture(uT, vUV + uTx * vec2(-1, 1)).rgb + texture(uT, vUV + uTx * vec2(1, 1)).rgb) * (0.25 * uIn);
  float br = max(c.r, max(c.g, c.b));
  float s = clamp(br - uTh + uKnee, 0.0, 2.0 * uKnee); s = s * s / (4.0 * uKnee + 1e-4);
  c *= max(s, br - uTh) / max(br, 1e-4);
  o = vec4(min(c, vec3(6e4)), 1.0);
}`;

const FS_DOWN = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uT; uniform vec2 uTx;
out vec4 o;
void main() {
  o = vec4((texture(uT, vUV + uTx * vec2(-1, -1)).rgb + texture(uT, vUV + uTx * vec2(1, -1)).rgb +
            texture(uT, vUV + uTx * vec2(-1, 1)).rgb + texture(uT, vUV + uTx * vec2(1, 1)).rgb) * 0.25, 1.0);
}`;

const FS_BLUR = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uT; uniform vec2 uDir;
out vec4 o;
void main() {   // 9-tap gaussian through 5 bilinear fetches
  vec3 c = texture(uT, vUV).rgb * 0.2270270270;
  vec2 d1 = uDir * 1.3846153846, d2 = uDir * 3.2307692308;
  c += (texture(uT, vUV + d1).rgb + texture(uT, vUV - d1).rgb) * 0.3162162162;
  c += (texture(uT, vUV + d2).rgb + texture(uT, vUV - d2).rgb) * 0.0702702703;
  o = vec4(c, 1.0);
}`;

const FS_UP = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uT; uniform float uW;
out vec4 o;
void main() { o = vec4(texture(uT, vUV).rgb * uW, 1.0); }`;

const FS_FINAL = `#version 300 es
precision highp float;
uniform sampler2D uScene, uBloom;
uniform vec2 uRes; uniform float uIn, uBloomK, uExp;
uniform vec4 uLens;   // x, y (device px, top-left origin), shadow, ring (px); ring <= 0 disables
uniform vec3 uBg;
out vec4 o;
vec2 lensUV(vec2 p, vec2 c, float E2) {      // device px (gl origin) -> scene uv
  vec2 d = p - c; float r = max(length(d), 1e-3);
  return (c + d * ((r - E2 / r) / r)) / uRes;
}
vec3 fetch(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.0);
  return texture(uScene, uv).rgb * uIn + texture(uBloom, uv).rgb * uBloomK;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 p = gl_FragCoord.xy;
  vec3 c;
  if (uLens.w > 0.0) {
    vec2 ctr = vec2(uLens.x, uRes.y - uLens.y);
    float s = uLens.z, E2 = uLens.w * uLens.w, r = length(p - ctr);
    c = fetch(lensUV(p, ctr, E2));
    c *= smoothstep(s - 0.75, s + 0.75, r);                    // shadow, anti-aliased
    float w = max(1.1, 0.035 * s);
    if (r < s + 14.0 * w && s > 0.5) {                          // photon ring: brightness follows the lensed sky around it
      vec3 m = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398 + 0.3927;
        vec2 q = ctr + vec2(cos(a), sin(a)) * s * 1.5;
        vec2 uv = lensUV(q, ctr, E2);
        if (uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0) m += textureLod(uScene, uv, 4.0).rgb * uIn + textureLod(uBloom, uv, 0.0).rgb * uBloomK;
      }
      m *= 0.125;
      float x = (r - s - w) / w;
      c += m * (3.2 * exp(-x * x) + 0.35 * exp(-x * x * 0.04)) * smoothstep(s - 0.75, s + 0.75, r);
    }
  } else {
    c = fetch(p / uRes);
  }
  c = 1.0 - exp(-uExp * max(c, vec3(0.0)));
  c = pow(c, vec3(1.0 / 2.2));
  float l = max(c.r, max(c.g, c.b));
  c += (hash(p) - 0.5) * (1.0 / 255.0) * smoothstep(0.0, 3.0 / 255.0, l);   // dither, zero where the sky is empty
  o = vec4(uBg + (1.0 - uBg) * clamp(c, 0.0, 1.0), 1.0);
}`;

/* ---------------------------------------------------------------- helpers */
function compile(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) { const m = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('gfx shader: ' + m); }
    return s;
  };
  const p = gl.createProgram(), a = mk(gl.VERTEX_SHADER, vs), b = mk(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p);
  gl.deleteShader(a); gl.deleteShader(b);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('gfx link: ' + gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}

function create(canvas, opts) {
  opts = opts || {};
  const maxDpr = opts.maxDpr || 1.5;
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  } catch (e) { gl = null; }
  if (!gl) return null;

  const size = { w: 0, h: 0, d: 1 };
  const stats = { draws: 0, points: 0, bytes: 0, capacity: 0, hdr: false };
  let R = null;          // GL resources (rebuilt after a context restore)
  let lost = false, inFrame = false, disposed = false;
  let fr = { exposure: 1, bloom: 0.8, bloomRadius: 1, threshold: 0.6 };
  let lensOn = false; const lensU = new Float32Array(4);
  let hasMips = false;

  function makeTex(w, h) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (R.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    return { t, f, w, h, ok };
  }
  function freeTargets() {
    if (!R || !R.targets) return;
    for (const x of R.targets) { gl.deleteTexture(x.t); gl.deleteFramebuffer(x.f); }
    R.targets = null;
  }
  function allocTargets() {
    freeTargets();
    const w = Math.max(1, size.w), h = Math.max(1, size.h);
    const all = [];
    const scene = makeTex(w, h); all.push(scene);
    const A = [], B = [];
    for (let i = 0; i < LEVELS; i++) {
      const lw = Math.max(1, w >> (i + 1)), lh = Math.max(1, h >> (i + 1));
      A.push(makeTex(lw, lh)); B.push(makeTex(lw, lh));
    }
    all.push(...A, ...B);
    R.targets = all; R.scene = scene; R.A = A; R.B = B; hasMips = false;
    if (R.hdr && !all.every((x) => x.ok)) { R.hdr = false; allocTargets(); }   // half float not renderable after all: fall back to RGBA8
  }

  function init() {
    R = {};
    const hf = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    R.hdr = !!hf;
    R.sprite = compile(gl, VS_SPRITE, FS_SPRITE);
    R.pre = compile(gl, VS_FULL, FS_PRE);
    R.down = compile(gl, VS_FULL, FS_DOWN);
    R.blur = compile(gl, VS_FULL, FS_BLUR);
    R.up = compile(gl, VS_FULL, FS_UP);
    R.fin = compile(gl, VS_FULL, FS_FINAL);
    R.emptyVao = gl.createVertexArray();
    R.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, R.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    R.inst = gl.createBuffer(); R.cap = 0;
    const vao = (stride, smudge) => {
      const v = gl.createVertexArray(); gl.bindVertexArray(v);
      gl.bindBuffer(gl.ARRAY_BUFFER, R.quad);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, R.inst);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 0); gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 12); gl.vertexAttribDivisor(2, 1);
      if (smudge) { gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 28); gl.vertexAttribDivisor(3, 1); }
      gl.bindVertexArray(null);
      return v;
    };
    R.vaoP = vao(FP * 4, false); R.vaoS = vao(FS * 4, true);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.DITHER);
    stats.hdr = R.hdr;
    if (size.w > 0) allocTargets();
  }

  function onLost(e) { e.preventDefault(); lost = true; inFrame = false; R = null; }
  function onRestored() { if (disposed) return; try { init(); lost = false; } catch (err) { lost = true; } }
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  try { init(); } catch (e) {
    canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
    return null;
  }

  function resize() {
    const r = canvas.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, maxDpr);
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    size.d = d;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (w !== size.w || h !== size.h || (R && !R.targets)) { size.w = w; size.h = h; if (R && !lost) allocTargets(); }
    return size;
  }

  function begin(o) {
    if (lost || disposed || !R) { inFrame = false; return; }
    if (!R.targets || canvas.width !== size.w || canvas.height !== size.h) resize();
    if (o) {
      fr.exposure = o.exposure != null ? o.exposure : 1; fr.bloom = o.bloom != null ? o.bloom : 0.8;
      fr.bloomRadius = o.bloomRadius != null ? o.bloomRadius : 1; fr.threshold = o.threshold != null ? o.threshold : 0.6;
    }
    stats.draws = 0; stats.points = 0; stats.bytes = 0; lensOn = false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.scene.f);
    gl.viewport(0, 0, size.w, size.h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(R.sprite.p);
    gl.uniform2f(R.sprite.u.uRes, size.w, size.h);
    gl.uniform1f(R.sprite.u.uOut, R.hdr ? 1 : 0.5);
    gl.enable(gl.BLEND);
    inFrame = true;
  }

  function upload(data, floats) {
    const bytes = floats * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, R.inst);
    if (bytes > R.cap) R.cap = Math.max(bytes, Math.ceil(R.cap * 1.5), 65536);
    gl.bufferData(gl.ARRAY_BUFFER, R.cap, gl.DYNAMIC_DRAW);        // orphan
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, floats);
    stats.bytes += bytes; stats.capacity = R.cap;
  }

  function draw(data, count, o, smudge) {
    if (!inFrame || !count || count <= 0) return;
    const per = smudge ? FS : FP;
    count = Math.min(count | 0, Math.floor(data.length / per));
    if (count <= 0) return;
    upload(data, count * per);
    const dark = o && o.blend === 'dark';
    const shape = o && o.shape === 'star' ? 1 : o && o.shape === 'disc' ? 2 : 0;
    const spread = shape === 1 ? 4.0 : 1.0;
    const u = R.sprite.u;
    gl.uniform1i(u.uShape, shape); gl.uniform1i(u.uDark, dark ? 1 : 0);
    gl.uniform1f(u.uSpread, spread); gl.uniform1f(u.uSmudge, smudge ? 1 : 0);
    if (dark) gl.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(smudge ? R.vaoS : R.vaoP);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
    stats.draws++; stats.points += count;
  }

  function lens(o) {
    if (!inFrame || !o) return;
    const s = Math.max(0, +o.shadow || 0), E = Math.max(0, +o.ring || 0);
    if (E <= 0) { lensOn = false; return; }
    lensU[0] = +o.x || 0; lensU[1] = +o.y || 0; lensU[2] = s; lensU[3] = E; lensOn = true;
  }

  function pass(prog, dst) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.f : null);
    gl.viewport(0, 0, dst ? dst.w : size.w, dst ? dst.h : size.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    stats.draws++;
  }
  function bindTex(unit, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); }

  function end() {
    if (!inFrame || lost || !R) { inFrame = false; return; }
    inFrame = false;
    const A = R.A, B = R.B, sc = R.scene, hdr = R.hdr;
    const inS = hdr ? 1 : 2, bloomK = fr.bloom * (hdr ? 1 : 0.6), rad = Math.max(0.25, Math.min(3, fr.bloomRadius));
    gl.disable(gl.BLEND);
    gl.bindVertexArray(R.emptyVao);
    if (bloomK > 0) {
      // bright pass into level 0 (half res)
      gl.useProgram(R.pre.p);
      bindTex(0, sc.t); gl.uniform1i(R.pre.u.uT, 0);
      gl.uniform2f(R.pre.u.uTx, 0.5 / sc.w, 0.5 / sc.h);
      gl.uniform1f(R.pre.u.uIn, inS); gl.uniform1f(R.pre.u.uTh, fr.threshold); gl.uniform1f(R.pre.u.uKnee, Math.max(0.05, fr.threshold * 0.5));
      pass(R.pre, A[0]);
      for (let i = 0; i < LEVELS; i++) {
        if (i > 0) {
          gl.useProgram(R.down.p); bindTex(0, A[i - 1].t); gl.uniform1i(R.down.u.uT, 0);
          gl.uniform2f(R.down.u.uTx, 0.5 / A[i - 1].w, 0.5 / A[i - 1].h);
          pass(R.down, A[i]);
        }
        gl.useProgram(R.blur.p); gl.uniform1i(R.blur.u.uT, 0);
        bindTex(0, A[i].t); gl.uniform2f(R.blur.u.uDir, rad / A[i].w, 0); pass(R.blur, B[i]);
        bindTex(0, B[i].t); gl.uniform2f(R.blur.u.uDir, 0, rad / A[i].h); pass(R.blur, A[i]);
      }
      // upsample and add, coarse to fine
      gl.useProgram(R.up.p); gl.uniform1i(R.up.u.uT, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = LEVELS - 1; i > 0; i--) {
        bindTex(0, A[i].t); gl.uniform1f(R.up.u.uW, Math.min(1.6, 0.55 + 0.45 * rad));
        pass(R.up, A[i - 1]);
      }
      gl.disable(gl.BLEND);
    }
    // final composite (lensing, tone map, floor)
    bindTex(0, sc.t);
    if (lensOn) { gl.generateMipmap(gl.TEXTURE_2D); if (!hasMips) { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); hasMips = true; } }
    else if (hasMips) { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); hasMips = false; }
    bindTex(1, A[0].t);
    const u = R.fin.u;
    gl.useProgram(R.fin.p);
    gl.uniform1i(u.uScene, 0); gl.uniform1i(u.uBloom, 1);
    gl.uniform2f(u.uRes, size.w, size.h);
    gl.uniform1f(u.uIn, inS); gl.uniform1f(u.uBloomK, bloomK > 0 ? bloomK : 0); gl.uniform1f(u.uExp, fr.exposure);
    gl.uniform3f(u.uBg, BG[0], BG[1], BG[2]);
    if (lensOn) gl.uniform4fv(u.uLens, lensU); else gl.uniform4f(u.uLens, 0, 0, 0, 0);
    pass(R.fin, null);
    gl.bindVertexArray(null);
  }

  function dispose() {
    if (disposed) return;
    disposed = true; inFrame = false;
    canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
    if (R && !lost) {
      freeTargets();
      for (const k of ['sprite', 'pre', 'down', 'blur', 'up', 'fin']) gl.deleteProgram(R[k].p);
      gl.deleteBuffer(R.quad); gl.deleteBuffer(R.inst);
      gl.deleteVertexArray(R.vaoP); gl.deleteVertexArray(R.vaoS); gl.deleteVertexArray(R.emptyVao);
    }
    R = null;
    const ext = gl.getExtension('WEBGL_lose_context'); if (ext && !gl.isContextLost()) ext.loseContext();
  }

  return {
    resize, begin, end, lens, dispose,
    points: (data, count, o) => draw(data, count, o, false),
    smudges: (data, count, o) => draw(data, count, o, true),
    get isLost() { return lost || (gl && gl.isContextLost()); },
    get hdr() { return !!(R && R.hdr); },
    get size() { return size; },   // the last { w, h, d } from resize(), read-only by convention
    stats, gl,
  };
}

ENT.gfx = { create };
})();
