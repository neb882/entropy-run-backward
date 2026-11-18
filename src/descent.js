(() => {
'use strict';
const ENT = window.ENT;
const { $, MINUS, reduced, mulberry32, blackbody, fit, fmtInt, sci, pow10html } = ENT;
const track = $('dscTrack');
if (!track) return;
const cv = $('dscSky'), glCv = $('dscGL');
// light goes through the shared WebGL2 renderer; the 2D canvas on top carries rings, the atom marker and motes.
// Without WebGL2 the 2D canvas draws the whole sky, as before.
let gl = null;
try { gl = ENT.gfx && glCv ? ENT.gfx.create(glCv, { maxDpr: 1.5 }) : null; } catch (e) { gl = null; }
if (!gl && glCv) glCv.hidden = true;
const ctx = cv.getContext('2d');
const stage = $('dscStage'), rail = $('dscRail'), topBox = $('dscTop');
const phoneMQ = window.matchMedia('(max-width: 760px)');

/* ---------------- scroll <-> time ---------------- */
const U0 = Math.log10(13.79e9);
// more scroll per decade near the present, where events are dense; see the rail for true log position
const KS = [0, 1.2, 2.0, 3.0, 5.8, 9.3, 14.3, 24.3, 26.8], KU = [U0, 10.34, 10.6, 11.2, 14, 20, 40, 100, 108], SMAX = 26.8;
function s2u(s) {
  if (s <= 0) return U0;
  for (let i = 1; i < KS.length; i++) if (s <= KS[i]) return KU[i - 1] + ((s - KS[i - 1]) / (KS[i] - KS[i - 1])) * (KU[i] - KU[i - 1]);
  return KU[KU.length - 1];
}
function u2s(u) {
  if (u <= U0) return 0;
  for (let i = 1; i < KU.length; i++) if (u <= KU[i]) return KS[i - 1] + ((u - KU[i - 1]) / (KU[i] - KU[i - 1])) * (KS[i] - KS[i - 1]);
  return SMAX;
}

/* ---------------- cosmology (as in the old section): flat ΛCDM, H0 = 67.7, Ωm = 0.31 ---------------- */
const Om = 0.31, OL = 0.69, H0 = 1 / 14.443e9; // per year
const lnSinh = (x) => (x > 20 ? x - Math.LN2 : Math.log(Math.sinh(x)));
const lnA = (t) => Math.log(Om / OL) / 3 + (2 / 3) * lnSinh(1.5 * Math.sqrt(OL) * H0 * t);
const lnA0 = lnA(13.79e9);
const log10a = (u) => (lnA(Math.pow(10, u)) - lnA0) / Math.LN10;
const TDS = 2.2e-30;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const TAU = Math.PI * 2;

/* ---------------- the sky: one seeded neighbourhood ---------------- */
const rnd = mulberry32(2026);
const gauss = () => { let a = 0; while (a === 0) a = rnd(); const b = rnd(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(TAU * b); };
const T0 = 13.79e9, POOL = 900;
const RED = 0, SUN = 1, BIG = 2, WD = 0, NS = 1, BH = 2;
const stars = [];
for (let i = 0; i < POOL; i++) {
  const r = rnd(), type = r < 0.74 ? RED : r < 0.95 ? SUN : BIG;
  // disk layout (units of the galaxy radius), with two faint arms
  const rd = Math.min(1.12, -Math.log(1 - rnd() * 0.96) * (type === BIG ? 0.24 : 0.29) + 0.025);
  let th = rnd() * TAU;
  if (rnd() < (type === BIG ? 0.85 : 0.45)) th = (rnd() < 0.5 ? 0 : Math.PI) + 2.3 * Math.log(rd + 0.06) + gauss() * 0.3;
  const dx = Math.cos(th) * rd, dy = Math.sin(th) * rd * 0.27 + gauss() * 0.014;
  // elliptical layout after the merger
  let ex = gauss() * 0.27, ey = gauss() * 0.21;
  const er = Math.hypot(ex, ey); if (er > 1.05) { ex *= 1.05 / er; ey *= 1.05 / er; }
  // birth and death, log10 years
  let ub, ud;
  if (type === BIG) {
    const life = Math.pow(10, 6.8 + rnd() * 2.1), tb = T0 - rnd() * life * 0.97;
    ub = Math.log10(tb); ud = Math.log10(tb + life);
  } else if (type === SUN) {
    const life = Math.pow(10, 9.9 + rnd() * 0.35);
    const tb = rnd() < 0.72 ? 1e9 + rnd() * (T0 - 1e9) : T0 + Math.pow(rnd(), 1.6) * (7.9e10 - T0);
    ub = Math.log10(tb); ud = Math.log10(tb + life);
  } else {
    const life = Math.pow(10, 12.88 + rnd() * 1.1);
    const tb = rnd() < 0.72 ? 1e9 + rnd() * (T0 - 1e9) : Math.pow(10, U0 + Math.pow(rnd(), 1.7) * (13 - U0));
    ub = Math.log10(tb); ud = Math.min(13.995, Math.max(ub + 0.08, Math.log10(tb + life)));
  }
  const T = type === RED ? 2900 + rnd() * 700 : type === SUN ? 4900 + rnd() * 1500 : 10000 + rnd() * 16000;
  const rem = type === BIG ? (rnd() < 0.35 ? BH : NS) : WD;
  stars.push({
    type, dx, dy, ex, ey, ub, ud, rem, T,
    col: blackbody(T).join(','),
    b: type === RED ? 0.36 + rnd() * 0.26 : type === SUN ? 0.72 + rnd() * 0.25 : 1,
    sz: type === RED ? 0.85 + rnd() * 0.45 : type === SUN ? 1.2 + rnd() * 0.55 : 1.6 + rnd() * 0.8,
    wdEnd: 15 + rnd(), wdT: type === SUN ? 22000 : 12000,
    ue: 19 + rnd(), falls: rnd() < (rem === WD ? 0.1 : 0.16),
    sinkR: 0.05 + rnd() * 0.13, uv: 20.7 + rnd() * 9.1, turns: (1 + rnd() * 2) * (rnd() < 0.5 ? 1 : -1),
    ej: Math.atan2(ey, ex) + gauss() * 0.35,
    tw: rnd() * 100, tws: 1.4 + rnd() * 2.6,
  });
}
// distant galaxies, reddening and fading as expansion carries them off
const galaxies = [];
while (galaxies.length < 36) {
  const x = rnd(), y = rnd();
  const g = { x, y, r: 2.5 + rnd() * 4.5, e: 0.45 + rnd() * 0.5, rot: rnd() * Math.PI, fade: 10.55 + rnd() * 0.6, b: 0.12 + rnd() * 0.16 };
  if (((x - 0.5) / 0.32) ** 2 + ((y - 0.5) / 0.2) ** 2 < 1) continue;
  galaxies.push(g);
}
// brown-dwarf collisions: one dim red dwarf at a time, on average
const sparks = [];
for (let i = 0; i < 11; i++) sparks.push({ us: 14.05 + rnd() * 4.55, dur: 0.3 + rnd() * 0.35, x: gauss() * 0.25, y: gauss() * 0.2, col: blackbody(2900 + rnd() * 400).join(',') });
// the dark era: a thin scatter of particles
const motes = [];
for (let i = 0; i < 40; i++) motes.push({ x: rnd(), y: rnd(), vx: (rnd() - 0.5) * 5, vy: (rnd() - 0.5) * 5, end: 104 + rnd() * 2.6, a: 0.09 + rnd() * 0.09 });

// the reader's atom: at the Sun's place in the disk, about 55% of the way out, on the near side
const ATOM = { dx: Math.cos(1.95) * 0.55, dy: Math.sin(1.95) * 0.55 * 0.27, ex: -0.16, ey: 0.115 };
ATOM.ej = Math.atan2(ATOM.ey, ATOM.ex);
const EMB = '255,138,74';

// stars shining in the observable universe: 2e23 x the fraction of the model's ordinary stars alive (whole pool,
// so every screen size agrees), held to its running minimum so the count never rises on the way down
const NSTEP = 0.002, NTAB = Math.ceil((14 - U0) / NSTEP) + 1, starTab = new Float64Array(NTAB);
{
  let a0 = 0; for (const st of stars) if (U0 >= st.ub && U0 < st.ud) a0++;
  let run = Infinity;
  for (let i = 0; i < NTAB; i++) {
    const u = Math.min(14, U0 + i * NSTEP);
    let n = 0; for (const st of stars) if (u >= st.ub && u < st.ud) n++;
    run = Math.min(run, Math.max(2e14, 2e23 * (n / a0)));
    starTab[i] = run;
  }
}
function starsAt(u) {
  if (u <= 14) return starTab[Math.max(0, Math.min(NTAB - 1, Math.floor((u - U0) / NSTEP + 1e-9)))];
  if (u <= 19) return 2e14;
  if (u <= 20.5) return Math.pow(10, Math.log10(2e14) * (1 - (u - 19) / 1.5));
  return 0;
}
function galaxiesAt(u) {
  if (u > 20) return 0;
  const x = clamp01((u - U0) / (11.2 - U0));
  return Math.pow(10, 12.3 * (1 - Math.pow(x, 4)));
}
// two significant figures, then zeros, with thousands separators; plain integer below 100
function fmt2(n) {
  n = Math.round(n);
  if (n < 100) return String(n);
  let e = Math.floor(Math.log10(n)), m = Math.round(n / Math.pow(10, e - 1));
  if (m >= 100) { m = 10; e++; }
  return (String(m) + '0'.repeat(e - 1)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const NS_COL = blackbody(9500).join(','), GLOW = '255,214,170', FLASH = '255,252,245', BONE = '235,229,217';
const TILT = -0.16, cT = Math.cos(TILT), sT = Math.sin(TILT);
let W = 1, H = 1, D = 1, R = 100, nStars = 450, alive0 = 1, clk = 0;

function place(st, u) { // galaxy-plane position in units of R, or null once gone
  const k = smooth((u - 10.3) / 0.7);
  return evolve(st.dx + (st.ex - st.dx) * k, st.dy + (st.ey - st.dy) * k, st, u);
}
// after u = st.ue a remnant is either flung out (most) or sinks toward the centre and is swallowed by u = st.uv
function evolve(x, y, st, u) {
  if (u > st.ue) {
    if (st.falls) {
      const r0 = Math.hypot(x, y) || 1e-6, a0 = Math.atan2(y, x);
      let r = r0 + (Math.min(r0, st.sinkR) - r0) * smooth((u - st.ue) / (20.5 - st.ue)), a = a0;
      if (u > 20.5) {
        const q = clamp01((u - 20.5) / (st.uv - 20.5));
        if (q >= 1) return null;
        r *= Math.pow(1 - q, 0.8); a += st.turns * TAU * q;
      }
      x = Math.cos(a) * r; y = Math.sin(a) * r;
    } else {
      const p = clamp01((u - st.ue) / 0.5), dd = p * p * 4.2;
      x += Math.cos(st.ej) * dd; y += Math.sin(st.ej) * dd;
    }
  }
  return [x, y];
}
// on wide screens the captions own the left side, so the sky sits right of centre
const CX = () => W * (W / (D || 1) >= 900 ? 0.585 : 0.5);
const toX = (x, y) => CX() + (x * cT - y * sT) * R;
const toY = (x, y) => H / 2 + (x * sT + y * cT) * R;
function dot(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }

function draw2d(u) {
  const d = D;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#050609'; ctx.fillRect(0, 0, W, H);
  if (u >= 93.4 && u < 100) return; // empty
  const tw = reduced ? 0 : clk, rDot = Math.max(0.75 * d, 1);

  if (u < 11.2) for (const g of galaxies) {
    const a = g.b * clamp01((g.fade - u) / 0.4); if (a <= 0.003) continue;
    const k = clamp01((u - U0) / (g.fade - U0));
    const c = `${Math.round(228 - 18 * k)},${Math.round(214 - 110 * k)},${Math.round(200 - 140 * k)}`;
    const rr = g.r * (1 - 0.4 * k) * d;
    ctx.save(); ctx.translate(g.x * W, g.y * H); ctx.rotate(g.rot); ctx.scale(1, g.e);
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rr);
    gr.addColorStop(0, `rgba(${c},${a})`); gr.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.fill(); ctx.restore();
  }

  if (u < 14) { // the diffuse glow of living stars
    let alive = 0; for (let i = 0; i < nStars; i++) { const st = stars[i]; if (u >= st.ub && u < st.ud) alive++; }
    const A = 0.15 * (alive / alive0);
    if (A > 0.002) {
      const k = smooth((u - 10.3) / 0.7);
      ctx.save(); ctx.translate(CX(), H / 2); ctx.rotate(TILT); ctx.scale(1, 0.3 + 0.48 * k);
      let gr = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.95);
      gr.addColorStop(0, `rgba(${GLOW},${A})`); gr.addColorStop(0.4, `rgba(${GLOW},${A * 0.35})`); gr.addColorStop(1, `rgba(${GLOW},0)`);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, R * 0.95, 0, TAU); ctx.fill();
      gr = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.22);
      gr.addColorStop(0, `rgba(${GLOW},${A * 1.3})`); gr.addColorStop(1, `rgba(${GLOW},0)`);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, R * 0.22, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  if (u < 30) for (let i = 0; i < nStars; i++) {
    const st = stars[i];
    if (u < st.ub) continue;
    const p = place(st, u); if (!p) continue;
    const X = toX(p[0], p[1]), Y = toY(p[0], p[1]);
    if (X < -12 || X > W + 12 || Y < -12 || Y > H + 12) continue;
    if (u < st.ud) { // shining
      let a = st.b * clamp01((u - st.ub) / 0.03) * (0.25 + 0.75 * clamp01((st.ud - u) / 0.025));
      if (tw) a *= 1 + 0.12 * Math.sin(tw * st.tws + st.tw);
      ctx.fillStyle = `rgba(${st.col},${Math.min(1, a)})`;
      dot(X, Y, st.sz * d);
      if (st.type === BIG) { ctx.fillStyle = `rgba(${st.col},${0.12 * a})`; dot(X, Y, st.sz * 3.4 * d); }
      continue;
    }
    // remnants
    const born = clamp01((u - st.ud) / 0.025);
    if (st.rem === WD) {
      if (u >= st.wdEnd) continue;
      const span = st.wdEnd - st.ud, k = clamp01((u - st.ud) / span);
      const T = st.wdT * Math.pow(2000 / st.wdT, k);
      const a = u < 14 ? 0.3 - 0.17 * clamp01((u - st.ud) / Math.max(0.01, 14 - st.ud)) : 0.13 * (1 - clamp01((u - 14) / (st.wdEnd - 14)));
      ctx.fillStyle = `rgba(${blackbody(T).join(',')},${a * born})`;
      dot(X, Y, rDot);
    } else if (st.rem === NS) {
      ctx.fillStyle = `rgba(${NS_COL},${(0.14 - 0.04 * clamp01((u - 12) / 7)) * born})`;
      dot(X, Y, rDot);
    } else {
      ctx.strokeStyle = `rgba(${BONE},${0.1 * born})`; ctx.lineWidth = 0.6 * d;
      ctx.beginPath(); ctx.arc(X, Y, 1.35 * d, 0, TAU); ctx.stroke();
    }
  }

  if (u > 14 && u < 19.2) for (const sp of sparks) { // collisions of brown dwarfs
    if (u < sp.us || u > sp.us + sp.dur) continue;
    const a = 0.5 * clamp01((u - sp.us) / 0.05) * clamp01((sp.us + sp.dur - u) / 0.12);
    ctx.fillStyle = `rgba(${sp.col},${a})`;
    dot(toX(sp.x, sp.y), toY(sp.x, sp.y), 1.05 * d);
  }

  if (u < 20.5) { // your atom
    const k = smooth((u - 10.3) / 0.7);
    let x = ATOM.dx + (ATOM.ex - ATOM.dx) * k, y = ATOM.dy + (ATOM.ey - ATOM.dy) * k;
    if (u > 19) { const p = (u - 19) / 1.5, dd = p * p * 4.6; x += Math.cos(ATOM.ej) * dd; y += Math.sin(ATOM.ej) * dd; }
    const X = toX(x, y), Y = toY(x, y), rr = 6 * d;
    if (X > -rr * 2 && X < W + rr * 2 && Y > -rr * 2 && Y < H + rr * 2) {
      ctx.strokeStyle = `rgba(${EMB},0.62)`; ctx.lineWidth = d;
      ctx.beginPath(); ctx.arc(X, Y, rr, 0, TAU); ctx.stroke();
      ctx.fillStyle = `rgba(${EMB},0.95)`; dot(X, Y, 1.6 * d);
    }
  }

  // the central black hole, its last moments, and the flash
  const cx = CX(), cy = H / 2, rb = 5.5 * d;
  if (u < 93) {
    const end = smooth((u - 92.6) / 0.4);
    if (end > 0) {
      const gr = ctx.createRadialGradient(cx, cy, rb, cx, cy, rb * 4);
      gr.addColorStop(0, `rgba(${FLASH},${0.18 * end})`); gr.addColorStop(1, `rgba(${FLASH},0)`);
      ctx.fillStyle = gr; dot(cx, cy, rb * 4);
    }
    ctx.fillStyle = '#000'; dot(cx, cy, rb);
    ctx.strokeStyle = `rgba(${BONE},${(u < 14 ? 0.3 : 0.38) + 0.6 * end})`; ctx.lineWidth = d;
    ctx.beginPath(); ctx.arc(cx, cy, rb, 0, TAU); ctx.stroke();
  }
  const f = 1 - Math.abs(u - 93) / 0.3;
  if (f > 0) {
    const I = f * f, fr = 0.25 * Math.min(W, H) * (0.35 + 0.65 * f);
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, fr);
    [[0, 1], [0.07, 0.72], [0.18, 0.4], [0.36, 0.16], [0.62, 0.045], [1, 0]].forEach(([o, k]) => gr.addColorStop(o, `rgba(${FLASH},${k * I})`));
    ctx.fillStyle = gr; dot(cx, cy, fr);
  }

  if (u >= 100 && u < 107) {
    const fin = clamp01((u - 100) / 0.6), mt = reduced ? 0 : clk;
    for (const m of motes) {
      const a = m.a * fin * clamp01((m.end - u) / 0.8); if (a <= 0) continue;
      const x = ((((m.x * W + m.vx * mt * d) % W) + W) % W), y = ((((m.y * H + m.vy * mt * d) % H) + H) % H);
      ctx.fillStyle = `rgba(${BONE},${a})`; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(d)), Math.max(1, Math.round(d)));
    }
  }
}

