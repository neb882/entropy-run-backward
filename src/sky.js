/* sky: shared sky models drawn through ENT.gfx: a barred spiral galaxy (that can age and relax into an elliptical) and the cosmic web.
   Models are built once; draw calls only write into preallocated buffers and issue g.points / g.smudges between the caller's begin/end. */
(() => {
'use strict';
const ENT = (window.ENT = window.ENT || {});
const TAU = Math.PI * 2;

/* ---------------------------------------------------------------- helpers */
const rng = ENT.mulberry32 || function (a) {
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
const bb = ENT.blackbody || function (T) {
  const t = T / 100; let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = 255; }
  const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return [cl(r), cl(g), cl(b)];
};
// blackbody -> linear rgb normalised to a brightest channel of 1 (800 K .. 40 000 K, log spaced)
const LUT_N = 512, T0 = 800, T1 = 40000, LUT = new Float32Array(LUT_N * 3), LT = Math.log(T1 / T0);
for (let i = 0; i < LUT_N; i++) {
  const c = bb(T0 * Math.exp(LT * i / (LUT_N - 1))).map((v) => Math.pow(v / 255, 2.2));
  const m = Math.max(c[0], c[1], c[2], 1e-6);
  LUT[i * 3] = c[0] / m; LUT[i * 3 + 1] = c[1] / m; LUT[i * 3 + 2] = c[2] / m;
}
const lutIdx = (T) => Math.max(0, Math.min(LUT_N - 1, Math.round(Math.log(Math.max(T, T0) / T0) / LT * (LUT_N - 1)))) * 3;
function gauss(rnd) { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rnd()); }
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth01 = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const KIND = ['halo', 'bulge', 'bar', 'disk', 'arm', 'knot', 'hii'];
const K_HALO = 0, K_BULGE = 1, K_BAR = 2, K_DISK = 3, K_ARM = 4, K_KNOT = 5, K_HII = 6;
const DPR = (g) => (g && g.size && g.size.d) || 1;

/* ================================================================ galaxy model */
function galaxy(opts) {
  opts = opts || {};
  const seed = num(opts.seed, 2026) | 0, N = Math.max(1000, num(opts.count, 60000) | 0), k = N / 60000;
  const rnd = rng(seed);
  const kL = Math.sqrt(1 / k);                   // fewer points: each carries a little more light
  const P = { pitch: 21, bulgeFrac: 0.13, barFrac: 0.05, diskFrac: 0.17, haloFrac: 0.03, glowFrac: Math.min(0.12, 0.08 + 0.05 * (1 - Math.min(1, k))),
    knotFrac: 0.3, armScale: 0.17, armR0: 0.2, hii: Math.round(420 * Math.max(0.6, Math.min(1, k))), knots: Math.round(420 * Math.max(0.6, Math.min(1, k))),
    dust: Math.round(2400 + 3400 * Math.min(1.5, k)) };

  // arms: [start angle, start radius, weight, end radius, pitch (deg), cot, tan]: two main arms from the bar ends, two weaker ones, flocculent fragments
  const ARMS = [[0, P.armR0, 1, 1.0, P.pitch], [Math.PI, P.armR0, 1, 1.0, P.pitch],
    [Math.PI * 0.5 + 0.6, 0.36, 0.5, 0.96, P.pitch + 2], [Math.PI * 1.5 + 0.6, 0.36, 0.5, 0.96, P.pitch + 2]];
  for (let i = 0; i < 12; i++) { const r0 = 0.28 + rnd() * 0.5; ARMS.push([rnd() * TAU, r0, 0.2 + rnd() * 0.2, Math.min(1, r0 + 0.1 + rnd() * 0.22), P.pitch - 3 + rnd() * 10]); }
  for (const a of ARMS) a.push(1 / Math.tan(a[4] * Math.PI / 180), Math.tan(a[4] * Math.PI / 180));
  const AW = []; let aw = 0; for (const a of ARMS) { aw += a[2] * (a[3] - a[1]) * (a[2] >= 1 ? 1.4 : 1); AW.push(aw); }
  const armTh = (a, r) => a[0] + Math.log(r / a[1]) * a[5];
  const pickArm = () => { const u = rnd() * aw; let i = 0; while (AW[i] < u) i++; return ARMS[i]; };
  const armR = (a) => {   // main arms rise from the bar end, peak, then fade (gamma, shape 2); fragments peak in their middle
    if (a[2] < 0.45) return a[1] + (a[3] - a[1]) * (rnd() + rnd()) * 0.5;
    for (;;) { const r = a[1] + 0.01 + (-Math.log(1 - rnd()) - Math.log(1 - rnd())) * P.armScale * (a[2] < 1 ? 0.7 : 1); if (r < a[3]) return r; }
  };
  const swell = (a, r) => { const q = Math.sin(r * 21 + a[0] * 3.1) * Math.sin(r * 9.3 + a[0]); return 0.65 + 0.7 * q * q; };
  const logU = (a, b) => a * Math.pow(b / a, rnd());
  const onArm = (a, wid, angJ, side) => {   // side 1: only outward of the ridge (sharp inner edge where the dust sits)
    const r = armR(a), th = armTh(a, r) + gauss(rnd) * angJ, g = gauss(rnd);
    const rr = r + (side ? Math.abs(g) * 1.2 - 0.003 : g) * wid(r) * swell(a, r);
    return [rr * Math.cos(th), rr * Math.sin(th), r];
  };

  // ---- point population (temporary lists, then split into back/front and shuffled so detail < 1 can draw a prefix)
  const nB = Math.round(N * P.bulgeFrac), nBar = Math.round(N * P.barFrac), nD = Math.round(N * P.diskFrac), nH = Math.round(N * P.haloFrac);
  const nG = Math.round(N * P.glowFrac), nHII = P.hii, nK = P.knots;
  const nA = Math.max(0, N - nB - nBar - nD - nH - nHII);   // the arm glow sprites come on top of count
  const recs = [];   // [x, y, z, sizePx, T, L, kind, Told, Lold]
  const old = () => logU(3900, 5200);
  const add = (x, y, z, sp, T, L, kind, young) => recs.push([x, y, z, sp, T, L, kind, young ? old() : T, young ? (0.05 + rnd() * 0.05) * kL : L]);
  for (let i = 0; i < nH; i++) {
    const r = 0.1 + -Math.log(1 - rnd() * 0.97) * 0.3, ct = rnd() * 2 - 1, st = Math.sqrt(1 - ct * ct), ph = rnd() * TAU;
    add(r * st * Math.cos(ph), r * st * Math.sin(ph), r * ct * 0.75, 1.7, logU(2900, 4000), (0.04 + rnd() * 0.05) * kL, K_HALO);
  }
  for (let i = 0; i < nB; i++) {
    const u = rnd(), r = 0.03 * Math.pow(-Math.log(1 - u * 0.9995), 1.6) + 0.002, ct = rnd() * 2 - 1, st = Math.sqrt(1 - ct * ct), ph = rnd() * TAU;
    add(r * st * Math.cos(ph), r * st * Math.sin(ph), r * ct * 0.6, 2.2 + rnd() * 1.2, logU(3800, 5400), (0.07 + rnd() * 0.07) * kL, K_BULGE);
  }
  for (let i = 0; i < nBar; i++) {
    let x; do { x = gauss(rnd) * 0.1; } while (Math.abs(x) > 0.22);
    add(x, gauss(rnd) * (0.028 - Math.abs(x) * 0.04), gauss(rnd) * 0.018, 2.2 + rnd(), logU(4300, 6500), (0.08 + rnd() * 0.06) * kL, K_BAR);
  }
  for (let i = 0; i < nD; i++) {
    let r; do { r = -Math.log(1 - rnd()) * 0.26 + 0.04; } while (r > 1.1);
    const ph = rnd() * TAU;
    add(r * Math.cos(ph), r * Math.sin(ph), gauss(rnd) * 0.012, 1.8 + rnd() * 0.6, logU(4600, 8000), (0.026 + rnd() * 0.03) * kL, K_DISK);
  }
  const knots = [];
  for (let i = 0; i < nK; i++) { const a = pickArm(), p = onArm(a, (r) => 0.008 + r * 0.018, 0.02, 1); knots.push([p[0], p[1], 0.003 + rnd() * 0.009]); }
  for (let i = 0; i < nA; i++) {
    if (rnd() < P.knotFrac) {
      const kn = knots[(rnd() * knots.length) | 0];
      add(kn[0] + gauss(rnd) * kn[2], kn[1] + gauss(rnd) * kn[2], gauss(rnd) * 0.008, 1.8 + rnd() * 1.2, logU(14000, 40000), (0.1 + Math.pow(rnd(), 5) * 1.2) * kL, K_KNOT, true);
    } else {
      const a = pickArm(), young = rnd() < 0.6;
      const p = onArm(a, young ? (r) => 0.01 + r * 0.026 : (r) => 0.03 + r * 0.06, young ? 0.02 : 0.05, young ? 1 : 0);
      let L = (young ? 0.048 : 0.034) + Math.pow(rnd(), 6) * (young ? 0.6 : 0.15);
      L *= (0.5 + 0.5 * Math.min(1, a[2])) * (1.15 - 0.45 * p[2]);
      add(p[0], p[1], gauss(rnd) * 0.008, 2.2 + rnd() * 1.6, young ? logU(14000, 40000) : logU(5500, 9000), L * kL, K_ARM, young);
    }
  }
  const front0 = recs.length;   // star-forming regions: always in front of the dust
  for (let i = 0; i < nHII;) {
    const a = pickArm(), r = Math.max(a[1] + 0.06, armR(a)), th = armTh(a, r) + gauss(rnd) * 0.02, rr = r - 0.01 + gauss(rnd) * 0.008;
    const cx = rr * Math.cos(th), cy = rr * Math.sin(th), m = 3 + ((rnd() * 8) | 0);
    for (let j = 0; j < m && i < nHII; j++, i++) add(cx + gauss(rnd) * 0.004, cy + gauss(rnd) * 0.004, 0, 1.5 + rnd() * 1.1, 40000, (0.1 + Math.pow(rnd(), 3) * 0.5) * kL, K_HII, true);
  }
  // split: back = below the disk plane or in it; front = above the plane (bulge and halo) and the star-forming regions
  const back = [], front = [];
  recs.forEach((r, i) => ((i >= front0 || ((r[6] === K_BULGE || r[6] === K_HALO) && r[2] > 0)) ? front : back).push(r));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; } };
  shuffle(back); shuffle(front);
  const all = back.concat(front), n = all.length, nBack = back.length;

  const X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n), EX = new Float32Array(n), EY = new Float32Array(n), EZ = new Float32Array(n);
  const SP = new Float32Array(n), T = new Float32Array(n), L = new Float32Array(n), To = new Float32Array(n), Lo = new Float32Array(n), KD = new Uint8Array(n);
  const rank = new Float32Array(n), rankO = new Float32Array(n), stag = new Float32Array(n), A = new Float32Array(n);
  all.forEach((r, i) => { X[i] = r[0]; Y[i] = r[1]; Z[i] = r[2]; SP[i] = r[3]; T[i] = r[4]; L[i] = r[5]; KD[i] = r[6]; To[i] = r[7]; Lo[i] = r[8]; });

  // death order: rank of temperature over all points (0 = coolest)
  const ord = Array.from({ length: n }, (_, i) => i).sort((a, b) => T[a] - T[b]);
  const Ts = new Float32Array(n); ord.forEach((i, j) => { rank[i] = j / (n - 1); Ts[j] = T[i]; });
  const rankOf = (t) => { let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (Ts[m] < t) lo = m + 1; else hi = m; } return lo / (n - 1); };
  for (let i = 0; i < n; i++) { rankO[i] = rankOf(To[i]); stag[i] = 0.6 * (1 - rank[i]); }   // hottest stop being replenished first

  // elliptical targets: a triaxial spheroid (1 : 0.8 : 0.65) with a de Vaucouleurs-like concentration.
  // Radii are handed out in the order of each point's disk radius and the azimuth is kept, so the morph is a smooth contraction with no swirl.
  const er = new Float32Array(n);
  for (let i = 0; i < n; i++) { let r; do { r = 0.2 * Math.pow(-Math.log(1 - rnd() * 0.99999), 1.6); } while (r > 0.95); er[i] = r; }
  er.sort();
  const byR = Array.from({ length: n }, (_, i) => i).sort((a, b) => (X[a] * X[a] + Y[a] * Y[a] + Z[a] * Z[a]) - (X[b] * X[b] + Y[b] * Y[b] + Z[b] * Z[b]));
  byR.forEach((i, j) => {
    const r = er[j], ph = Math.atan2(Y[i], X[i]) + (rnd() - 0.5) * 4.4, ct = rnd() * 2 - 1, st = Math.sqrt(1 - ct * ct);
    EX[i] = r * st * Math.cos(ph); EY[i] = r * st * Math.sin(ph) * 0.8; EZ[i] = r * ct * 0.65;
  });

  // ---- unresolved arm light: elongated faint sprites lying along the arms
  const glow = { n: nG, X: new Float32Array(nG), Y: new Float32Array(nG), TX: new Float32Array(nG), TY: new Float32Array(nG),
    Lm: new Float32Array(nG), Sq: new Float32Array(nG), T: new Float32Array(nG), L: new Float32Array(nG), A: new Float32Array(nG), out: new Float32Array(nG * 9) };
  for (let i = 0; i < nG; i++) {
    const a = pickArm(), p = onArm(a, (r) => 0.012 + r * 0.03, 0.03, 0), th = Math.atan2(p[1], p[0]), c = Math.cos(th), s = Math.sin(th);
    glow.X[i] = p[0]; glow.Y[i] = p[1];
    const tx = a[6] * c - s, ty = a[6] * s + c, tl = Math.hypot(tx, ty); glow.TX[i] = tx / tl; glow.TY[i] = ty / tl;
    glow.Lm[i] = 0.045 + rnd() * 0.045 + p[2] * 0.02; glow.Sq[i] = 0.3 + rnd() * 0.18;
    glow.T[i] = logU(9500, 24000);
    glow.L[i] = (0.016 + rnd() * 0.012) * (0.45 + 0.55 * Math.min(1, a[2])) * (1.2 - 0.6 * p[2]) / k;
  }

  // ---- smooth light: concentric gaussians. [disk diameter, T, brightness, intrinsic flattening (0 = in the plane)] -> [elliptical diameter, T, brightness]
  // the bulge entries (flattening > 0) are drawn half before and half after the dust, so dust hides only the half behind the disk plane
  const SM = [
    [1.8, 5800, 0.022, 0, 1.5, 4300, 0.010], [1.25, 5600, 0.045, 0, 1.0, 4300, 0.035], [0.8, 5300, 0.08, 0, 0.66, 4350, 0.11], [0.45, 5000, 0.12, 0, 0.42, 4400, 0.2],
    [0.62, 4400, 0.05, 0.7, 0.27, 4450, 0.38], [0.36, 4500, 0.13, 0.72, 0.16, 4500, 0.45], [0.17, 4700, 0.34, 0.78, 0.085, 4600, 0.85], [0.075, 5000, 0.9, 0.85, 0.04, 4800, 1.7], [0.026, 5600, 4.0, 0.99, 0.016, 5000, 4.0]];
  const nDiskSm = 4;
  const BAR = [[0.52, 0.2, 5300, 0.13], [0.38, 0.24, 5100, 0.28], [0.22, 0.32, 4900, 0.55]];

  // ---- dust
  const nDust = P.dust;
  const dust = { n: 0, X: new Float32Array(nDust), Y: new Float32Array(nDust), TX: new Float32Array(nDust), TY: new Float32Array(nDust),
    Lm: new Float32Array(nDust), Sq: new Float32Array(nDust), A: new Float32Array(nDust), out: new Float32Array(nDust * 9) };
  const addDust = (x, y, tx, ty, len, sq, a) => { const i = dust.n++; dust.X[i] = x; dust.Y[i] = y; const l = Math.hypot(tx, ty) || 1; dust.TX[i] = tx / l; dust.TY[i] = ty / l; dust.Lm[i] = len; dust.Sq[i] = sq; dust.A[i] = a; };
  const nArmDust = Math.round(nDust * 0.66), nBarDust = Math.round(nDust * 0.1);
  for (let i = 0; i < nArmDust; i++) {
    const a = pickArm(); let r = armR(a); r = Math.max(r, a[1] + 0.015);
    const strand = ((rnd() * 3) | 0) - 1;
    const th = armTh(a, r) + gauss(rnd) * 0.015, rr = r - (0.002 + r * 0.006) + strand * (0.003 + r * 0.006) + gauss(rnd) * (0.003 + r * 0.005);
    const c = Math.cos(th), s = Math.sin(th), lane = rnd() < 0.8, tp = a[6];
    const tx = lane ? tp * c - s : c + 0.6 * (tp * c - s), ty = lane ? tp * s + c : s + 0.6 * (tp * s + c);
    const q = Math.sin(r * 31 + a[0] * 5) * Math.cos(r * 13 - a[0]), patch = 0.25 + 1.1 * q * q;
    const fade = Math.min(1, (r - a[1]) / 0.08) * (1.1 - 0.6 * r);
    addDust(rr * c, rr * s, tx, ty, lane ? 0.035 + rnd() * 0.05 : 0.02 + rnd() * 0.03, lane ? 0.28 + rnd() * 0.25 : 0.3 + rnd() * 0.2,
      (lane ? 0.22 + rnd() * 0.24 : 0.12 + rnd() * 0.14) * (0.5 + 0.5 * Math.min(1, a[2])) * fade * patch);
  }
  for (let i = 0; i < nBarDust; i++) {
    const sgn = rnd() < 0.5 ? 1 : -1, u = Math.pow(rnd(), 0.8);
    addDust(sgn * (0.035 + u * 0.17), -sgn * (0.018 + u * 0.012 + u * u * 0.045) + gauss(rnd) * 0.006, 1, -sgn * (0.1 + u * 0.5),
      0.03 + rnd() * 0.03, 0.25 + rnd() * 0.2, (0.08 + rnd() * 0.1) * (0.4 + 0.6 * u));
  }
  for (let i = 0, nN = Math.round(nDust * 0.07); i < nN; i++) {
    const r = 0.06 + Math.pow(rnd(), 1.3) * 0.16, ph = rnd() * TAU, c = Math.cos(ph), s = Math.sin(ph);
    addDust(r * c, r * s, -s + 0.15 * c, c + 0.15 * s, 0.03 + rnd() * 0.04, 0.2 + rnd() * 0.2, 0.2 + rnd() * 0.3);
  }
  while (dust.n < nDust) {
    const r = 0.06 + Math.pow(rnd(), 0.9) * 0.6, ph = rnd() * TAU, c = Math.cos(ph), s = Math.sin(ph);
    addDust(r * c, r * s, -s + 0.3 * c, c + 0.3 * s, 0.02 + rnd() * 0.04, 0.3 + rnd() * 0.3, (0.08 + rnd() * 0.14) * (1 - r * 0.9));
  }
  for (let i = 0; i < nDust; i++) { const o = dust.out, q = i * 9; o[q + 3] = 0.6; o[q + 4] = 0.78; o[q + 5] = 1.0; }

  const gal = {
    count: n, nBack, X, Y, Z, EX, EY, EZ, SP, T, L, To, Lo, KD, rank, rankO, stag, A, rankOf,
    outB: new Float32Array(nBack * 7), outF: new Float32Array((n - nBack) * 7),
    glow, dust, SM, nDiskSm, BAR,
    smooth: new Float32Array(SM.length * 9), bar: new Float32Array(BAR.length * 9),
    smA: new Float32Array(SM.length), barA: new Float32Array(BAR.length),
    cAlive: NaN, cRelax: NaN, lum: 1, ret: { luminosity: 1 },
    star(i, out) {
      out = out || {};
      out.x = X[i]; out.y = Y[i]; out.z = Z[i]; out.T = T[i]; out.kind = KIND[KD[i]];
      return out;
    },
  };
  gal.smoothFront = gal.smooth.subarray(nDiskSm * 9);
  return gal;
}

