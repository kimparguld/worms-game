# Asset credits

Every file under `public/assets/` is produced by `scripts/generate_real_art.py`
(see that file for exactly which manifest key comes from which source). Two
sources, no exceptions:

## Real art (CC0 / public domain, no attribution required)

Processed from Kenney.nl asset packs — cropped, resized, and in a few cases
recolored to fit this game's manifest sizes. Each pack's own bundled license
file confirms CC0 (Creative Commons Zero) / public domain, free for personal
and commercial use, credit appreciated but never required. Credited here
anyway as good practice:

- **Particle Pack** — effects/particle base textures (explosion glow layers,
  splash, muzzle flash, dust, spark, debris, droplet)
- **Platformer Art: Extended Tileset** — terrain ground and building facades
- **Tanks** — explosion animation frames
- **Game Icons** — crosshair, gravestone marker
- **UI Pack** — turn arrow, HUD panel, health bar frame

All by Kenney Vleugels, https://kenney.nl — donate at https://kenney.nl/donate
if you'd like to support the work.

## Procedural art (drawn by this project, `scripts/generate_real_art.py`)

Everything with no good free match: the worm character (all animation
states), all 10 weapons (held + projectile — kept as one internally
consistent hand-drawn set rather than mixing in a differently-styled real
sprite for just one or two of them), water, and the sky backdrop.

## Regenerating

`missing_texture.png` and anything else not listed above still comes from
`scripts/generate-placeholder-art.mjs` (the flat-color placeholder pipeline)
and is untouched by this script.

Re-running `python3 scripts/generate_real_art.py` from the repo root
regenerates every file above from scratch (deterministic — seeded random).
It expects the source Kenney packs unzipped under `/tmp/kenney_downloads/extracted/`
(not committed to this repo — re-download from the URLs above if regenerating
on a fresh machine).
