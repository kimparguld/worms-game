#!/usr/bin/env python3
"""One-time art generation: produces the final PNGs at every path the asset
manifest (src/assetManifest.ts) declares, overwriting the flat-color
placeholders the placeholder generator wrote there.

Three sources, per asset:

1. Real, CC0-licensed art from Kenney.nl (Particle Pack, Platformer Art
   Extended Tileset, Tanks, UI Pack, Game Icons - each pack's own bundled
   license file confirms CC0 / public domain, no attribution required),
   downloaded to KENNEY_SRC below and processed (cropped/resized/recolored)
   to the manifest's exact declared dimensions with Pillow.
2. Procedural pixel art drawn with art_lib.py, for everything with no good
   free match: terrain ground/grass, all 10 weapons (held + projectile -
   kept as one internally consistent hand-drawn set rather than mixing in
   the one Kenney mine sprite that would otherwise fit, since a single
   differently-styled weapon among nine drawn ones would look worse than a
   consistent set), water, and the sky backdrop.
3. The worm character (all animation states): sliced and transformed from
   a user-supplied sprite sheet (public/assets/worm/worms_sprites.jpg,
   CC0-alike "Worms"-style pixel art) rather than drawn from scratch - see
   gen_worm_idle/gen_worm_walk and friends below for exactly which source
   frames become which state.

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

from PIL import Image, ImageDraw

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


def darken(hex_color, factor):
    """Scale a 0xRRGGBB color's RGB channels toward black by `factor` (0-1)."""
    r = int(((hex_color >> 16) & 0xFF) * factor)
    g = int(((hex_color >> 8) & 0xFF) * factor)
    b = int((hex_color & 0xFF) * factor)
    return (r << 16) | (g << 8) | b


def lighten(hex_color, factor):
    """Scale a 0xRRGGBB color's RGB channels toward white by `factor` (0-1)."""
    r = (hex_color >> 16) & 0xFF
    g = (hex_color >> 8) & 0xFF
    b = hex_color & 0xFF
    r = min(255, int(r + (255 - r) * factor))
    g = min(255, int(g + (255 - g) * factor))
    b = min(255, int(b + (255 - b) * factor))
    return (r << 16) | (g << 8) | b


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


TERRAIN_TILE_SIZE = 512

# Cartoon pebble-dirt fill (see the reference screenshot this was matched
# against): a solid brown base wall-to-wall covered in round pebbles across
# five brown/tan shades, each with a darker rim stroke and a small offset
# highlight for a glossy, hand-painted read - replacing the earlier
# Kenney-tile mosaic, which read as a pixel-art platformer tile rather than
# this rounded cartoon-terrain look.
DIRT_BASE = 0x8B5E3C
PEBBLE_COLORS = [0x6B4226, 0x9C6B3E, 0xA97C50, 0xC9A66B, 0x5C3A21, 0xB98354]


def _wrapped_shifts(c, r, size):
    """Which of {-size, 0, size} to also draw a shape at so it tiles
    seamlessly - only the shifts that could still land inside the canvas
    given this shape's centre `c` and radius/half-extent `r` are returned,
    so an interior shape (the common case) draws exactly once."""
    return (-size, 0, size) if c - r < 0 or c + r > size else (0,)


def gen_pebble_dirt(seed=42):
    size = TERRAIN_TILE_SIZE
    img = Image.new("RGBA", (size, size), rgba(DIRT_BASE))
    draw = ImageDraw.Draw(img)
    rng = random.Random(seed)
    highlights = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hl_draw = ImageDraw.Draw(highlights)

    for _ in range(1100):
        cx, cy = rng.uniform(0, size), rng.uniform(0, size)
        r = rng.uniform(4, 13)
        color = rng.choice(PEBBLE_COLORS)
        for dx in _wrapped_shifts(cx, r, size):
            for dy in _wrapped_shifts(cy, r, size):
                bbox = [cx + dx - r, cy + dy - r, cx + dx + r, cy + dy + r]
                draw.ellipse(bbox, fill=rgba(color))
                draw.ellipse(bbox, outline=rgba(darken(color, 0.55)), width=1)
                hl_r = r * 0.4
                hl_cx, hl_cy = cx + dx - r * 0.3, cy + dy - r * 0.3
                hl_draw.ellipse(
                    [hl_cx - hl_r, hl_cy - hl_r, hl_cx + hl_r, hl_cy + hl_r],
                    fill=rgba(lighten(color, 0.5), 110),
                )

    img.alpha_composite(highlights)
    return img.convert("RGB")


