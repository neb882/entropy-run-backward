(() => {
'use strict';
const ENT = window.ENT;
const { $, reduced, mulberry32, blackbody } = ENT;
const track = $('wtTrack');
if (!track) return;
const stage = $('wtStage'), glCv = $('wtGL'), ov = $('wtOv'), octx = ov.getContext('2d');
const phoneMQ = window.matchMedia('(max-width: 760px)');

const TOTAL = 8, TAU = Math.PI * 2, U_NOW = 10.1396;
const NOW0 = 3.05, NOW1 = 3.30;            // the false now: hard cut in, hard cut out
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const inNow = (s) => s >= NOW0 && s < NOW1;
function gauss(rnd) { let a = 0; while (a === 0) a = rnd(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(TAU * rnd()); }

/* blackbody -> linear rgb, brightest channel 1 (log-spaced look-up, 600 K .. 40 000 K) */
const LUT_N = 512, LT0 = 600, LT1 = 40000, LUT = new Float32Array(LUT_N * 3);
for (let i = 0; i < LUT_N; i++) {
  const c = blackbody(LT0 * Math.pow(LT1 / LT0, i / (LUT_N - 1))).map((v) => Math.pow(v / 255, 2.2));
  const m = Math.max(c[0], c[1], c[2], 1e-6);
  LUT[i * 3] = c[0] / m; LUT[i * 3 + 1] = c[1] / m; LUT[i * 3 + 2] = c[2] / m;
}
const lutIdx = (T) => Math.max(0, Math.min(LUT_N - 1, Math.round(Math.log(T / LT0) / Math.log(LT1 / LT0) * (LUT_N - 1)))) * 3;
const BONE_LIN = [0.83, 0.78, 0.69];
const BG = [5, 6, 9];
// the renderer's tone map, for the Canvas 2D path and for the HUD's ink: linear scene value -> 0..255
function tone(r, g, b, out) {
  const f = (c) => Math.pow(1 - Math.exp(-Math.max(0, c)), 1 / 2.2);
  out[0] = BG[0] + (255 - BG[0]) * f(r); out[1] = BG[1] + (255 - BG[1]) * f(g); out[2] = BG[2] + (255 - BG[2]) * f(b);
  return out;
}

/* ================================================================ the clock */
const nfmt = (x) => (x < 10 ? (Math.floor(x * 10 + 1e-6) / 10).toFixed(1) : String(Math.floor(x + 1e-6)));
function towerHTML(s) {
  if (s < 0.8) return `10<sup>${Math.floor(lerp(108, 1000, s / 0.8) + 1e-6)}</sup> years`;
  if (s < 5.0) {
    const N = s < 3 ? lerp(3, 50, (s - 0.8) / 2.2) : s < 3.5 ? 50 : lerp(50, 122, (s - 3.5) / 1.5);
    return `10<sup>10<sup>${nfmt(N)}</sup></sup> years`;
  }
  const M = s < 5.6 ? lerp(2.1, 56, (s - 5.0) / 0.6) : 56;
  return `10<sup>10<sup>10<sup>${nfmt(M)}</sup></sup></sup> years`;
}
const LOG_FL = Math.log10(3.8e5), LOG_FS = Math.log10(2e8);
function yearsAt(s) {
  if (s < 7.3) return 3.8e5 * Math.pow(clamp01((s - 6.9) / 0.4), 4);
  return Math.pow(10, lerp(LOG_FL, LOG_FS, clamp01((s - 7.3) / 0.5)));
}
function fmtYears(t) {
  if (t < 1) return '0 years';
  if (t < 1.5) return '1 year';
  if (t < 99.5) return `${Math.round(t)} years`;
  let e = Math.floor(Math.log10(t)), m = Math.round(t / Math.pow(10, e - 1));
  if (m >= 100) { m = 10; e++; }
  const v = m * Math.pow(10, e - 1);
  if (v < 1e6) return `${v.toLocaleString('en-US')} years`;
  const mm = v / 1e6;
  return `${mm < 10 ? String(Math.round(mm * 10) / 10) : String(Math.round(mm))} million years`;
}
const clockHTML = (s) => (s >= 6.9 ? fmtYears(yearsAt(s)) : towerHTML(s));

/* ================================================================ the void: motes and chance glints */
const rngM = mulberry32(31337);
const MOTES = [];
for (let i = 0; i < 60; i++) {
  const sp = 0.35 + rngM() * 1.1, ang = rngM() * TAU;
  MOTES.push({ x: rngM(), y: rngM(), vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, a: 0.07 + rngM() * 0.09 });
}
function moteVis(s) {
  if (s < 2.9) return 1;
  if (s < 3.0) return 1 - smooth((s - 2.9) / 0.1);
  if (s < 3.5) return 0;
  if (s < 3.62) return smooth((s - 3.5) / 0.12);
  if (s < 5.48) return 1;
  if (s < 5.6) return 1 - smooth((s - 5.48) / 0.12);
  return 0;
}
// glints: positions along the scroll, seeded; irregularly spaced but never overlapping
const GW = 0.03;                     // half-width of a glint in screens (inside the ±0.035 allowed)
function spaced(rng, n, a, b, gap) {
  const slack = b - a - (n - 1) * gap, w = []; let sum = 0;
  for (let i = 0; i <= n; i++) { const e = -Math.log(1 - rng() * 0.999); w.push(e); sum += e; }
  const out = []; let x = a + (slack * w[0]) / sum;
  for (let i = 0; i < n; i++) { out.push(x); x += gap + (slack * w[i + 1]) / sum; }
  return out;
}
const rngG = mulberry32(90210);
const GL_S = [...spaced(rngG, 24, 0.9 + GW, 2.9 - GW, 2 * GW + 0.004), ...spaced(rngG, 14, 3.6 + GW, 5.5 - GW, 2 * GW + 0.004)];
const GLINTS = GL_S.map((s, k) => {
  const n = 2 + Math.floor(rngG() * 6), parts = [];
  for (let i = 0; i < n; i++) {
    let dx, dy; do { dx = gauss(rngG) * 5; dy = gauss(rngG) * 5; } while (dx * dx + dy * dy > 13 * 13);
    parts.push([dx, dy, 0.55 + rngG() * 0.9]);
  }
  return { s, parts, seed: 1000 + k * 7919, x: 0, y: 0, T: 5200 + rngG() * 2600 };
});
const FIRST_GLINT = GLINTS[0].s;
const bump = (d) => { const q = d / GW; return q <= -1 || q >= 1 ? 0 : Math.pow(1 - q * q, 5); };
function glintAt(s) {
  for (const gl of GLINTS) { const b = bump(s - gl.s); if (b > 0) return [gl, b]; }
  return null;
}

/* ================================================================ the new beginning */
// cooling: [fraction of 6.9 -> 7.6, temperature K, linear brightness]
const COOL = [[0, 11000, 60], [0.08, 7500, 8], [0.18, 5200, 2.4], [0.36, 2600, 1.0], [0.55, 1800, 0.55], [0.72, 1300, 0.28], [0.88, 1000, 0.08], [1, 800, 0]];
function coolAt(c, out) {
  c = clamp01(c);
  let i = 1; while (i < COOL.length - 1 && c > COOL[i][0]) i++;
  const a = COOL[i - 1], b = COOL[i], t = (c - a[0]) / (b[0] - a[0]);
  out.T = Math.exp(lerp(Math.log(a[1]), Math.log(b[1]), t));
  out.L = b[2] > 0 ? Math.exp(lerp(Math.log(a[2]), Math.log(b[2]), t)) : a[2] * (1 - t) * (1 - t);
  out.m = 0.16 * smooth((c - 0.3) / 0.55);            // mottling contrast: appears as it darkens
  return out;
}
const COOLV = { T: 0, L: 0, m: 0 };
const pointI = (p) => 0.012 * Math.pow(10, 2.75 * p);  // 5.6 -> 6.2: barely visible, then brighter
const inflI = (q) => 6.7 * Math.pow(9, q);              // 6.2 -> 6.9: up to 60
let KINF = 6.5, P_X = 0.6, P_Y = 0.5;                   // growth rate (set from the screen), the point's place
const inflR = (q) => 2.6 * Math.exp(KINF * q);          // CSS px
// the glow is three nested soft sprites (core, shoulder, long tail), so it reads as light and not as a ball
const PROF = [[1, 1], [2.4, 0.06], [6, 0.012]];
const softF = (r2) => (r2 >= 1 ? 0 : (Math.exp(-4.5 * r2) - 0.011109) * 1.011234);
function profileAt(dist, r, I) { let v = 0; for (const [m, w] of PROF) { const q = dist / (r * m); v += I * w * softF(q * q); } return v; }
// first stars
const rngS = mulberry32(777);
const STARS = [];
for (let i = 0; i < 36; i++) {
  const L = 0.7 + Math.pow(rngS(), 4) * 5;
  STARS.push({ x: 0.04 + rngS() * 0.92, y: 0.05 + rngS() * 0.9, T: 11000 * Math.pow(30000 / 11000, rngS()), L, sz: 1.7 + rngS() * 1.0, on: 7.63 + Math.pow(rngS(), 1.3) * 0.3 });
}
STARS.sort((a, b) => b.L - a.L);
const NSPIKY = 5;

/* ================================================================ the false now: a fallback galaxy (the demo recipe, trimmed) */
let GAL = null;
function buildGalaxy(N) {
  const rnd = mulberry32(20261117), logU = (a, b) => a * Math.pow(b / a, rnd()), k = N / 60000, kL = Math.sqrt(1 / k);
  const PS = (n) => ({ n: 0, X: new Float32Array(n), Y: new Float32Array(n), Z: new Float32Array(n), S: new Float32Array(n), T: new Float32Array(n), L: new Float32Array(n), K: new Uint8Array(n), out: new Float32Array(n * 7) });
  const add = (ps, x, y, z, sz, T, L, pink) => { const i = ps.n++; ps.X[i] = x; ps.Y[i] = y; ps.Z[i] = z; ps.S[i] = sz; ps.T[i] = T; ps.L[i] = L; ps.K[i] = pink ? 1 : 0; };
  const pitch = 21, ARMS = [[0, 0.2, 1, 1.0, pitch], [Math.PI, 0.2, 1, 1.0, pitch], [Math.PI * 0.5 + 0.6, 0.36, 0.5, 0.96, pitch + 2], [Math.PI * 1.5 + 0.6, 0.36, 0.5, 0.96, pitch + 2]];
  for (let i = 0; i < 10; i++) { const r0 = 0.28 + rnd() * 0.5; ARMS.push([rnd() * TAU, r0, 0.2 + rnd() * 0.2, Math.min(1, r0 + 0.1 + rnd() * 0.22), pitch - 3 + rnd() * 10]); }
  for (const a of ARMS) a.push(1 / Math.tan((a[4] * Math.PI) / 180), Math.tan((a[4] * Math.PI) / 180));
  const AW = []; let aw = 0; for (const a of ARMS) { aw += a[2] * (a[3] - a[1]) * (a[2] >= 1 ? 1.4 : 1); AW.push(aw); }
  const armTh = (a, r) => a[0] + Math.log(r / a[1]) * a[5];
  const pick = () => { const u = rnd() * aw; let i = 0; while (AW[i] < u) i++; return ARMS[i]; };
  const armR = (a) => {
    if (a[2] < 0.45) return a[1] + (a[3] - a[1]) * (rnd() + rnd()) * 0.5;
    for (;;) { const r = a[1] + 0.01 + (-Math.log(1 - rnd()) - Math.log(1 - rnd())) * 0.17 * (a[2] < 1 ? 0.7 : 1); if (r < a[3]) return r; }
  };
  const swell = (a, r) => { const q = Math.sin(r * 21 + a[0] * 3.1) * Math.sin(r * 9.3 + a[0]); return 0.65 + 0.7 * q * q; };
  const onArm = (a, wid, angJ, side) => {
    const r = armR(a), th = armTh(a, r) + gauss(rnd) * angJ, gg = gauss(rnd);
    const rr = r + (side ? Math.abs(gg) * 1.2 - 0.003 : gg) * wid(r) * swell(a, r);
    return [rr * Math.cos(th), rr * Math.sin(th), r];
  };
  const back = PS(N), front = PS(Math.round(N * 0.2));
  const nH = Math.round(N * 0.03), nB = Math.round(N * 0.15), nD = Math.round(N * 0.18), nHII = Math.round(420 * Math.max(0.6, k));
  const nA = N - nH - nB - nD - nHII;
  for (let i = 0; i < nH; i++) {
    const r = 0.1 + -Math.log(1 - rnd() * 0.97) * 0.3, ct = rnd() * 2 - 1, st = Math.sqrt(1 - ct * ct), ph = rnd() * TAU, z = r * ct * 0.75;
    add(z > 0 ? front : back, r * st * Math.cos(ph), r * st * Math.sin(ph), z, 1.7, logU(2900, 4000), (0.04 + rnd() * 0.05) * kL);
  }
  for (let i = 0; i < nB; i++) {
    const u = rnd(), r = 0.03 * Math.pow(-Math.log(1 - u * 0.9995), 1.6) + 0.002, ct = rnd() * 2 - 1, st = Math.sqrt(1 - ct * ct), ph = rnd() * TAU, z = r * ct * 0.6;
    add(z > 0 ? front : back, r * st * Math.cos(ph), r * st * Math.sin(ph), z, 2.2 + rnd() * 1.2, logU(3800, 5400), (0.07 + rnd() * 0.07) * kL);
  }
  for (let i = 0; i < nD; i++) {
    let r; do { r = -Math.log(1 - rnd()) * 0.26 + 0.04; } while (r > 1.1);
    const ph = rnd() * TAU;
    add(back, r * Math.cos(ph), r * Math.sin(ph), gauss(rnd) * 0.012, 1.8 + rnd() * 0.6, logU(4600, 8000), (0.026 + rnd() * 0.03) * kL);
  }
  const knots = [];
  for (let i = 0; i < 420 * Math.max(0.6, k); i++) { const a = pick(), p = onArm(a, (r) => 0.008 + r * 0.018, 0.02, 1); knots.push([p[0], p[1], 0.003 + rnd() * 0.009]); }
  for (let i = 0; i < nA; i++) {
    let x, y, T, L, sz;
    if (rnd() < 0.3) {
      const kn = knots[(rnd() * knots.length) | 0];
      x = kn[0] + gauss(rnd) * kn[2]; y = kn[1] + gauss(rnd) * kn[2];
      T = logU(14000, 40000); L = 0.1 + Math.pow(rnd(), 5) * 1.2; sz = 1.8 + rnd() * 1.2;
    } else {
      const a = pick(), young = rnd() < 0.6;
      const p = onArm(a, young ? (r) => 0.01 + r * 0.026 : (r) => 0.03 + r * 0.06, young ? 0.02 : 0.05, young ? 1 : 0);
      x = p[0]; y = p[1]; T = young ? logU(14000, 40000) : logU(5500, 9000);
      L = ((young ? 0.048 : 0.034) + Math.pow(rnd(), 6) * (young ? 0.6 : 0.15)) * (0.5 + 0.5 * a[2]) * (1.15 - 0.45 * p[2]); sz = 2.2 + rnd() * 1.6;
    }
    add(back, x, y, gauss(rnd) * 0.008, sz, T, L * kL);
  }
  for (let i = 0; i < nHII;) {
    const a = pick(), r = Math.max(a[1] + 0.06, armR(a)), th = armTh(a, r) + gauss(rnd) * 0.02, rr = r - 0.01 + gauss(rnd) * 0.008;
    const cx = rr * Math.cos(th), cy = rr * Math.sin(th), m = 3 + ((rnd() * 8) | 0);
    for (let j = 0; j < m && i < nHII; j++, i++) add(front, cx + gauss(rnd) * 0.004, cy + gauss(rnd) * 0.004, 0, 1.5 + rnd() * 1.1, 40000, (0.1 + Math.pow(rnd(), 3) * 0.5) * kL, true);
  }
  // unresolved arm light and dust: elliptical sprites lying in the disk plane
  const SM = (n) => ({ n: 0, X: new Float32Array(n), Y: new Float32Array(n), TX: new Float32Array(n), TY: new Float32Array(n), Lm: new Float32Array(n), Sq: new Float32Array(n), A: new Float32Array(n), T: new Float32Array(n), out: new Float32Array(n * 9) });
  const addS = (o, x, y, tx, ty, len, sq, A, T) => { const i = o.n++, l = Math.hypot(tx, ty) || 1; o.X[i] = x; o.Y[i] = y; o.TX[i] = tx / l; o.TY[i] = ty / l; o.Lm[i] = len; o.Sq[i] = sq; o.A[i] = A; o.T[i] = T || 0; };
  const nG = Math.round(N * 0.08), glow = SM(nG);
  for (let i = 0; i < nG; i++) {
    const a = pick(), p = onArm(a, (r) => 0.012 + r * 0.03, 0.03, 0), th = Math.atan2(p[1], p[0]), c = Math.cos(th), s = Math.sin(th);
    addS(glow, p[0], p[1], a[6] * c - s, a[6] * s + c, 0.045 + rnd() * 0.045 + p[2] * 0.02, 0.3 + rnd() * 0.18,
      ((0.018 + rnd() * 0.012) * (0.45 + 0.55 * Math.min(1, a[2])) * (1.2 - 0.6 * p[2])) / k, logU(9500, 24000));
  }
  const nDust = Math.round(N * 0.09), dust = SM(nDust);
  for (let i = 0; i < Math.round(nDust * 0.72); i++) {
    const a = pick(); let r = armR(a); r = Math.max(r, a[1] + 0.015);
    const strand = ((rnd() * 3) | 0) - 1;
    const th = armTh(a, r) + gauss(rnd) * 0.015, rr = r - (0.002 + r * 0.006) + strand * (0.003 + r * 0.006) + gauss(rnd) * (0.003 + r * 0.005);
    const c = Math.cos(th), s = Math.sin(th), q = Math.sin(r * 31 + a[0] * 5) * Math.cos(r * 13 - a[0]), patch = 0.25 + 1.1 * q * q;
    const fade = Math.min(1, (r - a[1]) / 0.08) * (1.1 - 0.6 * r);
    addS(dust, rr * c, rr * s, a[6] * c - s, a[6] * s + c, 0.035 + rnd() * 0.05, 0.28 + rnd() * 0.25, (0.22 + rnd() * 0.24) * (0.5 + 0.5 * Math.min(1, a[2])) * fade * patch);
  }
  while (dust.n < nDust) {
    const r = 0.06 + Math.pow(rnd(), 0.9) * 0.6, ph = rnd() * TAU, c = Math.cos(ph), s = Math.sin(ph);
    addS(dust, r * c, r * s, -s + 0.3 * c, c + 0.3 * s, 0.02 + rnd() * 0.04, 0.3 + rnd() * 0.3, (0.08 + rnd() * 0.14) * (1 - r * 0.9));
  }
  const SMOOTH = [[1.8, 5800, 0.022, 1], [1.25, 5600, 0.045, 1], [0.8, 5300, 0.08, 1], [0.45, 5000, 0.12, 1],
    [0.62, 4400, 0.05, 0.7], [0.36, 4500, 0.13, 0.72], [0.17, 4700, 0.34, 0.78], [0.075, 5000, 0.9, 0.85], [0.026, 5600, 4.0, 0.99]];
  // our own galaxy's foreground stars and a few distant galaxies
  const nF = Math.round(240 * Math.max(0.45, k * 2.7)), field = PS(nF), spiky = PS(4);
  for (let i = 0; i < nF; i++) add(field, rnd(), rnd(), 0, 1.6 + rnd() * 0.6, logU(3200, 12000), 0.025 + Math.pow(rnd(), 6) * 0.7);
  for (let i = 0; i < 4; i++) add(spiky, 0.06 + rnd() * 0.88, 0.06 + rnd() * 0.88, 0, 3.6 + rnd() * 2, logU(4500, 11000), 1.0 + rnd() * 1.2);
  const far = [];
  while (far.length < 22) { const x = rnd(), y = rnd(); if (((x - 0.55) / 0.34) ** 2 + ((y - 0.5) / 0.22) ** 2 < 1) continue; far.push([x, y, 5 + rnd() * 9, logU(4200, 7000), 0.03 + rnd() * 0.06, rnd() * Math.PI, 0.25 + rnd() * 0.7]); }
  // colours (static)
  const col = (ps) => { for (let i = 0; i < ps.n; i++) { const o = i * 7; if (ps.K[i]) { ps.out[o + 3] = 1; ps.out[o + 4] = 0.3; ps.out[o + 5] = 0.48; } else { const j = lutIdx(ps.T[i]); ps.out[o + 3] = LUT[j]; ps.out[o + 4] = LUT[j + 1]; ps.out[o + 5] = LUT[j + 2]; } ps.out[o + 6] = ps.L[i]; } };
  [back, front, field, spiky].forEach(col);
  for (let i = 0; i < glow.n; i++) { const o = i * 9, j = lutIdx(glow.T[i]); glow.out[o + 3] = LUT[j]; glow.out[o + 4] = LUT[j + 1]; glow.out[o + 5] = LUT[j + 2]; glow.out[o + 6] = glow.A[i]; }
  for (let i = 0; i < dust.n; i++) { const o = i * 9; dust.out[o + 3] = 0.6; dust.out[o + 4] = 0.78; dust.out[o + 5] = 1.0; dust.out[o + 6] = dust.A[i]; }
  const smooth9 = new Float32Array(SMOOTH.length * 9), far9 = new Float32Array(far.length * 9);
  SMOOTH.forEach((m, i) => { const j = lutIdx(m[1]), o = i * 9; smooth9[o + 3] = LUT[j]; smooth9[o + 4] = LUT[j + 1]; smooth9[o + 5] = LUT[j + 2]; smooth9[o + 6] = m[3] < 1 ? m[2] * 0.5 : m[2]; });
  far.forEach((f, i) => { const j = lutIdx(f[3]), o = i * 9; far9[o + 3] = LUT[j]; far9[o + 4] = LUT[j + 1]; far9[o + 5] = LUT[j + 2]; far9[o + 6] = f[4]; far9[o + 7] = f[5]; far9[o + 8] = f[6]; });
  return { back, front, field, spiky, glow, dust, SMOOTH, smooth9, nDisk: SMOOTH.filter((m) => m[3] >= 1).length, far, far9, key: '' };
}
// geometry of Act II's opening frame (as in descent.js): centre right of middle on wide screens, galaxy radius R, tilted 16°
const G_INC = Math.acos(0.3), G_PA = -0.16, G_PHI = 0.6;
function nowGeom(cw, ch) {
  const cx = cw * (cw >= 900 ? 0.585 : 0.5), cy = ch / 2;
  const R = Math.min(cw * 0.44, ch * 0.42, Math.max(cw, ch) * 0.3);
  return { cx, cy, R };
}
function projectGalaxy(G, d, cw, ch) {
  const key = `${cw}x${ch}@${d}`;
  if (G.key === key) return;
  G.key = key;
  const { cx: gx, cy: gy, R: Rc } = nowGeom(cw, ch), cx = gx * d, cy = gy * d, S = Rc * d;
  const ci = Math.cos(G_INC), si = Math.sin(G_INC), cp = Math.cos(G_PHI), sp = Math.sin(G_PHI), ca = Math.cos(G_PA), sa = Math.sin(G_PA);
  const proj = (ps) => {
    for (let i = 0; i < ps.n; i++) {
      const x = ps.X[i], y = ps.Y[i], z = ps.Z[i], x1 = x * cp - y * sp, y1 = x * sp + y * cp, px = x1, py = -(y1 * ci + z * si), o = i * 7;
      ps.out[o] = cx + S * (px * ca - py * sa); ps.out[o + 1] = cy + S * (px * sa + py * ca); ps.out[o + 2] = ps.S[i] * d;
    }
  };
  proj(G.back); proj(G.front);
  const plane = (o, q, x, y, tx0, ty0, len, sq) => {
    const x1 = x * cp - y * sp, y1 = x * sp + y * cp, px = x1, py = -y1 * ci;
    o[q] = cx + S * (px * ca - py * sa); o[q + 1] = cy + S * (px * sa + py * ca);
    const t1x = tx0 * cp - ty0 * sp, t1y = tx0 * sp + ty0 * cp, tx = t1x, ty = -t1y * ci, nx = -t1y, ny = -t1x * ci;
    const maj = len * Math.hypot(tx, ty), mi = len * sq * Math.hypot(nx, ny);
    if (maj >= mi) { o[q + 2] = maj * S; o[q + 7] = Math.atan2(ty, tx) + G_PA; o[q + 8] = mi / maj; }
    else { o[q + 2] = mi * S; o[q + 7] = Math.atan2(ny, nx) + G_PA; o[q + 8] = maj / mi; }
  };
  for (const sm of [G.glow, G.dust]) for (let i = 0; i < sm.n; i++) plane(sm.out, i * 9, sm.X[i], sm.Y[i], sm.TX[i], sm.TY[i], sm.Lm[i], sm.Sq[i]);
  // inner dust on the far side sits behind the bulge's near half
  for (let i = 0; i < G.dust.n; i++) { const x = G.dust.X[i], y = G.dust.Y[i]; if (x * x + y * y < 0.12) { const y1 = x * sp + y * cp; G.dust.out[i * 9 + 6] = G.dust.A[i] * (0.72 - 0.28 * Math.tanh(y1 * 25)); } }
  G.SMOOTH.forEach((m, i) => { const o = i * 9; G.smooth9[o] = cx; G.smooth9[o + 1] = cy; G.smooth9[o + 2] = m[0] * S; G.smooth9[o + 7] = G_PA; G.smooth9[o + 8] = m[3] < 1 ? Math.max(ci, m[3]) : ci; });
  for (const ps of [G.field, G.spiky]) for (let i = 0; i < ps.n; i++) { const o = i * 7; ps.out[o] = ps.X[i] * cw * d; ps.out[o + 1] = ps.Y[i] * ch * d; ps.out[o + 2] = ps.S[i] * d; }
  G.far.forEach((f, i) => { const o = i * 9; G.far9[o] = f[0] * cw * d; G.far9[o + 1] = f[1] * ch * d; G.far9[o + 2] = f[2] * d; });
}
// the reader's atom, where Act II's fallback geometry puts it at its first instant (its black hole appears only later)
function nowMarkers(ctx, d, cw, ch) {
  const { cx, cy, R } = nowGeom(cw, ch);
  const ci = Math.cos(G_INC), cp = Math.cos(G_PHI), sp = Math.sin(G_PHI), ca = Math.cos(G_PA), sa = Math.sin(G_PA);
  const ax = Math.cos(1.95) * 0.55, ay = -Math.sin(1.95) * 0.55;
  const x1 = ax * cp - ay * sp, y1 = ax * sp + ay * cp, px = x1, py = -y1 * ci;
  const X = (cx + R * (px * ca - py * sa)) * d, Y = (cy + R * (px * sa + py * ca)) * d;
  ctx.strokeStyle = 'rgba(255,138,74,0.7)'; ctx.lineWidth = d;
  ctx.beginPath(); ctx.arc(X, Y, 6 * d, 0, TAU); ctx.stroke();
  ctx.fillStyle = 'rgba(255,138,74,0.95)'; ctx.beginPath(); ctx.arc(X, Y, 1.6 * d, 0, TAU); ctx.fill();
}
let skyGal = null;   // ENT.sky's model, built once if that module is present
function ensureNowSky() {
  if (ENT.descentSky && typeof ENT.descentSky.draw === 'function') return;
  if (ENT.sky && typeof ENT.sky.galaxy === 'function' && typeof ENT.sky.drawGalaxy === 'function') {
    if (!skyGal) { try { skyGal = ENT.sky.galaxy({ seed: 2026, count: small ? 25000 : 60000 }); } catch (e) { skyGal = null; } }
  }
  if (!GAL) GAL = buildGalaxy(small ? 9000 : 22000);   // also the backdrop (field stars, distant galaxies) and the Canvas 2D sky
}

/* ================================================================ renderer */
let g = null;
try { g = ENT.gfx && ENT.gfx.create ? ENT.gfx.create(glCv, { maxDpr: window.innerWidth <= 480 ? 1.5 : 2 }) : null; } catch (e) { g = null; }
if (!g) glCv.hidden = true;
let small = window.innerWidth <= 480;
let CW = 1, CH = 1, D = 1;          // stage size in CSS px; GL device px ratio
let OD = 1;                         // overlay device px ratio
const PT = new Float32Array(512 * 7);
let MOT = null, motN = 0;           // mottling lattice
let ovDirty = false;

function buildMottle() {
  const sp = 7, nx = Math.ceil(CW / sp) + 2, ny = Math.ceil(CH / sp) + 2, n = nx * ny, rnd = mulberry32(4711);
  MOT = { n, sp, X: new Float32Array(n), Y: new Float32Array(n), W: new Float32Array(n), out: new Float32Array(n * 7) };
  let i = 0;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++, i++) {
    MOT.X[i] = (x - 1 + (rnd() - 0.5) * 0.8) * sp; MOT.Y[i] = (y - 1 + (rnd() - 0.5) * 0.8) * sp;
    const a = rnd(), b = rnd(); MOT.W[i] = (a + b - 1) * 1.6;   // triangular, mean 0
  }
  motN = n;
}

function frameVoid(s, pts) {   // motes and the glint: returns number of points written
  let n = 0;
  const mv = moteVis(s);
  if (mv > 0) {
    const nm = small ? 30 : 60, t = reduced ? 0 : clk;
    for (let i = 0; i < nm; i++) {
      const m = MOTES[i];
      const x = (((m.x * CW + m.vx * t) % CW) + CW) % CW, y = (((m.y * CH + m.vy * t) % CH) + CH) % CH;
      const o = n++ * 7, I = m.a * mv * MOTE_K;
      pts[o] = x * D; pts[o + 1] = y * D; pts[o + 2] = 1.0 * D; pts[o + 3] = BONE_LIN[0] * I; pts[o + 4] = BONE_LIN[1] * I; pts[o + 5] = BONE_LIN[2] * I; pts[o + 6] = 1;
    }
  }
  const gb = glintAt(s);
  if (gb) {
    const [gl, b] = gb, j = lutIdx(gl.T);
    for (const p of gl.parts) {
      const o = n++ * 7, I = (0.1 + b * 2.6) * p[2];
      pts[o] = (gl.x + p[0]) * D; pts[o + 1] = (gl.y + p[1]) * D; pts[o + 2] = 1.3 * D;
      pts[o + 3] = LUT[j] * I; pts[o + 4] = LUT[j + 1] * I; pts[o + 5] = LUT[j + 2] * I; pts[o + 6] = 1;
    }
    const o = n++ * 7, I = b * b * 0.03;   // the patch itself, a breath of light around them
    pts[o] = gl.x * D; pts[o + 1] = gl.y * D; pts[o + 2] = 44 * D; pts[o + 3] = LUT[j] * I; pts[o + 4] = LUT[j + 1] * I; pts[o + 5] = LUT[j + 2] * I; pts[o + 6] = 1;
  }
  return n;
}
let MOTE_K = 1.0;

function renderGL(s) {
  if (inNow(s)) {
    const ds = ENT.descentSky;
    let fo = { exposure: 1, bloom: 0.85, bloomRadius: 1, threshold: 0.75 };
    if (ds && typeof ds.frameOpts === 'function') fo = ds.frameOpts(U_NOW) || fo;
    else if (ds && ds.frame) fo = (typeof ds.frame === 'function' ? ds.frame(U_NOW) : ds.frame) || fo;
    g.begin(fo);
    const W = glCv.width, H = glCv.height;
    if (ds && typeof ds.draw === 'function') {
      ds.draw(g, W, H, U_NOW);
    } else {
      ensureNowSky();
      projectGalaxy(GAL, D, CW, CH);
      g.smudges(GAL.far9, GAL.far.length);
      g.points(GAL.field.out, GAL.field.n);
      if (skyGal) {
        const { cx, cy, R } = nowGeom(CW, CH);
        ENT.sky.drawGalaxy(g, skyGal, { x: cx * D, y: cy * D, radius: R * D, tilt: G_INC, pa: G_PA, rot: G_PHI, alive: 1, relax: 0, alpha: 1, detail: 1 });
      } else {
        const G = GAL;
        g.smudges(G.smooth9, G.nDisk);
        g.smudges(G.glow.out, G.glow.n);
        g.points(G.back.out, G.back.n);
        g.smudges(G.dust.out, G.dust.n, { blend: 'dark' });
        g.smudges(G.smooth9.subarray(G.nDisk * 9), G.SMOOTH.length - G.nDisk);
        g.points(G.front.out, G.front.n);
      }
      g.points(GAL.spiky.out, GAL.spiky.n, { shape: 'star' });
    }
    g.end();
    return;
  }
  if (s < 5.6) {
    g.begin({ exposure: 1, bloom: 0.45, bloomRadius: 0.6, threshold: 1.0 });
    const n = frameVoid(s, PT);
    if (n) g.points(PT, n);
    g.end();
    return;
  }
  const px = P_X * CW * D, py = P_Y * CH * D, wj = lutIdx(10500);
  if (s < 6.9) {
    const inflating = s >= 6.2;
    const q = clamp01((s - 6.2) / 0.7);
    g.begin({ exposure: 1, bloom: inflating ? 0.4 + 0.8 * q : 0.35, bloomRadius: inflating ? 0.6 + 1.2 * q : 0.6, threshold: inflating ? 0.8 : 1.2 });
    let I, r;
    if (!inflating) { const p = clamp01((s - 5.6) / 0.6); I = pointI(p); r = lerp(1.4, 2.6, p); }
    else { I = inflI(q); r = inflR(q); }
    let n = 0;
    for (const [m, w] of PROF) {
      const o = n++ * 7, Ik = I * w;
      PT[o] = px; PT[o + 1] = py; PT[o + 2] = 2 * r * m * D; PT[o + 3] = LUT[wj] * Ik; PT[o + 4] = LUT[wj + 1] * Ik; PT[o + 5] = LUT[wj + 2] * Ik; PT[o + 6] = 1;
    }
    g.points(PT, n);
    const u = smooth((s - 6.84) / 0.06);
    if (u > 0) { fillUniform(lutIdx(11000), 60 * u); }
    g.end();
    return;
  }
  if (s < 7.6) {
    const cv = coolAt((s - 6.9) / 0.7, COOLV), j = lutIdx(cv.T);
    g.begin({ exposure: 1, bloom: 0.25, bloomRadius: 1.0, threshold: 0.9 });
    fillUniform(j, cv.L * (1 - cv.m));
    if (cv.m > 0.001 && MOT) {
      const sz = MOT.sp * 2.3, norm = (MOT.sp * MOT.sp) / (0.663 * (sz / 2) * (sz / 2)), base = cv.L * cv.m * norm, o = MOT.out;
      for (let i = 0; i < MOT.n; i++) {
        const q = i * 7, I = base * (1 + MOT.W[i]);
        o[q] = MOT.X[i] * D; o[q + 1] = MOT.Y[i] * D; o[q + 2] = sz * D; o[q + 3] = LUT[j] * I; o[q + 4] = LUT[j + 1] * I; o[q + 5] = LUT[j + 2] * I; o[q + 6] = 1;
      }
      g.points(o, MOT.n);
    }
    g.end();
    return;
  }
  // first light, then the first stars
  g.begin({ exposure: 1, bloom: 0.4, bloomRadius: 0.6, threshold: 1.2 });
  let n = 0, nk = 0;
  for (let i = 0; i < STARS.length; i++) {   // the brightest few first, with faint spikes
    const st = STARS[i], a = smooth((s - st.on) / 0.05);
    if (i === NSPIKY) { if (n) g.points(PT, n, { shape: 'star' }); nk = n; n = 0; }
    if (a <= 0) continue;
    const j = lutIdx(st.T), I = st.L * a, o = n++ * 7;
    PT[o] = st.x * CW * D; PT[o + 1] = st.y * CH * D; PT[o + 2] = st.sz * (i < NSPIKY ? 1.6 : 1) * D; PT[o + 3] = LUT[j] * I; PT[o + 4] = LUT[j + 1] * I; PT[o + 5] = LUT[j + 2] * I; PT[o + 6] = 1;
  }
  if (n) g.points(PT, n);
  g.end();
}
const UNI = new Float32Array(7);
function fillUniform(j, L) {
  if (L <= 0) return;
  UNI[0] = CW * D / 2; UNI[1] = CH * D / 2; UNI[2] = Math.hypot(CW, CH) * D * 1.2;
  UNI[3] = LUT[j] * L; UNI[4] = LUT[j + 1] * L; UNI[5] = LUT[j + 2] * L; UNI[6] = 1;
  g.points(UNI, 1, { shape: 'disc' });
}

/* ---------------- Canvas 2D path (no WebGL2): the same beats, drawn plainly ---------------- */
const TC = [0, 0, 0];
const rgbOf = (j, L) => { tone(LUT[j] * L, LUT[j + 1] * L, LUT[j + 2] * L, TC); return `rgb(${TC[0] | 0},${TC[1] | 0},${TC[2] | 0})`; };
let noiseCv = null;
function render2D(s) {
  const ctx = octx, d = OD, w = ov.width, h = ov.height;
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#050609'; ctx.fillRect(0, 0, w, h);
  if (inNow(s)) { ensureNowSky(); now2D(ctx, d); nowMarkers(ctx, d, CW, CH); return; }
  if (s < 5.6) {
    const mv = moteVis(s), t = reduced ? 0 : clk;
    if (mv > 0) {
      const nm = small ? 30 : 60, px = Math.max(1, Math.round(d));
      for (let i = 0; i < nm; i++) {
        const m = MOTES[i], x = (((m.x * CW + m.vx * t) % CW) + CW) % CW, y = (((m.y * CH + m.vy * t) % CH) + CH) % CH;
        ctx.fillStyle = `rgba(235,229,217,${(m.a * mv * 1.1).toFixed(3)})`; ctx.fillRect(Math.round(x * d), Math.round(y * d), px, px);
      }
    }
    const gb = glintAt(s);
    if (gb) {
      const [gl, b] = gb, c = blackbody(gl.T).join(',');
      for (const p of gl.parts) {
        const X = (gl.x + p[0]) * d, Y = (gl.y + p[1]) * d, rr = (1.2 + 3.2 * b * p[2]) * d;
        const gr = ctx.createRadialGradient(X, Y, 0, X, Y, rr);
        gr.addColorStop(0, `rgba(${c},${Math.min(1, b * p[2])})`); gr.addColorStop(0.25, `rgba(${c},${0.35 * b * p[2]})`); gr.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(X, Y, rr, 0, TAU); ctx.fill();
      }
    }
    return;
  }
  const px = P_X * CW * d, py = P_Y * CH * d, wj = lutIdx(10500);
  if (s < 6.9) {
    let I, r;
    if (s < 6.2) { const p = clamp01((s - 5.6) / 0.6); I = pointI(p); r = lerp(1.4, 2.6, p) * 2.5; }
    else { const q = clamp01((s - 6.2) / 0.7); I = inflI(q); r = inflR(q); }
    const R = r * 6 * d, gr = ctx.createRadialGradient(px, py, 0, px, py, R);
    for (let k = 0; k <= 24; k++) { const rho = Math.pow(k / 24, 1.6); gr.addColorStop(rho, rgbOf(wj, profileAt(rho * r * 6, r, I) * (s < 6.2 ? 0.5 : 1))); }
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(px, py, R, 0, TAU); ctx.fill();
    const u = smooth((s - 6.84) / 0.06);
    if (u > 0) { ctx.globalAlpha = u; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
    return;
  }
  if (s < 7.6) {
    const cv = coolAt((s - 6.9) / 0.7, COOLV), j = lutIdx(cv.T);
    ctx.fillStyle = rgbOf(j, cv.L); ctx.fillRect(0, 0, w, h);
    if (cv.m > 0.001) {
      if (!noiseCv) {
        noiseCv = document.createElement('canvas'); noiseCv.width = 160; noiseCv.height = 160;
        const nc = noiseCv.getContext('2d'), im = nc.createImageData(160, 160), rnd = mulberry32(4711);
        for (let i = 0; i < im.data.length; i += 4) { const v = rnd() < 0.5 ? 0 : 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
        nc.putImageData(im, 0, 0);
      }
      ctx.globalAlpha = cv.m * 0.35 * Math.min(1, cv.L * 2); ctx.globalCompositeOperation = 'overlay';
      ctx.imageSmoothingEnabled = true;
      for (let y = 0; y < h; y += 160 * 4 * d) for (let x = 0; x < w; x += 160 * 4 * d) ctx.drawImage(noiseCv, x, y, 160 * 4 * d, 160 * 4 * d);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    return;
  }
  for (const st of STARS) {
    const a = smooth((s - st.on) / 0.05); if (a <= 0) continue;
    const c = blackbody(st.T).join(','), X = st.x * CW * d, Y = st.y * CH * d, rr = (0.9 + Math.sqrt(st.L) * 0.9) * d;
    const gr = ctx.createRadialGradient(X, Y, 0, X, Y, rr * 2);
    gr.addColorStop(0, `rgba(${c},${a})`); gr.addColorStop(0.25, `rgba(${c},${0.45 * a})`); gr.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(X, Y, rr * 2, 0, TAU); ctx.fill();
  }
}
function now2D(ctx, d) {
  const G = GAL, { cx, cy, R } = nowGeom(CW, CH), X = cx * d, Y = cy * d, S = R * d;
  for (const f of G.far) {   // distant galaxies
    const c = blackbody(f[3]).join(','), rr = f[2] * d;
    ctx.save(); ctx.translate(f[0] * CW * d, f[1] * CH * d); ctx.rotate(f[5]); ctx.scale(1, f[6]);
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rr); gr.addColorStop(0, `rgba(${c},${f[4] * 3})`); gr.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.fill(); ctx.restore();
  }
  ctx.save(); ctx.translate(X, Y); ctx.rotate(G_PA); ctx.scale(1, Math.cos(G_INC));
  let gr = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.95);
  gr.addColorStop(0, 'rgba(255,214,170,0.28)'); gr.addColorStop(0.4, 'rgba(255,214,170,0.08)'); gr.addColorStop(1, 'rgba(255,214,170,0)');
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, S * 0.95, 0, TAU); ctx.fill();
  gr = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.2); gr.addColorStop(0, 'rgba(255,230,200,0.7)'); gr.addColorStop(1, 'rgba(255,214,170,0)');
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, S * 0.2, 0, TAU); ctx.fill();
  ctx.restore();
  projectGalaxy(G, d, CW, CH);
  const step = small ? 3 : 4;
  for (const ps of [G.back, G.front, G.field]) for (let i = 0; i < ps.n; i += ps === G.field ? 1 : step) {
    const o = i * 7, L = ps.L[i] * (ps === G.field ? 1 : 2.2);
    ctx.fillStyle = `rgba(${Math.round(255 * Math.pow(ps.out[o + 3], 1 / 2.2))},${Math.round(255 * Math.pow(ps.out[o + 4], 1 / 2.2))},${Math.round(255 * Math.pow(ps.out[o + 5], 1 / 2.2))},${Math.min(1, 0.25 + L * 3).toFixed(3)})`;
    const z = Math.max(1, Math.round(d * (L > 0.2 ? 1.6 : 1)));
    ctx.fillRect(ps.out[o] - z / 2, ps.out[o + 1] - z / 2, z, z);
  }
}

