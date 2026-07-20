# Notices

Codex Dream Skin Studio is an **unofficial** customization project and is **not affiliated with, endorsed by, or sponsored by OpenAI**.

## Software license

The MIT License in `LICENSE` applies to the **software source code** in this repository (scripts, CSS, injectors, docs that describe the software, and the abstract demo asset generated for this repo).

It does **not** grant rights to:

- OpenAI or Codex trademarks, product names, logos, or trade dress
- Official Codex / ChatGPT application binaries, `.app` bundles, or `app.asar`
- Any user-supplied images or third-party artwork you drop into a theme
- Character likenesses, franchise art, or celebrity imagery

## Demo artwork

`assets/portal-hero.png` is original abstract geometric art generated for this open-source repository (no characters). Replace it with your own image before shipping a branded theme to customers.

## Concept-direction preset artwork

The wallpapers in these preset directories are newly generated continuous background scenes based on broad written directions such as palette, lighting, atmosphere, and layout safety:

- `preset-rose-reverie`
- `preset-fortune-at-work`
- `preset-coral-horizon`
- `preset-sage-daylight`
- `preset-spark-studio`
- `preset-cosmic-violet`
- `preset-aqua-resonance`
- `preset-midnight-gold`

They do not reuse pixels from the UI concept screenshots. Human and virtual-singer subjects are original fictional adults. Themes with realistic styling use back views, masks, or silhouettes so no identifiable facial likeness is present. No celebrity identity, real-person name, franchise character, signature costume, readable text, logo, or interface element is intentionally reproduced. The concept screenshots themselves are not runtime assets and must not be imported as wallpapers.

The retired named-person preset is not bundled, displayed, or used as a default theme. Existing local installations that still reference its former ID are migrated to `preset-rose-reverie` without exposing the retired artwork in the theme library.

## Runtime

Dream Skin uses a Rust-native local CDP runtime. It does not redistribute, require, or execute Node.js at runtime.

## Security model

Themes are applied through Chromium DevTools Protocol on **loopback only**. While a themed session is running, treat the local debugging port as sensitive: do not run untrusted local software that could attach to it. Use the Restore launcher to tear down the themed session and debugging port.
