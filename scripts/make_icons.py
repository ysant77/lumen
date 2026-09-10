#!/usr/bin/env python3
"""Generate the lumen app icons (PNG sizes + SVG favicon).

Design: a warm reading lamp glow over an open book, on near-black.
Usage: python scripts/make_icons.py
"""

import os

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
BG = (10, 10, 10, 255)
AMBER = (251, 191, 36, 255)
AMBER_DIM = (245, 158, 11, 255)
GLOW = (251, 191, 36, 46)


def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # background
    radius = 0 if maskable else int(s * 0.22)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=BG)

    # safe-zone padding (maskable icons need content within the inner 80%)
    pad = 0.12 if maskable else 0.04
    u = s * (1 - 2 * pad)  # usable span
    ox = oy = s * pad

    cx = ox + u / 2

    # glow
    gy = oy + u * 0.36
    for r, alpha in [(0.34, 28), (0.26, 46), (0.18, 76)]:
        rr = u * r
        d.ellipse([cx - rr, gy - rr, cx + rr, gy + rr], fill=(251, 191, 36, alpha))

    # lamp point
    rr = u * 0.075
    d.ellipse([cx - rr, gy - rr, cx + rr, gy + rr], fill=AMBER)

    # light rays
    lw = max(2, int(s * 0.022))
    for dx, dy, fx, fy in [(-0.20, -0.16, -0.31, -0.26), (0.20, -0.16, 0.31, -0.26), (0, -0.22, 0, -0.35)]:
        d.line(
            [cx + u * dx, gy + u * dy, cx + u * fx, gy + u * fy],
            fill=AMBER_DIM,
            width=lw,
        )

    # open book: two page arcs
    by = oy + u * 0.62
    bw = u * 0.72
    bh = u * 0.30
    lw2 = max(3, int(s * 0.045))
    # left page
    d.arc([cx - bw / 2, by - bh * 0.2, cx + bw * 0.04, by + bh], start=185, end=355, fill=AMBER, width=lw2)
    # right page
    d.arc([cx - bw * 0.04, by - bh * 0.2, cx + bw / 2, by + bh], start=185, end=355, fill=AMBER, width=lw2)
    # spine
    d.line([cx, by + bh * 0.28, cx, by + bh * 0.72], fill=AMBER, width=max(2, lw2 // 2))

    return img


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0a0a0a"/>
  <circle cx="32" cy="24" r="12" fill="#fbbf24" opacity="0.16"/>
  <circle cx="32" cy="24" r="7" fill="#fbbf24" opacity="0.28"/>
  <circle cx="32" cy="24" r="3.2" fill="#fbbf24"/>
  <g stroke="#f59e0b" stroke-width="1.6" stroke-linecap="round">
    <line x1="32" y1="15.5" x2="32" y2="10.5"/>
    <line x1="24.5" y1="18" x2="20.5" y2="14.5"/>
    <line x1="39.5" y1="18" x2="43.5" y2="14.5"/>
  </g>
  <g stroke="#fbbf24" stroke-width="2.6" stroke-linecap="round" fill="none">
    <path d="M12 40 q10 -6 20 0 v9 q-10 -6 -20 0 z" fill="none"/>
    <path d="M52 40 q-10 -6 -20 0 v9 q10 -6 20 0 z" fill="none"/>
  </g>
</svg>
"""

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    draw_icon(512).save(os.path.join(OUT, "icon-512.png"))
    draw_icon(192).save(os.path.join(OUT, "icon-192.png"))
    draw_icon(512, maskable=True).save(os.path.join(OUT, "icon-maskable-512.png"))
    apple = Image.new("RGB", (180, 180), BG[:3])
    apple.paste(draw_icon(180), (0, 0), draw_icon(180))
    apple.save(os.path.join(OUT, "apple-touch-icon.png"))
    with open(os.path.join(OUT, "icon.svg"), "w") as f:
        f.write(SVG)
    print("icons written to", os.path.abspath(OUT))