/* ================================================================ HUD */
const elClock = $('wtClockT'), elEra = $('wtEra'), elNote = $('wtNote'), elLargest = $('wtLargest');
const elHead = $('wtInvHead'), elPips = $('wtPips'), elLost = $('wtLost');
const elCB = $('wtClockbox'), elSide = $('wtSide');
const NOTE = 'The descent took 10<sup>108</sup> years. That is no longer a visible fraction of this number.';
const ITEMS = [['Other galaxies in view', '11.2'], ['New stars forming', '13'], ['Starlight', '14'], ['Planets in orbit', '15'], ['Galaxies', '20'], ['Atoms', '40'], ['Black holes', '100'], ['Temperature differences', '100.5']];
const pips = ITEMS.map(() => { const p = document.createElement('i'); p.className = 'wt-gone'; elPips.appendChild(p); return p; });
// the false now's inventory, full
{
  const list = $('wtNowList'), np = $('wtNowPips');
  for (const it of ITEMS) { const li = document.createElement('li'); li.innerHTML = `<span>${it[0]}</span><span>10<sup>${it[1]}</sup></span>`; list.appendChild(li); np.appendChild(document.createElement('i')); }
}
const setHTML = (el, html) => { if (el._h !== html) { el._h = html; el.innerHTML = html; } };
const refilled = (s) => (s < 6.4 ? 0 : Math.min(8, 1 + Math.floor((s - 6.4) / (1.2 / 7) + 1e-6)));
const largest = (s) => (s < FIRST_GLINT ? 'nothing' : s < 3.5 ? 'a few particles, for an instant' : s < 6.4 ? 'a brain, for an instant' : 'a universe');
let invK = -1;
const INK = [235, 229, 217], DIMC = [142, 145, 156], GONEC = [74, 77, 87];
const mixC = (a, b, t) => `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
// brightness of the picture at a point (CSS px), as the eye gets it: for the HUD's ink over the white-out
function lumaAt(s, x, y) {
  let r = 0, gg = 0, b = 0;
  const wj = lutIdx(10500);
  if (s >= 6.2 && s < 6.9) {
    const q = clamp01((s - 6.2) / 0.7), I = profileAt(Math.hypot(x - P_X * CW, y - P_Y * CH), inflR(q), inflI(q)) + 60 * smooth((s - 6.84) / 0.06);
    r = LUT[wj] * I; gg = LUT[wj + 1] * I; b = LUT[wj + 2] * I;
  } else if (s >= 6.9 && s < 7.6) {
    const cv = coolAt((s - 6.9) / 0.7, COOLV), j = lutIdx(cv.T);
    r = LUT[j] * cv.L; gg = LUT[j + 1] * cv.L; b = LUT[j + 2] * cv.L;
  } else return 0;
  tone(r, gg, b, TC);
  return (0.2126 * TC[0] + 0.7152 * TC[1] + 0.0722 * TC[2]) / 255;
}
let hudPts = [];   // sample points for the ink: [element, x, y]
function setInk(el, luma) {
  // dark ink over the brightest light; over mid-bright colour the secondary text lifts toward bone so it stays legible
  const t = Math.round(smooth((luma - 0.41) / 0.07) * 50) / 50, lift = Math.round(smooth((luma - 0.12) / 0.2) * 50) / 50, key = t * 100 + lift;
  if (el._ink === key) return; el._ink = key;
  if (t <= 0 && lift <= 0) { el.style.removeProperty('--wt-ink'); el.style.removeProperty('--wt-dink'); el.style.removeProperty('--wt-gink'); return; }
  el.style.setProperty('--wt-ink', mixC(INK, BG, t));
  el.style.setProperty('--wt-dink', t > 0 ? mixC(DIMC, [40, 36, 30], t) : mixC(DIMC, [214, 208, 198], lift));
  el.style.setProperty('--wt-gink', t > 0 ? mixC(GONEC, [60, 55, 48], t) : mixC(GONEC, [180, 175, 168], lift));
}
let nowOn = null;
function hud(s) {
  const now = inNow(s);
  if (now !== nowOn) { nowOn = now; stage.classList.toggle('wt-is-now', now); }
  setHTML(elClock, clockHTML(s));
  setHTML(elEra, s < 5.6 ? 'Dark era' : s >= 7.8 ? 'first stars' : s >= 7.3 ? 'first light' : '');
  setHTML(elNote, s >= 1.2 && s < 6.9 ? NOTE : '');
  setHTML(elLargest, largest(s));
  const k = refilled(s);
  if (k !== invK) {
    invK = k;
    pips.forEach((p, i) => p.classList.toggle('wt-gone', i < 8 - k));
    elHead.textContent = `Still possible · ${k} of 8`;
    elLost.textContent = k === 0 ? 'Lost: temperature differences' : `Possible again: ${ITEMS[8 - k][0].toLowerCase()}`;
  }
  for (const [el, x, y] of hudPts) setInk(el, lumaAt(s, x, y));
}

/* ---------------- the false now's depth rail (as Act II draws it at its first instant) ---------------- */
const rail = $('wtRail');
{
  const rp = (u) => `${(((u - 10) / 98) * 100).toFixed(3)}%`, U0 = Math.log10(13.79e9);
  let h = '<i class="wt-rl"></i><i class="wt-rd" style="transform:scaleY(0.0014)"></i>';
  for (let u = 20; u <= 100; u += 10) {
    h += `<i class="wt-rt" style="top:${rp(u)}"></i>`;
    if (u % 20 === 0) h += `<span class="wt-rlab${u === 20 || u === 60 || u === 100 ? '' : ' wt-opt'}" style="top:${rp(u)}">10<sup>${u}</sup></span>`;
  }
  for (const u of [14, 40, 100]) h += `<i class="wt-re" style="top:${rp(u)}"></i>`;
  h += `<i class="wt-rs" style="top:${rp(U0)};height:${(((14 - U0) / 98) * 100).toFixed(3)}%"></i><span class="wt-rsl" style="top:${rp((U0 + 14) / 2)}">stars</span>`;
  h += '<i class="wt-rm" style="top:0"></i>';
  rail.innerHTML = h;
}

/* ================================================================ captions */
const cards = [...$('wtCards').children].map((el) => ({ el, s: +el.dataset.s, top: 0, h: 0, op: -1, cut: -1 }));
let fadeLine = 0;
function layoutCards() {
  cards.forEach((c) => { c.h = c.el.offsetHeight; });
  let prev = -Infinity;
  for (const c of cards) {
    let top = (c.s + 0.58) * SH;
    if (top < prev + 24) top = prev + 24;
    c.top = top; prev = top + c.h;
  }
  cards.forEach((c) => { c.el.style.top = `${Math.round(c.top)}px`; c.op = -1; c.cut = -1; });
}
function fadeCards(y) {
  const stageTop = Math.max(0, Math.min(TOTAL * SH, y - trackTop));
  const floor = phoneMQ.matches ? window.innerHeight - 64 : Infinity;
  const F = phoneMQ.matches ? 44 : 60;
  for (const c of cards) {
    const rel = c.top - stageTop;
    const top = Math.max(0, Math.min(c.h, Math.round(fadeLine - rel)));
    const vp = trackTop + c.top - y;
    const cut = Math.max(0, Math.min(c.h, Math.round(vp + c.h - floor)));
    const op = top + cut >= c.h - 2 || top >= c.h - F * 0.5 ? 0 : 1;
    if (op !== c.op) { c.op = op; c.el.style.opacity = op; c.el.style.visibility = op === 0 ? 'hidden' : ''; }
    const key = op ? top * 4096 + cut : -1;
    if (key !== c.cut) {
      c.cut = key;
      const m = op && (top > 0 || cut > 0) ? `linear-gradient(transparent ${top}px, #000 ${top + F}px, #000 ${c.h - cut - 36}px, transparent ${c.h - cut}px)` : '';
      c.el.style.webkitMaskImage = m; c.el.style.maskImage = m;
    }
  }
}

