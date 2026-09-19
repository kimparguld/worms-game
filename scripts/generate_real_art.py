#!/usr/bin/env python3
"""One-time art generation: produces the final PNGs at every path the asset
manifest (src/assetManifest.ts) declares, overwriting the flat-color
placeholders the placeholder generator wrote there.

Two sources, per asset:

1. Real, CC0-licensed art from Kenney.nl (Particle Pack, Platformer Art
   Extended Tileset, Tanks, UI Pack, Game Icons - each pack's own bundled
   license file confirms CC0 / public domain, no attribution required),
   downloaded to KENNEY_SRC below and processed (cropped/resized/recolored)
   to the manifest's exact declared dimensions with Pillow.
2. Procedural pixel art drawn with art_lib.py, for everything with no good
   free match: the worm character (all animation states), all 10 weapons
   (held + projectile - kept as one internally consistent hand-drawn set
   rather than mixing in the one Kenney mine sprite that would otherwise
   fit, since a single differently-styled weapon among nine drawn ones
   would look worse than a consistent set), water, and the sky backdrop.

Run from the repo root: python3 scripts/generate_real_art.py
Requires Pillow (already installed locally); not part of the app's own
build/dev dependency chain, since this only ever runs once, by hand, to
produce committed PNG files - the generate-placeholder-art.mjs pipeline it
supplements stays dependency-free by design.
"""

import math
import os
import random
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from art_lib import (
    canvas,
    composite,
    draw_arc,
    draw_circle,
    draw_ellipse,
    draw_line,
    draw_polygon,
    draw_rect,
    draw_rounded_rect,
    fade,
    rgba,
    save,
    save_frames_as_strip,
)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(REPO_ROOT, "public")
KENNEY_SRC = "/tmp/kenney_downloads/extracted"

random.seed(1234)  # deterministic output across re-runs