/* ================= the sky through the shared renderer (gfx + sky) ================= */
const rndG = mulberry32(7717); // its own stream: the model above, and the star counter built on it, stay exactly as they were
const gaussR = (r) => { let a = 0; while (a === 0) a = r(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(TAU * r()); };
// blackbody -> linear rgb with the brightest channel at 1
const LUT_N = 512, LT0 = 800, LT1 = 40000, LUT = new Float32Array(LUT_N * 3);
for (let i = 0; i < LUT_N; i++) {
  const c = blackbody(LT0 * Math.pow(LT1 / LT0, i / (LUT_N - 1))).map((v) => Math.pow(v / 255, 2.2));
  const m = Math.max(c[0], c[1], c[2], 1e-6);
  LUT[i * 3] = c[0] / m; LUT[i * 3 + 1] = c[1] / m; LUT[i * 3 + 2] = c[2] / m;
}
const LLN = Math.log(LT1 / LT0);
const lutIdx = (T) => Math.max(0, Math.min(LUT_N - 1, Math.round((Math.log(T / LT0) / LLN) * (LUT_N - 1)))) * 3;
const PHONE = Math.min(window.innerWidth, (window.screen && window.screen.width) || 1e9) <= 480;
const TILT_G = 1.047, ROT0 = 0.6, CAP = 40;
const aliveAt = (u) => (u < 14 ? starsAt(u) / 2e23 : 0);   // the Stars shining counter's fraction
const relaxAt = (u) => clamp01((u - 10.3) / 0.7);   // ENT.sky eases it
const skyOK = () => !!(ENT.sky && ENT.sky.galaxy && ENT.sky.drawGalaxy && ENT.sky.project);
const PB = new Float32Array(4200 * 9);                       // one scratch buffer, uploaded by each call before reuse
let PN = 0;
function pt(x, y, size, T, a) { const o = PN++ * 7, j = lutIdx(T); PB[o] = x; PB[o + 1] = y; PB[o + 2] = size; PB[o + 3] = LUT[j]; PB[o + 4] = LUT[j + 1]; PB[o + 5] = LUT[j + 2]; PB[o + 6] = a; }
function ptRGB(x, y, size, r, g, b, a) { const o = PN++ * 7; PB[o] = x; PB[o + 1] = y; PB[o + 2] = size; PB[o + 3] = r; PB[o + 4] = g; PB[o + 5] = b; PB[o + 6] = a; }
function flushPts(g, o) { if (PN) g.points(PB, PN, o); PN = 0; }

// frame geometry: where the galaxy sits for a frame of W x H device px at d device px per CSS px
const geoms = new Map();
function geomFor(W, H, d) {
  const key = `${W}x${H}@${d}`;
  let G = geoms.get(key);
  if (G) return G;
  const cw = W / d, ch = H / d, narrow = cw <= 760;
  G = { W, H, d, cw, ch, narrow };
  if (narrow) { G.x = W * 0.5; G.y = H * 0.62; G.radius = Math.min(cw * 0.5, ch * 0.3) * d; G.pa = -0.5; }
  else { G.x = W * (cw >= 900 ? 0.585 : 0.5); G.y = H * 0.5; G.radius = Math.min(cw * 0.33, ch * 0.52) * d; G.pa = -0.3; }
  G.R0 = G.radius * 0.95;   // radius of the old point model, used only when ENT.sky is missing
  if (geoms.size > 6) geoms.clear();
  geoms.set(key, G);
  return G;
}
const oX = (G, x, y) => G.x + (x * cT - y * sT) * G.R0;
const oY = (G, x, y) => G.y + (x * sT + y * cT) * G.R0;

/* distant galaxies: small oriented smudges that redden and drop out in step with the Galaxies in view counter */
const BGN = 150, BG = [];
for (let i = 0; i < BGN; i++) {
  const big = rndG() < 0.1;
  BG.push({ x: 0.02 + rndG() * 0.96, y: 0.02 + rndG() * 0.96, s: big ? 9 + rndG() * 10 : 2.4 + Math.pow(rndG(), 1.7) * 6.5,
    T: 4300 * Math.pow(9500 / 4300, rndG()), a: big ? 0.035 + rndG() * 0.04 : 0.05 + rndG() * 0.1,
    ang: rndG() * Math.PI, sq: 0.2 + rndG() * 0.75, thr: rndG() });
}
function drawBG(g, G, u, E) {
  const f = Math.log10(Math.max(1, galaxiesAt(u))) / 12.3, x = clamp01((u - U0) / (11.2 - U0));
  const n = G.cw <= 480 ? 60 : BGN, d = G.d;
  let q = 0;
  for (let i = 0; i < n; i++) {
    const b = BG[i], v = clamp01((f - b.thr) / 0.06);
    if (v <= 0) continue;
    const j = lutIdx(b.T * (1 - 0.5 * x)), a = (b.a * v * (1 - 0.4 * x)) / E, X = b.x * G.W, Y = b.y * G.H, sz = b.s * d * (1 - 0.25 * x);
    for (let k = 0; k < 2; k++) {   // a faint body and a brighter core
      const o = q * 9; q++;
      PB[o] = X; PB[o + 1] = Y; PB[o + 2] = k ? sz * 0.32 : sz; PB[o + 3] = LUT[j]; PB[o + 4] = LUT[j + 1]; PB[o + 5] = LUT[j + 2];
      PB[o + 6] = k ? a * 1.5 : a * 0.55; PB[o + 7] = b.ang; PB[o + 8] = k ? Math.min(1, b.sq * 1.5) : b.sq;
    }
  }
  if (q) g.smudges(PB, q);
}

/* supernovae: brief white glints in the disk, deterministic in u, never more than two at once */
const GLINTS = [];
for (let i = 0; i < 40; i++) GLINTS.push({ u: 10.16 + (i + 0.2 + rndG() * 0.6) * (0.54 / 40), w: 0.0055 + rndG() * 0.0025, f: rndG(), I: 5 + rndG() * 9 });
for (let i = 0; i < 9; i++) GLINTS.push({ u: 10.75 + (i + 0.2 + rndG() * 0.6) * (1.25 / 9), w: 0.006 + rndG() * 0.004, f: rndG(), I: 5 + rndG() * 7 });
/* dead stars colliding: a few white flashes in the dark */
const BANGS = [];
for (let i = 0; i < 6; i++) BANGS.push({ u: 14.35 + (i + 0.15 + rndG() * 0.7) * (4.5 / 6), w: 0.03 + rndG() * 0.02, f: rndG(), I: 2 + rndG() * 2 });

/* the galaxy model, built once when ENT.sky is there */
let GAL = null, ATOMI = -1, REM = null, L0 = 0;
const PO = { x: 0, y: 0, radius: 1, tilt: TILT_G, pa: 0, rot: ROT0, alive: 1, relax: 0, alpha: 1, detail: 1 };
const tmpS = { x: 0, y: 0, z: 0, T: 0, kind: 0 }, tmpP = { x: 0, y: 0 };
function setPO(G, u, rot) {
  PO.x = G.x; PO.y = G.y; PO.radius = G.radius; PO.pa = G.pa; PO.tilt = TILT_G; PO.rot = rot;
  PO.alive = aliveAt(u); PO.relax = relaxAt(u); PO.alpha = 1; PO.detail = 1;
}
function uOfAlive(a) {   // first u at which the alive fraction has fallen to a
  let lo = 0, hi = NTAB - 1;
  if (starTab[hi] / 2e23 > a) return 14;
  while (lo < hi) { const m = (lo + hi) >> 1; if (starTab[m] / 2e23 <= a) hi = m; else lo = m + 1; }
  return U0 + lo * NSTEP;
}
function galaxy() {
  if (GAL) return GAL;
  if (!skyOK()) return null;
  try { GAL = ENT.sky.galaxy({ seed: 2026, count: PHONE ? 25000 : 60000 }); } catch (e) { GAL = null; }
  if (!GAL) return null;
  const n = GAL.count;
  // the atom: one star about 55% of the way out, on the near side (lowest on screen with the disk seen from above)
  const U = { x: 0, y: 0, radius: 1, tilt: TILT_G, pa: 0, rot: ROT0, alive: 1, relax: 0, alpha: 1, detail: 1 };
  let best = -1, by = -Infinity;
  const T = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    GAL.star(i, tmpS); T[i] = tmpS.T;
    const r = Math.hypot(tmpS.x, tmpS.y);
    if (r > 0.53 && r < 0.57 && Math.abs(tmpS.z) < 0.03) {
      ENT.sky.project(GAL, i, U, tmpP);
      if (tmpP.y > by) { by = tmpP.y; best = i; }
    }
  }
  ATOMI = best;
  // remnants: a few thousand stars of the model, each going out when the alive fraction passes its temperature rank
  const sorted = Float32Array.from(T).sort();
  const rankOf = (t) => { let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < t) lo = m + 1; else hi = m; } return lo / Math.max(1, n - 1); };
  const r2 = mulberry32(4471), M = Math.min(n, PHONE ? 1300 : 3200), list = [];
  for (let j = 0; j < M; j++) {
    const i = Math.min(n - 1, Math.floor(((j + r2()) * n) / M));
    list.push({ i, T: T[i], ud: uOfAlive(rankOf(T[i]) / 1.05), wdEnd: 15.3 + r2(), b: 0.55 + r2() * 0.9, type: WD,
      ue: 19 + r2(), falls: r2() < 0.1, sinkR: 0.05 + r2() * 0.13, uv: 20.7 + r2() * 9.1, turns: (1 + r2() * 2) * (r2() < 0.5 ? 1 : -1),
      jit: gaussR(r2) * 0.35, ox: 0, oy: 0, ej: 0 });
  }
  list.slice().sort((a, b) => b.T - a.T).forEach((r, k) => { if (k < (PHONE ? 7 : 12)) r.type = BH; else if (k < M * 0.05) r.type = NS; });
  REM = { list, key: '' };
  const res = ENT.sky.drawGalaxy(null, GAL, U);   // with no context it only reports the light (relative to alive = 1)
  L0 = (res && res.luminosity) || 1;
  return GAL;
}
function remBase(G, rot) {   // relaxed positions of the remnants, as offsets in units of the galaxy radius
  const key = `${G.pa}|${rot}`;
  if (REM.key === key) return;
  REM.key = key;
  const U = { x: 0, y: 0, radius: 1, tilt: TILT_G, pa: G.pa, rot, alive: 1, relax: 1, alpha: 1, detail: 1 };
  for (const r of REM.list) { ENT.sky.project(GAL, r.i, U, tmpP); r.ox = tmpP.x; r.oy = tmpP.y; r.ej = Math.atan2(r.oy, r.ox) + r.jit; }
}