/* ================================================================ glint placement: clear of the HUD, the captions and the Play button */
function placeGlints(hudR) {
  const cr = cards.map((c) => { const r = c.el.getBoundingClientRect(), st = stage.getBoundingClientRect(); return { c, l: r.left - st.left, r: r.right - st.left }; });
  for (const gl of GLINTS) {
    const rnd = mulberry32(gl.seed);
    let best = null;
    for (let t = 0; t < 40; t++) {
      const x = CW * (0.08 + rnd() * 0.84), y = hudR.bottom + 30 + rnd() * Math.max(10, CH - hudR.bottom - 110);
      best = [x, y];
      const pad = 26;
      if (y < hudR.bottom + pad && x > hudR.left - pad && x < hudR.right + pad) continue;
      if (x > CW - 110 && y > CH - 80) continue;
      let hit = false;
      for (const k of cr) {
        const top = k.c.top - gl.s * SH, bot = top + k.c.h;
        if (bot < 0 || top > CH) continue;
        if (x > k.l - pad && x < k.r + pad && y > top - pad && y < bot + pad) { hit = true; break; }
      }
      if (!hit) break;
    }
    gl.x = best[0]; gl.y = best[1];
  }
}

/* ================================================================ layout */
let SH = window.innerHeight, lastVW = 0, trackTop = 0, clk = 0;
function measureTrack() { trackTop = track.getBoundingClientRect().top + window.scrollY; }
function layout(force) {
  const vw = window.innerWidth, vh = window.innerHeight;
  if (force || vw !== lastVW || Math.abs(vh - SH) >= 120) { SH = vh; track.style.setProperty('--wt-h', `${SH}px`); }
  lastVW = vw; small = vw <= 480;
  const st = stage.getBoundingClientRect();
  CW = Math.max(1, st.width); CH = Math.max(1, st.height);
  if (g) { const z = g.resize(); D = z.d; }
  const od = Math.min(2, window.devicePixelRatio || 1), ow = Math.max(1, Math.round(CW * od)), oh = Math.max(1, Math.round(CH * od));
  if (ov.width !== ow || ov.height !== oh) { ov.width = ow; ov.height = oh; }
  OD = od; ovDirty = true;
  // the new beginning: slightly off-centre, clear of the HUD
  const phone = phoneMQ.matches;
  P_X = phone ? 0.56 : 0.6; P_Y = phone ? 0.6 : 0.5;
  const px = P_X * CW, py = P_Y * CH, far = Math.max(Math.hypot(px, py), Math.hypot(CW - px, py), Math.hypot(px, CH - py), Math.hypot(CW - px, CH - py));
  KINF = Math.log(far / 0.72 / 2.6) / 0.94;   // the white front reaches the farthest corner just before 6.9
  // rail of the false now starts below its HUD on phones
  if (phone) rail.style.top = `${Math.round($('wtNowTop').getBoundingClientRect().bottom - st.top + 16)}px`; else rail.style.top = '';
  const rh = rail.clientHeight; rail.querySelector('.wt-rm').style.transform = `translateY(${(0.00142 * rh).toFixed(1)}px)`;
  // HUD extent (for caption fade and glint placement) and ink sample points
  const probe = cards[0].el.getBoundingClientRect();
  fadeLine = 0;
  let hb = { left: Infinity, right: -Infinity, bottom: 0 };
  hudPts = [];
  for (const el of [elCB, elSide]) {
    const r = el.getBoundingClientRect();
    if (r.right > probe.left && r.left < probe.right) fadeLine = Math.max(fadeLine, r.bottom - st.top);
    hb.left = Math.min(hb.left, r.left - st.left); hb.right = Math.max(hb.right, r.right - st.left); hb.bottom = Math.max(hb.bottom, r.bottom - st.top);
    hudPts.push([el, r.left - st.left + Math.min(120, r.width / 2), r.top - st.top + Math.min(40, r.height / 2)]);
  }
  fadeLine += 10;
  layoutCards();
  measureTrack();
  placeGlints(hb);
  if (g) buildMottle();
  if (GAL) GAL.key = '';
  lastS = NaN; lastY = NaN; dirty = true;
}

