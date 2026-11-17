(() => {
'use strict';
const ENT = window.ENT, $ = ENT.$, C = ENT.C, reduced = ENT.reduced;

/* ================= 08: a box that un-mixes itself ================= */
const box = (() => {
  const cv = $('aftCanvas'), ctx = cv.getContext('2d');
  const BUDGET_MS = 6;       // CPU spent on simulation per frame
  const DT = 0.00004;        // box seconds per step
  const VRMS = 1;            // root-mean-square speed, box widths per box second
  const FREEZE = 0.9;        // seconds the un-mixed state is held
  let N = 8, x, y, vx, vy, side, left, simT, events, inEvent;
  let freeze = 0, tint = 0, lastUI = 0, lastDraw = 0, dirty = true, shown = {};

  function init() {
    const rnd = ENT.mulberry32((Date.now() ^ (Math.random() * 4294967296)) >>> 0);
    x = new Float64Array(N); y = new Float64Array(N); vx = new Float64Array(N); vy = new Float64Array(N); side = new Uint8Array(N);
    left = 0;
    for (let i = 0; i < N; i++) {
      x[i] = rnd(); y[i] = rnd();
      const sp = VRMS * Math.sqrt(-Math.log(1 - rnd())), a = rnd() * Math.PI * 2; // Rayleigh speeds, as in a 2D gas
      vx[i] = Math.cos(a) * sp; vy[i] = Math.sin(a) * sp;
      side[i] = x[i] < 0.5 ? 1 : 0; left += side[i];
    }
    simT = 0; events = 0; inEvent = left === N; freeze = 0; tint = 0; dirty = true;
  }

  function steps(budgetMs) {
    const t0 = performance.now();
    for (;;) {
      for (let k = 0; k < 64; k++) {
        for (let i = 0; i < N; i++) {
          let px = x[i] + vx[i] * DT, py = y[i] + vy[i] * DT;
          if (px < 0) { px = -px; vx[i] = -vx[i]; } else if (px > 1) { px = 2 - px; vx[i] = -vx[i]; }
          if (py < 0) { py = -py; vy[i] = -vy[i]; } else if (py > 1) { py = 2 - py; vy[i] = -vy[i]; }
          x[i] = px; y[i] = py;
          const s = px < 0.5 ? 1 : 0;
          if (s !== side[i]) { side[i] = s; left += s ? 1 : -1; }
        }
        simT += DT;
        if (left === N) {
          if (!inEvent) { inEvent = true; events++; freeze = FREEZE; tint = reduced ? 1 : 0; return; }
        } else inEvent = false;
      }
      if (performance.now() - t0 >= budgetMs) return;
    }
  }

  function draw() {
    const { w, h, d } = ENT.fit(cv);
    ctx.fillStyle = C.panel; ctx.fillRect(0, 0, w, h);
    if (tint > 0) { ctx.globalAlpha = 0.10 * tint; ctx.fillStyle = C.ember; ctx.fillRect(0, 0, w / 2, h); ctx.globalAlpha = 1; }
    ctx.strokeStyle = C.dim; ctx.globalAlpha = 0.6; ctx.lineWidth = Math.max(1, d * 0.8);
    ctx.setLineDash([5 * d, 5 * d]); ctx.beginPath(); ctx.moveTo(Math.round(w / 2) + 0.5, 0); ctx.lineTo(Math.round(w / 2) + 0.5, h); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    let m2 = 0; for (let i = 0; i < N; i++) m2 += vx[i] * vx[i] + vy[i] * vy[i]; m2 = m2 / N || 1;
    const r = (w < 600 * d ? 4.5 : 5.5) * d, pad = r + d;
    for (let i = 0; i < N; i++) {
      const q = (vx[i] * vx[i] + vy[i] * vy[i]) / m2, c = ENT.blackbody(900 * Math.pow(14, Math.min(q, 3) / 3));
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.beginPath(); ctx.arc(pad + x[i] * (w - 2 * pad), pad + y[i] * (h - 2 * pad), r, 0, Math.PI * 2); ctx.fill();
    }
    if (freeze > 0) {
      ctx.fillStyle = C.bone; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `${Math.round((w < 600 * d ? 15 : 18) * d)}px "IBM Plex Mono", ui-monospace, monospace`;
      ctx.fillText('Un-mixed.', w * 0.75, h / 2);
    }
    dirty = false;
  }

  function fmtTime(s) {
    const sig2 = (v) => { if (v < 9.95) return v.toFixed(1); return ENT.fmtInt(v >= 100 ? Math.round(v / Math.pow(10, Math.floor(Math.log10(v)) - 1)) * Math.pow(10, Math.floor(Math.log10(v)) - 1) : Math.round(v)); };
    const U = [[1, 'second'], [60, 'minute'], [3600, 'hour'], [86400, 'day'], [31557600, 'year']];
    let k = 0; while (k < U.length - 1 && s >= U[k + 1][0] * 0.995) k++;
    const v = s / U[k][0], t = sig2(v);
    return `${t} ${U[k][1]}${t === '1.0' ? '' : 's'}`;
  }
  const set = (id, html) => { if (shown[id] !== html) { shown[id] = html; $(id).innerHTML = html; } };
  function ui(force) {
    const now = performance.now(); if (!force && now - lastUI < 120) return; lastUI = now;
    set('aftOdds', `1 in ${ENT.fmtInt(Math.pow(2, N))}`);
    set('aftTime', fmtTime(simT));
    set('aftCount', ENT.fmtInt(events));
    set('aftAvg', events ? fmtTime(simT / events) : 'not yet');
  }

  function reset() { init(); draw(); ui(true); }

  ENT.onFrame((dt) => {
    if (!ENT.isVisible(cv)) return;
    dt = Math.min(dt, 0.1);
    if (freeze > 0) {
      freeze -= dt;
      if (!reduced && tint < 1) tint = Math.min(1, tint + dt / 0.25);
      if (freeze <= 0) { freeze = 0; tint = 0; }
      draw(); ui(false); return;
    }
    steps(BUDGET_MS);
    if (freeze > 0) { draw(); ui(true); return; }
    if (reduced && !freeze) { const now = performance.now(); if (now - lastDraw < 450) { ui(false); return; } lastDraw = now; }
    draw(); ui(false);
  });

  $('aftN').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    N = +b.dataset.n; [...$('aftN').children].forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    reset();
  });
  $('aftRestart').addEventListener('click', reset);
  ENT.watch(cv);
  ENT.onResize(() => draw());
  reset();
})();