/* exposure from the luminosity drawGalaxy reports (cached by its inputs), capped */
const lumCache = new Map();
function expAt(u, rot) {
  if (u >= 14 || !galaxy()) return 1;
  const a = aliveAt(u), rx = Math.round(relaxAt(u) * 200) / 200, key = a + '|' + rx;
  let L = lumCache.get(key);
  if (L === undefined) {
    const U = { x: 0, y: 0, radius: 1, tilt: TILT_G, pa: -0.3, rot: rot == null ? ROT0 : rot, alive: a, relax: rx, alpha: 1, detail: 1 };
    const res = ENT.sky.drawGalaxy(null, GAL, U);
    L = (res && res.luminosity) || 0;
    if (lumCache.size > 4000) lumCache.clear();
    lumCache.set(key, L);
  }
  // the picture's brightness follows the stars that are left (alive^2: the survivors are the faint ones); the model's own light falls later
  // and faster, so the exposure rises toward the end to keep the last red dwarfs a visible glow
  return Math.max(0.05, Math.min(CAP, (a * a * L0) / Math.max(L, L0 * 1e-9)));
}
const FO = { exposure: 1, bloom: 0.85, bloomRadius: 1, threshold: 0.75 };
function frameOpts(u, E) {
  const fl = u > 92.6 && u < 93.4;
  FO.exposure = E; FO.bloom = fl ? 0.7 : 0.85; FO.bloomRadius = fl ? 1.6 : 1; FO.threshold = fl ? 0.6 : 0.75;
  return FO;
}