/* ================================================================ frame loop */
let lastS = NaN, lastY = NaN, dirty = true, lastDraw = 0, lastKey = '';
function render(s) {
  const useGL = g && !g.isLost;
  if (useGL !== !glCv.hidden) { glCv.hidden = !useGL; ovDirty = true; }
  const key = inNow(s) ? 'now' : '';
  if (useGL) {
    if (!(key === 'now' && lastKey === 'now' && !dirty)) renderGL(s);
    // the overlay carries only the false now's markers
    if (key === 'now') {
      if (lastKey !== 'now' || ovDirty) {
        octx.clearRect(0, 0, ov.width, ov.height);
        const ds = ENT.descentSky;
        if (ds && typeof ds.drawOverlay === 'function') ds.drawOverlay(octx, ov.width, ov.height, U_NOW);
        else if (!(ds && typeof ds.draw === 'function')) nowMarkers(octx, OD, CW, CH);
        ovDirty = false;
      }
    } else if (lastKey === 'now' || ovDirty) { octx.clearRect(0, 0, ov.width, ov.height); ovDirty = false; }
  } else if (!(key === 'now' && lastKey === 'now' && !dirty)) render2D(s);
  lastKey = key;
}
ENT.watch(track);
ENT.onFrame((dt) => {
  if (!ENT.isVisible(track)) return;
  clk += Math.min(dt, 0.1);
  const y = window.scrollY;
  const s = Math.max(0, Math.min(TOTAL, (y - trackTop) / SH));
  if (s > 2.2 && s < 3.3) ensureNowSky();           // build the false now's sky before the cut, never during it
  const anim = !reduced && moteVis(s) > 0;
  const t = performance.now();
  if (s !== lastS || dirty || (anim && t - lastDraw >= 33)) { render(s); lastDraw = t; dirty = false; }
  if (s !== lastS) { hud(s); lastS = s; }
  if (y !== lastY) { fadeCards(y); lastY = y; }
});
ENT.onResize(() => layout(false));
if ('ResizeObserver' in window) new ResizeObserver(() => { measureTrack(); lastY = NaN; dirty = true; }).observe(document.body);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => layout(true));
window.addEventListener('load', () => layout(true));

$('wtAgain').addEventListener('click', () => {
  if (ENT.autoplay) ENT.autoplay.stop();
  window.scrollTo(0, 0);
});

layout(true);
{
  const s0 = Math.max(0, Math.min(TOTAL, (window.scrollY - trackTop) / SH));
  hud(s0); render(s0); lastS = s0; fadeCards(window.scrollY); lastY = window.scrollY;
}
})();
