# Entropy, Run Backward

An interactive page about the second law of thermodynamics, from a box of gas to the heat death of the universe.

Live: https://neb882.github.io/entropy-run-backward/

Inspired by Daniel Temkin's [Entropy](https://entropy-lang.org/), a programming language in which data decays as it is used.

## What's in it

- A bit-reversible gas simulation (integer molecular dynamics after Levesque & Verlet) that counts its own entropy, S = k ln W.
- Two identical boxes run backward in time: one exactly, one with an error as small as 10⁻¹⁵ of the box.
- A sentence that decays under thermal noise, and the minimum heat it costs to repair it (Landauer's limit).
- Earth's photon budget: one visible photon in, about twenty infrared photons out.
- What there is: a scroll-driven pull-back from the Sun and Voyager 1 to the whole observable universe, ending on the number of stars in it.
- The entropy budget of the observable universe on a log scale, with a black hole calculator (entropy, temperature, lifetime).
- The descent: a scroll-driven journey from now to the heat death, about 10¹⁰⁰ years on. The star count drains as you go, one carbon atom is followed the whole way, and the proton-decay question is shown as a fork.
- After the end: a box that un-mixes itself by chance, Boltzmann brains, and a last button.

## Layout

- `index.html` is the built, self-contained page that GitHub Pages serves. Its only outside dependency is two Google Fonts.
- `src/base.html` holds the shared styles, the first four experiments and the closing sections.
- `src/inventory.*`, `src/ledger.*`, `src/descent.*` and `src/after*` are the modules, each as HTML, CSS and JS fragments.
- `python3 build.py` inlines the modules into `index.html`.

## Sources

Egan & Lineweaver (2010), Adams & Laughlin (1997), Dyson (1979), Dyson, Kleban & Susskind (2002), Krauss & Scherrer (2007), Sawala et al. (2025), Boddy, Carroll & Pollack (2014), Krauss & Starkman (1999), Carroll & Chen (2004), Tully et al. (2014), Conselice et al. (2016), Landauer (1961). Full notes are in the page footer.
