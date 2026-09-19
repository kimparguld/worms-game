"""Small drawing helper library for one-time procedural sprite generation.

PIL's ImageDraw does not alpha-blend when drawing RGBA shapes onto an RGBA
canvas directly - it just overwrites pixels, including alpha. The original
Phaser Graphics-based renderer this project replaced built its shading by
layering semi-transparent shapes (a soft shadow ellipse, a translucent
highlight), which needs real alpha compositing. Every draw_* helper here
draws onto its own transparent layer and composites it onto the canvas with
Image.alpha_composite, so layered semi-transparent shapes blend correctly.
"""

from PIL import Image, ImageDraw


def canvas(w, h):
    return Image.new("RGBA", (w, h), (0, 0, 0, 0))


def _layer(w, h):
    return Image.new("RGBA", (w, h), (0, 0, 0, 0))


def composite(base, layer):
    base.alpha_composite(layer)


def rgba(hex_color, alpha=255):
    """hex_color: 0xRRGGBB int. alpha: 0-255."""
    r = (hex_color >> 16) & 0xFF
    g = (hex_color >> 8) & 0xFF
    b = hex_color & 0xFF
    return (r, g, b, alpha)


def fade(color_rgba, factor):
    """Scale a color's own alpha by factor (0-1), keep RGB."""
    r, g, b, a = color_rgba
    return (r, g, b, max(0, min(255, int(a * factor))))


def draw_ellipse(base, bbox, fill):
    layer = _layer(*base.size)
    ImageDraw.Draw(layer).ellipse(bbox, fill=fill)
    composite(base, layer)


def draw_circle(base, cx, cy, r, fill):
    draw_ellipse(base, (cx - r, cy - r, cx + r, cy + r), fill)


def draw_rounded_rect(base, bbox, radius, fill):
    layer = _layer(*base.size)
    ImageDraw.Draw(layer).rounded_rectangle(bbox, radius=radius, fill=fill)
    composite(base, layer)


def draw_rect(base, bbox, fill):
    layer = _layer(*base.size)
    ImageDraw.Draw(layer).rectangle(bbox, fill=fill)
    composite(base, layer)


def draw_polygon(base, points, fill):
    layer = _layer(*base.size)
    ImageDraw.Draw(layer).polygon(points, fill=fill)
    composite(base, layer)


def draw_line(base, points, width, fill):
    layer = _layer(*base.size)
    ImageDraw.Draw(layer).line(points, fill=fill, width=max(1, round(width)), joint="curve")
    composite(base, layer)


def draw_arc(base, bbox, start, end, width, fill):
    layer = _layer(*base.size)
    ImageDraw.Draw(layer).arc(bbox, start=start, end=end, fill=fill, width=max(1, round(width)))
    composite(base, layer)


def save_frames_as_strip(frames, out_path):
    """Horizontally concatenate same-size RGBA frames into one spritesheet PNG."""
    w, h = frames[0].size
    strip = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for i, frame in enumerate(frames):
        strip.paste(frame, (i * w, 0), frame)
    strip.save(out_path)


def save(img, out_path):
    img.save(out_path)