// colour one smooth sprite for its temperature; returns its alpha after ageing
function tint(gal, alive, t, Lb, o, q) {
  const band = 0.05, f = clamp01((alive * (1 + band) - gal.rankOf(t)) / band), j = lutIdx(alive >= 1 ? t : t * (0.42 + 0.58 * alive));
  o[q + 3] = LUT[j]; o[q + 4] = LUT[j + 1]; o[q + 5] = LUT[j + 2];
  return Lb * f;
}
/* colours and base alphas depend only on (alive, relax): recomputed when either changes */
function recolour(gal, alive, relax) {
  const band = 0.05, cut = alive * (1 + band), shift = 0.42 + 0.58 * alive, e = smooth01(relax);
  const n = gal.count, nB = gal.nBack, T = gal.T, To = gal.To, L = gal.L, Lo = gal.Lo, KD = gal.KD, A = gal.A;
  const fadeYoung = 1 - smooth01(relax / 0.6);
  let lum = 0, lum1 = 0;
  for (let i = 0; i < n; i++) {
    // young populations stop being replenished as the galaxy relaxes: hottest first, they turn into old light
    const w = clamp01((e - gal.stag[i]) / 0.25);
    const t = T[i] + (To[i] - T[i]) * w, rk = gal.rank[i] + (gal.rankO[i] - gal.rank[i]) * w;
    let l = L[i] + (Lo[i] - L[i]) * w;
    if (KD[i] === K_HII) l = L[i] * fadeYoung;
    l *= 1 - 0.8 * e;   // in the elliptical most light is carried by the smooth layers, so the grain stays fine
    const f = clamp01((cut - rk) / band), f1 = clamp01((1 + band - rk) / band);
    const out = i < nB ? gal.outB : gal.outF, q = (i < nB ? i : i - nB) * 7;
    let r, g, b;
    if (KD[i] === K_HII) { r = 1.0; g = 0.3; b = 0.48; }
    else { const j = lutIdx(alive >= 1 ? t : t * shift); r = LUT[j]; g = LUT[j + 1]; b = LUT[j + 2]; }
    out[q + 3] = r; out[q + 4] = g; out[q + 5] = b; A[i] = l * f;
    const y = 0.3 * r + 0.6 * g + 0.1 * b, s2 = gal.SP[i] * gal.SP[i];
    lum += l * f * y * s2;
    if (f1 > 0) { const j = lutIdx(t); lum1 += l * f1 * (0.3 * LUT[j] + 0.6 * LUT[j + 1] + 0.1 * LUT[j + 2]) * s2; }
  }
  for (let i = 0; i < gal.SM.length; i++) { const m = gal.SM[i]; gal.smA[i] = tint(gal, alive, m[1] + (m[5] - m[1]) * e, (m[2] + (m[6] - m[2]) * e) * (m[3] > 0 ? 0.5 : 1), gal.smooth, i * 9); }
  for (let i = 0; i < gal.BAR.length; i++) { const m = gal.BAR[i]; gal.barA[i] = tint(gal, alive, m[2], m[3], gal.bar, i * 9); }
  const G = gal.glow;
  for (let i = 0; i < G.n; i++) G.A[i] = tint(gal, alive, G.T[i], G.L[i], G.out, i * 9);
  gal.lum = alive >= 1 ? 1 : lum1 > 0 ? lum / lum1 : 0;
  gal.cAlive = alive; gal.cRelax = relax;
}