/* the old point model through the renderer, for when ENT.sky is missing */
const alive0All = Math.max(1, stars.reduce((n, st) => n + (U0 >= st.ub && U0 < st.ud ? 1 : 0), 0));
const GLOWL = [1, 0.67, 0.4];
function drawOldGL(g, G, u, E) {
  const d = G.d, nP = PHONE ? 450 : POOL;
  if (u < 14) {
    let alive = 0; for (let i = 0; i < POOL; i++) { const st = stars[i]; if (u >= st.ub && u < st.ud) alive++; }
    const A = alive / alive0All, k = relaxAt(u);
    if (A > 0.002) {
      let q = 0;
      for (const [sz, a] of [[1.9, 0.025], [0.42, 0.09]]) {
        const o = q++ * 9;
        PB[o] = G.x; PB[o + 1] = G.y; PB[o + 2] = sz * G.R0; PB[o + 3] = GLOWL[0]; PB[o + 4] = GLOWL[1]; PB[o + 5] = GLOWL[2];
        PB[o + 6] = (a * A) / E; PB[o + 7] = TILT; PB[o + 8] = 0.3 + 0.48 * k;
      }
      g.smudges(PB, q);
    }
  }
  if (u >= 30) return;
  for (let i = 0; i < nP; i++) {
    const st = stars[i];
    if (u < st.ub) continue;
    const p = place(st, u); if (!p) continue;
    const X = oX(G, p[0], p[1]), Y = oY(G, p[0], p[1]);
    if (X < -12 || X > G.W + 12 || Y < -12 || Y > G.H + 12) continue;
    if (u < st.ud) {
      const a = st.b * clamp01((u - st.ub) / 0.03) * (0.25 + 0.75 * clamp01((st.ud - u) / 0.025));
      pt(X, Y, st.sz * 2.2 * d, st.T, (a * a * 1.4) / E);
      continue;
    }
    const born = clamp01((u - st.ud) / 0.025);
    if (st.rem === WD) {
      if (u >= st.wdEnd) continue;
      const k = clamp01((u - st.ud) / (st.wdEnd - st.ud)), Tw = st.wdT * Math.pow(2000 / st.wdT, k);
      const a = u < 14 ? 0.3 - 0.17 * clamp01((u - st.ud) / Math.max(0.01, 14 - st.ud)) : 0.13 * (1 - clamp01((u - 14) / (st.wdEnd - 14)));
      pt(X, Y, 1.6 * d, Tw, (a * a * born) / E);
    } else if (st.rem === NS) pt(X, Y, 1.6 * d, 9500, (0.02 * born) / E);
  }
  flushPts(g);
}

