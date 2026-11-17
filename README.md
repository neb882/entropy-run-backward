# Entropy, Run Backward

An interactive page about the second law of thermodynamics, from a box of gas to the heat death of the universe.

Live: https://neb882.github.io/entropy-run-backward/

Inspired by Daniel Temkin's [Entropy](https://entropy-lang.org/), a programming language in which data decays as it is used.

## What's in it

- A bit-reversible gas simulation (integer molecular dynamics after Levesque & Verlet) that counts its own entropy, S = k ln W.
- Two identical boxes run backward in time: one exactly, one with an error as small as 10⁻¹⁵ of the box.
- A sentence that decays under thermal noise, and the minimum heat it costs to repair it (Landauer's limit).
- Earth's photon budget: one visible photon in, about twenty infrared photons out.
- The far future of the universe, out to the evaporation of the last black holes.

Everything is one self-contained `index.html` with no dependencies beyond two Google Fonts.

## Sources

Egan & Lineweaver (2010), Adams & Laughlin (1997), Dyson (1979), Dyson, Kleban & Susskind (2002), Krauss & Scherrer (2007), Landauer (1961). Full notes are in the page footer.