/* shared projection state, filled per call (no allocation) */
const PJ = { cx: 0, cy: 0, S: 1, ci: 0.5, si: 0.866, cp: 1, sp: 0, ca: 1, sa: 0, pa: 0, e: 0 };
function setProj(o) {
  const tilt = num(o.tilt, 1.047), rot = num(o.rot, 0), pa = num(o.pa, -0.32);
  PJ.cx = num(o.x, 0); PJ.cy = num(o.y, 0); PJ.S = num(o.radius, 100);
  PJ.ci = Math.cos(tilt); PJ.si = Math.sin(tilt); PJ.cp = Math.cos(rot); PJ.sp = Math.sin(rot);
  PJ.ca = Math.cos(pa); PJ.sa = Math.sin(pa); PJ.pa = pa; PJ.e = smooth01(num(o.relax, 0));
}
function projectXYZ(x, y, z, out, q) {
  const x1 = x * PJ.cp - y * PJ.sp, y1 = x * PJ.sp + y * PJ.cp;
  const px = x1, py = -(y1 * PJ.ci + z * PJ.si);
  out[q] = PJ.cx + PJ.S * (px * PJ.ca - py * PJ.sa); out[q + 1] = PJ.cy + PJ.S * (px * PJ.sa + py * PJ.ca);
}
// an elliptical sprite lying in the disk plane, foreshortened by the tilt
function planeSmudge(o, q, x, y, tx0, ty0, len, sq) {
  projectXYZ(x, y, 0, o, q);
  const t1x = tx0 * PJ.cp - ty0 * PJ.sp, t1y = tx0 * PJ.sp + ty0 * PJ.cp, ci = PJ.ci;
  const tx = t1x, ty = -t1y * ci, nx = -t1y, ny = -t1x * ci;
  const maj = len * Math.hypot(tx, ty), mi = len * sq * Math.hypot(nx, ny);
  if (maj >= mi) { o[q + 2] = maj * PJ.S; o[q + 7] = Math.atan2(ty, tx) + PJ.pa; o[q + 8] = mi / Math.max(maj, 1e-9); }
  else { o[q + 2] = mi * PJ.S; o[q + 7] = Math.atan2(ny, nx) + PJ.pa; o[q + 8] = maj / Math.max(mi, 1e-9); }
}

