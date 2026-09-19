# Asset credits

Every file under `public/assets/` is produced by `scripts/generate_real_art.py`
(see that file for exactly which manifest key comes from which source). Three
sources, no exceptions:

## Real art (CC0 / public domain, no attribution required)

Processed from Kenney.nl asset packs — cropped, resized, and in a few cases
recolored to fit this game's manifest sizes. Each pack's own bundled license
file confirms CC0 (Creative Commons Zero) / public domain, free for personal
and commercial use, credit appreciated but never required. Credited here
anyway as good practice:

- **Particle Pack** — effects/particle base textures (explosion glow layers,
  splash, muzzle flash, dust, spark, debris, droplet)
- **Platformer Art: Extended Tileset** — building facades
- **Tanks** — explosion animation frames
- **Game Icons** — crosshair, gravestone marker
- **UI Pack** — turn arrow, HUD panel, health bar frame

All by Kenney Vleugels, https://kenney.nl — donate at https://kenney.nl/donate
if you'd like to support the work.

## Procedural art (drawn by this project, `scripts/generate_real_art.py`)

Everything with no good free match: terrain ground (pebble dirt) and grass
cap, water, the sky backdrop, and the weapons the sprite sheet below has no
equivalent for - ninjaRope, sniperRifle, drill (held + projectile), plus
the shotgun and airstrikeRocket *projectiles* specifically (their held
sprites are cropped from the sheet - see below).

## Worm character and weapons

Sliced (and in the worm's case, transformed) from a supplied "Worms"-style
pixel-art sprite sheet (`public/assets/worm/worms_sprites.jpg`) rather than
drawn or sourced by this script from scratch:

- **Worm**: idle and walk frames are cropped directly from the sheet (the
  idle strip doubles as the in-game "walk" animation and the walk strip
  doubles as "jump" - see `src/assetManifest.ts`), and fall/death are
  derived from those crops by rotating and squashing them (see
  `gen_worm_fall`/`gen_worm_death` in `scripts/generate_real_art.py`).
- **Weapons**: bazooka (held + projectile), grenade, holyHandGrenade,
  dynamite, mine (held + projectile, one crop reused at two sizes for the
  last four - see `gen_weapon_icons_from_sheet`), airstrikeRocket (held
  only) and shotgun (held only) are cropped from the sheet's weapons row.

## Regenerating

`missing_texture.png` and anything else not listed above still comes from
`scripts/generate-placeholder-art.mjs` (the flat-color placeholder pipeline)
and is untouched by this script.

Re-running `python3 scripts/generate_real_art.py` from the repo root
regenerates every file above from scratch (deterministic — seeded random).
It expects the source Kenney packs unzipped under `/tmp/kenney_downloads/extracted/`
(not committed to this repo — re-download from the URLs above if regenerating
on a fresh machine) and the worm sprite sheet already present at
`public/assets/worm/worms_sprites.jpg`.