/* remnants of the sky model: faint points where stars were, cooling, then flung out or swallowed */
function drawRemnants(g, G, u, E) {
  const d = G.d, sz = 1.7 * d;
  for (const r of REM.list) {
    if (r.type === BH) continue;
    const t0 = Math.max(r.ud, 13.3), fi = clamp01((u - t0) / 0.3);
    if (fi <= 0) continue;
    const p = evolve(r.ox, r.oy, r, u); if (!p) continue;
    const X = G.x + p[0] * G.radius, Y = G.y + p[1] * G.radius;
    if (X < -8 || X > G.W + 8 || Y < -8 || Y > G.H + 8) continue;
    let I, Tc;
    if (r.type === NS) { I = 0.009; Tc = 9500; }
    else {
      const k = clamp01((u - 13.6) / (r.wdEnd - 13.6));
      Tc = 15000 * Math.pow(2300 / 15000, k);
      I = u < r.wdEnd ? 0.075 * Math.pow(0.045, k) : 0.0028;
    }
    pt(X, Y, sz, Tc, (I * r.b * fi) / E);
  }
  flushPts(g);
}
// a star of the model on screen at time u (index chosen by a fraction f)
function starAt(G, u, rot, f, out) {
  if (GAL) { setPO(G, u, rot); ENT.sky.project(GAL, Math.min(GAL.count - 1, Math.floor(f * GAL.count)), PO, out); return out; }
  const st = stars[Math.floor(f * (PHONE ? 450 : POOL))], p = place(st, u) || [0, 0];
  out.x = oX(G, p[0], p[1]); out.y = oY(G, p[0], p[1]); return out;
}
// the atom: follows one fixed star through the relaxation, then leaves with the ejected remnants
function atomAt(G, u, rot, out) {
  let ang;
  if (GAL && ATOMI >= 0) {
    setPO(G, u, rot); ENT.sky.project(GAL, ATOMI, PO, out);
    ang = Math.atan2(out.y - G.y, out.x - G.x);
  } else {
    const k = relaxAt(u), x = ATOM.dx + (ATOM.ex - ATOM.dx) * k, y = ATOM.dy + (ATOM.ey - ATOM.dy) * k;
    out.x = oX(G, x, y); out.y = oY(G, x, y);
    ang = Math.atan2(Math.sin(ATOM.ej) * cT + Math.cos(ATOM.ej) * sT, Math.cos(ATOM.ej) * cT - Math.sin(ATOM.ej) * sT);
  }
  if (u > 19) { const p = (u - 19) / 1.5, dd = p * p * 4.6 * G.radius; out.x += Math.cos(ang) * dd; out.y += Math.sin(ang) * dd; }
  return out;
}