const SCR = new Float32Array(2);
function project(gal, i, o, out) {
  setProj(o || {});
  const e = PJ.e;
  projectXYZ(gal.X[i] + (gal.EX[i] - gal.X[i]) * e, gal.Y[i] + (gal.EY[i] - gal.Y[i]) * e, gal.Z[i] + (gal.EZ[i] - gal.Z[i]) * e, SCR, 0);
  out = out || {}; out.x = SCR[0]; out.y = SCR[1];
  return out;
}

function fillPts(gal, out, i0, cnt, e, szK, ptK) {
  const X = gal.X, Y = gal.Y, Z = gal.Z, EX = gal.EX, EY = gal.EY, EZ = gal.EZ, SP = gal.SP, A = gal.A;
  for (let j = 0, q = 0; j < cnt; j++, q += 7) {
    const i = i0 + j;
    projectXYZ(X[i] + (EX[i] - X[i]) * e, Y[i] + (EY[i] - Y[i]) * e, Z[i] + (EZ[i] - Z[i]) * e, out, q);
    out[q + 2] = SP[i] * szK; out[q + 6] = A[i] * ptK;
  }
}

function drawGalaxy(g, gal, o) {
  o = o || {};
  const alive = clamp01(num(o.alive, 1)), relax = clamp01(num(o.relax, 0)), alpha = Math.max(0, num(o.alpha, 1)), detail = clamp01(num(o.detail, 1));
  if (alive !== gal.cAlive || relax !== gal.cRelax) recolour(gal, alive, relax);
  gal.ret.luminosity = gal.lum;
  if (!g || alpha <= 0) return gal.ret;
  setProj(o);
  const d = DPR(g), e = PJ.e, S = PJ.S, ci = PJ.ci, si = PJ.si;
  const fadeYoung = 1 - smooth01(relax / 0.6), fadeBar = 1 - smooth01(relax / 0.5);
  const dk = detail * detail;   // the share of points drawn
  // points carry fixed light each, so on a small galaxy they are dimmed toward the smooth layers' surface brightness
  const ptK = alpha * Math.min(1, Math.pow(S / (250 * d), 2)) / Math.max(dk, 1e-3);
  const smK = alpha * (1 + 0.5 * (1 - detail));

  // smooth layers: flattened disk gaussians morph into round ones
  const SM = gal.SM, sm = gal.smooth;
  const flatE = Math.sqrt(Math.pow(0.9 * ci, 2) + Math.pow(0.65 * si, 2)) / 0.95;
  for (let i = 0; i < SM.length; i++) {
    const m = SM[i], q = i * 9, qd = m[3];
    const sqD = Math.sqrt(ci * ci + qd * qd * si * si), sq = sqD + (flatE - sqD) * e;
    sm[q] = PJ.cx; sm[q + 1] = PJ.cy; sm[q + 2] = (m[0] + (m[4] - m[0]) * e) * S; sm[q + 6] = gal.smA[i] * smK; sm[q + 7] = PJ.pa; sm[q + 8] = Math.min(1, sq);
  }
  g.smudges(sm, SM.length);
  if (fadeBar > 0 && detail > 0) {
    for (let i = 0; i < gal.BAR.length; i++) { planeSmudge(gal.bar, i * 9, 0, 0, 1, 0, gal.BAR[i][0], gal.BAR[i][1]); gal.bar[i * 9 + 6] = gal.barA[i] * alpha * fadeBar; }
    g.smudges(gal.bar, gal.BAR.length);
  }
  if (detail <= 0) { g.smudges(gal.smoothFront, SM.length - gal.nDiskSm); return gal.ret; }

  const G = gal.glow, gN = Math.round(G.n * dk);
  if (fadeYoung > 0 && gN > 0) {
    const gk = alpha * fadeYoung / Math.max(dk, 1e-3);
    for (let i = 0; i < gN; i++) { planeSmudge(G.out, i * 9, G.X[i], G.Y[i], G.TX[i], G.TY[i], G.Lm[i], G.Sq[i]); G.out[i * 9 + 6] = G.A[i] * gk; }
    g.smudges(G.out, gN);
  }
  const szK = d * Math.max(0.6, Math.min(1, S / (250 * d)));
  const nBack = Math.round(gal.nBack * dk), nFront = Math.round((gal.count - gal.nBack) * dk);
  fillPts(gal, gal.outB, 0, nBack, e, szK, ptK);
  g.points(gal.outB, nBack);
  const D = gal.dust, dN = Math.round(D.n * dk);
  if (fadeYoung > 0 && dN > 0) {
    const dkA = alpha * fadeYoung * Math.min(2, 1 / Math.max(dk, 1e-3));
    for (let i = 0; i < dN; i++) {
      planeSmudge(D.out, i * 9, D.X[i], D.Y[i], D.TX[i], D.TY[i], D.Lm[i], D.Sq[i]);
      const x = D.X[i], y = D.Y[i];
      let a = D.A[i];
      if (x * x + y * y < 0.12) { const y1 = x * PJ.sp + y * PJ.cp; a *= 0.72 - 0.28 * Math.tanh(y1 * 25); }   // far-side inner dust sits behind the bulge's near half
      D.out[i * 9 + 6] = Math.min(1, a * dkA);
    }
    g.smudges(D.out, dN, { blend: 'dark' });
  }
  g.smudges(gal.smoothFront, SM.length - gal.nDiskSm);
  fillPts(gal, gal.outF, gal.nBack, nFront, e, szK, ptK);
  g.points(gal.outF, nFront);
  return gal.ret;
}