def out(rel_path):
    path = os.path.join(PUBLIC, rel_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


# ---------------------------------------------------------------------------
# Real-art processing (Kenney.nl, CC0)
# ---------------------------------------------------------------------------


def load(pack, *parts):
    return Image.open(os.path.join(KENNEY_SRC, pack, *parts)).convert("RGBA")


def boost_alpha(img, target_max=255):
    """Linearly rescale the alpha channel so its current peak becomes
    target_max. Kenney's particle-pack "Transparent" textures are soft
    glow/light gradients meant for many overlapping, additively-blended
    instances in a real particle system - their peak alpha is often well
    under 50%, which reads as near-invisible for a single small sprite
    used at normal opacity (this project's particle emitters scale/tint
    these but don't otherwise compensate for a low-alpha source)."""
    r, g, b, a = img.split()
    hist = a.histogram()
    peak = max(i for i, count in enumerate(hist) if count > 0)
    if peak == 0:
        return img
    lut = [min(255, round(v * target_max / peak)) for v in range(256)]
    a = a.point(lut)
    return Image.merge("RGBA", (r, g, b, a))


def tile_to_size(tile, w, h, tile_size=64):
    """Resize `tile` to tile_size x tile_size and repeat it to fill w x h."""
    tile = tile.resize((tile_size, tile_size), Image.NEAREST)
    result = Image.new("RGBA", (w, h))
    for y in range(0, h, tile_size):
        for x in range(0, w, tile_size):
            result.paste(tile, (x, y))
    return result


def recolor_flat(img, hex_color):
    """Replace every non-transparent pixel's RGB with hex_color, keep alpha."""
    r, g, b = (hex_color >> 16) & 0xFF, (hex_color >> 8) & 0xFF, hex_color & 0xFF
    img = img.convert("RGBA")
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            pr, pg, pb, pa = px[x, y]
            if pa > 0:
                px[x, y] = (r, g, b, pa)
    return img


def gen_terrain():
    # "HalfXMid" tiles are solid only in their top half (they're meant for
    # stacking at a boundary row, not tiling as a fill) - confirmed by
    # inspecting the alpha channel directly, which showed exactly the
    # horizontal banding that using them here produced. "slice21_21.png" is
    # confirmed fully opaque (>99.9% of pixels) in all four of these
    # sub-packs, so it tiles as a genuine solid fill with no transparent
    # bands.
    ground = tile_to_size(load("platformer-tileset", "PNG Dirt", "slice21_21.png"), 512, 512)
    save(ground, out("assets/terrain/ground.png"))

    castle = tile_to_size(load("platformer-tileset", "PNG Castle", "slice21_21.png"), 256, 512)
    save(castle, out("assets/terrain/building_1.png"))

    metal = tile_to_size(load("platformer-tileset", "PNG Metal", "slice21_21.png"), 256, 512)
    save(metal, out("assets/terrain/building_2.png"))

    choco = tile_to_size(load("platformer-tileset", "PNG Choco", "slice21_21.png"), 256, 512)
    save(choco, out("assets/terrain/building_3.png"))


def gen_effects_from_real_art():
    # fx_explosion: 7 frames, 64x64 - tanks pack's explosion sequence reads
    # as an expanding fireball from directly overhead, which still works
    # fine viewed from the side (explosions are roughly radially symmetric).
    frames = []
    for i in [1, 2, 3, 4, 6, 8, 10]:  # 7 frames spread across the 12-frame sequence
        f = load("tanks", "PNG", "Default size", f"tank_explosion{i}.png")
        f = f.resize((64, 64), Image.LANCZOS)
        frames.append(f)
    save_frames_as_strip(frames, out("assets/effects/explosion.png"))

    # fx_splash: 4 frames, 32x32 - particle-pack's transparent circle series
    # reads as an expanding ring, tinted toward pale blue for water.
    frames = []
    for i in [1, 2, 3, 5]:
        f = load("particle-pack", "PNG (Transparent)", f"circle_0{i}.png")
        f = f.resize((32, 32), Image.LANCZOS)
        frames.append(f)
    save_frames_as_strip(frames, out("assets/effects/splash.png"))

    # fx_muzzle: 3-frame particle-variety sheet (random frame per spawned
    # particle, not an animation) - particle-pack's muzzle flash frames.
    frames = []
    for name in ["muzzle_01.png", "muzzle_02.png", "flare_01.png"]:
        f = load("particle-pack", "PNG (Transparent)", name)
        f = f.resize((16, 16), Image.LANCZOS)
        frames.append(f)
    save_frames_as_strip(frames, out("assets/effects/muzzle.png"))

    # fx_dust: 3-frame particle-variety sheet - dirt puff frames. Boosted:
    # see boost_alpha's docstring - these source textures peak well under
    # full opacity by design, too faint at this size without it.
    # Boost AFTER resizing, not before: these source textures have a tiny,
    # near-opaque core within a much larger soft falloff. Boosting the
    # full-size original (already ~255 at that pinpoint core) is a no-op,
    # and then downscaling with Lanczos resampling blends that pinpoint
    # core into its huge faint surroundings, diluting it right back down -
    # the boost has to correct the *resized* image's own diluted peak.
    frames = []
    for name in ["dirt_01.png", "dirt_02.png", "dirt_03.png"]:
        f = load("particle-pack", "PNG (Transparent)", name).resize((12, 12), Image.LANCZOS)
        frames.append(boost_alpha(f))
    save_frames_as_strip(frames, out("assets/effects/dust.png"))

    # Particle base textures - all boosted post-resize, same reasoning.
    spark = load("particle-pack", "PNG (Transparent)", "spark_01.png" if os.path.exists(
        os.path.join(KENNEY_SRC, "particle-pack", "PNG (Transparent)", "spark_01.png")) else "flare_01.png")
    save(boost_alpha(spark.resize((8, 8), Image.LANCZOS)), out("assets/particles/spark.png"))

    debris = load("particle-pack", "PNG (Transparent)", "dirt_02.png").resize((8, 8), Image.LANCZOS)
    save(boost_alpha(debris), out("assets/particles/debris.png"))

    droplet = load("particle-pack", "PNG (Transparent)", "circle_04.png").resize((8, 8), Image.LANCZOS)
    save(boost_alpha(droplet), out("assets/particles/droplet.png"))


def gen_misc_and_hud_from_real_art():
    crosshair = load("game-icons", "PNG", "White", "2x", "target.png")
    crosshair = recolor_flat(crosshair, 0xFFD966)
    save(crosshair.resize((10, 10), Image.LANCZOS), out("assets/hud/crosshair.png"))

    # "cross.png" in this icon set is a UI close/cancel "X" glyph, not a
    # crucifix - confirmed by looking at the rendered output, not just the
    # filename. "plus.png" (a "+") reads correctly as a grave marker cross.
    grave = load("game-icons", "PNG", "White", "2x", "plus.png")
    grave = recolor_flat(grave, 0x9CA2A8)
    save(grave.resize((16, 16), Image.LANCZOS), out("assets/misc/gravestone.png"))

    arrow = load("ui-pack", "PNG", "Grey", "Default", "arrow_decorative_n.png")
    arrow = recolor_flat(arrow, 0xFFD966)
    save(arrow.resize((26, 30), Image.LANCZOS), out("assets/misc/turn_arrow.png"))

    panel = load("ui-pack", "PNG", "Blue", "Default", "button_rectangle_depth_flat.png")
    panel = recolor_flat(panel, 0x16213F)
    save(panel.resize((32, 32), Image.LANCZOS), out("assets/hud/panel.png"))

    frame = load("ui-pack", "PNG", "Grey", "Default", "button_rectangle_border.png")
    save(frame.resize((24, 16), Image.LANCZOS), out("assets/hud/health_bar_frame.png"))


# ---------------------------------------------------------------------------
# Procedural art: worm character
# ---------------------------------------------------------------------------

BODY = 0xD99578
BODY_SHADE = 0x8F4E3F
BODY_HIGHLIGHT = 0xF7C7AD
SOFT_LINE = 0x5F3835

SEGMENTS = [(21, 0, 7.5), (14, 1, 6), (8, 2, 4.5)]  # (dx from head, wave-phase index, radius)
HEAD_R = 9


def draw_worm_body(canvas_w, canvas_h, head_x, head_y, wave_amp, wave_phase, tilt_deg, squash):
    img = canvas(canvas_w, canvas_h)
    cx, cy = canvas_w / 2, canvas_h / 2
    angle = math.radians(tilt_deg)
    cos_a, sin_a = math.cos(angle), math.sin(angle)

    def place(dx, dy):
        # rotate (dx, dy) around origin, apply squash on the rotated y axis, then offset to head position
        rx = dx * cos_a - dy * sin_a
        ry = (dx * sin_a + dy * cos_a) * squash
        return head_x + rx, head_y + ry

    # Tail segments, back-to-front so each overlaps under the one ahead
    for dx, phase_i, r in reversed(SEGMENTS):
        wobble = math.sin(wave_phase + phase_i * 1.3) * wave_amp
        sx, sy = place(-dx, 2 + wobble)
        draw_circle(img, sx, sy + 1.5, r * 1.05, fade(rgba(0x000000), 0.18))
        draw_circle(img, sx, sy, r, rgba(BODY))
        draw_ellipse(img, (sx - r, sy, sx + r, sy + r * 0.7), fade(rgba(BODY_SHADE), 0.6))
        draw_ellipse(img, (sx - r * 0.4, sy - r * 0.5, sx + r * 0.4, sy), fade(rgba(BODY_HIGHLIGHT), 0.35))

    # Back arm nub
    bx, by = place(-12, 3)
    draw_circle(img, bx, by, 4, rgba(BODY))

    # Head
    hx, hy = place(0, 0)
    draw_circle(img, hx + 1.4, hy + 1.6, HEAD_R * 1.03, fade(rgba(0x000000), 0.18))
    draw_circle(img, hx, hy, HEAD_R, rgba(BODY))
    draw_ellipse(img, (hx - HEAD_R, hy + 2, hx + HEAD_R, hy + HEAD_R), fade(rgba(BODY_SHADE), 0.55))
    draw_ellipse(img, (hx - HEAD_R * 0.6, hy - HEAD_R * 0.7, hx - HEAD_R * 0.05, hy - HEAD_R * 0.1),
                 fade(rgba(BODY_HIGHLIGHT), 0.5))

    # Freckles (deterministic-looking scatter, seeded once at module import)
    for fx, fy, fr in [(-3, -3, 1.2), (2, -4, 1.0), (4, 1, 1.1), (-5, 1, 0.9)]:
        draw_circle(img, hx + fx, hy + fy, fr, fade(rgba(BODY_SHADE), 0.7))

    # Eyes
    ex = hx + 3
    for off in (-3, 4):
        draw_circle(img, ex + off, hy - 2, 3.4, rgba(0xFFFFFF))
        draw_circle(img, ex + off + 1, hy - 2, 1.6, rgba(0x1C1C1C))

    # Eyebrows
    draw_line(img, [(ex - 6, hy - 6), (ex - 1, hy - 7.5)], 1.6, fade(rgba(SOFT_LINE), 0.8))
    draw_line(img, [(ex + 2, hy - 7.5), (ex + 7, hy - 6)], 1.6, fade(rgba(SOFT_LINE), 0.8))

    # Smile
    draw_arc(img, (ex - 3, hy - 1, ex + 5, hy + 6), 20, 160, 1.6, fade(rgba(0x8A4A4A), 0.85))

    # Front arm (drawn last so it sits over the head/body join)
    hand_x, hand_y = place(11, 2)
    draw_line(img, [(hx + 3, hy + 3), (hand_x, hand_y)], 5, rgba(BODY))
    draw_circle(img, hand_x, hand_y, 3.6, rgba(BODY))

    return img


def gen_worm_idle():
    frames = []
    for i in range(3):
        phase = i * 1.3
        img = draw_worm_body(48, 48, 26, 26, wave_amp=0.8, wave_phase=phase, tilt_deg=-6, squash=1.0)
        frames.append(img)
    save_frames_as_strip(frames, out("assets/worm/idle.png"))


def gen_worm_walk():
    frames = []
    for i in range(4):
        phase = i * (math.pi / 2)
        img = draw_worm_body(48, 48, 27, 25, wave_amp=3.2, wave_phase=phase, tilt_deg=-4, squash=1.0)
        frames.append(img)
    save_frames_as_strip(frames, out("assets/worm/walk.png"))


def gen_worm_jump():
    img = draw_worm_body(48, 48, 27, 22, wave_amp=0, wave_phase=0, tilt_deg=-24, squash=0.92)
    save_frames_as_strip([img], out("assets/worm/jump.png"))


def gen_worm_fall():
    img = draw_worm_body(48, 48, 27, 26, wave_amp=0, wave_phase=0, tilt_deg=14, squash=1.08)
    save_frames_as_strip([img], out("assets/worm/fall.png"))


def gen_worm_death():
    frames = []
    for i in range(5):
        t = i / 4
        tilt = t * 260
        squash = 1 + math.sin(t * math.pi * 3) * 0.14
        img = draw_worm_body(48, 48, 26, 26, wave_amp=1.5, wave_phase=t * 6, tilt_deg=tilt, squash=squash)
        frames.append(img)
    save_frames_as_strip(frames, out("assets/worm/death.png"))


def gen_worm_headband():
    # A wide horizontal cloth band across the canvas (the head it wraps sits
    # behind/under this in WormRenderer), with a small triangular tail
    # flapping off one edge - tinted per-team at runtime via setTint, so
    # this stays plain white/flat, no shading baked in.
    img = canvas(16, 16)
    draw_rounded_rect(img, (0, 5, 16, 11), 2.5, rgba(0xFFFFFF))
    draw_polygon(img, [(0, 6), (-4, 3), (-4, 8), (0, 10)], rgba(0xFFFFFF))
    draw_rounded_rect(img, (1, 6, 15, 7.5), 1, fade(rgba(0xFFFFFF), 0.45))
    save(img, out("assets/worm/headband.png"))


def gen_rope_hook():
    # A simple J-shaped grapple hook: a shank down from the rope, curling
    # into a point - drawn bold enough to read at 12x12.
    img = canvas(12, 12)
    draw_line(img, [(6, 0), (6, 6)], 2.2, rgba(0xC49A55))
    draw_arc(img, (2, 4, 10, 11), 20, 200, 2.6, rgba(0x9A9AA2))
    draw_circle(img, 3, 6.5, 1.3, rgba(0xDEE2E6))
    save(img, out("assets/misc/rope_hook.png"))


# ---------------------------------------------------------------------------
# Procedural art: weapons (all 10, one consistent hand-drawn set)
# ---------------------------------------------------------------------------


def new_held():
    return canvas(32, 32)


def new_proj(w=24, h=24):
    return canvas(w, h)


def gen_bazooka():
    held = new_held()
    hx, hy, ex, ey = 6, 22, 27, 10
    draw_line(held, [(hx, hy), (ex, ey)], 8, rgba(0x565964))
    draw_line(held, [(hx - 1, hy - 2), (ex - 1, ey - 2)], 2, fade(rgba(0xAEB5C2), 0.6))
    draw_circle(held, ex, ey, 5.5, rgba(0x3A3A42))
    draw_circle(held, ex - 2, ey + 1, 3, rgba(0xD6452F))
    draw_rounded_rect(held, (hx - 4, hy - 3, hx + 4, hy + 5), 2, rgba(0x30323A))
    save(held, out("assets/weapons/bazooka_held.png"))

    proj = new_proj(40, 16)
    cy = 8
    draw_ellipse(proj, (2, cy - 5, 30, cy + 5), rgba(0x8A2F20))
    draw_ellipse(proj, (4, cy - 3.5, 28, cy + 3.5), rgba(0xFF5722))
    draw_polygon(proj, [(30, cy - 5), (30, cy + 5), (39, cy)], rgba(0xF2F5F7))
    draw_polygon(proj, [(4, cy - 5), (-4, cy - 9), (6, cy - 3)], rgba(0x45505A))
    draw_polygon(proj, [(4, cy + 5), (-4, cy + 9), (6, cy + 3)], rgba(0x45505A))
    draw_ellipse(proj, (10, cy - 2, 20, cy), fade(rgba(0xFFFFFF), 0.4))
    save(proj, out("assets/weapons/bazooka_projectile.png"))


def gen_grenade():
    def body(img, cx, cy, r):
        draw_ellipse(img, (cx - r, cy + r * 0.3, cx + r, cy + r * 0.9), fade(rgba(0x203719), 0.25))
        draw_circle(img, cx, cy, r, rgba(0x4F9A3A))
        draw_line(img, [(cx - r * 0.7, cy), (cx + r * 0.7, cy)], 1, fade(rgba(0x2E4A1C), 0.6))
        draw_line(img, [(cx, cy - r * 0.7), (cx, cy + r * 0.7)], 1, fade(rgba(0x2E4A1C), 0.6))
        draw_circle(img, cx - r * 0.3, cy - r * 0.3, r * 0.3, fade(rgba(0xFFFFFF), 0.3))
        draw_line(img, [(cx, cy - r), (cx, cy - r * 1.5)], 1.6, rgba(0x4A4A3A))
        draw_circle(img, cx, cy - r * 1.5, r * 0.35, rgba(0xC9C9C9))

    held = new_held()
    body(held, 16, 18, 7)
    save(held, out("assets/weapons/grenade_held.png"))

    proj = new_proj()
    body(proj, 12, 13, 5.5)
    save(proj, out("assets/weapons/grenade_projectile.png"))


def gen_shotgun():
    held = new_held()
    hx, hy = 6, 22
    draw_rounded_rect(held, (hx - 4, hy - 4, hx + 5, hy + 5), 2, rgba(0x8A5A2E))
    draw_rounded_rect(held, (hx + 2, hy - 6, hx + 24, hy - 1), 2, rgba(0xC5CCD5))
    draw_rounded_rect(held, (hx + 2, hy + 1, hx + 24, hy + 6), 2, rgba(0xC5CCD5))
    draw_circle(held, hx + 24, hy - 3.5, 2.2, rgba(0x353842))
    draw_circle(held, hx + 24, hy + 3.5, 2.2, rgba(0x353842))
    save(held, out("assets/weapons/shotgun_held.png"))

    proj = new_proj()
    for i in range(6):
        angle = -0.35 + i * 0.14
        dist = 6 + (i % 2) * 3
        px = 12 + math.cos(angle) * dist
        py = 12 + math.sin(angle) * dist
        draw_circle(proj, px, py, 2.2, rgba(0xFFD966))
        draw_circle(proj, px, py, 2.2, fade(rgba(0xFFFFFF), 0.25))
    save(proj, out("assets/weapons/shotgun_projectile.png"))


def gen_ninja_rope():
    held = new_held()
    hx, hy = 16, 18
    draw_circle(held, hx - 3, hy + 1, 4.5, rgba(0x30323A))
    draw_arc(held, (hx - 6, hy - 6, hx + 6, hy + 6), 0, 235, 2.2, rgba(0xC49A55))
    hookx, hooky = hx + 6 * math.cos(math.radians(235)), hy + 6 * math.sin(math.radians(235))
    draw_circle(held, hookx, hooky, 2.2, rgba(0x9A9AA2))
    save(held, out("assets/weapons/ninjaRope_held.png"))

    proj = new_proj()
    draw_line(proj, [(4, 4), (16, 16)], 2, rgba(0xC49A55))
    draw_polygon(proj, [(16, 16), (20, 14), (18, 20)], rgba(0x9A9AA2))
    save(proj, out("assets/weapons/ninjaRope_projectile.png"))


def gen_dynamite():
    def sticks(img, cx, cy, h, blink=False):
        for dx in (-3.5, 0, 3.5):
            draw_rounded_rect(img, (cx + dx - 1.6, cy - h / 2, cx + dx + 1.6, cy + h / 2), 1.4, rgba(0xD7263D))
        draw_line(img, [(cx - 5, cy - h * 0.3), (cx + 7, cy - h * 0.3)], 1.4, fade(rgba(0x8A1220), 0.8))
        draw_line(img, [(cx, cy - h / 2), (cx + 3, cy - h / 2 - 4)], 1.4, rgba(0x8A5A2A))
        draw_circle(img, cx + 3, cy - h / 2 - 4, 1.8, rgba(0xFFE58A if not blink else 0xFF2222))

    held = new_held()
    sticks(held, 16, 18, 13)
    save(held, out("assets/weapons/dynamite_held.png"))

    proj = new_proj()
    sticks(proj, 12, 13, 11)
    save(proj, out("assets/weapons/dynamite_projectile.png"))


def gen_sniper_rifle():
    held = new_held()
    hx, hy, ex, ey = 6, 22, 27, 9
    draw_line(held, [(hx, hy), (ex, ey)], 3.5, rgba(0x2E2E38))
    draw_rect(held, (hx + 10, hy - 9, hx + 15, hy - 5), rgba(0x1C1C22))
    save(held, out("assets/weapons/sniperRifle_held.png"))

    proj = new_proj()
    draw_line(proj, [(2, 12), (22, 12)], 2, fade(rgba(0xFFF2B0), 0.9))
    draw_circle(proj, 22, 12, 1.8, rgba(0xFFFFFF))
    save(proj, out("assets/weapons/sniperRifle_projectile.png"))


def gen_airstrike_rocket():
    held = new_held()
    hx, hy, ex, ey = 8, 22, 25, 12
    draw_line(held, [(hx, hy), (ex, ey)], 5, rgba(0x4FC3F7))
    draw_polygon(held, [(ex, ey), (ex - 6, ey - 4), (ex - 2, ey)], rgba(0x1C8FC7))
    save(held, out("assets/weapons/airstrikeRocket_held.png"))

    proj = new_proj(40, 16)
    cy = 8
    draw_ellipse(proj, (2, cy - 4, 28, cy + 4), rgba(0x1C8FC7))
    draw_ellipse(proj, (4, cy - 2.8, 26, cy + 2.8), rgba(0x4FC3F7))
    draw_polygon(proj, [(28, cy - 4), (28, cy + 4), (36, cy)], rgba(0xE6F7FF))
    draw_polygon(proj, [(6, cy - 4), (-2, cy - 8), (8, cy - 2)], rgba(0x1C8FC7))
    draw_polygon(proj, [(6, cy + 4), (-2, cy + 8), (8, cy + 2)], rgba(0x1C8FC7))
    save(proj, out("assets/weapons/airstrikeRocket_projectile.png"))


def gen_holy_hand_grenade():
    def body(img, cx, cy, r):
        draw_circle(img, cx, cy, r, rgba(0xFFD700))
        draw_circle(img, cx - r * 0.3, cy - r * 0.3, r * 0.28, fade(rgba(0xFFF4C2), 0.5))
        draw_line(img, [(cx, cy - r * 1.5), (cx, cy - r * 0.4)], 2, rgba(0xFFF4C2))
        draw_line(img, [(cx - r * 0.4, cy - r * 1.0), (cx + r * 0.4, cy - r * 1.0)], 2, rgba(0xFFF4C2))

    held = new_held()
    body(held, 16, 18, 7)
    save(held, out("assets/weapons/holyHandGrenade_held.png"))

    proj = new_proj()
    body(proj, 12, 13, 5.5)
    save(proj, out("assets/weapons/holyHandGrenade_projectile.png"))


def gen_mine():
    def body(img, cx, cy, r):
        draw_circle(img, cx, cy, r, rgba(0x37474F))
        for angle_deg in (0, 60, 120, 180, 240, 300):
            a = math.radians(angle_deg)
            x1, y1 = cx + math.cos(a) * r, cy + math.sin(a) * r
            x2, y2 = cx + math.cos(a) * (r + 3.5), cy + math.sin(a) * (r + 3.5)
            draw_line(img, [(x1, y1), (x2, y2)], 1.6, rgba(0x1C262B))
        draw_circle(img, cx - r * 0.25, cy - r * 0.25, r * 0.2, fade(rgba(0x7B8A91), 0.4))

    held = new_held()
    body(held, 16, 17, 6.5)
    save(held, out("assets/weapons/mine_held.png"))

    proj = new_proj()
    body(proj, 12, 12, 5)
    save(proj, out("assets/weapons/mine_projectile.png"))


def gen_drill():
    held = new_held()
    hx, hy = 8, 22
    draw_rounded_rect(held, (hx - 3, hy - 5, hx + 9, hy + 5), 3, rgba(0x2F3338))
    draw_polygon(held, [(hx + 9, hy - 5), (hx + 22, hy), (hx + 9, hy + 5)], rgba(0xD8DDE3))
    draw_line(held, [(hx + 11, hy - 3), (hx + 19, hy + 1.5)], 1.2, fade(rgba(0x808891), 0.9))
    draw_circle(held, hx - 1, hy, 2.2, rgba(0xFFD966))
    save(held, out("assets/weapons/drill_held.png"))

    proj = new_proj()
    draw_rounded_rect(proj, (2, 9, 12, 15), 2, rgba(0x2F3338))
    draw_polygon(proj, [(12, 9), (22, 12), (12, 15)], rgba(0xD8DDE3))
    save(proj, out("assets/weapons/drill_projectile.png"))


# ---------------------------------------------------------------------------
# Procedural art: water and sky
# ---------------------------------------------------------------------------


def gen_water():
    img = canvas(128, 128)
    draw_rect(img, (0, 0, 128, 128), rgba(0x1E5F8F))
    draw_rect(img, (0, 30, 128, 128), rgba(0x2F7FB8))
    for row_y, amp, color, alpha in [(18, 4, 0x5FB0E8, 0.55), (46, 3, 0xBFE3F5, 0.35), (74, 3.5, 0x5FB0E8, 0.4)]:
        points = []
        for x in range(0, 129, 4):
            y = row_y + math.sin((x / 128) * 2 * math.pi * 2) * amp
            points.append((x, y))
        draw_line(img, points, 2, fade(rgba(color), alpha))
    save(img, out("assets/water/water.png"))


def gen_sky():
    w, h = 1600, 900
    img = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    top = (0x6E, 0xC3, 0xF4)
    bottom = (0xB9, 0xE4, 0xFB)
    px = img.load()
    for y in range(h):
        t = y / h
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        for x in range(0, w, 4):  # coarse horizontal stride, then fill - flat gradient has no per-x variation
            for xx in range(x, min(x + 4, w)):
                px[xx, y] = (r, g, b, 255)
    img = img.convert("RGBA")

    rng = random.Random(99)
    for _ in range(9):
        cx = rng.uniform(80, w - 80)
        cy = rng.uniform(60, h * 0.4)
        base_r = rng.uniform(40, 90)
        for _ in range(5):
            dx = rng.uniform(-base_r, base_r)
            dy = rng.uniform(-base_r * 0.3, base_r * 0.3)
            r = base_r * rng.uniform(0.5, 0.9)
            draw_ellipse(img, (cx + dx - r, cy + dy - r * 0.6, cx + dx + r, cy + dy + r * 0.6),
                         fade(rgba(0xFFFFFF), 0.55))
    save(img, out("assets/sky/sky.png"))


# ---------------------------------------------------------------------------


def main():
    gen_terrain()
    gen_effects_from_real_art()
    gen_misc_and_hud_from_real_art()

    gen_worm_idle()
    gen_worm_walk()
    gen_worm_jump()
    gen_worm_fall()
    gen_worm_death()
    gen_worm_headband()
    gen_rope_hook()

    gen_bazooka()
    gen_grenade()
    gen_shotgun()
    gen_ninja_rope()
    gen_dynamite()
    gen_sniper_rifle()
    gen_airstrike_rocket()
    gen_holy_hand_grenade()
    gen_mine()
    gen_drill()

    gen_water()
    gen_sky()

    print("done")


if __name__ == "__main__":
    main()