// everything luminous at time u, into the current frame of g (between the caller's begin and end)
function drawSky(g, G, u, E, rot) {
  const d = G.d;
  if (u < 11.2) drawBG(g, G, u, E);
  if (u < 14) {
    if (galaxy()) { setPO(G, u, rot); ENT.sky.drawGalaxy(g, GAL, PO); }
    else drawOldGL(g, G, u, E);
  } else if (u < 30 && !GAL) drawOldGL(g, G, u, E);
  if (u >= 13.3 && u < 30 && GAL) { remBase(G, rot); drawRemnants(g, G, u, E); }
  // supernova glints
  if (u > 10.1 && u < 12.1) {
    let n = 0;
    for (const s of GLINTS) {
      const p = 1 - Math.abs(u - s.u) / s.w;
      if (p <= 0) continue;
      starAt(G, u, rot, s.f, tmpP);
      const I = (p * p * s.I) / E;
      pt(tmpP.x, tmpP.y, 2.6 * d, 16000, I); pt(tmpP.x, tmpP.y, 9 * d, 12000, I * 0.05);
      if (++n >= 2) break;
    }
    flushPts(g, { shape: 'star' });
  }
  if (u > 14 && u < 19.2) {
    // brown dwarfs colliding: one dim red star at a time, on average
    for (const sp of sparks) {
      if (u < sp.us || u > sp.us + sp.dur) continue;
      const a = clamp01((u - sp.us) / 0.05) * clamp01((sp.us + sp.dur - u) / 0.12);
      const X = GAL ? G.x + sp.x * G.radius : oX(G, sp.x, sp.y), Y = GAL ? G.y + sp.y * G.radius : oY(G, sp.x, sp.y);
      pt(X, Y, 2.2 * d, 3000, (0.16 * a) / E);
    }
    // dead stars colliding: rare white flashes
    for (const b of BANGS) {
      const p = 1 - Math.abs(u - b.u) / b.w;
      if (p <= 0) continue;
      let x = 0, y = 0;
      if (GAL) { const r = REM.list[Math.floor(b.f * REM.list.length)]; x = G.x + r.ox * G.radius; y = G.y + r.oy * G.radius; }
      else { starAt(G, 14.5, rot, b.f, tmpP); x = tmpP.x; y = tmpP.y; }
      pt(x, y, 2.4 * d, 14000, (p * p * b.I) / E); pt(x, y, 10 * d, 11000, (p * p * b.I * 0.03) / E);
    }
    flushPts(g);
  }
  // the central black hole's end: a small, fierce core with wide bloom that briefly lights the frame
  const f = 1 - Math.abs(u - 93) / 0.3;
  if (f > 0) {
    // nested gaussians, each a little wider and much fainter, so the glow has no edge anywhere
    const I = f * f;
    let S = 7 * d * (0.6 + 0.4 * f), P = 4 * I;
    for (let k = 0; k < 8; k++) { ptRGB(G.x, G.y, S, 1, 0.96 - 0.01 * k, 0.9 - 0.015 * k, P / E); S *= 2.2; P *= k < 2 ? 0.3 : 0.25; }
    flushPts(g);
  }
}

/* our own canvases */
let rot = ROT0, glEmptyLast = false, glKey = '';
const ovP = { x: 0, y: 0 };
function renderGL(u) {
  if (gl.isLost) return;
  const sz = gl.resize(), G = geomFor(sz.w, sz.h, sz.d), key = G.W + 'x' + G.H;
  if (key !== glKey) { glKey = key; glEmptyLast = false; }
  const empty = (u >= 30 && u < 92.6) || u >= 93.4;
  if (!(empty && glEmptyLast)) {
    const E = expAt(u, rot);
    gl.begin(frameOpts(u, E));
    if (!empty) drawSky(gl, G, u, E, rot);
    gl.end();
    glEmptyLast = empty;
  }
  drawOverlay(G, u);
}
function drawOverlay(G, u) {
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, W, H);
  overlayTo(ctx, G, u, rot, W / G.W, D, W, H);
  if (u >= 100 && u < 107) drawMotes(u);
}
// the vector layer (stellar black hole rings, the atom marker, the central black hole) onto any 2D context c of size Wc x Hc;
// G is the light's frame geometry, k converts its pixels to c's, d is c's device px per CSS px
function overlayTo(c, G, u, rot, k, d, Wc, Hc) {
  const disc = (x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); };
  // stellar black holes: hairline rings, barely visible
  if (u >= 13.6 && u < 30) {
    const born = clamp01((u - 13.6) / 0.4);
    c.strokeStyle = `rgba(${BONE},${0.1 * born})`; c.lineWidth = 0.6 * d;
    c.beginPath();
    if (GAL) {
      for (const r of REM.list) {
        if (r.type !== BH) continue;
        const p = evolve(r.ox, r.oy, r, u); if (!p) continue;
        const X = (G.x + p[0] * G.radius) * k, Y = (G.y + p[1] * G.radius) * k;
        c.moveTo(X + 1.35 * d, Y); c.arc(X, Y, 1.35 * d, 0, TAU);
      }
    } else {
      for (let i = 0; i < (PHONE ? 450 : POOL); i++) {
        const st = stars[i];
        if (st.rem !== BH || u < st.ud) continue;
        const p = place(st, u); if (!p) continue;
        const X = oX(G, p[0], p[1]) * k, Y = oY(G, p[0], p[1]) * k;
        c.moveTo(X + 1.35 * d, Y); c.arc(X, Y, 1.35 * d, 0, TAU);
      }
    }
    c.stroke();
  }
  // your atom
  if (u < 20.5) {
    atomAt(G, u, rot, ovP);
    const X = ovP.x * k, Y = ovP.y * k, rr = 6 * d;
    if (X > -rr * 2 && X < Wc + rr * 2 && Y > -rr * 2 && Y < Hc + rr * 2) {
      c.strokeStyle = `rgba(${EMB},0.7)`; c.lineWidth = d;
      c.beginPath(); c.arc(X, Y, rr, 0, TAU); c.stroke();
      c.fillStyle = `rgba(${EMB},0.95)`; disc(X, Y, 1.6 * d);
    }
  }
  // the central black hole: it appears as the starlight goes, and is the only thing left from u = 30
  const cx = G.x * k, cy = G.y * k, rb = 5.5 * d;
  if (u < 93 && u >= 13.8) {
    const vis = u < 14 ? smooth((u - 13.8) / 0.2) : 1, fl = clamp01(1 - Math.abs(u - 93) / 0.3), keep = 1 - smooth(fl);
    const end = smooth((u - 92.6) / 0.4);
    if (end > 0) {
      const gr = c.createRadialGradient(cx, cy, rb, cx, cy, rb * 4);
      gr.addColorStop(0, `rgba(${FLASH},${0.18 * end * keep})`); gr.addColorStop(1, `rgba(${FLASH},0)`);
      c.fillStyle = gr; disc(cx, cy, rb * 4);
    }
    c.fillStyle = `rgba(0,0,0,${vis * keep})`; disc(cx, cy, rb);
    c.strokeStyle = `rgba(${BONE},${(0.38 + 0.6 * end) * vis * keep})`; c.lineWidth = d;
    c.beginPath(); c.arc(cx, cy, rb, 0, TAU); c.stroke();
  }
}
function drawMotes(u) {
  const d = D, fin = clamp01((u - 100) / 0.6), mt = reduced ? 0 : clk;
  for (const m of motes) {
    const a = m.a * fin * clamp01((m.end - u) / 0.8); if (a <= 0) continue;
    const x = ((((m.x * W + m.vx * mt * d) % W) + W) % W), y = ((((m.y * H + m.vy * mt * d) % H) + H) % H);
    ctx.fillStyle = `rgba(${BONE},${a})`; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(d)), Math.max(1, Math.round(d)));
  }
}
function draw(u) { if (gl) renderGL(u); else draw2d(u); }