/* ================================================================ cosmic web */
/* Voronoi-like foam from seeded void centres in a thick slab: samples are projected onto the wall between their two nearest centres,
   the filament where three cells meet, or the node where four meet. A smooth seeded displacement field then bends the straight edges
   into curves, and a second field varies filament thickness along their length. A layer of broad faint sprites on the walls adds the diffuse sheets. */
function web(opts) {
  opts = opts || {};
  const seed = num(opts.seed, 7) | 0, N = Math.max(2000, num(opts.count, 90000) | 0), rnd = rng(seed);
  const SLAB = 0.3, NV = 230, V = new Float32Array(NV * 3);
  for (let i = 0; i < NV; i++) {
    let x, y, z; do { x = rnd() * 2.8 - 1.4; y = rnd() * 2.8 - 1.4; z = (rnd() * 2 - 1) * (SLAB + 0.4); } while (x * x + y * y > 1.96);
    V[i * 3] = x; V[i * 3 + 1] = y; V[i * 3 + 2] = z;
  }
  const near = new Int32Array(4), nd = new Float32Array(4);
  function nearest4(x, y, z) {
    nd.fill(1e9);
    for (let i = 0; i < NV; i++) {
      const dx = x - V[i * 3], dy = y - V[i * 3 + 1], dz = z - V[i * 3 + 2], dd = dx * dx + dy * dy + dz * dz;
      if (dd < nd[3]) { let j = 3; while (j > 0 && nd[j - 1] > dd) { nd[j] = nd[j - 1]; near[j] = near[j - 1]; j--; } nd[j] = dd; near[j] = i; }
    }
  }
  const c = (i, kk) => V[near[i] * 3 + kk];
  const Am = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bm = [0, 0, 0], Gm = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], ym = [0, 0, 0];
  function project(p, m) {   // nearest point to p equidistant from centres 0..m
    for (let j = 1; j <= m; j++) {
      const a = Am[j - 1]; a[0] = c(j, 0) - c(0, 0); a[1] = c(j, 1) - c(0, 1); a[2] = c(j, 2) - c(0, 2);
      const n2 = (c(j, 0) ** 2 + c(j, 1) ** 2 + c(j, 2) ** 2 - c(0, 0) ** 2 - c(0, 1) ** 2 - c(0, 2) ** 2) / 2;
      bm[j - 1] = n2 - (a[0] * p[0] + a[1] * p[1] + a[2] * p[2]);
    }
    for (let i = 0; i < m; i++) { for (let j = 0; j < m; j++) Gm[i][j] = Am[i][0] * Am[j][0] + Am[i][1] * Am[j][1] + Am[i][2] * Am[j][2]; Gm[i][m] = bm[i]; }
    for (let i = 0; i < m; i++) {
      let piv = i; for (let r = i + 1; r < m; r++) if (Math.abs(Gm[r][i]) > Math.abs(Gm[piv][i])) piv = r;
      if (Math.abs(Gm[piv][i]) < 1e-9) return false;
      const t = Gm[i]; Gm[i] = Gm[piv]; Gm[piv] = t;
      for (let r = 0; r < m; r++) if (r !== i) { const f = Gm[r][i] / Gm[i][i]; for (let kk = i; kk <= m; kk++) Gm[r][kk] -= f * Gm[i][kk]; }
    }
    for (let i = 0; i < m; i++) ym[i] = Gm[i][m] / Gm[i][i];
    for (let j = 0; j < m; j++) for (let kk = 0; kk < 3; kk++) p[kk] += Am[j][kk] * ym[j];
    return true;
  }
  // smooth displacement field (sum of seeded plane waves) and a thickness field
  const NW = 9, W = [];
  for (let i = 0; i < NW; i++) {
    const f = 2.2 + rnd() * 4.5, a = rnd() * TAU, b = Math.acos(rnd() * 2 - 1);
    W.push([Math.sin(b) * Math.cos(a) * f, Math.sin(b) * Math.sin(a) * f, Math.cos(b) * f, rnd() * TAU, gauss(rnd), gauss(rnd), gauss(rnd) * 0.4, 0.042 / Math.sqrt(f / 3)]);
  }
  const warp = (p) => {
    let dx = 0, dy = 0, dz = 0;
    for (const w of W) { const s = Math.sin(w[0] * p[0] + w[1] * p[1] + w[2] * p[2] + w[3]) * w[7]; dx += s * w[4]; dy += s * w[5]; dz += s * w[6]; }
    p[0] += dx; p[1] += dy; p[2] += dz;
  };
  const thick = (p) => { const s = Math.sin(p[0] * 9.1 + p[2] * 5 + 1.3) * Math.sin(p[1] * 7.3 - p[0] * 3.1 + 0.4) + 0.6 * Math.sin((p[0] + p[1]) * 13.7 + 2.1); return 0.35 + 0.9 * clamp01(0.5 + 0.5 * s); };

  const X = new Float32Array(N), Y = new Float32Array(N), Z = new Float32Array(N), SZ = new Float32Array(N), A0 = new Float32Array(N), out = new Float32Array(N * 7);
  const logU = (a, b) => a * Math.pow(b / a, rnd());
  const kL = Math.sqrt(90000 / N) * 0.8;
  let n = 0, guard = 0;
  const p = [0, 0, 0], q3 = [0, 0, 0];
  // sheets: broad faint sprites on the walls
  const NS = Math.round(1200 + N * 0.02), sh = { n: 0, X: new Float32Array(NS), Y: new Float32Array(NS), Z: new Float32Array(NS), S: new Float32Array(NS), A: new Float32Array(NS), DX: new Float32Array(NS), DY: new Float32Array(NS), DZ: new Float32Array(NS), W: new Float32Array(NS), out: new Float32Array(NS * 9) };
  const shC = lutIdx(6500);
  while ((n < N || sh.n < NS) && guard++ < N * 30) {
    const sheet = n >= N || (sh.n < NS && rnd() < NS / (N + NS));
    const u = rnd(), m = sheet ? (rnd() < 0.75 ? 2 : 1) : u < 0.2 ? 3 : u < 0.7 ? 2 : u < 0.975 ? 1 : 0;
    p[0] = rnd() * 2 - 1; p[1] = rnd() * 2 - 1; p[2] = (rnd() * 2 - 1) * SLAB;
    if (p[0] * p[0] + p[1] * p[1] > 1) continue;
    if (m > 0) {
      nearest4(p[0], p[1], p[2]);
      if (!project(p, m)) continue;
      nearest4(p[0], p[1], p[2]);
      if (nd[m] - nd[0] > 0.02) continue;
    }
    let T, L, sz, sc;
    const th = thick(p);
    if (m === 3) { sc = 0.004 + Math.pow(rnd(), 3) * 0.02; T = logU(3800, 5600); L = 0.2 + Math.pow(rnd(), 4) * 0.9; sz = 1.9; }
    else if (m === 2) { sc = (0.002 + rnd() * rnd() * 0.012) * th * 1.3; T = logU(4500, 9500); L = (0.09 + Math.pow(rnd(), 6) * 0.4) * (0.6 + 0.6 * th); sz = 1.7; }
    else if (m === 1) { sc = 0.006; T = logU(5000, 9500); L = 0.04; sz = 1.6; }
    else { sc = 0; T = logU(5000, 9000); L = 0.035; sz = 1.5; }
    const p0x = p[0], p0y = p[1], p0z = p[2];
    warp(p);
    if (sheet) sc = m === 2 ? 0.018 : 0.01;   // sheets: a soft sleeve around filaments, fainter on the walls
    const x = p[0] + gauss(rnd) * sc, y = p[1] + gauss(rnd) * sc, z = p[2] + gauss(rnd) * sc;
    if (x * x + y * y > 1 || Math.abs(z) > SLAB + 0.05) continue;
    if (sheet) {
      if (sh.n >= NS) continue;
      const i = sh.n++; sh.X[i] = x; sh.Y[i] = y; sh.Z[i] = z;
      if (m === 2) {   // a sleeve along the filament: its direction is normal to both cell walls
        const ax = c(1, 0) - c(0, 0), ay = c(1, 1) - c(0, 1), az = c(1, 2) - c(0, 2), bx = c(2, 0) - c(0, 0), by = c(2, 1) - c(0, 1), bz = c(2, 2) - c(0, 2);
        let dx = ay * bz - az * by, dy = az * bx - ax * bz, dz = ax * by - ay * bx, l = Math.hypot(dx, dy, dz) || 1;
        // carry the direction through the warp so the sleeve follows the bent filament
        q3[0] = p0x + dx / l * 0.01; q3[1] = p0y + dy / l * 0.01; q3[2] = p0z + dz / l * 0.01; warp(q3);
        dx = q3[0] - p[0]; dy = q3[1] - p[1]; dz = q3[2] - p[2]; l = Math.hypot(dx, dy, dz) || 1;
        sh.DX[i] = dx / l; sh.DY[i] = dy / l; sh.DZ[i] = dz / l; sh.S[i] = 0.035 + rnd() * 0.03; sh.W[i] = 0.016 + rnd() * 0.008; sh.A[i] = 0.007 + rnd() * 0.005;
      } else { sh.S[i] = 0.05 + rnd() * 0.03; sh.W[i] = sh.S[i]; sh.A[i] = 0.0025; }
      const q = i * 9; sh.out[q + 3] = LUT[shC]; sh.out[q + 4] = LUT[shC + 1]; sh.out[q + 5] = LUT[shC + 2];
      continue;
    }
    if (n >= N) continue;
    X[n] = x; Y[n] = y; Z[n] = z; SZ[n] = sz;
    const j = lutIdx(T), q = n * 7;
    out[q + 3] = LUT[j]; out[q + 4] = LUT[j + 1]; out[q + 5] = LUT[j + 2]; A0[n] = L * kL;
    // a knot: a small group of galaxies around this node point
    if (m === 3 && rnd() < 0.35) {
      for (let t = 0, mm = 2 + ((rnd() * 5) | 0); t < mm && n + 1 < N; t++) {
        n++; const qq = n * 7, s2 = 0.004 + rnd() * 0.008;
        X[n] = x + gauss(rnd) * s2; Y[n] = y + gauss(rnd) * s2; Z[n] = z + gauss(rnd) * s2; SZ[n] = 1.8;
        const jj = lutIdx(logU(3700, 5200)); out[qq + 3] = LUT[jj]; out[qq + 4] = LUT[jj + 1]; out[qq + 5] = LUT[jj + 2]; A0[n] = (0.15 + Math.pow(rnd(), 3) * 0.6) * kL;
      }
    }
    n++;
  }
  const NR = 720, rim = new Float32Array(NR * 7), rimC = lutIdx(2700);
  for (let i = 0; i < NR; i++) { const q = i * 7; rim[q + 3] = LUT[rimC]; rim[q + 4] = LUT[rimC + 1]; rim[q + 5] = LUT[rimC + 2]; }
  return { count: n, X, Y, Z, SZ, A0, out, sheets: sh, rim, NR, SLAB };
}

