# L'occlusion ambiante du campus, calculée une fois : une carte des hauteurs (bâtiments, arbres, relief),
# puis, pour chaque point, la part de ciel qu'il voit dans seize directions. Fixe dans le monde : rien
# à recalculer à chaque image, rien qui puisse clignoter. Sortie : ao.webp, 1024² sur ±110 unités.
# Rouge = lumière reçue (1 = plein ciel) ; vert = hauteur du sol, de G0 à G1. Usage : ao.py <geo>
import json, sys
import numpy as np, DracoPy
from PIL import Image, ImageDraw, ImageFilter
GEO = sys.argv[1]
UNIT, EXAG, R, S, G0, G1 = 6.0, 1.3, 110.0, 1024, -4.0, 6.0
px = lambda x, z: ((x + R) / (2 * R) * S, (R - z) / (2 * R) * S)
# Le sol : la couche fine du relief.
L = json.load(open(f"{GEO}/meta.json"))["layers"]["near"]
g = L["grid"]; h = np.fromfile(f"{GEO}/near.bin", dtype="<i2").reshape(g, g) * L.get("scale", 1) / UNIT * EXAG
size = L["size"] / UNIT
xs = (np.arange(S) + 0.5) / S * 2 * R - R; zs = R - (np.arange(S) + 0.5) / S * 2 * R
X, Z = np.meshgrid(xs, zs)
u = (X - L["cx"] / UNIT) / size + 0.5; v = 0.5 - (-Z - L["cz"] / UNIT) / size
ground = h[np.clip(np.rint(v * (g - 1)).astype(int), 0, g - 1), np.clip(np.rint(u * (g - 1)).astype(int), 0, g - 1)] + 0.08
# Les toits, du plus bas au plus haut.
m = DracoPy.decode(open(f"{GEO}/campus.drc", "rb").read())
P = np.asarray(m.points, float).reshape(-1, 3); F = np.asarray(m.faces, np.int64).reshape(-1, 3); T = P[F]
n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
T = T[np.abs(n[:, 1]) > 0.3]
img = Image.fromarray(ground.astype("float32"), "F"); d = ImageDraw.Draw(img)
for t in T[np.argsort(T[:, :, 1].mean(1))]:
    d.polygon([px(p[0], p[2]) for p in t], fill=float(t[:, 1].mean()))
# Les arbres, en disques à hauteur du houppier.
tr = np.fromfile(f"{GEO}/trees.bin", dtype="<f4").reshape(-1, 4)
for x, z, base, hh in tr[np.argsort(tr[:, 2] + tr[:, 3])]:
    r = max(0.7, hh) * 0.3; a = px(x - r, z + r); b = px(x + r, z - r)
    d.ellipse([a, b], fill=float(base + max(0.7, hh) * 0.6))
H = np.maximum(np.asarray(img, dtype="float32"), ground)
# La part de ciel : pour seize directions, l'horizon le plus haut.
cell = 2 * R / S; occ = np.zeros_like(H)
radii = 0.35 * 1.32 ** np.arange(14)                 # de 2 m à 60 m
for k in range(16):
    a = k / 16 * 2 * np.pi; top = np.zeros_like(H)
    for r in radii:
        dx, dz = int(round(np.cos(a) * r / cell)), int(round(np.sin(a) * r / cell))
        top = np.maximum(top, (np.roll(H, (dz, dx), (0, 1)) - H) / r)
    occ += top / np.sqrt(1 + top * top)
light = 1 - occ / 16
out = np.stack([light, (ground - G0) / (G1 - G0), np.zeros_like(light)], -1)
im = Image.fromarray((np.clip(out, 0, 1) * 255).astype("uint8"), "RGB").filter(ImageFilter.GaussianBlur(0.6))
im.save(f"{GEO}/ao.webp", quality=82, method=6)
print("ground", ground.min(), ground.max(), "light", light.min(), light.mean())