/* ================= the final button ================= */
(() => {
  const ENT = window.ENT, reduced = ENT.reduced;
  const btn = document.getElementById('aftWait');
  if (!btn) return;
  const LINES = [
    { html: '10<sup>100</sup> years.', hold: 2200 },
    { html: '10<sup>10<sup>50</sup></sup> years.', hold: 2200 },
    { html: '10<sup>10<sup>10<sup>56</sup></sup></sup> years.', hold: 2600 },
    { html: 'On one proposal, a patch of empty space eventually fluctuates into a new beginning: hot, dense, and improbably orderly.', hold: 4500, txt: true },
  ];
  let ov = null, timers = [], running = false, finished = false, onKey = null;

  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  function show(i) {
    const lines = ov.querySelectorAll('.aft-line');
    lines.forEach((l, k) => l.classList.toggle('on', k === i));
  }
  function finish(skipped) {
    if (finished) return; finished = true;
    timers.forEach(clearTimeout); timers = [];
    ov.classList.remove('in'); ov.classList.add('snap'); // still opaque
    ov.querySelectorAll('.aft-line').forEach((l) => l.classList.remove('on'));
    window.scrollTo(0, 0);
    if (ENT.restartHero) ENT.restartHero();
    const done = () => {
      if (onKey) document.removeEventListener('keydown', onKey, true);
      ov.remove(); ov = null; running = false; btn.disabled = false;
      document.body.setAttribute('tabindex', '-1'); document.body.focus({ preventScroll: true }); document.body.removeAttribute('tabindex');
      window.scrollTo(0, 0);
    };
    if (reduced) { done(); return; }
    void ov.offsetWidth;
    ov.classList.remove('snap'); ov.classList.add('out');
    later(done, 2450);
  }
  function start() {
    if (running) return; running = true; finished = false; btn.disabled = true;
    ov = document.createElement('div');
    ov.className = 'aft-ov' + (reduced ? ' cut' : ''); ov.tabIndex = -1;
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Waiting');
    ov.innerHTML = LINES.map((l) => `<div class="aft-line${l.txt ? ' txt' : ''}"><span>${l.html}</span></div>`).join('');
    document.body.appendChild(ov);
    ov.addEventListener('click', () => finish(true));
    ov.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    ov.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    onKey = (e) => { if (e.key === 'Tab') { e.preventDefault(); return; } e.preventDefault(); finish(true); };
    document.addEventListener('keydown', onKey, true);
    ov.focus({ preventScroll: true });
    void ov.offsetWidth;
    ov.classList.add('in');
    let t = reduced ? 0 : 1600 + 1200; // fade in, then hold empty
    if (reduced) { ov.style.opacity = '1'; t = 1200; }
    LINES.forEach((l, i) => { const at = t; later(() => show(i), at); t += l.hold; });
    later(() => finish(false), t);
  }
  btn.addEventListener('click', start);
})();
})();