/* for Act III: this act's sky at time u, into another gfx context's frame (between that caller's begin and end) */
ENT.descentSky = {
  draw(g, W2, H2, u) {
    if (!g || !(W2 > 0) || !(H2 > 0)) return;
    const sz = g.size, d = sz && sz.w === W2 && sz.d ? sz.d : Math.min(window.devicePixelRatio || 1, 1.5);
    drawSky(g, geomFor(W2, H2, d), u, expAt(u, ROT0), ROT0);
  },
  // the 2D overlay for time u (atom marker, central black hole, stellar black hole rings) onto a Canvas 2D context of W x H device px
  drawOverlay(c, W2, H2, u) {
    if (!c || !(W2 > 0) || !(H2 > 0)) return;
    const cvs = c.canvas, cssW = cvs && cvs.getBoundingClientRect ? cvs.getBoundingClientRect().width : 0;
    const d = cssW > 0 ? W2 / cssW : Math.min(window.devicePixelRatio || 1, 2);
    galaxy();
    const G = geomFor(W2, H2, d);
    if (GAL && REM) remBase(G, ROT0);
    c.save(); c.globalAlpha = 1; overlayTo(c, G, u, ROT0, 1, d, W2, H2); c.restore();
  },
  // the begin() options this act uses at time u (exposure follows the light that is left)
  frameOpts(u) { const o = frameOpts(u, expAt(u, ROT0)); return { exposure: o.exposure, bloom: o.bloom, bloomRadius: o.bloomRadius, threshold: o.threshold }; },
};

/* ---------------- HUD ---------------- */
const elClock = $('dscClock'), elEra = $('dscEra'), elRatio = $('dscRatio'), elTemp = $('dscTemp'), elStretch = $('dscStretch');
const elHead = $('dscInvHead'), elPips = $('dscPips'), elList = $('dscInvList'), elLost = $('dscLost'), elProton = $('dscProton');
const elStars = $('dscStars'), elGals = $('dscGals'), elAtom = $('dscAtom');
let decay = true;
const ATOM_LINES = [
  [10.18, 'A carbon atom in your left hand. It was forged in a star that died before the Sun was born.'],
  [10.33, "In Earth's rock or air. The oceans are gone."],
  [11.2, 'Either boiled off into the swollen Sun and blown back out among the stars, or still in the cinder of Earth circling a white dwarf. Nobody knows which.'],
  [15, 'In thin gas between dead and dying stars, or locked inside a cold planet.'],
  [19.5, 'Whatever world it was part of has been pulled away from its star.'],
  [21, 'Flung out of the galaxy with almost everything else.'],
  [37, 'Adrift between what used to be galaxies. Nothing it could ever reach is still within range.'],
];
function atomLine(u) {
  for (const [end, t] of ATOM_LINES) if (u < end) return t;
  if (decay) return u < 40 ? 'Its protons are decaying.' : 'Gone. It lasted about 10<sup>40</sup> years.';
  return u < 100.5 ? 'Unchanged. Still carbon.' : 'Still carbon, alone, at the temperature of empty space.';
}
const ITEMS = [['Other galaxies in view', 11.2], ['New stars forming', 13], ['Starlight', 14], ['Planets in orbit', 15], ['Galaxies', 20], ['Atoms', 40], ['Black holes', 100], ['Temperature differences', 100.5]];
const endOf = (it) => (it[0] === 'Atoms' && !decay ? Infinity : it[1]);
const lis = ITEMS.map((it) => { const li = document.createElement('li'); li.innerHTML = `<span>${it[0]}</span><span></span>`; elList.appendChild(li); return li; });
const pips = ITEMS.map(() => { const p = document.createElement('i'); elPips.appendChild(p); return p; });
function inventoryEnds() {
  ITEMS.forEach((it, i) => { const e = endOf(it); lis[i].lastChild.innerHTML = e === Infinity ? 'never' : `10<sup>${it[1]}</sup>`; });
}

function fmtYears(u) {
  const t = Math.pow(10, u);
  const n = (x) => (x < 99.95 ? x.toFixed(1) : String(Math.round(x)));
  if (u < 12) { const v = n(t / 1e9); if (+v < 1000) return `${v} billion years`; }
  if (u < 15) { const v = n(t / 1e12); if (+v < 1000) return `${v} trillion years`; }
  return `10<sup>${u < 20 ? Math.min(u, 19.95).toFixed(1) : Math.floor(u + 0.005)}</sup> years`;
}
const eraOf = (u) => (u < 14 ? 'Stelliferous era' : u < 40 ? 'Degenerate era' : u < 100 ? 'Black hole era' : 'Dark era');
function tempHTML(u, la) {
  const lT = Math.log10(2.725) - la;
  if (lT <= Math.log10(TDS)) return `2 × 10<sup>${MINUS}30</sup> K <small>· horizon</small>`;
  const T = Math.pow(10, lT);
  return (lT > -1 ? `${(Math.round(T * 100 + 1e-6) / 100).toFixed(2)} K` : `${sci(T, 1)} K`) + (u < 10.2 ? ' <small>CMB</small>' : '');
}
function stretchHTML(la) {
  if (la < 0.005) return '×1';
  if (la < 4) { const a = Math.pow(10, la); return `×${la < 1 ? a.toFixed(2) : fmtInt(a)}`; }
  return `×${pow10html(la)}`;
}
const setHTML = (el, html) => { if (el._h !== html) { el._h = html; el.innerHTML = html; } };
let invKey = '';
function hud(u) {
  setHTML(elClock, fmtYears(u));
  setHTML(elEra, eraOf(u));
  const x = u - U0;
  setHTML(elRatio, x < 0.05 ? '' : `10<sup>${x.toFixed(1)}</sup> × the universe's present age`);
  const la = log10a(u);
  setHTML(elTemp, tempHTML(u, la));
  setHTML(elStretch, stretchHTML(la));
  // the two draining counters
  const ns = starsAt(u), ng = galaxiesAt(u);
  setHTML(elStars, fmt2(ns)); elStars.classList.toggle('dsc-zero', ns < 0.5);
  setHTML(elGals, fmt2(ng)); elGals.classList.toggle('dsc-zero', ng < 0.5);
  { const note = $('dscGalsNote'); if (note) { const t = ng >= 1e6 ? 'upper estimate' : ng >= 1.5 ? '' : ng >= 0.5 ? 'our own' : ''; if (note.textContent !== t) note.textContent = t; } }
  // your atom
  const al = atomLine(u);
  if (elAtom._h !== al) {
    const first = elAtom._h === undefined; setHTML(elAtom, al);
    if (!reduced && !first) { elAtom.classList.remove('dsc-new'); void elAtom.offsetWidth; elAtom.classList.add('dsc-new'); }
  }
  // inventory
  let left = 0, lost = null;
  const gone = ITEMS.map((it) => { const e = endOf(it), g = u >= e; if (!g) left++; else if (!lost || e > endOf(lost)) lost = it; return g; });
  const key = gone.join() + decay;
  if (key !== invKey) {
    invKey = key;
    gone.forEach((g, i) => { lis[i].classList.toggle('dsc-gone', g); pips[i].classList.toggle('dsc-gone', g); });
    elHead.textContent = `Still possible · ${left} of ${ITEMS.length}`;
    elLost.textContent = lost ? `Lost: ${lost[0].toLowerCase()}` : 'Lost: nothing yet';
  }
  elProton.classList.toggle('dsc-on', u >= 33);
  // rail marker
  const y = clamp01((u - 10) / 98) * railH;
  railMark.style.transform = `translateY(${y.toFixed(1)}px)`;
  railDone.style.transform = `scaleY(${(railH ? y / railH : 0).toFixed(4)})`;
}

