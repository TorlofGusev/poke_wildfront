"""Shrinks the downloaded SpriteCollab sheets for the web build.

Keeps only the 4 orthogonal facings (down, right, up, left) of the idle and walk
sheets (the game moves on a square grid), drops the hurt sheets (a tint flash is
used instead) and saves palette PNGs. Run after tools/fetch-sprites.mjs:
    python3 tools/pack-sprites.py
"""
import json
import os

from PIL import Image

SPRITES = "src/assets/sprites"
META = "src/content/sprites.json"
KEEP_ROWS = [0, 2, 4, 6]  # down, right, up, left in the PMD row order

meta = json.load(open(META))
for species, m in meta.items():
    dex = f"{m['dex']:04d}"
    for anim in ("idle", "walk"):
        path = f"{SPRITES}/{dex}-{anim}.png"
        a = m[anim]
        img = Image.open(path).convert("RGBA")
        rows = img.height // a["frameHeight"]
        if rows == len(KEEP_ROWS) or rows < 8:
            continue  # already packed, or a single-direction sheet
        out = Image.new("RGBA", (img.width, a["frameHeight"] * len(KEEP_ROWS)))
        for i, r in enumerate(KEEP_ROWS):
            out.paste(img.crop((0, r * a["frameHeight"], img.width, (r + 1) * a["frameHeight"])), (0, i * a["frameHeight"]))
        # Pixel art has few colours: an adaptive palette is lossless in practice.
        out.quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(path, optimize=True)
    hurt = f"{SPRITES}/{dex}-hurt.png"
    if os.path.exists(hurt):
        os.remove(hurt)
    m.pop("hurt", None)
    portrait = f"{SPRITES}/{dex}-portrait.png"
    Image.open(portrait).convert("RGBA").quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(portrait, optimize=True)
json.dump(meta, open(META, "w"), indent=1)
open(META, "a").write("\n")
print("packed", len(meta), "species")
