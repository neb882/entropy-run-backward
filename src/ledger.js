(() => {
'use strict';
const { $, MINUS, neg } = window.ENT;
const MSUN = 1.989e30, SKY = 2.725;
const PRESETS = [3.003e-6, 1, 4.3e6, 6.5e9, 6.6e10];
const PLOG = PRESETS.map((m) => Math.round(Math.log10(m) * 100) / 100);
const slider = $('ledMass'), btns = [...$('ledPresets').children];
let preset = 1;

/* a x 10^b with d decimals; plain numbers between 0.01 and 1000 */
function f(x, d = 1) {
  if (x === 0) return '0';
  let e = Math.floor(Math.log10(x)), m = x / Math.pow(10, e);
  if (+m.toFixed(d) >= 10) { m /= 10; e += 1; }
  if (e >= -2 && e <= 3) return (+x.toPrecision(d + 1)).toLocaleString('en-US', { maximumFractionDigits: 6 });
  return `${m.toFixed(d)} × 10<sup>${neg(e)}</sup>`;
}
/* ENT.sci-style but always a x 10^b (years, entropy) */
function g(x, d = 1) {
  let e = Math.floor(Math.log10(x)), m = x / Math.pow(10, e);
  if (+m.toFixed(d) >= 10) { m /= 10; e += 1; }
  return `${m.toFixed(d)} × 10<sup>${neg(e)}</sup>`;
}
function width(m) {
  const km = 5.906 * m;
  if (km < 1e-3) return `${f(km * 1e6)} <small>mm</small>`;
  if (km < 1) return `${f(km * 1e3)} <small>m</small>`;
  if (km < 1e7) return `${f(km)} <small>km</small>`;
  return `${f(km / 1.496e8)} <small>au</small>`;
}
function wait(T) { /* years from now until the sky is colder than the hole */
  const a = SKY / T, k = Math.sqrt(0.69 / 0.31);
  const x = a > 1e6 ? Math.log(2 * k) + 1.5 * Math.log(a) : Math.asinh(k * Math.pow(a, 1.5));
  const N = (x / (1.5 * Math.sqrt(0.69))) * 14.443e9 - 13.79e9;
  if (N < 1e9) return `about ${(+(N / 1e6).toPrecision(2)).toLocaleString('en-US')} million`;
  return `about ${(+(N / 1e9).toPrecision(2)).toLocaleString('en-US')} billion`;
}
function render(m, text) {
  const T = 6.169e-8 / m, t = 2.097e67 * m * m * m;
  $('ledM').innerHTML = `${f(m)} <small>${m === 1 ? 'solar mass' : 'solar masses'}</small>`;
  $('ledMkg').innerHTML = `${g(m * MSUN, 2)} kg`;
  $('ledW').innerHTML = width(m);
  $('ledS').innerHTML = g(1.049e77 * m * m);
  $('ledT').innerHTML = `${f(T)} <small>K</small>`;
  const hot = T > SKY;
  $('ledTsub').textContent = hot ? "hotter than today's sky" : "colder than today's sky";
  $('ledE').innerHTML = t < 1e6 ? `${f(t)} <small>years</small>` : `${g(t)} <small>years</small>`;
  $('ledEsub').textContent = hot ? 'shrinking already' : `cannot start for ${wait(T)} years: it must wait for the sky to cool below it`;
  slider.setAttribute('aria-valuetext', `${text} solar masses`);
}
function press(i) { preset = i; btns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i))); }

btns.forEach((b, i) => b.addEventListener('click', () => {
  press(i); slider.value = PLOG[i]; render(PRESETS[i], (+PRESETS[i].toPrecision(3)).toString());
}));
slider.addEventListener('input', () => {
  const v = +slider.value, near = PLOG.findIndex((p) => Math.abs(p - v) <= 0.02);
  if (near >= 0) { press(near); slider.value = PLOG[near]; render(PRESETS[near], (+PRESETS[near].toPrecision(3)).toString()); }
  else { press(-1); const m = Math.pow(10, v); render(m, m.toPrecision(3)); }
});
render(1, '1');
})();