# Grass-cap layer: TerrainRenderer masks this to only the band of ground
# pixels still part of each column's original (undug) surface, so it reads
# as the classic "grass on top, dirt underneath" strata instead of a
# flat-colored trim - and never re-appears on a crater floor once dug away,
# since that mask is computed once from the pre-dig terrain. Drawn as a
# bright green fill flecked with small rotated blade shapes in two darker
# shades (plus a few lighter ones) rather than a flat color, so the thin
# revealed strip still reads as textured turf rather than a solid bar.
GRASS_BASE = 0x5FBF3F
BLADE_COLORS = [(0x3E8F27, 3), (0x2E6E1C, 1), (0x8FE362, 1)]  # (color, relative weight)


def gen_grass_cap(seed=43):
    size = TERRAIN_TILE_SIZE
    img = Image.new("RGBA", (size, size), rgba(GRASS_BASE))
    rng = random.Random(seed)
    weighted_colors = [c for c, weight in BLADE_COLORS for _ in range(weight)]

    for _ in range(900):
        cx, cy = rng.uniform(0, size), rng.uniform(0, size)
        length = rng.uniform(5, 11)
        width_ = rng.uniform(2, 4)
        angle = rng.uniform(-30, 30)
        color = rng.choice(weighted_colors)

        blade = Image.new("RGBA", (int(length * 2) + 2, int(width_ * 2) + 2), (0, 0, 0, 0))
        ImageDraw.Draw(blade).ellipse([0, 0, blade.width - 1, blade.height - 1], fill=rgba(color, 220))
        blade = blade.rotate(angle, expand=True, resample=Image.BICUBIC)

        for dx in _wrapped_shifts(cx, blade.width, size):
            for dy in _wrapped_shifts(cy, blade.height, size):
                img.alpha_composite(blade, (int(cx + dx - blade.width / 2), int(cy + dy - blade.height / 2)))

    return img.convert("RGB")


# Building facades: TerrainRenderer tiles each of these from world (0,0) as a
# TileSprite and masks it to a building's dug silhouette (see
# src/render/TerrainRenderer.ts) - so a facade is never seen as a whole
# illustration, only as an arbitrary crop wherever a building happens to sit
# on screen. That ruled out a one-off illustrated feature (earlier drafts
# had a single door baked into one corner, which only looked right if a
# building's silhouette happened to line up with it). Instead each facade is
# a uniform, seamlessly-repeating building material - coursed
# brick/stone blocks or corrugated metal, in the same layered
# flat-fill-plus-outline-plus-offset-highlight technique as
# gen_pebble_dirt/gen_grass_cap - with a windows motif on a grid pitch that
# divides the canvas evenly so the coursing and window rhythm stay
# consistent across a tile seam.
BUILDING_W, BUILDING_H = 256, 512


def _draw_coursed_blocks(img, w, h, block_w, block_h, colors, seed, radius=0):
    """Running-bond rows of rounded rects (bricks/stone blocks) over img's
    existing mortar-colored fill, each with a darker outline and a lighter
    offset highlight - leaves a 1px mortar gap between blocks."""
    rng = random.Random(seed)
    draw = ImageDraw.Draw(img)
    highlights = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    hl_draw = ImageDraw.Draw(highlights)

    rows = h // block_h + 2
    cols = w // block_w + 2
    for row in range(-1, rows):
        y0, y1 = row * block_h, row * block_h + block_h
        offset = block_w // 2 if row % 2 else 0
        for col in range(-1, cols):
            x0, x1 = col * block_w - offset, col * block_w - offset + block_w
            color = rng.choice(colors)
            bbox = [x0 + 1, y0 + 1, x1 - 1, y1 - 1]
            if radius:
                draw.rounded_rectangle(bbox, radius=radius, fill=rgba(color))
                draw.rounded_rectangle(bbox, radius=radius, outline=rgba(darken(color, 0.55)), width=2)
            else:
                draw.rectangle(bbox, fill=rgba(color))
                draw.rectangle(bbox, outline=rgba(darken(color, 0.55)), width=2)
            hl_w = (x1 - x0) * 0.45
            hl_draw.rectangle([x0 + 3, y0 + 3, x0 + 3 + hl_w, y1 - 3], fill=rgba(lighten(color, 0.45), 80))

    img.alpha_composite(highlights)


