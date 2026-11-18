# Entropy, Run Backward

A timeline of the deep future, as a scroll-driven interactive film: everything there is, what becomes of it, and what might come after.

Live: https://neb882.github.io/entropy-run-backward/

Scroll, or press Play. About six minutes.

## The three acts

1. **What there is.** The view pulls back from the Sun and Voyager 1, ten times wider at each step, through the nearest stars, the Milky Way, the Local Group, the Laniakea supercluster and the cosmic web, until the whole observable universe is on screen. It ends on the number of stars in it.
2. **What becomes of it.** Time runs forward on a logarithmic ruler from today to about 10¹⁰⁸ years. The star count drains, the galaxy merges, reddens and goes dark, one carbon atom is followed to its end, and for sixty factors of ten the only thing left is a black hole.
3. **What might come after.** The clock switches to exponents of exponents. Small accidents of order flicker in the void, then a Boltzmann brain, then, on Carroll and Chen's proposal, a new inflating beginning. This act is speculation and says so.

A separate Notes view (linked from the title and the end card) holds the physics behind it as interactive experiments, plus the sources: a reversible gas that counts its own entropy, the same gas run backward with and without a tiny error, a sentence that decays under thermal noise, Earth's photon budget, the entropy budget of the universe with a black hole calculator, and a box that un-mixes itself by chance.

Inspired by Daniel Temkin's [Entropy](https://entropy-lang.org/), a programming language in which data decays as it is used.

## Layout

- `index.html` is the built, self-contained page that GitHub Pages serves. Its only outside dependency is two Google Fonts.
- `src/base.html` is the shell: shared styles, the title card, autoplay, the Notes view and its first four experiments.
- `src/gfx.js` is a small WebGL2 renderer (soft point sprites, dust, HDR bloom, tone mapping, lensing). `src/sky.js` holds the shared galaxy and cosmic-web models.
- `src/inventory.*`, `src/descent.*` and `src/wait.*` are the three acts. `src/ledger.*` and `src/after.*` belong to the Notes view.
- `demo/gfx_demo.html` is a standalone test page for the renderer (open it from a local web server or directly from disk).
- `python3 build.py` inlines everything into `index.html`.

Without WebGL2 the film falls back to a plainer Canvas 2D rendering.

## Sources

Egan & Lineweaver (2010), Adams & Laughlin (1997), Dyson (1979), Dyson, Kleban & Susskind (2002), Krauss & Scherrer (2007), Krauss & Starkman (1999), Carroll & Chen (2004), Sawala et al. (2025), Boddy, Carroll & Pollack (2014), Tully et al. (2014), Conselice et al. (2016), Landauer (1961). Full notes are in the page's Notes view.
