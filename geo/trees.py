# Les arbres du campus, relevés sur la photo aérienne : la canopée (vert sombre) devient une
# liste de positions (x, z, hauteur du sol, rayon) en unités de 6 m. Sortie : geo/trees.bin.
import json, sys, random
import numpy as np
from PIL import Image
GEO = sys.argv[1]
meta = json.load(open(f"{GEO}/meta.json"))
L = meta["layers"]["near"]; UNIT = meta["unit"]; EXAG = 1.3
img = np.asarray(Image.open(f"{GEO}/near.webp").convert("RGB")).astype(np.int32)
n = img.shape[0]
h = np.fromfile(f"{GEO}/near.bin", dtype="<i2").reshape(L["grid"], L["grid"]).astype(float)
r, g, b = img[..., 0], img[..., 1], img[..., 2]
lum = (r * 299 + g * 587 + b * 114) // 1000
canopy = (g > r + 6) & (g >= b) & (lum < 95) & (lum > 20)
random.seed(3)
size = L["size"] / UNIT
pts = []
step = 5
for py in range(0, n, step):
    for px in range(0, n, step):
        win = canopy[py:py + step, px:px + step]
        if win.mean() < 0.6 or random.random() > 0.55:
            continue
        u, v = (px + step / 2) / n, (py + step / 2) / n
        if min(u, 1 - u, v, 1 - v) < 0.12:
            continue
        x = L["cx"] / UNIT + (u - 0.5) * size
        z = L["cz"] / UNIT + (0.5 - v) * size
        if abs(x) < 14.6 and abs(z) < 10.9:
            continue
        gi = v * (L["grid"] - 1); gj = u * (L["grid"] - 1)
        base = h[int(round(gi)), int(round(gj))] / UNIT * EXAG
        pts.append((x + random.uniform(-0.3, 0.3), z + random.uniform(-0.3, 0.3), base, random.uniform(0.45, 0.85)))
print(len(pts), "arbres")
np.array(pts, dtype="<f4").tofile(f"{GEO}/trees.bin")
