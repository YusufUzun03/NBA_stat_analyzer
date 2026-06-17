"""Generate the PWA / Apple touch icons (bracket-ball mark) as PNGs.

Run from the backend/ directory:
    python scripts/gen_icons.py
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from PIL import Image, ImageDraw

OUT = Path(__file__).parent.parent.parent / "frontend" / "icons"


def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    S = size * 4                                   # supersample for smooth edges
    img = Image.new("RGBA", (S, S), (10, 12, 20, 255))
    cx = cy = S / 2
    r = S * 0.30 * (0.72 if maskable else 0.84)    # smaller for maskable safe zone

    d = ImageDraw.Draw(img)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(238, 103, 48, 255))
    # subtle top-left highlight (opaque blend over the orange, not a cutout)
    hr = r * 0.92
    d.ellipse([cx - r * 0.7, cy - r * 0.82, cx - r * 0.7 + hr, cy - r * 0.82 + hr],
              fill=(247, 150, 92, 255))
    seam = max(2, int(S * 0.013))
    col = (22, 12, 4, 255)
    d.line([cx, cy - r * 0.98, cx, cy + r * 0.98], fill=col, width=seam)
    d.line([cx - r * 0.98, cy, cx + r * 0.98, cy], fill=col, width=seam)
    d.arc([cx - r * 0.35, cy - r, cx + r * 1.65, cy + r], 90, 270, fill=col, width=seam)
    d.arc([cx - r * 1.65, cy - r, cx + r * 0.35, cy + r], 270, 90, fill=col, width=seam)

    bw = max(3, int(S * 0.032))
    oc = (255, 138, 76, 255)
    bx, by, arm = r * 1.40, r * 1.16, r * 0.24
    for sx in (-1, 1):
        x = cx + sx * bx
        d.line([x, cy - by, x, cy + by], fill=oc, width=bw)
        d.line([x, cy - by, x - sx * arm, cy - by], fill=oc, width=bw)
        d.line([x, cy + by, x - sx * arm, cy + by], fill=oc, width=bw)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-512-maskable.png", 512, True),
        ("apple-touch-icon.png", 180, False),
    ]
    for name, size, mask in jobs:
        draw_icon(size, mask).save(OUT / name)
        print(f"wrote {name} ({size}px{', maskable' if mask else ''})")


if __name__ == "__main__":
    main()
