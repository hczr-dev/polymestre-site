# Le chantier de la RTS sur les photos (2023) : remplacé par un sol clair, puisque le bâtiment est fini.
# Usage : site.py <geo>
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
GEO = sys.argv[1]
# Le contour du chantier, en unités de scène.
CROP = [(600, 262), (950, 262), (985, 320), (1000, 400), (990, 470), (830, 570), (690, 615), (640, 590), (650, 480)]
RING = [(x / 13 - 30, 35 - y / 13) for x, y in CROP]
def paint(path, x0, x1, z0, z1, q):
    im = Image.open(path).convert("RGB"); W = im.width; s = W / (x1 - x0)
    m = Image.new("L", (W, W), 0)
    ImageDraw.Draw(m).polygon([((x - x0) * s, (z1 - z) * s) for x, z in RING], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(max(1.5, s * 0.25)))
    rng = np.random.default_rng(3)
    n = rng.normal(0, 1, (W // 8 + 1, W // 8 + 1)); n = np.asarray(Image.fromarray(((n * 20) + 128).clip(0, 255).astype("uint8")).resize((W, W), Image.BICUBIC)).astype(float) - 128
    pave = np.dstack([168 + n * .25, 164 + n * .25, 156 + n * .25]).clip(0, 255).astype("uint8")
    Image.composite(Image.fromarray(pave), im, m).save(path, quality=q, method=6)
b = json.load(open(f"{GEO}/campus-photo.json")); paint(f"{GEO}/campus-photo.webp", b["x0"], b["x1"], b["z0"], b["z1"], 72)
L = json.load(open(f"{GEO}/meta.json"))["layers"]["near"]; h = L["size"] / 12
paint(f"{GEO}/near.webp", L["cx"] / 6 - h, L["cx"] / 6 + h, L["cz"] / 6 - h, L["cz"] / 6 + h, 74)
