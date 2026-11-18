(() => {
'use strict';
const ENT = window.ENT;
const { $, reduced, mulberry32, blackbody, fit } = ENT;
const track = $('invTrack');
if (!track) return;
const cv = $('invSky'), ctx = cv.getContext('2d');   // the 2D canvas: vector overlay over the GL sky, or the whole picture in the fallback
const cvGL = $('invGL');
const stage = $('invStage');
const phoneMQ = window.matchMedia('(max-width: 760px)');
const SMALL = Math.min(window.innerWidth, (window.screen && screen.width) || 1e9) <= 480;   // phones: about 40% of the desktop point counts
let g = null;
try { g = ENT.gfx && cvGL ? ENT.gfx.create(cvGL, { maxDpr: SMALL ? 1.5 : 2 }) : null; } catch (e) { g = null; }
if (!g && cvGL) cvGL.hidden = true;
if (g) cvGL.addEventListener('webglcontextrestored', () => { dirty = true; });

const TAU = Math.PI * 2;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const band = (z, a, b, c, e) => smooth((z - a) / (b - a)) * (1 - smooth((z - c) / (e - c))); // fade in a→b, out c→e
const rad = (deg) => (deg * Math.PI) / 180;
const dir = (deg) => [Math.cos(rad(deg)), Math.sin(rad(deg))];

/* ---------------- units (light-years) and the facts the picture is drawn from ---------------- */
const LMIN = 1 / 525960, LHOUR = 1 / 8766, LDAY = 1 / 365.25, YEAR_S = 31557600;
const R_EARTH = 8.3 * LMIN, R_NEP = 4.2 * LHOUR, R_VOY = LDAY, D_ACEN = 4.3;
const R_GC = 27000, R_MW = 50000, D_M31 = 2.5e6, R_OBS = 46.5e9, LAN_LEN = 520e6;
const VOY_LY_PER_YEAR = 5.67e-5, AGE = 13.8e9;

/* ---------------- scroll -> zoom ---------------- */
// z = log10(width of view in light-years) across the shorter side of the canvas.
// The table's knots, except that phase D reaches the full galaxy a little early and then drifts to z = 5.3 (the hold).
const KS = [0, 1.4, 2.8, 5.0, 6.2, 6.85, 7.6, 8.8, 10.2, 11.8, 12.6];
const KZ = [-4.3, -2.2, 2.0, 2.0, 3.6, 5.15, 5.3, 7.2, 9.0, 11.05, 11.05];
const SMAX = 12.6;
function s2z(s) {
  if (s <= 0) return KZ[0];
  for (let i = 1; i < KS.length; i++) if (s <= KS[i]) return KZ[i - 1] + ((s - KS[i - 1]) / (KS[i] - KS[i - 1])) * (KZ[i] - KZ[i - 1]);
  return KZ[KZ.length - 1];
}
const phaseOf = (s) => (s < 1.4 ? 0 : s < 2.8 ? 1 : s < 5 ? 2 : s < 6.2 ? 3 : s < 7.6 ? 4 : s < 8.8 ? 5 : s < 10.2 ? 6 : 7);
const NAMES = ['The Sun and its planets', 'Between the stars', "The Sun's neighbourhood", "The Sun's neighbourhood", 'The Milky Way', 'The Local Group', 'Laniakea', 'The observable universe'];

/* ---------------- numbers ---------------- */
const SK = [[-4.3, 1], [0.5, 1], [1.0, 4], [1.3, 12], [2, 2000], [3, 2e6], [3.6, 5e7], [5.0, 2e11], [5.3, 2e11], [7.0, 1.5e12], [9.0, 1e16], [11.05, 2e23]];
function starsInView(z) {
  if (z <= SK[0][0]) return 1;
  for (let i = 1; i < SK.length; i++) {
    if (z <= SK[i][0]) {
      const t = (z - SK[i - 1][0]) / (SK[i][0] - SK[i - 1][0]);
      return Math.pow(10, Math.log10(SK[i - 1][1]) + t * (Math.log10(SK[i][1]) - Math.log10(SK[i - 1][1])));
    }
  }
  return SK[SK.length - 1][1];
}
const commas = (str) => str.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
function sigInt(v, sf) { // v >= 10^(sf-1): digits with zeros, exact as a string
  let e = Math.floor(Math.log10(v)), m = Math.round(v / Math.pow(10, e - sf + 1));
  if (m >= Math.pow(10, sf)) { m = Math.round(m / 10); e++; }
  return commas(String(m) + '0'.repeat(Math.max(0, e - sf + 1)));
}
function sig(v, sf = 2) {
  if (v >= Math.pow(10, sf - 1)) return sigInt(v, sf);
  return v.toPrecision(sf);
}
const num = (str) => Number(str.replace(/,/g, ''));
function unit(v, name) {
  const t = v < 10 && Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : sig(v);
  return `${t} ${name}${t === '1' ? '' : 's'}`;
}
function scaled(v, units) { // units: [[divisor, word], ...] ascending
  for (let i = 0; i < units.length; i++) {
    const x = v / units[i][0], t = sig(x);
    if (num(t) < 1000 || i === units.length - 1) return `${t} ${units[i][1]}`;
  }
  return '';
}
function widthText(W) {
  if (W < LHOUR && sig(W / LMIN) !== '60') return unit(W / LMIN, 'light-minute');
  if (W < 2 * LDAY && num(sig(W / LHOUR)) < 48) return unit(Math.max(1, W / LHOUR), 'light-hour');
  if (W < 0.1 && num(sig(W / LDAY)) < 36.5) return unit(W / LDAY, 'light-day');
  if (num(sig(W)) < 1000) return unit(W, 'light-year');
  return scaled(W, [[1e3, 'thousand light-years'], [1e6, 'million light-years'], [1e9, 'billion light-years']]);
}
function durText(sec, voyager) {
  if (sec < 59.5) return unit(sec, 'second');
  if (sec < 3570) return unit(sec / 60, 'minute');
  if (sec < 86400 * 0.995) return unit(sec / 3600, 'hour');
  if (sec < YEAR_S * 0.995) return unit(sec / 86400, 'day');
  const y = sec / YEAR_S;
  if (num(sig(y)) < 1e6) return unit(y, 'year');
  if (voyager) return scaled(y, [[1e6, 'million years'], [1e9, 'billion years'], [1e12, 'trillion years'], [1e15, 'quadrillion years']]);
  if (y <= AGE) return scaled(y, [[1e6, 'million years'], [1e9, 'billion years']]);
  return `${sig(y / AGE)} × the age of the universe`;
}
function countWords(v, sf) { // "30 million", "25", "13,000"
  if (v >= 1e9 * 0.9995) return `${sig(v / 1e9, sf)} billion`;
  if (v >= 1e6 * 0.9995) return `${sig(v / 1e6, sf)} million`;
  return v >= 10 ? sig(v, sf) : String(Math.round(v));
}

/* ---------------- colours ---------------- */
const TEMPS = [2900, 3300, 3800, 4400, 5000, 5600, 6300, 7500, 9500, 13000];
const COLS = TEMPS.map((T) => `rgb(${blackbody(T).join(',')})`);
const tIndex = (T) => { let b = 0; for (let i = 1; i < TEMPS.length; i++) if (Math.abs(TEMPS[i] - T) < Math.abs(TEMPS[b] - T)) b = i; return b; };
const BONE = '235,229,217', WARM = blackbody(4300).join(','), SUNC = blackbody(5800).join(','), CMB = blackbody(2600).join(',');
const EMBER = ENT.C.ember || '#ff8a4a';
// for the GL sky: blackbody -> linear rgb normalised to a brightest channel of 1 (800 K .. 40,000 K, log spaced), as in sky.js
const LUT_N = 512, LT0 = 800, LT1 = 40000, LLT = Math.log(LT1 / LT0), LUT = new Float32Array(LUT_N * 3);
for (let i = 0; i < LUT_N; i++) {
  const c = blackbody(LT0 * Math.exp((LLT * i) / (LUT_N - 1))).map((v) => Math.pow(v / 255, 2.2)), m = Math.max(c[0], c[1], c[2], 1e-6);
  LUT[i * 3] = c[0] / m; LUT[i * 3 + 1] = c[1] / m; LUT[i * 3 + 2] = c[2] / m;
}
const lut = (T) => Math.max(0, Math.min(LUT_N - 1, Math.round((Math.log(Math.max(T, LT0) / LT0) / LLT) * (LUT_N - 1)))) * 3;
const TJ = TEMPS.map(lut);

/* ---------------- dot batching: one fill per (colour, alpha level, size) ---------------- */
const NAL = 16, NSZ = 3;
const BUCK = []; for (let i = 0; i < TEMPS.length * NAL * NSZ; i++) BUCK.push([]);
const used = [];
let SZ = [1, 1.5, 2.2], nDots = 0;
function dot(ci, a, si, x, y) {
  let al = Math.round(a * (NAL - 1));
  if (al <= 0) return;
  if (al > NAL - 1) al = NAL - 1;
  const k = (ci * NAL + al) * NSZ + si, b = BUCK[k];
  if (b.length === 0) used.push(k);
  b.push(x, y); nDots++;
}
function flush() {
  for (const k of used) {
    const b = BUCK[k], si = k % NSZ, al = Math.floor(k / NSZ) % NAL, ci = Math.floor(k / (NSZ * NAL)), s = SZ[si], h = s / 2;
    ctx.globalAlpha = al / (NAL - 1); ctx.fillStyle = COLS[ci]; ctx.beginPath();
    for (let i = 0; i < b.length; i += 2) ctx.rect(Math.round(b[i] - h), Math.round(b[i + 1] - h), s, s);
    ctx.fill(); b.length = 0;
  }
  used.length = 0; ctx.globalAlpha = 1;
}

/* ---------------- hashing for the endless fill field and the web lattice ---------------- */
function hash(a, b, c) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x632be5ab, 0x165667b1) ^ Math.imul((c | 0) + 0x5bd1e995, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/* ---------------- layout-dependent world ---------------- */
// Directions are screen angles in degrees (0 = right, 90 = down), chosen per screen shape so that
// every object lands in free sky: right of the captions on wide screens, above/below centre on phones.
const V_WIDE = { voy: -14, acen: 16, gc: -6, m31: -24, tri: 40, ga: 6, virgo: 32, lab: -1 };
const V_TALL = { voy: 80, acen: 62, gc: -96, m31: 88, tri: 30, ga: 84, virgo: -35, lab: 1 };
let V = V_WIDE;
let Wd = 1, Hd = 1, D = 1, CW = 1, CH = 1, SMIN = 1, FX = 0, FY = 0;
let sc = 1, camX = 0, camY = 0;
let field = null, galaxy = null, lg = null, lan = null, web = null, sprite = null, anchors = null;
let fieldKey = '', worldKey = '';

function genField() {
  const S = Math.min(CW, CH), Wv = (100 * CW) / S, Hv = (100 * CH) / S, asp = Math.max(CW, CH) / S;
  const fx = FX / Wd, fy = FY / Hd;
  const xL = -fx * Wv, xR = (1 - fx) * Wv, yT = -fy * Hv;
  const Ptot = 6.6 * Wv, rho = 2000 / (Wv * Hv), Dh = 50 / asp;
  const rnd = mulberry32(9001);
  const LAY = [[1, 0.22, 1, 0], [0.8, 0.33, 0.85, 0], [0.62, 0.45, 0.68, 0]];
  const ac = dir(V.acen), margins = [];
  const pack = (f, pts, counted) => {
    pts.sort((p, q) => p[0] - q[0]);
    const N = pts.length, L = { f, counted, n: N, x: new Float64Array(N), y: new Float64Array(N), d: new Float32Array(N), c: new Uint8Array(N), a: new Float32Array(N), s: new Uint8Array(N), ph: new Float32Array(N), sp: new Float32Array(N),
      j: new Uint16Array(N), l: new Float32Array(N), k: new Uint8Array(N) };
    pts.forEach((p, i) => {
      L.x[i] = p[0]; L.y[i] = p[1]; L.d[i] = p[2]; L.c[i] = p[3]; L.a[i] = p[4]; L.s[i] = p[5]; L.ph[i] = p[6]; L.sp[i] = p[7];
      // for the GL sky: true colour, and a wide spread of brightness (a few per screen bright enough for spikes)
      const T = p[8], u = p[6] / TAU, v = clamp01((p[7] - 1.2) / 2.2);
      L.j[i] = lut(T);
      L.l[i] = (T < 4000 ? 0.3 : T < 6500 ? 0.55 : 0.9) * (0.6 + p[4]) * (0.6 + 1.2 * v * v) * (1 + 5 * Math.pow(u, 40));
      if (p[9]) { L.l[i] = 1.6; L.k[i] = 1; }
      else if (counted && u > 0.9955) {   // the brightest few: giants and hot stars, whatever the dwarf beneath was
        const w = (u - 0.9955) / 0.0045;
        L.l[i] = 0.6 + 1.4 * w; L.k[i] = 1; L.j[i] = lut(v < 0.4 ? 4200 + v * 2000 : 6500 + v * 12000);
      }
    });
    return L;
  };
  const layers = LAY.map(([f, share, bm], li) => {
    const x0 = xL - 2, x1 = xR + f * Ptot + 2, n = Math.round(rho * share * (x1 - x0) * Hv);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const x = x0 + rnd() * (x1 - x0), y = yT + rnd() * Hv, dd = (rnd() * 2 - 1) * Dh;
      const t = rnd(), b = rnd(), ph = rnd() * TAU, sp = 1.2 + rnd() * 2.2;
      if (x * x + y * y + dd * dd < 4.6 * 4.6) continue;
      let T, a, si;
      if (t < 0.72) { T = 2900 + b * 900; a = 0.3 + b * 0.25; si = 0; }
      else if (t < 0.94) { T = 4500 + b * 1800; a = 0.55 + b * 0.35; si = b > 0.75 ? 1 : 0; }
      else { T = 6800 + b * 7000; a = 0.85 + b * 0.15; si = b > 0.4 ? 2 : 1; }
      if (li === 2 && si > 0) si--;
      pts.push([x, y, dd, tIndex(T), a * bm, si, ph, sp, T]);
    }
    // soft margins beyond the panned strip (never in view during the pan, never counted)
    const mpts = [], mh = 0.6 * Hv, mw = 0.5 * Wv, nm = Math.round(rho * share * (x1 - x0 + 2 * mw) * 2 * mh);
    for (let i = 0; i < nm; i++) {
      const x = x0 - mw + rnd() * (x1 - x0 + 2 * mw), up = rnd() < 0.5, e = rnd() * mh, y = up ? yT - e : yT + Hv + e, dd = (rnd() * 2 - 1) * Dh;
      const ex = x < x0 ? (x0 - x) / mw : x > x1 ? (x - x1) / mw : 0, keep = (1 - e / mh) * (1 - ex);
      const t = rnd(), b = rnd(), ph = rnd() * TAU, sp = 1.2 + rnd() * 2.2;
      if (rnd() > keep * keep) continue;
      const T = t < 0.72 ? 2900 + b * 900 : t < 0.94 ? 4500 + b * 1800 : 6800 + b * 7000, a = t < 0.72 ? 0.3 + b * 0.25 : t < 0.94 ? 0.55 + b * 0.35 : 0.9;
      mpts.push([x, y, dd, tIndex(T), a * bm, 0, ph, sp, T]);
    }
    const ext = [];
    for (let i = 0; i < Math.round(rho * share * mw * Hv * 2); i++) { // ragged ends in x
      const left = rnd() < 0.5, e = rnd() * mw, x = left ? x0 - e : x1 + e, y = yT + rnd() * Hv, t = rnd(), b = rnd();
      if (rnd() > (1 - e / mw) ** 2) continue;
      if (left && x * x + y * y < 25) continue;
      const T = t < 0.72 ? 2900 + b * 900 : t < 0.94 ? 4500 + b * 1800 : 6800 + b * 7000, a = t < 0.72 ? 0.3 + b * 0.25 : t < 0.94 ? 0.55 + b * 0.35 : 0.9;
      mpts.push([x, y, (rnd() * 2 - 1) * Dh, tIndex(T), a * bm, 0, rnd() * TAU, 1.5, T]);
    }
    margins.push(pack(f, mpts, false));
    if (li === 0) pts.push([D_ACEN * ac[0], D_ACEN * ac[1], 0.4, tIndex(5600), 1, 2, 0, 1.6, 5600, 1]);
    return pack(f, pts, true);
  });
  return { Wv, Hv, asp, xL, yT, Ptot, Dh, layers: layers.concat(margins), counted: layers, acen: [D_ACEN * ac[0], D_ACEN * ac[1]] };
}
function lowerBound(arr, n, v) { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; }
function starsPassed(P) {
  let k = 0;
  for (const L of field.counted) k += lowerBound(L.x, L.n, field.xL + L.f * P) - lowerBound(L.x, L.n, field.xL);
  return k;
}

/* the Milky Way: barred spiral, plane coordinates with the Sun at (-27,000, 0) */
const G_K = 0.42, G_BAR = rad(150), G_PITCH = 2.9;
const ARMS = [[G_BAR, 13000, 1], [G_BAR + Math.PI, 13000, 1], [G_BAR + Math.PI / 2, 9000, 0.55], [G_BAR - Math.PI / 2, 9000, 0.55]];
function armAngle(arm, r) { return arm[0] + Math.log(r / arm[1]) * G_PITCH; }
function genGalaxy(n) {
  const rnd = mulberry32(77);
  const gauss = () => { let a = 0; while (a === 0) a = rnd(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(TAU * rnd()); };
  const th = rad(V.gc), cs = Math.cos(th), sn = Math.sin(th), gc = [R_GC * cs, R_GC * sn];
  const x = new Float64Array(n), y = new Float64Array(n), c = new Uint8Array(n), a = new Float32Array(n), s = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r0 = rnd();
    let u, v, T, al, si = 0;
    if (r0 < 0.13) { // bulge
      const bx = gauss() * 4200, by = gauss() * 2600;
      u = bx * Math.cos(G_BAR) - by * Math.sin(G_BAR); v = bx * Math.sin(G_BAR) + by * Math.cos(G_BAR);
      T = 4200 + rnd() * 1300; al = 0.55 + rnd() * 0.4; si = rnd() < 0.15 ? 1 : 0;
    } else if (r0 < 0.21) { // bar
      const bx = (rnd() * 2 - 1) * 14000, by = gauss() * 1700;
      u = bx * Math.cos(G_BAR) - by * Math.sin(G_BAR); v = bx * Math.sin(G_BAR) + by * Math.cos(G_BAR);
      T = 4600 + rnd() * 1200; al = 0.5 + rnd() * 0.35;
    } else if (r0 < 0.72) { // arms
      const arm = ARMS[rnd() < 0.78 ? (rnd() < 0.5 ? 0 : 1) : (rnd() < 0.5 ? 2 : 3)];
      const r = Math.min(52000, arm[1] + -Math.log(1 - rnd() * 0.97) * 13000 * arm[2]);
      const ang = armAngle(arm, r) + gauss() * 0.11, rr = r + gauss() * (900 + r * 0.035);
      u = Math.cos(ang) * rr; v = Math.sin(ang) * rr;
      const hot = rnd() < 0.62;
      T = hot ? 7000 + rnd() * 8000 : 4600 + rnd() * 1600; al = hot ? 0.55 + rnd() * 0.45 : 0.35 + rnd() * 0.3; si = hot && rnd() < 0.12 ? 1 : 0;
    } else { // disk
      const r = Math.min(54000, 2500 + -Math.log(1 - rnd() * 0.985) * 12500), ang = rnd() * TAU;
      u = Math.cos(ang) * r; v = Math.sin(ang) * r;
      T = 4000 + rnd() * 2500; al = 0.25 + rnd() * 0.3;
    }
    // plane -> world: the Sun's plane position (-27,000, 0) maps to the origin
    x[i] = gc[0] + cs * u - sn * G_K * v; y[i] = gc[1] + sn * u + cs * G_K * v;
    c[i] = tIndex(T); a[i] = al; s[i] = si;
  }
  return { n, x, y, c, a, s, gc, th };
}
function genSprite() {
  const N = 512, cvs = document.createElement('canvas'); cvs.width = cvs.height = N;
  const g = cvs.getContext('2d'), m = N / 120000;
  g.translate(N / 2, N / 2); g.scale(m, m);
  let gr = g.createRadialGradient(0, 0, 0, 0, 0, 56000);
  [[0, 0.5], [0.07, 0.3], [0.2, 0.15], [0.4, 0.07], [0.6, 0.03], [0.85, 0.008], [1, 0]].forEach(([o, k]) => gr.addColorStop(o, `rgba(${WARM},${k})`));
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 56000, 0, TAU); g.fill();
  const armC = blackbody(9000).join(','), rnd = mulberry32(5);
  for (const arm of ARMS) {
    for (let r = arm[1]; r < 50000; r += 700) {
      const ang = armAngle(arm, r), rr = 2600 + r * 0.05, px = Math.cos(ang) * r, py = Math.sin(ang) * r;
      const k = 0.09 * arm[2] * (1 - r / 56000) * (0.7 + rnd() * 0.6);
      gr = g.createRadialGradient(px, py, 0, px, py, rr);
      gr.addColorStop(0, `rgba(${armC},${k})`); gr.addColorStop(1, `rgba(${armC},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(px, py, rr, 0, TAU); g.fill();
    }
  }
  g.save(); g.rotate(G_BAR); g.scale(1.9, 1);
  gr = g.createRadialGradient(0, 0, 0, 0, 0, 7500);
  const bc = blackbody(4400).join(',');
  [[0, 0.95], [0.25, 0.6], [0.6, 0.18], [1, 0]].forEach(([o, k]) => gr.addColorStop(o, `rgba(${bc},${k})`));
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 7500, 0, TAU); g.fill();
  g.restore();
  return cvs;
}
function genLocalGroup() {
  const rnd = mulberry32(31);
  const m = dir(V.m31), m31 = [D_M31 * m[0], D_M31 * m[1]];
  const t = dir(V.m31 + V.tri), tri = [m31[0] + 0.75e6 * t[0], m31[1] + 0.75e6 * t[1]];
  const n = 50, x = new Float64Array(n), y = new Float64Array(n), a = new Float32Array(n), c = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const host = i < 25 ? galaxy.gc : m31;
    const r = Math.pow(10, Math.log10(6e4) + rnd() * (Math.log10(1.1e6) - Math.log10(6e4))) * Math.sqrt(1 - Math.pow(rnd(), 2));
    const ang = rnd() * TAU;
    x[i] = host[0] + Math.cos(ang) * r; y[i] = host[1] + Math.sin(ang) * r;
    a[i] = 0.4 + rnd() * 0.4; c[i] = tIndex(5000 + rnd() * 2000);
  }
  return { m31, tri, n, x, y, a, c, centre: [m31[0] * 0.5, m31[1] * 0.5] };
}
function genLaniakea(n) {
  const rnd = mulberry32(4242);
  const gauss = () => { let a = 0; while (a === 0) a = rnd(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(TAU * rnd()); };
  const ax = dir(V.ga), ay = [-ax[1], ax[0]];
  const ga = [2.2e8 * ax[0], 2.2e8 * ax[1]], vd = dir(V.virgo), virgo = [5.5e7 * vd[0], 5.5e7 * vd[1]];
  const C0 = [ga[0] * 0.5, ga[1] * 0.5];
  const P = (a, b) => [C0[0] + a * ax[0] + b * ay[0], C0[1] + a * ax[1] + b * ay[1]];
  const streams = [[P(-1.55e8, 0.25e8), virgo, ga]];
  for (let k = 0; k < 11; k++) {
    const al = (k / 11) * TAU + rnd() * 0.4, st = P(Math.cos(al) * 2.6e8, Math.sin(al) * 1.6e8);
    const mid = [(st[0] + ga[0]) / 2, (st[1] + ga[1]) / 2], ox = -(ga[1] - st[1]), oy = ga[0] - st[0], ol = Math.hypot(ox, oy) || 1, bend = (rnd() - 0.5) * 0.7;
    streams.push([st, [mid[0] + (ox / ol) * bend * 1e8, mid[1] + (oy / ol) * bend * 1e8], ga]);
  }
  const x = new Float64Array(n), y = new Float64Array(n), a = new Float32Array(n), c = new Uint8Array(n), s = new Uint8Array(n), k = new Uint8Array(n);
  let i = 0;
  while (i < n) {
    const r0 = rnd(); let px, py;
    const kind = r0 < 0.13 ? 0 : r0 < 0.19 ? 1 : r0 < 0.9 ? 2 : 3;   // 0 Great Attractor, 1 Virgo, 2 streams, 3 field
    if (r0 < 0.13) { px = ga[0] + gauss() * 1.5e7; py = ga[1] + gauss() * 1.5e7; }
    else if (r0 < 0.19) { px = virgo[0] + gauss() * 0.6e7; py = virgo[1] + gauss() * 0.6e7; }
    else if (r0 < 0.9) {
      const st = streams[rnd() < 0.16 ? 0 : 1 + Math.floor(rnd() * 11)], t = 1 - Math.pow(1 - rnd(), 1.25), u = 1 - t;
      const bx = u * u * st[0][0] + 2 * u * t * st[1][0] + t * t * st[2][0], by = u * u * st[0][1] + 2 * u * t * st[1][1] + t * t * st[2][1];
      const w = 0.95e7 * (1 - 0.5 * t);
      px = bx + gauss() * w; py = by + gauss() * w;
      if (rnd() < 0.18) { px += gauss() * 0.3e7; py += gauss() * 0.3e7; }
    } else { const q = P((rnd() * 2 - 1) * 2.6e8, (rnd() * 2 - 1) * 1.6e8); px = q[0]; py = q[1]; }
    if (Math.hypot(px, py) < 4.5e6) continue;
    x[i] = px; y[i] = py; a[i] = 0.4 + rnd() * 0.45; c[i] = tIndex(4800 + rnd() * 2600); s[i] = rnd() < 0.06 ? 1 : 0; k[i] = kind; i++;
  }
  return { n, x, y, a, c, s, k, ga, virgo, centre: [ga[0] * 0.55, ga[1] * 0.55] };
}
/* the cosmic web: points concentrated on the walls of a jittered Voronoi lattice, with a junction at our position */
const LAM = 3.5e8, LG_R = 72;
function genWeb(f) {
  const SEED = new Float64Array((2 * LG_R + 1) * (2 * LG_R + 1) * 2);
  const idx = (i, j) => ((j + LG_R) * (2 * LG_R + 1) + (i + LG_R)) * 2;
  for (let j = -LG_R; j <= LG_R; j++) for (let i = -LG_R; i <= LG_R; i++) {
    const k = idx(i, j);
    SEED[k] = (i + 0.5 + (hash(i, j, 11) - 0.5) * 0.85) * LAM; SEED[k + 1] = (j + 0.5 + (hash(i, j, 12) - 0.5) * 0.85) * LAM;
  }
  const out = [0, 0, 0];
  function near3(qx, qy) {
    let d1 = Infinity, d2 = Infinity, d3 = Infinity;
    const ci = Math.floor(qx / LAM), cj = Math.floor(qy / LAM);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      if (i < -LG_R || i > LG_R || j < -LG_R || j > LG_R) continue;
      const k = idx(i, j), dx = SEED[k] - qx, dy = SEED[k + 1] - qy, dd = Math.sqrt(dx * dx + dy * dy);
      if (dd < d1) { d3 = d2; d2 = d1; d1 = dd; } else if (dd < d2) { d3 = d2; d2 = dd; } else if (dd < d3) d3 = dd;
    }
    out[0] = d1; out[1] = d2; out[2] = d3; return out;
  }
  // put a junction of three cells at the origin
  let best = Infinity, ox = 0, oy = 0;
  for (let j = -30; j <= 30; j++) for (let i = -30; i <= 30; i++) {
    const qx = (i / 30) * LAM * 0.9, qy = (j / 30) * LAM * 0.9, r = near3(qx, qy), v = r[2] - r[0];
    if (v < best) { best = v; ox = qx; oy = qy; }
  }
  const rnd = mulberry32(777);
  const LV = [[1.5e9, 5000, 1], [6e9, 9000, 1], [2.4e10, 7000, 1], [R_OBS, 10000, 0]];
  return LV.map(([R, n0, structured], li) => {
    const n = Math.round(n0 * f), x = new Float64Array(n), y = new Float64Array(n), a = new Float32Array(n), c = new Uint8Array(n);
    let i = 0, tries = 0;
    while (i < n && tries < n * 400) {
      tries++;
      const rr = R * Math.sqrt(rnd()), ang = rnd() * TAU;
      let px = Math.cos(ang) * rr, py = Math.sin(ang) * rr, al = 0.5 + rnd() * 0.45;
      if (structured) {
        const r = near3(px + ox, py + oy), e2 = (r[1] - r[0]) / LAM, e3 = (r[2] - r[0]) / LAM;
        const p = 0.012 + 0.988 * Math.exp(-((e2 / 0.055) ** 2)) * (0.3 + 0.7 * Math.exp(-((e3 / 0.13) ** 2)));
        if (rnd() > p) continue;
        al *= 1 - smooth((rr / R - 0.45) / 0.55);
      } else {
        if (rnd() < 0.35 && i > 0) { const j = Math.floor(rnd() * i); px = x[j] + (rnd() - 0.5) * R * 0.012; py = y[j] + (rnd() - 0.5) * R * 0.012; }
        const q = Math.hypot(px, py) / R;
        if (q > 1) continue;
        al *= 1 - 0.85 * smooth((q - 0.7) / 0.29);
      }
      x[i] = px; y[i] = py; a[i] = al; c[i] = tIndex(4800 + rnd() * 2600); i++;
    }
    return { R, n: i, x, y, a, c, perDot: (2e12 * Math.pow(R / R_OBS, 3)) / Math.max(1, i), li };
  });
}

/* ---------------- the camera ---------------- */
function panP(s) { return clamp01((s - 2.8) / 2.2) * field.Ptot; }
function camera(s, z) {
  if (s <= 2.8) { camX = 0; camY = 0; return; }
  if (s < 5) { camX = panP(s); camY = 0; return; }
  // after the pan: glide between anchors, linear in view width, so fixed points barely move on screen
  const W = Math.pow(10, z);
  anchors[0][1] = [field.Ptot, 0];
  for (let k = 0; k < anchors.length - 1; k++) {
    const [W0, A] = anchors[k], [W1, B] = anchors[k + 1];
    if (W <= W1 || k === anchors.length - 2) {
      const t = smooth((W - W0) / (W1 - W0));
      camX = A[0] + (B[0] - A[0]) * t; camY = A[1] + (B[1] - A[1]) * t; return;
    }
  }
}
const SX = (wx) => FX + (wx - camX) * sc, SY = (wy) => FY + (wy - camY) * sc;

/* ---------------- canvas text ---------------- */
let FONT = '11px monospace';
function label(x, y, l1, l2, a, prefer) {
  if (a <= 0.01) return;
  const d = D, g = 9 * d, m = 10 * d;
  ctx.font = FONT; ctx.textBaseline = 'middle';
  const w = Math.max(ctx.measureText(l1).width, l2 ? ctx.measureText(l2).width : 0);
  let side = prefer || 1;
  if (side > 0 && x + g + w > Wd - m) side = -1; else if (side < 0 && x - g - w < m) side = 1;
  let tx = side > 0 ? x + g : x - g;
  ctx.textAlign = side > 0 ? 'left' : 'right';
  if (side > 0) tx = Math.min(tx, Wd - m - w); else tx = Math.max(tx, m + w);
  const lh = 14 * d, y0 = l2 ? y - lh / 2 : y;
  ctx.globalAlpha = a * 0.85; ctx.fillStyle = `rgb(${BONE})`; ctx.fillText(l1, tx, y0);
  if (l2) { ctx.globalAlpha = a * 0.75; ctx.fillStyle = ENT.C.dim || '#8e919c'; ctx.fillText(l2, tx, y0 + lh); }
  ctx.globalAlpha = 1;
}
function ring(x, y, r, lw, style, a) {
  if (a <= 0.01) return;
  ctx.globalAlpha = a; ctx.strokeStyle = style; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
}
function glow(x, y, r, rgb, a) {
  if (a <= 0.003 || r <= 0) return;
  const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(0.3, `rgba(${rgb},${a * 0.35})`); gr.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}
const onScreen = (x, y, pad) => x > -pad && x < Wd + pad && y > -pad && y < Hd + pad;
function drawSprite(cx, cy, th, k, sizeLy, a) {
  if (a <= 0.003) return;
  const px = sizeLy * sc; // device px across the sprite's 120,000-light-year square, scaled
  if (px < 0.6) return;
  const m = px / 512, cs = Math.cos(th), sn = Math.sin(th);
  ctx.globalAlpha = a;
  ctx.setTransform(m * cs, m * sn, -m * sn * k, m * cs * k, cx, cy);
  ctx.drawImage(sprite, -256, -256);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
}

/* ---------------- the frame ---------------- */
const FILL_C0 = 11, FILL_G = 18, FILL_K = 4, FILL_L = 4;
let clk = 0, panDots = 0, viewDots = 0, webLevel = -1;
const youW = [0, 0], mwW = [0, 0];   // world positions this frame: the 'you are here' ring, the Milky Way's centre
function draw2D(s) {
  const z = s2z(s), W = Math.pow(10, z), d = D;
  sc = SMIN / W;
  camera(s, z);
  youW[0] = 0; youW[1] = 0; mwW[0] = galaxy.gc[0]; mwW[1] = galaxy.gc[1];
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  ctx.fillStyle = '#050609'; ctx.fillRect(0, 0, Wd, Hd);
  nDots = 0;
  const x0 = camX - FX / sc, x1 = camX + (Wd - FX) / sc, y0 = camY - FY / sc, y1 = camY + (Hd - FY) / sc;
  const cssPx = (ly) => (ly * sc) / d;
  const ox = SX(0), oy = SY(0);

  /* haze of unresolved stars, inside the disk */
  const haze = 0.05 * smooth((z - 2.4) / 1.1) * (1 - smooth((z - 3.7) / 0.6));
  if (haze > 0.002) { ctx.fillStyle = `rgba(${WARM},${haze})`; ctx.fillRect(0, 0, Wd, Hd); }

  /* the observable universe: a faint disk and, at its rim, the afterglow */
  const uni = smooth((z - 10.35) / 0.55);
  if (uni > 0.003) {
    const R = R_OBS * sc;
    const gr = ctx.createRadialGradient(ox, oy, 0, ox, oy, R);
    gr.addColorStop(0, `rgba(${BONE},${0.035 * uni})`); gr.addColorStop(0.8, `rgba(${BONE},${0.025 * uni})`); gr.addColorStop(1, `rgba(${BONE},0)`);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(ox, oy, R, 0, TAU); ctx.fill();
  }

  /* galaxy sprites: the Milky Way glow, then Andromeda and Triangulum */
  const lgExt = cssPx(3.4e6), lgFade = smooth((lgExt - 6) / 10);
  const mwIn = smooth((z - 3.35) / 0.6);
  const boost = smooth((160 - cssPx(2 * R_MW)) / 110);
  if (z > 3.3 && lgFade > 0) {
    drawSprite(SX(galaxy.gc[0]), SY(galaxy.gc[1]), galaxy.th, G_K, 120000, 0.95 * mwIn * lgFade);
    if (boost > 0) { ctx.globalCompositeOperation = 'lighter'; drawSprite(SX(galaxy.gc[0]), SY(galaxy.gc[1]), galaxy.th, G_K, 120000, 0.9 * boost * lgFade); ctx.globalCompositeOperation = 'source-over'; }
  }
  if (z > 5.6 && lgFade > 0) {
    const a = smooth((z - 5.7) / 0.4) * lgFade;
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 2; k++) {
      drawSprite(SX(lg.m31[0]), SY(lg.m31[1]), rad(V.m31 + 62), 0.32, 168000, a * 0.9);
      drawSprite(SX(lg.tri[0]), SY(lg.tri[1]), rad(V.m31 - 30), 0.68, 60000, a * 0.8);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* cosmic web levels */
  webLevel = -1; let wbest = 0;
  if (z > 8.55) {
    const LA = [band(z, 8.6, 9.1, 9.55, 9.95), band(z, 9.35, 9.8, 10.15, 10.5), band(z, 9.95, 10.3, 10.65, 10.95), smooth((z - 10.4) / 0.45)];
    for (let k = 0; k < web.length; k++) {
      const A = LA[k], L = web[k]; if (A <= 0.01) continue;
      if (A > wbest - 0.05) { wbest = A; webLevel = k; }
      if (cssPx(L.R) < 2) continue;
      for (let i = 0; i < L.n; i++) {
        const sx = SX(L.x[i]), sy = SY(L.y[i]);
        if (sx < -2 || sx > Wd + 2 || sy < -2 || sy > Hd + 2) continue;
        dot(L.c[i], L.a[i] * A, 0, sx, sy);
      }
    }
  }

  /* Laniakea */
  // as it shrinks into a knot of the web its light is conserved, not piled up
  const lanA = smooth((z - 7.15) / 0.6) * smooth((cssPx(LAN_LEN) - 35) / 70) * Math.min(1, Math.pow(cssPx(LAN_LEN) / 200, 2));
  if (lanA > 0.004) {
    for (let i = 0; i < lan.n; i++) {
      const sx = SX(lan.x[i]), sy = SY(lan.y[i]);
      if (sx < -3 || sx > Wd + 3 || sy < -3 || sy > Hd + 3) continue;
      dot(lan.c[i], lan.a[i] * lanA, lan.s[i], sx, sy);
    }
  }
  // our Local Group as one dot among them, once its galaxies have merged into one point
  const lgDot = (1 - lgFade) * smooth((z - 7.0) / 0.4) * (1 - smooth((z - 10.2) / 0.5));
  if (lgDot > 0.01) dot(tIndex(5600), 0.95 * lgDot, 1, ox, oy);

  /* Local Group dwarfs */
  if (z > 5.3 && lgFade > 0) {
    const a = smooth((z - 5.4) / 0.45) * lgFade;
    for (let i = 0; i < lg.n; i++) {
      const sx = SX(lg.x[i]), sy = SY(lg.y[i]);
      if (onScreen(sx, sy, 2)) dot(lg.c[i], lg.a[i] * a, 1, sx, sy);
    }
  }

  /* Milky Way stars */
  const gExt = cssPx(2 * R_MW), gA = smooth((z - 3.5) / 0.5) * smooth((gExt - 55) / 90);
  if (gA > 0.004) {
    for (let i = 0; i < galaxy.n; i++) {
      const sx = SX(galaxy.x[i]), sy = SY(galaxy.y[i]);
      if (sx < -3 || sx > Wd + 3 || sy < -3 || sy > Hd + 3) continue;
      dot(galaxy.c[i], galaxy.a[i] * gA, galaxy.s[i], sx, sy);
    }
  }

  /* fill: more and more stars crowd in once the view is wider than the pan */
  viewDots = 0;
  const fillA = smooth((z - 2.04) / 0.3) * (1 - smooth((z - 3.65) / 0.5));
  if (fillA > 0.004) {
    const n0 = nDots;
    for (let L = 0; L < FILL_L; L++) {
      const c = FILL_C0 * Math.pow(4, L), l = Math.log(W / (FILL_G * c)) / Math.log(4);
      const La = fillA * (l <= 0 ? 1 : 1 - clamp01(l));
      if (La <= 0.004) continue;
      const q = Math.min(1, Math.pow((FILL_G * c) / W, 2)), qb = 0.25 * q;
      const i0 = Math.floor(x0 / c), i1 = Math.floor(x1 / c), j0 = Math.floor(y0 / c), j1 = Math.floor(y1 / c);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (let k = 0; k < FILL_K; k++) {
        const key = L * 32 + k * 5, w = hash(i, j, key);
        if (w >= q) continue;
        const sx = SX((i + hash(i, j, key + 1)) * c), sy = SY((j + hash(i, j, key + 2)) * c);
        const t = hash(i, j, key + 3);
        const ci = t < 0.7 ? 1 + Math.floor(t * 4) : 4 + Math.floor((t - 0.7) * 17);
        dot(Math.min(8, ci), La * (0.2 + 0.32 * t) * clamp01((q - w) / qb), 0, sx, sy);
      }
    }
    viewDots += nDots - n0;
  }

  /* the field of single stars: the gap, the pan, then the strip you panned through */
  panDots = 0;
  const fieldA = smooth((z - 0.8) / 0.2);
  const P = s <= 2.8 ? 0 : panP(s);
  const stripLen = cssPx(field.Wv + 0.8 * field.Ptot);
  const stripA = fieldA * (s < 5 ? 1 : smooth((stripLen - 10) / 30) * (1 - 0.15 * smooth((z - 2.05) / 0.8)));
  const shrink = s < 5 || z < 2.15 ? 2 : z < 2.5 ? 1 : 0;
  if (stripA > 0.004) {
    const tw = !reduced && s > 2.8 && s < 5 ? clk : 0;
    const dz = z < 2 ? W / (2 * field.asp) : Infinity;
    let budget = 0;
    for (const L of field.layers) {
      const sh = (1 - L.f) * P;
      budget += lowerBound(L.x, L.n, x1 - sh + 1) - lowerBound(L.x, L.n, x0 - sh - 1);
    }
    const step = Math.max(1, Math.ceil(budget / (D > 1 ? 4200 : 5200)));
    const n0 = nDots;
    for (const L of field.layers) {
      const sh = (1 - L.f) * P, lo = lowerBound(L.x, L.n, x0 - sh - 1), hi = lowerBound(L.x, L.n, x1 - sh + 1);
      for (let i = lo; i < hi; i += step) {
        const yy = L.y[i]; if (yy < y0 - 1 || yy > y1 + 1) continue;
        let a = L.a[i] * stripA;
        if (dz !== Infinity) { const ad = Math.abs(L.d[i]); if (ad > dz) continue; a *= clamp01((dz - ad) / (0.3 * dz)); }
        if (tw) a *= 1 + 0.09 * Math.sin(tw * L.sp[i] + L.ph[i]);
        dot(L.c[i], a, L.s[i] > shrink ? shrink : L.s[i], SX(L.x[i] + sh), SY(yy));
      }
    }
    panDots = nDots - n0;
    viewDots += panDots * step;
  }

  flush();

  /* the Sun */
  if (onScreen(ox, oy, 40)) {
    const big = 1 - smooth((z + 3.3) / 3.6); // a disk with glow at first, a point among stars later
    const fade = 1 - smooth((z - 3.0) / 0.4);
    if (fade > 0) {
      glow(ox, oy, (5 + 22 * big) * d, SUNC, (0.3 + 0.35 * big) * fade);
      ctx.fillStyle = `rgba(255,248,236,${fade})`;
      ctx.beginPath(); ctx.arc(ox, oy, (1.1 + 1.9 * big) * d, 0, TAU); ctx.fill();
    }
  }

  /* the afterglow of the Big Bang */
  if (uni > 0.003) {
    const R = R_OBS * sc, w = Math.max(3 * d, R * 0.035);
    const gr = ctx.createRadialGradient(ox, oy, Math.max(0, R - w * 2.4), ox, oy, R + w * 0.6);
    gr.addColorStop(0, `rgba(${CMB},0)`); gr.addColorStop(0.55, `rgba(${CMB},${0.08 * uni})`);
    gr.addColorStop(0.82, `rgba(${CMB},${0.55 * uni})`); gr.addColorStop(0.9, `rgba(${CMB},${0.62 * uni})`); gr.addColorStop(1, `rgba(${CMB},0)`);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(ox, oy, R + w * 0.6, 0, TAU); ctx.fill();
  }

  vectors(s);
}

/* ================================================================ the GL sky (ENT.gfx, with ENT.sky for the galaxies and the web) */
const PCAP = 90000, PB = new Float32Array(PCAP * 7);   // soft points
const SCAP = 512, SB = new Float32Array(SCAP * 7);     // the few brightest stars, with spikes
const MCAP = 12000, MB = new Float32Array(MCAP * 9);   // smudges (distant galaxies)
let pn = 0, sn = 0, mn = 0, KG = 1, GD = 1, GW = 1, GH = 1;
function pt(x, y, size, j, a) {
  if (pn >= PCAP || a <= 0.0005) return;
  const q = pn++ * 7; PB[q] = x; PB[q + 1] = y; PB[q + 2] = size; PB[q + 3] = LUT[j]; PB[q + 4] = LUT[j + 1]; PB[q + 5] = LUT[j + 2]; PB[q + 6] = a;
}
function spike(x, y, size, j, a) {
  if (sn >= SCAP || a <= 0.0005) return;
  const q = sn++ * 7; SB[q] = x; SB[q + 1] = y; SB[q + 2] = size; SB[q + 3] = LUT[j]; SB[q + 4] = LUT[j + 1]; SB[q + 5] = LUT[j + 2]; SB[q + 6] = a;
}
function smudge(x, y, size, j, a, ang, sq) {
  if (mn >= MCAP || a <= 0.0005) return;
  const q = mn++ * 9; MB[q] = x; MB[q + 1] = y; MB[q + 2] = size; MB[q + 3] = LUT[j]; MB[q + 4] = LUT[j + 1]; MB[q + 5] = LUT[j + 2]; MB[q + 6] = a; MB[q + 7] = ang; MB[q + 8] = sq;
}
const ONE = new Float32Array(7), ONE9 = new Float32Array(9);
function single(x, y, size, r, gg, b, a, shape) { ONE[0] = x; ONE[1] = y; ONE[2] = size; ONE[3] = r; ONE[4] = gg; ONE[5] = b; ONE[6] = a; g.points(ONE, 1, shape ? { shape } : undefined); }
function flushPts() { if (pn) g.points(PB, pn); pn = 0; }
function flushSpikes() { if (sn) g.points(SB, sn, { shape: 'star' }); sn = 0; }
function flushSmudges() { if (mn) g.smudges(MB, mn); mn = 0; }

/* exposure and bloom per level, interpolated in z so nothing pumps: [z, exposure, bloom, threshold, bloom radius] */
const EXK = [[-4.3, 1.0, 1.0, 0.9, 1.2], [-1, 1.0, 0.85, 0.9, 1.1], [1.2, 1.15, 0.6, 0.8, 1], [2.2, 1.25, 0.55, 0.75, 1], [3.6, 1.2, 0.6, 0.7, 1],
  [5.0, 1.05, 0.8, 0.6, 1.1], [5.6, 1.1, 0.8, 0.6, 1.1], [6.6, 1.7, 0.75, 0.5, 1], [7.6, 1.8, 0.7, 0.5, 1], [9.0, 1.5, 0.6, 0.6, 1], [10.4, 1.3, 0.65, 0.6, 1.1], [11.05, 1.2, 0.7, 0.6, 1.2]];
const FR = { exposure: 1, bloom: 0.8, threshold: 0.6, bloomRadius: 1 };
function exposure(z) {
  let i = 1; while (i < EXK.length - 1 && z > EXK[i][0]) i++;
  const A = EXK[i - 1], B = EXK[i], t = smooth((z - A[0]) / (B[0] - A[0]));
  FR.exposure = A[1] + (B[1] - A[1]) * t; FR.bloom = A[2] + (B[2] - A[2]) * t; FR.threshold = A[3] + (B[3] - A[3]) * t; FR.bloomRadius = A[4] + (B[4] - A[4]) * t;
}

/* models: built once, off the critical path where possible */
const SKY = () => (ENT.sky && ENT.sky.galaxy && ENT.sky.drawGalaxy ? ENT.sky : null);
const M = { mw: null, m31: null, m33: null, web: null, sun: -1 };
const TILT_MW = rad(55), TILT_M31 = rad(77), TILT_M33 = rad(52);
let paMW = 0, rot0 = 0, rotG = 0;
const PJ = { x: 0, y: 0 }, PJO = { x: 0, y: 0, radius: 1, tilt: TILT_MW, pa: 0, rot: 0 };
function build(name) {
  const sky = SKY(); if (!sky || M[name]) return M[name];
  try {
    if (name === 'mw') { M.mw = sky.galaxy({ seed: 2026, count: SMALL ? 25000 : 60000 }); M.sun = pickSun(M.mw); orientMW(); worldNear(); setAnchors(); }
    else if (name === 'm31') M.m31 = sky.galaxy({ seed: 31, count: SMALL ? 8000 : 20000 });
    else if (name === 'm33') M.m33 = sky.galaxy({ seed: 33, count: SMALL ? 3000 : 8000 });
    else if (name === 'web' && sky.web && sky.drawWeb) M.web = sky.web({ seed: 7, count: SMALL ? 35000 : 90000 });
  } catch (e) { M[name] = null; }
  return M[name];
}
function buildLater() {
  if (!g || !SKY()) return;
  const q = ['mw', 'm31', 'm33', 'web'];
  const next = () => { const n = q.shift(); if (!n) return; if (!M[n]) { build(n); dirty = true; } setTimeout(next, 60); };
  setTimeout(next, 200);
}
// the Sun: one disk star about 54% of the way out, in the plane, in a gap between two arms
function pickSun(gal) {
  const NG = 64, grid = new Float32Array(NG * NG), o = {};
  const cell = (x, y) => { const i = Math.floor(((x + 1.2) / 2.4) * NG), j = Math.floor(((y + 1.2) / 2.4) * NG); return i < 0 || j < 0 || i >= NG || j >= NG ? -1 : j * NG + i; };
  for (let i = 0; i < gal.count; i++) { gal.star(i, o); if (o.kind === 'arm' || o.kind === 'knot' || o.kind === 'hii') { const c = cell(o.x, o.y); if (c >= 0) grid[c]++; } }
  const dens = (x, y) => { const c = cell(x, y); return c < 0 ? 0 : grid[c]; };
  let best = 0, bs = -Infinity;
  for (let i = 0; i < gal.count; i++) {
    gal.star(i, o);
    if (o.kind !== 'disk') continue;
    const r = Math.hypot(o.x, o.y);
    if (r < 0.52 || r > 0.56 || Math.abs(o.z) > 0.01) continue;
    const ux = o.x / r, uy = o.y / r, here = dens(o.x, o.y);
    const sc0 = Math.min(dens(o.x - ux * 0.075, o.y - uy * 0.075), dens(o.x + ux * 0.075, o.y + uy * 0.075)) - 2 * here;
    if (sc0 > bs) { bs = sc0; best = i; }
  }
  return best;
}
// turn the disk so that the Sun lies where the 2D layout put it (the galaxy's centre in direction V.gc from us)
function orientMW() {
  if (!M.mw) return;
  const tall = V === V_TALL;
  paMW = tall ? rad(-80) : rad(-8);
  PJO.tilt = TILT_MW; PJO.pa = paMW; PJO.radius = 1;
  const want = rad(V.gc) + Math.PI;
  let best = 0, bd = Infinity;
  for (let k = 0; k < 720; k++) {
    PJO.rot = (k / 720) * TAU; ENT.sky.project(M.mw, M.sun, PJO, PJ);
    let dA = Math.atan2(PJ.y, PJ.x) - want; dA = Math.atan2(Math.sin(dA), Math.cos(dA));
    if (Math.abs(dA) < bd) { bd = Math.abs(dA); best = PJO.rot; }
  }
  rot0 = best;
  PJO.rot = rot0; ENT.sky.project(M.mw, M.sun, PJO, PJ);
  galaxy.gc[0] = -PJ.x * R_MW; galaxy.gc[1] = -PJ.y * R_MW;   // world: the Sun is the origin
}

/* fixed data for the levels drawn here */
let BK = null, LANX = null, MC = null, DW = null;
function genBackdrop() {
  const rnd = mulberry32(404), n = SMALL ? 260 : 420, B = { n, u: new Float32Array(n), v: new Float32Array(n), s: new Float32Array(n), j: new Uint16Array(n), a: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    B.u[i] = rnd(); B.v[i] = rnd();
    const t = rnd(), b = rnd();
    B.j[i] = lut(t < 0.55 ? 3000 + b * 1600 : t < 0.9 ? 4800 + b * 2000 : 7500 + b * 9000);
    const br = rnd() < 0.025;
    B.a[i] = br ? 0.35 + rnd() * 0.4 : 0.035 + Math.pow(rnd(), 3) * 0.12; B.s[i] = br ? 2.4 : 1.5 + rnd() * 0.5;
  }
  return B;
}
function prepLan() {
  const n = lan.n, X = { j: new Uint16Array(n), a: new Float32Array(n), ang: new Float32Array(n), sq: new Float32Array(n), s: new Float32Array(n) };
  // crowded places: less light per galaxy, so the knots stay knots instead of burning out
  const G = 96, cnt = new Uint16Array(G * G), ext = 3.2e8, cellOf = (i) => {
    const gx = Math.floor(((lan.x[i] - lan.ga[0] * 0.5) / ext + 0.5) * G), gy = Math.floor(((lan.y[i] - lan.ga[1] * 0.5) / ext + 0.5) * G);
    return gx < 0 || gy < 0 || gx >= G || gy >= G ? -1 : gy * G + gx;
  };
  for (let i = 0; i < n; i++) { const c = cellOf(i); if (c >= 0 && cnt[c] < 65535) cnt[c]++; }
  for (let i = 0; i < n; i++) {
    const h1 = hash(i, 7, 1), h2 = hash(i, 7, 2), h3 = hash(i, 7, 3), h4 = hash(i, 7, 4);
    const dense = lan.k[i] <= 1, ell = dense ? h1 < 0.75 : lan.k[i] === 2 ? h1 < 0.3 : h1 < 0.12;
    X.j[i] = lut(ell ? 4300 + h2 * 1000 : 6500 + h2 * 5000);
    X.ang[i] = h3 * Math.PI; X.sq[i] = ell ? 0.6 + 0.35 * h4 : 0.22 + 0.7 * h4;
    X.s[i] = (ell ? 1.9 : 2.3) + 1.8 * Math.pow(h2 * h4, 1.5) + (dense && ell && h3 < 0.05 ? 1.6 : 0);
    X.a[i] = lan.a[i] * (ell ? 0.5 : 0.36) * (1 + 1.6 * Math.pow(h4, 8)) * Math.min(1, Math.pow((SMALL ? 2.5 : 5) / Math.max(1, cnt[cellOf(i)] || 1), 0.85));
  }
  return X;
}
function genClouds() {   // the two Magellanic Clouds: small irregular smudges beside the Milky Way
  const rnd = mulberry32(55), out = [];
  const tall = V === V_TALL, base = tall ? 100 : 62;
  [[160000, base, 7000, 340, 1], [200000, base + 22, 4000, 160, 0.6]].forEach(([dist, angDeg, rr, n, w]) => {
    const dd = dir(angDeg), cx = galaxy.gc[0] + dd[0] * dist, cy = galaxy.gc[1] + dd[1] * dist, P = [];
    const barA = rnd() * Math.PI, ca = Math.cos(barA), sa = Math.sin(barA);
    for (let i = 0; i < n; i++) {
      let u = gauss(rnd) * rr * 0.55, v = gauss(rnd) * rr * 0.33;
      if (rnd() < 0.35) { u = gauss(rnd) * rr * 0.45; v = gauss(rnd) * rr * 0.1; }   // a bar
      P.push([cx + u * ca - v * sa, cy + u * sa + v * ca, lut(rnd() < 0.5 ? 9000 + rnd() * 9000 : 5000 + rnd() * 1500), 0.05 + Math.pow(rnd(), 6) * 0.5]);
    }
    out.push({ cx, cy, rr, w, P, ang: barA });
  });
  return out;
}
function gauss(rnd) { let a = 0; while (a === 0) a = rnd(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(TAU * rnd()); }
function prepDwarfs() {
  const n = lg.n, X = { j: new Uint16Array(n), ang: new Float32Array(n), sq: new Float32Array(n), s: new Float32Array(n) };
  for (let i = 0; i < n; i++) { const h = hash(i, 9, 1), h2 = hash(i, 9, 2); X.j[i] = lut(4600 + h * 2200); X.ang[i] = h2 * Math.PI; X.sq[i] = 0.45 + 0.5 * hash(i, 9, 3); X.s[i] = 2.6 + 2.4 * hash(i, 9, 4); }
  return X;
}

function drawGL(s) {
  const z = s2z(s), W = Math.pow(10, z), d = D;
  sc = SMIN / W;
  camera(s, z);
  const gs = g.resize(); GW = gs.w; GH = gs.h; GD = gs.d; KG = GW / Wd;
  const gd = GD, X = (wx) => SX(wx) * KG, Y = (wy) => SY(wy) * KG;
  const cssPx = (ly) => (ly * sc) / d;
  const ox = X(0), oy = Y(0), sky = SKY();
  youW[0] = 0; youW[1] = 0; mwW[0] = galaxy.gc[0]; mwW[1] = galaxy.gc[1];
  exposure(z);
  g.begin(FR);
  pn = 0; sn = 0; mn = 0;
  const inView = (x, y, pad) => x > -pad && x < GW + pad && y > -pad && y < GH + pad;

  /* the backdrop: distant stars too far away to move while we leave the solar system */
  const bkA = 1 - smooth((z - 0.6) / 1.0);
  if (bkA > 0.004) {
    for (let i = 0; i < BK.n; i++) {
      const x = BK.u[i] * GW, y = BK.v[i] * GH;
      if (Math.hypot(x - ox, y - oy) < 30 * gd) continue;   // keep the Sun's glare clean
      if (BK.a[i] > 0.3) spike(x, y, BK.s[i] * 2 * gd, BK.j[i], BK.a[i] * bkA * 0.8);
      else pt(x, y, BK.s[i] * gd, BK.j[i], BK.a[i] * bkA);
    }
  }

  /* the observable universe and the web (sky.js), and the finer web levels around us */
  webLevel = -1; let wbest = 0;
  if (z > 8.55) {
    const LA = [band(z, 8.6, 9.1, 9.55, 9.95), band(z, 9.35, 9.8, 10.15, 10.5), band(z, 9.95, 10.3, 10.65, 10.95), smooth((z - 10.35) / 0.5)];
    const webM = sky && sky.drawWeb ? M.web || build('web') : null;
    for (let k = 0; k < web.length; k++) {
      const A = LA[k], L = web[k]; if (A <= 0.01) continue;
      if (A > wbest - 0.05) { wbest = A; webLevel = k; }
      if (k === 3 && webM) {
        sky.drawWeb(g, webM, { x: ox, y: oy, radius: (R_OBS * sc * KG) / 1.05, zoom: 1, alpha: A, rim: smooth((z - 10.45) / 0.45), detail: 1 });
        continue;
      }
      if (cssPx(L.R) < 2) continue;
      const lw = k === 3 ? 0.5 : 0.75;
      for (let i = 0; i < L.n; i++) {
        const x = X(L.x[i]), y = Y(L.y[i]);
        if (!inView(x, y, 3)) continue;
        pt(x, y, 1.9 * gd, TJ[L.c[i]], L.a[i] * A * lw);
      }
    }
    flushPts();
  }
  if (z > 10.3 && !(sky && M.web)) {   // no sky.js: the afterglow as a warm ring of light
    const uni = smooth((z - 10.35) / 0.55), R = R_OBS * sc * KG, n = 360, j = lut(2700);
    for (let i = 0; i < n; i++) { const an = (i / n) * TAU; pt(ox + Math.cos(an) * R, oy + Math.sin(an) * R, Math.max(6 * gd, R * 0.08), j, 0.012 * uni); }
    flushPts();
  }

  /* Laniakea: galaxies as small oriented smudges */
  // as it shrinks into a knot of the web its light is conserved, not piled up
  const lanA = smooth((z - 7.15) / 0.6) * smooth((cssPx(LAN_LEN) - 35) / 70) * Math.min(1, Math.pow(cssPx(LAN_LEN) / 200, 2));
  if (lanA > 0.004) {
    for (let i = 0; i < lan.n; i++) {
      const x = X(lan.x[i]), y = Y(lan.y[i]);
      if (!inView(x, y, 6)) continue;
      smudge(x, y, LANX.s[i] * 1.2 * gd, LANX.j[i], LANX.a[i] * lanA * 2.2, LANX.ang[i], LANX.sq[i]);
    }
  }
  const lgExt = cssPx(3.4e6), lgFade = smooth((lgExt - 6) / 10);
  const lgDot = (1 - lgFade) * smooth((z - 7.0) / 0.4) * (1 - smooth((z - 10.2) / 0.5));
  if (lgDot > 0.01) smudge(ox, oy, 3.2 * gd, lut(5200), 0.9 * lgDot, 0.4, 0.7);

  /* the Local Group: dwarfs, the Magellanic Clouds, Andromeda, Triangulum */
  if (z > 5.0 && lgFade > 0) {
    const a = smooth((z - 5.4) / 0.45) * lgFade;
    for (let i = 0; i < lg.n; i++) {
      const x = X(lg.x[i]), y = Y(lg.y[i]);
      if (inView(x, y, 10)) smudge(x, y, DW.s[i] * gd, DW.j[i], lg.a[i] * a * 0.16, DW.ang[i], DW.sq[i]);
    }
    const ca = smooth((z - 4.95) / 0.35) * lgFade;
    if (ca > 0.004) for (const c of MC) {
      const x = X(c.cx), y = Y(c.cy), rpx = c.rr * sc * KG;
      if (!inView(x, y, rpx * 2 + 10)) continue;
      smudge(x, y, Math.max(3 * gd, rpx * 2.4), lut(6800), 0.1 * c.w * ca, c.ang, 0.55);
      smudge(x, y, Math.max(2 * gd, rpx * 1.1), lut(7500), 0.12 * c.w * ca, c.ang, 0.4);
      const pk = smooth((rpx / gd - 4) / 14);
      if (pk > 0.01) for (const p of c.P) pt(X(p[0]), Y(p[1]), 1.6 * gd, p[2], p[3] * ca * pk);
    }
    flushSmudges(); flushPts();
    const ga = smooth((z - 5.7) / 0.4) * lgFade;
    if (ga > 0.004) {
      const big = [[M.m31 || (sky && build('m31')), lg.m31, 1.5, TILT_M31, rad(V.m31 + 62), 1.1], [M.m33 || (sky && build('m33')), lg.tri, 0.6, TILT_M33, rad(V.m31 - 30), 1.0]];
      for (const [gal, P, k, tilt, pa, br] of big) {
        const x = X(P[0]), y = Y(P[1]), R = R_MW * k * sc * KG;
        if (!inView(x, y, R * 1.6 + 8)) continue;
        if (gal) {
          const detail = smooth((R / gd - 6) / 70);
          sky.drawGalaxy(g, gal, { x, y, radius: R, tilt, pa, rot: -rotG * 0.8, alpha: ga * br, detail });
          compact(x, y, R, pa, tilt, ga * br);
        } else {
          smudge(x, y, Math.max(2.5 * gd, R * 2.2), lut(5600), 0.35 * ga * br, pa, Math.cos(tilt));
          smudge(x, y, Math.max(2 * gd, R * 0.5), lut(4800), 0.8 * ga * br, pa, Math.cos(tilt) + 0.2);
        }
      }
    }
  }
  flushSmudges();

  /* the Milky Way */
  const gExt = cssPx(2 * R_MW);
  const mwA = smooth((z - 3.95) / 0.6) * (lgFade > 0 ? 1 : 0);
  if (mwA > 0.004) {
    const mw = sky ? M.mw || build('mw') : null;
    if (mw) {
      const t = smooth((z - 4.0) / 1.0), rot = rot0 - rotG;
      PJO.tilt = TILT_MW; PJO.pa = paMW; PJO.radius = R_MW; PJO.rot = rot;
      sky.project(mw, M.sun, PJO, PJ);
      const px = PJ.x, py = PJ.y;   // the Sun relative to the centre, in light-years, now
      const cx = galaxy.gc[0] + (1 - t) * (-galaxy.gc[0] - px), cy = galaxy.gc[1] + (1 - t) * (-galaxy.gc[1] - py);
      mwW[0] = cx; mwW[1] = cy; youW[0] = cx + px; youW[1] = cy + py;
      const detail = smooth((gExt - 10) / 170);
      const fadeOut = lgFade * (1 - 0.5 * smooth((10 - gExt) / 6));
      sky.drawGalaxy(g, mw, { x: X(cx), y: Y(cy), radius: R_MW * sc * KG, tilt: TILT_MW, pa: paMW, rot, alpha: mwA * fadeOut, detail });
      compact(X(cx), Y(cy), R_MW * sc * KG, paMW, TILT_MW, mwA * fadeOut);
    } else {   // no sky.js: the 2D model's dots, drawn as light
      const gA = smooth((z - 3.5) / 0.5) * smooth((gExt - 55) / 90);
      for (let i = 0; i < galaxy.n; i++) {
        const x = X(galaxy.x[i]), y = Y(galaxy.y[i]);
        if (!inView(x, y, 3)) continue;
        pt(x, y, (1.6 + 0.6 * galaxy.s[i]) * gd, TJ[galaxy.c[i]], galaxy.a[i] * gA * 0.35);
      }
      const gc = [X(galaxy.gc[0]), Y(galaxy.gc[1])], R = R_MW * sc * KG;
      smudge(gc[0], gc[1], R * 2.2, lut(5200), 0.08 * mwA * lgFade, galaxy.th, G_K);
      smudge(gc[0], gc[1], Math.max(2 * gd, R * 0.4), lut(4600), 0.5 * mwA * lgFade, galaxy.th + G_BAR, 0.5);
      flushSmudges(); flushPts();
    }
  }

  /* the neighbourhood: more and more stars crowd in once the view is wider than the pan, then merge into light */
  viewDots = 0;
  // unresolved light: the strip glows as it contracts, then a faint even glow of the disk all around us
  const jh = lut(4600);
  const sg = smooth((z - 2.3) / 0.6) * (1 - smooth((z - 3.55) / 0.45));
  if (sg > 0.003) {
    const cxw = field.xL + (field.Wv + field.Ptot) / 2, cyw = field.yT + field.Hv / 2, len = (field.Wv + field.Ptot) * sc * KG;
    const sk = Math.min(1, Math.pow(len / KG / D / (1.1 * CW), 1.6));
    const r = LUT[jh], gg = LUT[jh + 1], b = LUT[jh + 2];
    ONE[0] = X(cxw); ONE[1] = Y(cyw); ONE[2] = Math.max(16 * gd, len * 1.4); ONE[3] = r; ONE[4] = gg; ONE[5] = b; ONE[6] = 0.035 * sg * sk;
    ONE9.set(ONE, 0); ONE9[7] = 0; ONE9[8] = clamp01(field.Hv / (field.Wv + field.Ptot) * 1.6); g.smudges(ONE9, 1);
  }
  const haze = smooth((z - 2.9) / 0.8) * (1 - smooth((z - 4.35) / 0.5));
  if (haze > 0.003) single(GW / 2, GH / 2, 5 * Math.hypot(GW, GH), LUT[jh], LUT[jh + 1], LUT[jh + 2], 0.0016 * haze);
  const fillA = smooth((z - 2.04) / 0.3) * (1 - smooth((z - 4.05) / 0.5));
  if (fillA > 0.004) {
    const x0 = camX - FX / sc, x1 = camX + (Wd - FX) / sc, y0 = camY - FY / sc, y1 = camY + (Hd - FY) / sc;
    const n0 = pn;
    for (let L = 0; L < FILL_L; L++) {
      const c = FILL_C0 * Math.pow(4, L), l = Math.log(W / (FILL_G * c)) / Math.log(4);
      const La = fillA * (l <= 0 ? 1 : 1 - clamp01(l));
      if (La <= 0.004) continue;
      const q = Math.min(1, Math.pow((FILL_G * c) / W, 2)), qb = 0.25 * q;
      const i0 = Math.floor(x0 / c), i1 = Math.floor(x1 / c), j0 = Math.floor(y0 / c), j1 = Math.floor(y1 / c);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (let k = 0; k < FILL_K; k++) {
        const key = L * 32 + k * 5, w = hash(i, j, key);
        if (w >= q) continue;
        const t = hash(i, j, key + 3);
        const T = t < 0.7 ? 3000 + t * 1300 : t < 0.95 ? 4500 + (t - 0.7) * 8000 : 7000 + (t - 0.95) * 140000;
        pt(SX((i + hash(i, j, key + 1)) * c) * KG, SY((j + hash(i, j, key + 2)) * c) * KG, 1.6 * gd, lut(T), La * (0.12 + 0.36 * t * t) * clamp01((q - w) / qb));
      }
    }
    viewDots += pn - n0;
  }

  /* the field of single stars: the gap, the pan, then the strip you panned through */
  panDots = 0;
  const fieldA = smooth((z - 0.8) / 0.2);
  const P = s <= 2.8 ? 0 : panP(s);
  const stripLen = cssPx(field.Wv + 0.8 * field.Ptot);
  const shrinkK = s < 5 ? 1 : Math.min(1, Math.pow(stripLen / (1.1 * CW), 2.6));   // light is conserved as the strip contracts
  const stripA = fieldA * (s < 5 ? 1 : smooth((stripLen - 10) / 30) * (1 - 0.15 * smooth((z - 2.05) / 0.8))) * shrinkK;
  if (stripA > 0.002) {
    const x0 = camX - FX / sc, x1 = camX + (Wd - FX) / sc, y0 = camY - FY / sc, y1 = camY + (Hd - FY) / sc;
    const tw = !reduced && s > 2.8 && s < 5 ? clk : 0;
    const dz = z < 2 ? W / (2 * field.asp) : Infinity;
    const n0 = pn + sn;
    for (const L of field.layers) {
      const sh = (1 - L.f) * P, lo = lowerBound(L.x, L.n, x0 - sh - 1), hi = lowerBound(L.x, L.n, x1 - sh + 1);
      for (let i = lo; i < hi; i++) {
        const yy = L.y[i]; if (yy < y0 - 1 || yy > y1 + 1) continue;
        let a = L.l[i] * stripA;
        if (dz !== Infinity) { const ad = Math.abs(L.d[i]); if (ad > dz) continue; a *= clamp01((dz - ad) / (0.3 * dz)); }
        if (tw) a *= 1 + 0.09 * Math.sin(tw * L.sp[i] + L.ph[i]);
        const x = SX(L.x[i] + sh) * KG, y = SY(yy) * KG;
        if (L.k[i]) spike(x, y, (3.2 + 2.2 * a) * gd, L.j[i], a * 0.8);
        else pt(x, y, (1.5 + 0.35 * L.s[i]) * gd, L.j[i], a);
      }
    }
    panDots = pn + sn - n0;
    viewDots += panDots;
  }
  flushPts(); flushSpikes();

  /* the Sun: a disk with a corona and glare, then one star among the others */
  if (inView(ox, oy, 200 * gd)) {
    const big = 1 - smooth((z + 3.3) / 3.6), fade = 1 - smooth((z - 3.0) / 0.4);
    if (fade > 0) {
      const j = lut(5800), r = LUT[j], gg = LUT[j + 1], b = LUT[j + 2];
      const disc = smooth((big - 0.08) / 0.35);
      if (big > 0.002) {   // glare: nested gaussians give a steep, photographic falloff
        single(ox, oy, (24 + 150 * big) * gd, r, gg, b, 0.012 * big * fade);
        single(ox, oy, (14 + 60 * big) * gd, r, gg, b, 0.05 * big * fade);
        single(ox, oy, (8 + 22 * big) * gd, r, gg, b, 0.35 * big * fade);
      }
      if (disc > 0.01) single(ox, oy, (2.4 + 4.4 * big) * gd, r * 7, gg * 7, b * 7, disc * fade, 'disc');
      if (disc < 0.99) single(ox, oy, (4.5 + 2 * (1 - smooth((z - 1.2) / 1.2))) * gd, r, gg, b, (1 - disc) * fade * 1.4, 'star');
    }
  }
  /* keep the readouts legible over the bright web: a soft local shade under them (only where the web reaches) */
  const shade = smooth((z - 10.4) / 0.4);
  if (shade > 0.01) {
    for (const r of HUDR) {
      if (r.w <= 0) continue;
      ONE[0] = (r.x + r.w / 2) * gd; ONE[1] = (r.y + r.h / 2) * gd; ONE[2] = (r.w + 60) * 2.6 * gd; ONE[3] = 1; ONE[4] = 1; ONE[5] = 1; ONE[6] = 1.6 * shade;
      ONE9.set(ONE, 0); ONE9[7] = 0; ONE9[8] = clamp01((r.h + 60) / (r.w + 60)); g.smudges(ONE9, 1, { blend: 'dark' });
    }
  }
  g.end();

  /* lines, rings and labels on the overlay */
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, Wd, Hd);
  vectors(s);
}
// a galaxy a few pixels across still shows its light: a compact core and glow that hand over to the model as it grows
function compact(x, y, R, pa, tilt, a) {
  const k = smooth((26 - R / GD) / 22) * a;
  if (k <= 0.01) return;
  smudge(x, y, Math.max(2.6 * GD, R * 0.45), lut(5000), 1.4 * k, pa, Math.min(1, Math.cos(tilt) + 0.3));
  smudge(x, y, Math.max(5 * GD, R * 1.6), lut(5600), 0.14 * k, pa, Math.min(1, Math.cos(tilt) + 0.1));
  flushSmudges();
}
const HUDR = [];   // CSS px rectangles of the readout blocks, relative to the stage
function draw(s) { if (g && !g.isLost) drawGL(s); else if (!g) draw2D(s); }

function vectors(s) {
  const z = s2z(s), d = D, ox = SX(0), oy = SY(0), uni = smooth((z - 10.35) / 0.55);
  const cssPx = (ly) => (ly * sc) / d;
  /* the planets' orbits and Voyager 1 */
  if (z < 0.6) {
    const lab = V.lab;
    const orbit = (R, l1, l2, angDeg) => {
      const r = R * sc, rc = r / d, a = smooth((rc - 4) / 9);
      if (a <= 0.01 || r > 3 * Math.max(Wd, Hd)) return;
      ring(ox, oy, r, d, `rgba(${BONE},0.32)`, a);
      const la = a * smooth((rc - 34) / 26), an = rad(angDeg);
      label(ox + Math.cos(an) * r, oy + Math.sin(an) * r, l1, l2, la, Math.cos(an) >= 0 ? 1 : -1);
    };
    orbit(R_EARTH, "Earth's orbit", '8.3 light-minutes', lab > 0 ? -58 : -52);
    orbit(R_NEP, "Neptune's orbit", '4.2 light-hours', lab > 0 ? 58 : 40);
    // Earth itself, a speck on its orbit
    const er = R_EARTH * sc, ea = smooth((er / d - 6) / 10);
    if (ea > 0.01) { ctx.globalAlpha = 0.8 * ea; ctx.fillStyle = ENT.C.ice || '#a9c8ff'; ctx.beginPath(); ctx.arc(ox + Math.cos(rad(152)) * er, oy + Math.sin(rad(152)) * er, 1.6 * d, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    const vd = dir(V.voy), vx = ox + vd[0] * R_VOY * sc, vy = oy + vd[1] * R_VOY * sc, vr = (R_VOY * sc) / d;
    const va = smooth((vr - 4) / 10);
    if (va > 0.01 && onScreen(vx, vy, 60)) {
      glow(vx, vy, 7 * d, '255,138,74', 0.35 * va);
      ctx.globalAlpha = va; ctx.fillStyle = EMBER; ctx.beginPath(); ctx.arc(vx, vy, 2.1 * d, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      label(vx, vy, 'Voyager 1', '1 light-day from the Sun', va * smooth((vr - 30) / 30), vd[0] >= 0 ? 1 : -1);
    }
  }

  /* Alpha Centauri */
  if (z > 0.75 && z < 2.1) {
    const a = smooth((z - 0.85) / 0.2) * (1 - smooth((z - 1.5) / 0.35));
    const ax = SX(field.acen[0]), ay = SY(field.acen[1]);
    label(ax, ay, 'Alpha Centauri · 4.2 light-years', null, a, V.lab > 0 ? 1 : 1);
  }

  /* the afterglow's name */
  if (uni > 0.003) {
    const R = R_OBS * sc, w = Math.max(3 * d, R * 0.035);
    const la = smooth((z - 10.85) / 0.18);
    if (la > 0.01) {
      if (V.lab > 0) {
        ctx.font = FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.globalAlpha = 0.8 * la; ctx.fillStyle = `rgb(${CMB})`;
        ctx.fillText('The afterglow of the Big Bang', ox, oy + R + w + 8 * d); ctx.globalAlpha = 1;
      } else {
        const an = rad(26);
        label(ox + Math.cos(an) * (R + w * 0.6), oy + Math.sin(an) * (R + w * 0.6), 'The afterglow of the Big Bang', null, la, 1);
      }
    }
  }

  /* names */
  const yx = SX(youW[0]), yy = SY(youW[1]);
  if (z > 3.6 && z < 6.5) label(yx, yy, 'You are here', null, band(z, 3.75, 4.1, 5.4, 5.7), V.lab > 0 ? 1 : -1);
  if (z > 5.4 && z < 8.1) {
    const a = band(z, 5.7, 6.0, 7.15, 7.45);
    const gx = SX(mwW[0]), gy = SY(mwW[1]), off = Math.max(10 * d, cssPx(60000) * d);
    label(gx, gy + off, 'Milky Way', null, a, V.lab > 0 ? 1 : -1);
    const mx = SX(lg.m31[0]), my = SY(lg.m31[1]);
    if (onScreen(mx, my, 0)) label(mx, my - Math.max(10 * d, cssPx(80000) * d), 'Andromeda', null, a * smooth((z - 5.8) / 0.3), 1);
    const tx = SX(lg.tri[0]), ty = SY(lg.tri[1]);
    if (onScreen(tx, ty, 0)) label(tx, ty, 'Triangulum', null, a * smooth((z - 6.0) / 0.3), 1);
  }
  if (z > 7.7 && z < 9.9) {
    const a = band(z, 7.85, 8.2, 9.45, 9.85);
    const vx = SX(lan.virgo[0]), vy = SY(lan.virgo[1]);
    if (onScreen(vx, vy, 0)) label(vx, vy, 'Virgo Cluster', null, a, V.lab > 0 ? 1 : -1);
    const gx = SX(lan.ga[0]), gy = SY(lan.ga[1]);
    if (onScreen(gx, gy, 0)) label(gx, gy, 'Great Attractor', null, a * smooth((z - 8.3) / 0.3), 1);
  }

  /* you are here */
  const yr = smooth((z - 3.1) / 0.4);
  if (yr > 0.01) ring(yx, yy, 5.5 * d, 1.3 * d, EMBER, yr);
}

/* ---------------- HUD ---------------- */
const elScale = $('invScale'), elName = $('invName'), elStars = $('invStars'), elCount = $('invCount'), elVoy = $('invVoy'), elDot = $('invDot');
const elPan = $('invPan'), elPassed = $('invPassed'), elPace = $('invPace');
const elBarL = $('invBarL'), elBarLine = $('invBarLine'), elBarT1 = $('invBarT1');
const setText = (el, t) => { if (el._t !== t) { el._t = t; el.textContent = t; } };
const BARS = [];
[[LMIN, 'light-minute', [1, 2, 5, 10, 20, 30]], [LHOUR, 'light-hour', [1, 2, 5, 10, 20]], [LDAY, 'light-day', [1, 2, 5, 10, 20, 50, 100, 200]]]
  .forEach(([ly, name, steps]) => steps.forEach((k) => BARS.push([k * ly, `${k} ${name}${k === 1 ? '' : 's'}`])));
for (let e = 0; e <= 11; e++) for (const k of [1, 2, 5]) {
  const v = k * Math.pow(10, e);
  if (v > 2e11) break;
  const t = v < 1e6 ? `${commas(String(v))} light-year${v === 1 ? '' : 's'}` : v < 1e9 ? `${v / 1e6} million light-years` : `${v / 1e9} billion light-years`;
  BARS.push([v, t]);
}
let panOp = -1, passed = 0;
function hud(s) {
  const z = s2z(s), W = Math.pow(10, z), ph = phaseOf(s);
  setText(elScale, widthText(W));
  setText(elName, NAMES[ph]);
  const Ns = starsInView(z), str = Ns < 1000 ? String(Math.round(Ns)) : sigInt(Ns, 2), N = num(str);
  setText(elStars, str);
  setText(elCount, durText(N, false));
  setText(elVoy, durText((Math.min(W, 2 * R_OBS) / VOY_LY_PER_YEAR) * YEAR_S, true));
  // one dot =
  let dt = '';
  if (ph === 2) dt = 'One dot = 1 star';
  else if (ph === 3) { const r = Ns / Math.max(1, viewDots); dt = r < 1.5 ? 'One dot = 1 star' : `One dot ≈ ${countWords(r, 1)} stars`; }
  else if (ph === 4) dt = `One dot ≈ ${countWords(2e11 / (g && M.mw ? M.mw.count : galaxy.n), 1)} stars`;
  else if (ph === 5) dt = 'One dot = 1 galaxy';
  else if (ph === 6) dt = `One dot ≈ ${countWords(1e5 / lan.n, 2)} galaxies`;
  else if (ph === 7) {
    const L = web[webLevel < 0 ? 0 : webLevel], per = webLevel === 3 && g && M.web ? 2e12 / M.web.count : L.perDot;
    dt = `One dot ≈ ${countWords(per, 2)} galaxies`;
  }
  elDot.classList.toggle('inv-off', !dt);
  if (dt) setText(elDot, dt);
  // scale bar
  const pxPerLy = SMIN / D / W;
  let pick = BARS[0];
  for (const b of BARS) if (b[0] * pxPerLy <= 160) pick = b;
  const len = Math.max(1, pick[0] * pxPerLy);
  setText(elBarL, pick[1]);
  elBarLine.style.transform = `scaleX(${(len / 160).toFixed(4)})`;
  elBarT1.style.transform = `translateX(${(len - 1).toFixed(1)}px)`;
  // the count
  const op = Math.round(smooth((s - 2.8) / 0.12) * (1 - smooth((s - 6.2) / 0.3)) * 50) / 50;
  if (op !== panOp) { panOp = op; elPan.style.opacity = op; elPan.style.visibility = op === 0 ? 'hidden' : 'visible'; }
  passed = s <= 2.8 ? 0 : starsPassed(panP(s));
  setText(elPassed, ENT.fmtInt(passed));
}
/* the reader's own pace: stars passed per second over the last 2 seconds */
const paceT = [], paceX = [];
let paceRate = 0, lastPX = -1, lastMoveT = -1e9, lastPaceUI = 0;
function pace(now) {
  if (panOp <= 0) return;
  if (passed !== lastPX) { if (lastPX >= 0) lastMoveT = now; lastPX = passed; }
  paceT.push(now); paceX.push(passed);
  while (paceT.length > 2 && now - paceT[0] > 2000) { paceT.shift(); paceX.shift(); }
  const span = (now - paceT[0]) / 1000, dX = passed - paceX[0];
  if (now - lastMoveT < 250 && dX > 0 && span > 0.2) paceRate = dX / span;
  if (now - lastPaceUI < 250) return;
  lastPaceUI = now;
  if (paceRate <= 0) { setText(elPace, 'Keep scrolling.'); return; }
  const left = 2e11 - passed, sec = left / paceRate;
  setText(elPace, `At this pace, the rest of this galaxy takes ${durText(sec, false)} of scrolling.`);
}

/* ---------------- captions ---------------- */
const cards = [...$('invCards').children].map((el) => ({ el, s: +el.dataset.s, top: 0, h: 0, op: -1, cut: -1 }));
let fadeLine = 0, floorBar = 1e9, floorPan = 1e9;
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
  // captions fade before they reach the HUD above them and emerge from a soft edge above the scale bar (and the count)
  const stageTop = Math.max(0, Math.min(SMAX * SH, y - trackTop));
  const s = (y - trackTop) / SH;
  const po = smooth((s - 2.7) / 0.15) * (1 - smooth((s - 6.2) / 0.3));
  const floor = floorBar + (floorPan - floorBar) * po;
  for (const c of cards) {
    const rel = c.top - stageTop;
    if ((rel > SH + 40 || rel + c.h < -40) && c.op >= 0 && c.cut === 0) continue;
    let op = Math.round(clamp01((rel - fadeLine) / (phoneMQ.matches ? 50 : 70)) * 50) / 50;
    const vp = trackTop + c.top - y;
    const cut = Math.max(0, Math.min(c.h, Math.round(vp + c.h - floor)));
    if (cut >= c.h - 2) op = 0;
    if (op !== c.op) { c.op = op; c.el.style.opacity = op; c.el.style.visibility = op === 0 ? 'hidden' : ''; }
    if (cut !== c.cut) {
      c.cut = cut;
      const m = cut > 0 ? `linear-gradient(#000 ${c.h - cut - 36}px, transparent ${c.h - cut}px)` : '';
      c.el.style.webkitMaskImage = m; c.el.style.maskImage = m;
    }
  }
}

/* ---------------- layout ---------------- */
// everything placed relative to the Milky Way's centre (which moves once the GL galaxy model has chosen the Sun)
function worldNear() { lg = genLocalGroup(); if (g) { MC = genClouds(); DW = prepDwarfs(); } }
function setAnchors() { if (field) anchors = [[100, [field.Ptot, 0]], [Math.pow(10, 5.3), galaxy.gc], [Math.pow(10, 7.2), lg.centre], [1e9, lan.centre], [Math.pow(10, 11.05), [0, 0]]]; }

let SH = window.innerHeight, lastVW = 0, trackTop = 0;
function measureTrack() { trackTop = track.getBoundingClientRect().top + window.scrollY; }
function layout(force) {
  const vw = window.innerWidth, vh = window.innerHeight;
  if (force || vw !== lastVW || Math.abs(vh - SH) >= 120) { SH = vh; track.style.setProperty('--inv-h', `${SH}px`); }
  lastVW = vw;
  { const portrait = vh / vw > 1.3; KZ[5] = portrait ? 4.95 : 5.15; KZ[6] = portrait ? 5.1 : 5.3; } // tall screens: come in closer so the Milky Way fills the frame
  const dims = fit(cv); Wd = dims.w; Hd = dims.h; D = dims.d;
  CW = Wd / D; CH = Hd / D; SMIN = Math.min(Wd, Hd);
  const phone = phoneMQ.matches, tall = CH > CW * 1.15;
  V = tall ? V_TALL : V_WIDE;
  FX = Wd * (CW >= 900 ? 0.585 : 0.5); FY = Hd * (phone ? 0.44 : 0.5);
  SZ = [Math.max(1, Math.round(D)), Math.max(1.5, 1.5 * D), 2.2 * D];
  FONT = `${10.5 * D}px "IBM Plex Mono", ui-monospace, monospace`;
  const wk = `${tall}|${phone}`;
  if (wk !== worldKey) {
    worldKey = wk;
    galaxy = genGalaxy(phone ? 3500 : 7000);
    if (!g && !sprite) sprite = genSprite();
    if (g && M.mw) orientMW();
    lan = genLaniakea(g ? (SMALL ? 3200 : 8000) : 4000);
    const wf = g ? (SMALL ? 0.8 : 2) : phone ? 0.5 : 1;
    if (!web || web._f !== wf) { web = genWeb(wf); web._f = wf; }
    worldNear();
    if (g) { LANX = prepLan(); if (!BK) BK = genBackdrop(); }
  }
  const fk = `${Math.round(CW)}x${Math.round(CH)}|${FX / Wd}|${FY / Hd}|${wk}`;
  if (fk !== fieldKey) { fieldKey = fk; field = genField(); }
  setAnchors();
  // HUD geometry
  const st = stage.getBoundingClientRect();
  const side = $('invSide').getBoundingClientRect();
  if (!phone) elPan.style.top = `${Math.round(side.bottom - st.top + 22)}px`; else elPan.style.top = '';
  floorBar = $('invBar').getBoundingClientRect().top - st.top - 10;
  floorPan = phone ? elPan.getBoundingClientRect().top - st.top - 10 : floorBar;
  const cr = cards[0].el.getBoundingClientRect();
  fadeLine = 0;
  for (const el of [$('invScalebox'), $('invSide')]) {
    const r = el.getBoundingClientRect();
    if (r.right > cr.left && r.left < cr.right) fadeLine = Math.max(fadeLine, r.bottom - st.top);
  }
  fadeLine += 10;
  HUDR.length = 0;
  for (const el of phone ? [$('invTop')] : [$('invScalebox'), $('invSide')]) {
    const r = el.getBoundingClientRect();
    HUDR.push({ x: r.left - st.left, y: r.top - st.top, w: r.width, h: r.height });
  }
  layoutCards();
  measureTrack();
  lastS = NaN; lastY = NaN; dirty = true;
}

/* ---------------- frame loop ---------------- */
let lastS = NaN, lastY = NaN, dirty = true;
const curS = (y) => Math.max(0, Math.min(SMAX, (y - trackTop) / SH));
ENT.watch(track);
let tick = 0;
ENT.onFrame((dt) => {
  if (!ENT.isVisible(track)) return;
  dt = Math.min(dt, 0.1);
  clk += dt; tick += dt;
  const y = window.scrollY, s = curS(y), z = s2z(s);
  // gentle life: twinkle during the pan, the galaxies' slow turn (one turn in about four minutes); never under reduced motion
  const turning = !!g && z > 4.0 && z < 7.6;
  if (turning && !reduced) rotG += dt * (TAU / 240) * smooth((z - 4.3) / 0.7);
  const live = !reduced && ((s > 2.8 && s < 5) || turning);
  if (s !== lastS || dirty || (live && tick >= 1 / 30)) {
    tick = 0;
    const t0 = performance.now();
    draw(s); dirty = false;
    if (window.__invPerf) window.__invPerf.push(performance.now() - t0);
  }
  if (s !== lastS) { hud(s); lastS = s; }
  pace(performance.now());
  if (y !== lastY) { fadeCards(y); lastY = y; }
});
ENT.onResize(() => layout(false));
if ('ResizeObserver' in window) new ResizeObserver(() => { measureTrack(); lastY = NaN; dirty = true; }).observe(document.body);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => layout(true));
window.addEventListener('load', () => layout(true));

layout(true);
buildLater();
const s0 = curS(window.scrollY);
draw(s0); hud(s0); lastS = s0;
fadeCards(window.scrollY); lastY = window.scrollY;
})();