/* ---------------- depth rail ---------------- */
const rp = (u) => `${(((u - 10) / 98) * 100).toFixed(3)}%`;
let railHTML = '<i class="dsc-rl"></i><i class="dsc-rd"></i>';
for (let u = 20; u <= 100; u += 10) {
  railHTML += `<i class="dsc-rt" style="top:${rp(u)}"></i>`;
  if (u % 20 === 0) railHTML += `<span class="dsc-rlab${u === 20 || u === 60 || u === 100 ? '' : ' dsc-opt'}" style="top:${rp(u)}">10<sup>${u}</sup></span>`;
}
for (const u of [14, 40, 100]) railHTML += `<i class="dsc-re" style="top:${rp(u)}"></i>`;
railHTML += `<i class="dsc-rs" style="top:${rp(U0)};height:${(((14 - U0) / 98) * 100).toFixed(3)}%"></i><span class="dsc-rsl" style="top:${rp((U0 + 14) / 2)}">stars</span>`;
railHTML += '<i class="dsc-rm"></i>';
rail.innerHTML = railHTML;
const railMark = rail.querySelector('.dsc-rm'), railDone = rail.querySelector('.dsc-rd');
let railH = 0;

/* ---------------- captions ---------------- */
const cards = [...$('dscCards').children].map((el) => ({ el, u: +el.dataset.u, br: el.dataset.branch || '', top: 0, h: 0, op: -1, cut: -1 }));
let shown = [], fadeLine = 0;
function layoutCards() {
  cards.forEach((c) => { if (c.br) c.el.hidden = (c.br === 'd') !== decay; });
  shown = cards.filter((c) => !c.el.hidden);
  shown.forEach((c) => { c.h = c.el.offsetHeight; });
  let prev = -Infinity;
  for (const c of shown) {
    let top = (u2s(c.u) + (window.innerWidth <= 760 ? 0.70 : 0.58)) * SH; // phones: captions cross lower, below the galaxy's centre
    if (top < prev + 24) top = prev + 24;
    c.top = top; prev = top + c.h;
  }
  shown.forEach((c) => { c.el.style.top = `${Math.round(c.top)}px`; c.op = -1; c.cut = -1; });
}
function fadeCards(y) {
  // captions dissolve line by line as they slide under the HUD block above them (so a long card stays
  // readable while its top has already gone); on phones they also emerge from a soft edge above the
  // corner kept free for the film's Play button
  const stageTop = Math.max(0, Math.min(SMAX * SH, y - trackTop));
  const floor = phoneMQ.matches ? window.innerHeight - 54 : Infinity;
  const F = phoneMQ.matches ? 44 : 60;
  for (const c of shown) {
    const rel = c.top - stageTop;
    const top = Math.max(0, Math.min(c.h, Math.round(fadeLine - rel)));
    const vp = trackTop + c.top - y;
    const cut = Math.max(0, Math.min(c.h, Math.round(vp + c.h - floor)));
    const op = top + cut >= c.h - 2 || top >= c.h - F * 0.5 ? 0 : 1;
    if (op !== c.op) {
      c.op = op;
      c.el.style.opacity = op;
      c.el.style.visibility = op === 0 ? 'hidden' : '';
    }
    const key = op ? top * 4096 + cut : -1;
    if (key !== c.cut) {
      c.cut = key;
      const m = op && (top > 0 || cut > 0)
        ? `linear-gradient(transparent ${top}px, #000 ${top + F}px, #000 ${c.h - cut - 36}px, transparent ${c.h - cut}px)` : '';
      c.el.style.webkitMaskImage = m; c.el.style.maskImage = m;
    }
  }
}

/* ---------------- layout ---------------- */
let SH = window.innerHeight, lastVW = 0, trackTop = 0;
function measureTrack() { trackTop = track.getBoundingClientRect().top + window.scrollY; }
function layout(force) {
  const vw = window.innerWidth, vh = window.innerHeight;
  if (force || vw !== lastVW || Math.abs(vh - SH) >= 120) { SH = vh; track.style.setProperty('--dsc-h', `${SH}px`); }
  lastVW = vw;
  // rail starts below the HUD block on phones
  if (phoneMQ.matches) rail.style.top = `${Math.round(topBox.getBoundingClientRect().bottom - stage.getBoundingClientRect().top + 16)}px`;
  else rail.style.top = '';
  railH = rail.clientHeight;
  // fade line: lowest HUD element that sits over the caption column
  const st = stage.getBoundingClientRect();
  const probe = shown[0] || cards[0];
  const cr = probe.el.getBoundingClientRect();
  fadeLine = 0;
  for (const el of [$('dscClockbox'), $('dscSide')]) {
    const r = el.getBoundingClientRect();
    if (r.right > cr.left && r.left < cr.right) fadeLine = Math.max(fadeLine, r.bottom - st.top);
  }
  fadeLine += 10;
  const dims = fit(cv); W = dims.w; H = dims.h; D = dims.d;
  const cw = W / D, ch = H / D;
  R = Math.min(cw * 0.44, ch * 0.42, Math.max(cw, ch) * 0.3) * D;
  nStars = Math.round(Math.max(300, Math.min(900, 450 + ((cw * ch - 330e3) / (1224e3 - 330e3)) * 450)));
  alive0 = 0; for (let i = 0; i < nStars; i++) if (U0 >= stars[i].ub && U0 < stars[i].ud) alive0++;
  alive0 = Math.max(1, alive0);
  layoutCards();
  measureTrack();
  lastU = NaN; lastY = NaN; dirty = true;
}

/* ---------------- proton branch ---------------- */
const bDecay = $('dscDecay'), bLast = $('dscLast');
function setBranch(d) {
  if (d === decay) return;
  decay = d;
  bDecay.setAttribute('aria-pressed', String(d)); bLast.setAttribute('aria-pressed', String(!d));
  inventoryEnds(); invKey = '';
  layoutCards(); lastU = NaN; lastY = NaN;
}
bDecay.addEventListener('click', () => setBranch(true));
bLast.addEventListener('click', () => setBranch(false));

/* ---------------- frame loop ---------------- */
let lastU = NaN, lastY = NaN, dirty = true, tickAcc = 0, wasLost = false;
ENT.watch(track);
ENT.onFrame((dt) => {
  if (!ENT.isVisible(track)) return;
  dt = Math.min(dt, 0.1);
  clk += dt;
  const y = window.scrollY;
  const u = s2u(Math.max(0, Math.min(SMAX, (y - trackTop) / SH)));
  let tick = false;
  if (gl) {
    const lost = gl.isLost;
    if (wasLost && !lost) dirty = true, glEmptyLast = false;
    wasLost = lost;
    // gentle life, at most 30 redraws a second: the disk turns until it has relaxed; the motes drift
    const turning = !reduced && GAL && u < 11, drifting = !reduced && u >= 100 && u < 107;
    if (turning) rot += (dt * TAU / 240) * (1 - relaxAt(u));
    if (turning || drifting) { tickAcc += dt; if (tickAcc >= 1 / 30) { tickAcc = 0; tick = true; } }
  } else tick = !reduced && (u < 14 || (u >= 100 && u < 107));
  if (u !== lastU || dirty || tick) { draw(u); dirty = false; }
  if (u !== lastU) { hud(u); lastU = u; }
  if (y !== lastY) { fadeCards(y); lastY = y; }
});
ENT.onResize(() => layout(false));
if ('ResizeObserver' in window) new ResizeObserver(() => { measureTrack(); lastY = NaN; dirty = true; }).observe(document.body);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => layout(true));
window.addEventListener('load', () => layout(true));

inventoryEnds();
layout(true);
const u0 = s2u(Math.max(0, Math.min(SMAX, (window.scrollY - trackTop) / SH)));
draw(u0); hud(u0); lastU = u0;
fadeCards(window.scrollY); lastY = window.scrollY;
})();