const WS = { cr: 1, sr: 0, cw: 1, sw: 0, cx: 0, cy: 0, Rz: 1 };
function xf(X, Y, Z, i, out, q) {
  const x0 = X[i] * WS.cr - Y[i] * WS.sr, y0 = X[i] * WS.sr + Y[i] * WS.cr;
  const x = x0 * WS.cw + Z[i] * WS.sw, z = -x0 * WS.sw + Z[i] * WS.cw, persp = 3.2 / (3.2 - z);
  out[q] = WS.cx + x * WS.Rz * persp; out[q + 1] = WS.cy + y0 * WS.Rz * persp;
  return persp;
}
function drawWeb(g, w, o) {
  o = o || {};
  const alpha = Math.max(0, num(o.alpha, 1)), rimK = clamp01(num(o.rim, 1)), detail = clamp01(num(o.detail, 1));
  if (!g || alpha <= 0) return;
  const d = DPR(g), cx = num(o.x, 0), cy = num(o.y, 0), R = num(o.radius, 100), zoom = Math.max(0.01, num(o.zoom, 1)), rot = num(o.rot, 0);
  // turn about the line of sight, with a slow small rocking of the slab for parallax (both from rot, so the result is deterministic)
  const cr = Math.cos(rot), sr = Math.sin(rot), wb = 0.12 * Math.sin(rot * 3.7), cw = Math.cos(wb), sw = Math.sin(wb);
  const Rz = R * zoom, ks = d * Math.min(2, Math.sqrt(zoom));
  if (rimK > 0) {
    const rr = Rz * 1.05;
    for (let i = 0; i < w.NR; i++) {   // a thin bright edge and a broad faint glow falling inward
      const a = i / w.NR * TAU, q = i * 7, r1 = i % 2 ? rr : rr * 0.97;
      w.rim[q] = cx + Math.cos(a) * r1; w.rim[q + 1] = cy + Math.sin(a) * r1; w.rim[q + 2] = i % 2 ? rr * 0.05 : rr * 0.22; w.rim[q + 6] = (i % 2 ? 0.02 : 0.004) * rimK * alpha;
    }
    g.points(w.rim, w.NR);
  }
  WS.cr = cr; WS.sr = sr; WS.cw = cw; WS.sw = sw; WS.cx = cx; WS.cy = cy; WS.Rz = Rz;
  const S = w.sheets, so = S.out, wallK = alpha / zoom;
  for (let i = 0; i < S.n; i++) {
    const q = i * 9, ps = xf(S.X, S.Y, S.Z, i, so, q);
    if (S.W[i] < S.S[i]) {   // filament sleeve: oriented along the filament's projected direction
      const x0 = S.DX[i] * cr - S.DY[i] * sr, y0 = S.DX[i] * sr + S.DY[i] * cr, x = x0 * cw + S.DZ[i] * sw;
      const pl = Math.hypot(x, y0), len = Math.max(S.W[i], S.S[i] * pl);
      so[q + 2] = len * Rz * ps; so[q + 6] = S.A[i] * alpha / Math.sqrt(zoom); so[q + 7] = Math.atan2(y0, x); so[q + 8] = S.W[i] / len;
    } else { so[q + 2] = S.S[i] * Rz * ps; so[q + 6] = S.A[i] * wallK; so[q + 7] = 0; so[q + 8] = 1; }
  }
  g.smudges(so, S.n);
  const n = Math.round(w.count * detail * detail), k = alpha / Math.max(detail * detail, 1e-3), out = w.out;
  for (let i = 0, q = 0; i < n; i++, q += 7) { const ps = xf(w.X, w.Y, w.Z, i, out, q); out[q + 2] = w.SZ[i] * ks * ps; out[q + 6] = w.A0[i] * k; }
  g.points(out, n);
}

ENT.sky = { galaxy, drawGalaxy, project, web, drawWeb };
})();