BRICK_MORTAR = 0x5A4A42
BRICK_COLORS = [0xB33A2E, 0xC24A3A, 0x9C2E22, 0xD1573F, 0xA83527]
BRICK_FRAME = 0x4A2E1A
BRICK_PANE = 0x8FD6E8
BRICK_MUNTIN = 0xE8DCC8


def gen_brick_facade(seed=51):
    w, h = BUILDING_W, BUILDING_H
    img = Image.new("RGBA", (w, h), rgba(BRICK_MORTAR))
    _draw_coursed_blocks(img, w, h, block_w=32, block_h=16, colors=BRICK_COLORS, seed=seed)

    cell = 128
    for cy in range(cell // 2, h, cell):
        for cx in range(cell // 2, w, cell):
            bw, bh = 62, 84
            frame = [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2]
            draw_rounded_rect(img, frame, 4, rgba(BRICK_FRAME))
            pane = [frame[0] + 6, frame[1] + 6, frame[2] - 6, frame[3] - 6]
            draw_rect(img, pane, rgba(BRICK_PANE))
            draw_rect(img, [pane[0], pane[1], pane[0] + (pane[2] - pane[0]) * 0.4, pane[3]], rgba(lighten(BRICK_PANE, 0.4), 140))
            mid_x, mid_y = (pane[0] + pane[2]) / 2, (pane[1] + pane[3]) / 2
            draw_line(img, [(mid_x, pane[1]), (mid_x, pane[3])], 2, rgba(BRICK_MUNTIN))
            draw_line(img, [(pane[0], mid_y), (pane[2], mid_y)], 2, rgba(BRICK_MUNTIN))
            draw_rect(img, [frame[0] - 8, frame[3], frame[2] + 8, frame[3] + 6], rgba(darken(BRICK_FRAME, 0.8)))

    return img.convert("RGB")


METAL_BASE = 0x8A9199
METAL_LIGHT = 0x9FA7AF
METAL_DARK = 0x6E747A
METAL_SEAM = 0x4A4F54
METAL_RIVET = 0x3A3E42
METAL_FRAME = 0x1B1D1F
METAL_PANE = 0x2E3A42


def gen_metal_facade(seed=52):
    w, h = BUILDING_W, BUILDING_H
    img = Image.new("RGBA", (w, h), rgba(METAL_BASE))

    ridge_w = 16
    for i, x in enumerate(range(0, w, ridge_w)):
        color = METAL_LIGHT if i % 2 == 0 else METAL_DARK
        draw_rect(img, [x, 0, x + ridge_w - 2, h], rgba(color))

    panel_h = 128
    rng = random.Random(seed)
    for y in range(0, h, panel_h):
        draw_rect(img, [0, y, w, y + 4], rgba(METAL_SEAM))
        for x in range(8, w, 24):
            draw_circle(img, x + rng.uniform(-2, 2), y + 2, 2.5, rgba(METAL_RIVET))

    cell = 85
    for cy in range(cell // 2, h, cell):
        for cx in range(cell // 2, w, cell):
            bw, bh = 28, 28
            frame = [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2]
            draw_rect(img, frame, rgba(METAL_FRAME))
            pane = [frame[0] + 4, frame[1] + 4, frame[2] - 4, frame[3] - 4]
            draw_rect(img, pane, rgba(METAL_PANE))
            draw_line(img, [(pane[0], pane[1]), (pane[2], pane[1] + (pane[3] - pane[1]) * 0.5)], 2, rgba(lighten(METAL_PANE, 0.6), 160))
            for corner in ((frame[0] + 3, frame[1] + 3), (frame[2] - 3, frame[1] + 3), (frame[0] + 3, frame[3] - 3), (frame[2] - 3, frame[3] - 3)):
                draw_circle(img, corner[0], corner[1], 1.5, rgba(METAL_RIVET))

    return img.convert("RGB")


STONE_MORTAR = 0x9C8F7A
STONE_COLORS = [0xD8C7A1, 0xC9B68C, 0xE0D2B0, 0xB8A67C, 0xCDBB94]
STONE_FRAME = 0xEDE3C8
STONE_PANE = 0x3A4A6B


def _draw_arch(img, bbox, fill):
    """Round-topped window silhouette: a semicircle (diameter = bbox width)
    sitting on top of a rectangle, so the shape reads as an arched window
    rather than draw_rounded_rect's pill (round top *and* bottom)."""
    x0, y0, x1, y1 = bbox
    bw = x1 - x0
    draw_ellipse(img, [x0, y0, x1, y0 + bw], fill)
    draw_rect(img, [x0, y0 + bw / 2, x1, y1], fill)


def gen_stone_facade(seed=53):
    w, h = BUILDING_W, BUILDING_H
    img = Image.new("RGBA", (w, h), rgba(STONE_MORTAR))
    _draw_coursed_blocks(img, w, h, block_w=64, block_h=32, colors=STONE_COLORS, seed=seed, radius=3)

    cell = 128
    for cy in range(cell // 2, h, cell):
        for cx in range(cell // 2, w, cell):
            bw, bh = 56, 90
            frame = [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2]
            _draw_arch(img, frame, rgba(STONE_FRAME))
            pane = [frame[0] + 7, frame[1] + 7, frame[2] - 7, frame[3] - 7]
            _draw_arch(img, pane, rgba(STONE_PANE))
            arch_w = pane[2] - pane[0]
            draw_arc(img, [pane[0] + 3, pane[1] + 3, pane[2] - 3, pane[1] + arch_w - 3], 195, 345, 3, rgba(lighten(STONE_PANE, 0.5), 170))
            mid_x = (pane[0] + pane[2]) / 2
            spring_y = pane[1] + arch_w / 2
            draw_line(img, [(mid_x, spring_y), (mid_x, pane[3] - 4)], 2, rgba(STONE_FRAME))
            draw_line(img, [(pane[0] + 4, spring_y), (pane[2] - 4, spring_y)], 2, rgba(STONE_FRAME, 120))

    return img.convert("RGB")


def gen_buildings():
    save(gen_brick_facade(), out("assets/terrain/building_1.png"))
    save(gen_metal_facade(), out("assets/terrain/building_2.png"))
    save(gen_stone_facade(), out("assets/terrain/building_3.png"))


def gen_terrain():
    save(gen_pebble_dirt(), out("assets/terrain/ground.png"))
    save(gen_grass_cap(), out("assets/terrain/grass.png"))
    gen_buildings()


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
# Worm character: sliced and transformed from a provided sprite sheet
# ---------------------------------------------------------------------------

WORM_SHEET_PATH = os.path.join(PUBLIC, "assets", "worm", "worms_sprites.jpg")
WORM_CANVAS_W, WORM_CANVAS_H = 48, 56
# Every extracted/derived frame's source crop is pasted with its own top
# edge (== the sprite's head-top, true for every box below) at this fixed
# canvas row, so the head lands at roughly the same screen position - close
# to canvas-centre, matching WormRenderer's setOrigin(0.5, 0.5) plus
# worm.y's role as roughly head-height (see headY = worm.y in
# WormRenderer.update) - across every animation state, idle through death.
WORM_HEAD_TOP_Y = 4

# Hand-picked bounding boxes (left, top, right, bottom) into
# worms_sprites.jpg for the three-frame bob cycle and five-frame inchworm
# crawl, found by overlaying a pixel grid on the sheet and reading off where
# each sprite's ink starts/ends. Not a uniform grid - the source art itself
# isn't laid out on one.
#
# The bob cycle reads as a walk (a settled side-to-side sway), so it backs
# 'walk'; the crawl's big forward lunge reads as a leap, so it backs 'jump'.
# 'idle' gets its own single frame (the bob cycle's rest pose) rather than
# sharing either animated cycle, so each state has an exclusive source file.
WORM_BOB_BOXES = [(0, 0, 33, 39), (33, 0, 65, 39), (65, 0, 96, 39)]
WORM_STAND_BOX = WORM_BOB_BOXES[0]
WORM_CRAWL_BOXES = [
    (0, 43, 31, 79),
    (32, 42, 60, 89),
    (65, 42, 94, 94),
    (96, 42, 124, 94),
    (126, 42, 153, 94),
]


def _remove_sprite_sheet_bg(img, threshold=222):
    """The sheet is a JPEG with a plain white background (no alpha) - key
    it out so the cropped worm sits on transparency. Flood-fills near-white
    starting from the crop's own border rather than thresholding every
    pixel globally: the worm's face is *also* drawn near-white (for the
    eyes/muzzle detail), and a global threshold punched a transparent hole
    through it since that white is indistinguishable from the sheet's
    background by color alone - it's only distinguishable by being enclosed
    by the black outline instead of touching the crop's edge."""
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()

    def is_bgish(x, y):
        r, g, b, _a = px[x, y]
        return r > threshold and g > threshold and b > threshold

    visited = [[False] * w for _ in range(h)]
    stack = []
    for x in range(w):
        for y in (0, h - 1):
            if is_bgish(x, y) and not visited[y][x]:
                visited[y][x] = True
                stack.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_bgish(x, y) and not visited[y][x]:
                visited[y][x] = True
                stack.append((x, y))

    while stack:
        cx, cy = stack.pop()
        r, g, b, _a = px[cx, cy]
        px[cx, cy] = (r, g, b, 0)
        for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx] and is_bgish(nx, ny):
                visited[ny][nx] = True
                stack.append((nx, ny))

    return img


def _crop_worm_frame(sheet, box):
    # The source sheet draws the worm facing left (face/eyes on the left,
    # tail trailing right) - mirrored here so the unflipped baseline faces
    # right, matching WormRenderer's convention (setFlipX only on
    # facing === -1, so facing === 1/right must be the unflipped art).
    frame = _remove_sprite_sheet_bg(sheet.crop(box))
    return frame.transpose(Image.FLIP_LEFT_RIGHT)


def _place_worm_frame(crop):
    frame = Image.new("RGBA", (WORM_CANVAS_W, WORM_CANVAS_H), (0, 0, 0, 0))
    x = (WORM_CANVAS_W - crop.width) // 2
    frame.alpha_composite(crop, (x, WORM_HEAD_TOP_Y))
    return frame


def _transformed_worm_frame(crop, tilt_deg, squash):
    """Derives a jump/fall/death pose from an idle/walk crop by squashing
    (vertical resize) then rotating - the same tilt+squash trick the
    earlier hand-drawn version of this file used to get a "leaping"/
    "falling"/"tumbling" read from a single static body drawing, just
    applied to a real sprite crop instead of a freshly-drawn one."""
    if squash != 1.0:
        crop = crop.resize((crop.width, max(1, round(crop.height * squash))), Image.LANCZOS)
    rotated = crop.rotate(-tilt_deg, expand=True, resample=Image.BICUBIC)
    frame = Image.new("RGBA", (WORM_CANVAS_W, WORM_CANVAS_H), (0, 0, 0, 0))
    x = (WORM_CANVAS_W - rotated.width) // 2
    y = WORM_HEAD_TOP_Y - (rotated.height - crop.height) // 2
    frame.alpha_composite(rotated, (x, y))
    return frame


def _load_sprite_sheet():
    return Image.open(WORM_SHEET_PATH).convert("RGB")


def gen_worm_idle():
    sheet = _load_sprite_sheet()
    frame = _place_worm_frame(_crop_worm_frame(sheet, WORM_STAND_BOX))
    save_frames_as_strip([frame], out("assets/worm/idle.png"))


def gen_worm_walk():
    sheet = _load_sprite_sheet()
    frames = [_place_worm_frame(_crop_worm_frame(sheet, box)) for box in WORM_BOB_BOXES]
    save_frames_as_strip(frames, out("assets/worm/walk.png"))


def gen_worm_jump():
    sheet = _load_sprite_sheet()
    frames = [_place_worm_frame(_crop_worm_frame(sheet, box)) for box in WORM_CRAWL_BOXES]
    save_frames_as_strip(frames, out("assets/worm/jump.png"))


def gen_worm_fall():
    sheet = _load_sprite_sheet()
    base = _crop_worm_frame(sheet, WORM_CRAWL_BOXES[2])
    frame = _transformed_worm_frame(base, tilt_deg=14, squash=1.08)
    save_frames_as_strip([frame], out("assets/worm/fall.png"))


def gen_worm_death():
    sheet = _load_sprite_sheet()
    base = _crop_worm_frame(sheet, WORM_BOB_BOXES[0])
    frames = []
    for i in range(5):
        t = i / 4
        tilt = t * 250
        squash = 1 + math.sin(t * math.pi * 3) * 0.14
        frames.append(_transformed_worm_frame(base, tilt_deg=tilt, squash=squash))
    save_frames_as_strip(frames, out("assets/worm/death.png"))


def gen_rope_hook():
    # A simple J-shaped grapple hook: a shank down from the rope, curling
    # into a point - drawn bold enough to read at 12x12.
    img = canvas(12, 12)
    draw_line(img, [(6, 0), (6, 6)], 2.2, rgba(0xC49A55))
    draw_arc(img, (2, 4, 10, 11), 20, 200, 2.6, rgba(0x9A9AA2))
    draw_circle(img, 3, 6.5, 1.3, rgba(0xDEE2E6))
    save(img, out("assets/misc/rope_hook.png"))


# ---------------------------------------------------------------------------
# Weapons: six of the ten sliced from the provided sprite sheet, the rest
# (ninjaRope, sniperRifle, airstrikeRocket's projectile, drill, shotgun's
# projectile) stay procedural - the sheet has no grapple hook, scoped rifle,
# spinning drill, or pellet-spray equivalent to crop instead.
# ---------------------------------------------------------------------------

# Bounding boxes (left, top, right, bottom) into worms_sprites.jpg's weapons
# row, found the same way as the worm boxes above: overlay a pixel grid,
# read off each icon's ink extent.
GREEN_CANNON_BOX = (2, 104, 54, 131)  # bazooka_held
BLUE_CANNON_BOX = (57, 104, 111, 131)  # airstrikeRocket_held
DART_BOX = (133, 107, 145, 121)  # bazooka_projectile
GREEN_GRENADE_BOX = (61, 132, 79, 153)
GOLD_ORB_BOX = (120, 129, 140, 159)  # holyHandGrenade
DYNAMITE_STICK_BOX = (145, 134, 153, 155)
MINE_DOME_BOX = (183, 147, 194, 157)
SHOTGUN_BOX = (5, 141, 55, 156)  # held only - no pellet-spray equivalent to crop for the projectile


def _crop_weapon_icon(sheet, box, flip_x=False):
    # Every gun icon in the sheet is drawn muzzle-left, grip-right - the
    # opposite of this project's convention (muzzle points away from the
    # worm's body, i.e. right, at facing === 1 / aimAngle 0 - see
    # WormRenderer's fireAngle/setFlipY handling), so guns pass flip_x=True.
    icon = _remove_sprite_sheet_bg(sheet.crop(box))
    return icon.transpose(Image.FLIP_LEFT_RIGHT) if flip_x else icon


def _place_weapon_icon(icon, canvas_w, canvas_h):
    # Centers the icon in the target canvas, scaling down (never up - these
    # crops are already close to their target sizes) to fit within it while
    # preserving aspect ratio. WormRenderer rotates this whole texture by
    # aimAngle around its centre (see setRotation in update()), so centring
    # here is what makes that rotation pivot sit roughly mid-weapon, matching
    # how the procedural weapons above already behave (their own hand/muzzle
    # coordinates likewise straddle the canvas centre rather than pinning
    # the grip to it).
    scale = min(1.0, canvas_w / icon.width, canvas_h / icon.height)
    if scale < 1.0:
        icon = icon.resize((max(1, round(icon.width * scale)), max(1, round(icon.height * scale))), Image.LANCZOS)
    frame = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    x = (canvas_w - icon.width) // 2
    y = (canvas_h - icon.height) // 2
    frame.alpha_composite(icon, (x, y))
    return frame


def gen_weapon_icons_from_sheet():
    sheet = _load_sprite_sheet()

    bazooka_held = _crop_weapon_icon(sheet, GREEN_CANNON_BOX, flip_x=True)
    save(_place_weapon_icon(bazooka_held, 32, 32), out("assets/weapons/bazooka_held.png"))
    bazooka_proj = _crop_weapon_icon(sheet, DART_BOX, flip_x=True)  # nose-left in the sheet, nose-right is this project's convention
    save(_place_weapon_icon(bazooka_proj, 40, 16), out("assets/weapons/bazooka_projectile.png"))

    airstrike_held = _crop_weapon_icon(sheet, BLUE_CANNON_BOX, flip_x=True)
    save(_place_weapon_icon(airstrike_held, 32, 32), out("assets/weapons/airstrikeRocket_held.png"))

    grenade_icon = _crop_weapon_icon(sheet, GREEN_GRENADE_BOX)
    save(_place_weapon_icon(grenade_icon, 32, 32), out("assets/weapons/grenade_held.png"))
    save(_place_weapon_icon(grenade_icon, 24, 24), out("assets/weapons/grenade_projectile.png"))

    holy_icon = _crop_weapon_icon(sheet, GOLD_ORB_BOX)
    save(_place_weapon_icon(holy_icon, 32, 32), out("assets/weapons/holyHandGrenade_held.png"))
    save(_place_weapon_icon(holy_icon, 24, 24), out("assets/weapons/holyHandGrenade_projectile.png"))

    dynamite_icon = _crop_weapon_icon(sheet, DYNAMITE_STICK_BOX)
    save(_place_weapon_icon(dynamite_icon, 32, 32), out("assets/weapons/dynamite_held.png"))
    save(_place_weapon_icon(dynamite_icon, 24, 24), out("assets/weapons/dynamite_projectile.png"))

    mine_icon = _crop_weapon_icon(sheet, MINE_DOME_BOX)
    save(_place_weapon_icon(mine_icon, 32, 32), out("assets/weapons/mine_held.png"))
    save(_place_weapon_icon(mine_icon, 24, 24), out("assets/weapons/mine_projectile.png"))

    shotgun_held = _crop_weapon_icon(sheet, SHOTGUN_BOX, flip_x=True)
    save(_place_weapon_icon(shotgun_held, 32, 32), out("assets/weapons/shotgun_held.png"))


# ---------------------------------------------------------------------------
# Procedural art: remaining weapons (ninjaRope, sniperRifle, drill, and the
# shotgun/airstrikeRocket projectiles the sheet has no equivalent for)
# ---------------------------------------------------------------------------


def new_held():
    return canvas(32, 32)


def new_proj(w=24, h=24):
    return canvas(w, h)


def gen_shotgun_projectile():
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


def gen_airstrike_rocket_projectile():
    proj = new_proj(40, 16)
    cy = 8
    draw_ellipse(proj, (2, cy - 4, 28, cy + 4), rgba(0x1C8FC7))
    draw_ellipse(proj, (4, cy - 2.8, 26, cy + 2.8), rgba(0x4FC3F7))
    draw_polygon(proj, [(28, cy - 4), (28, cy + 4), (36, cy)], rgba(0xE6F7FF))
    draw_polygon(proj, [(6, cy - 4), (-2, cy - 8), (8, cy - 2)], rgba(0x1C8FC7))
    draw_polygon(proj, [(6, cy + 4), (-2, cy + 8), (8, cy + 2)], rgba(0x1C8FC7))
    save(proj, out("assets/weapons/airstrikeRocket_projectile.png"))


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
    gen_rope_hook()

    gen_weapon_icons_from_sheet()
    gen_shotgun_projectile()
    gen_ninja_rope()
    gen_sniper_rifle()
    gen_airstrike_rocket_projectile()
    gen_drill()

    gen_water()
    gen_sky()

    print("done")


if __name__ == "__main__":
    main()
