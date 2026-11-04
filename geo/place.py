# Pose les bâtiments et les arbres de swisstopo sur le relief du site, dans les unités de la scène
# (1 unité = 6 m ; x vers l'est, z vers le nord, y vers le haut — le même repère que le terrain).
# Sorties : geo/campus.drc (bâtiments, Draco) et geo/trees.bin (float32 : x, z, sol, hauteur).
import json, sys
import numpy as np
import DracoPy
BLD, VEG, GEO = sys.argv[1], sys.argv[2], sys.argv[3]
meta = json.load(open(f"{GEO}/meta.json"))
UNIT, EXAG = meta["unit"], 1.3
BASE_M = meta["base"]
LAKE = (372 - BASE_M) / UNIT * EXAG
layers = {}
for name, lift in (("near", 0.08), ("mid", 0.05)):
    L = meta["layers"][name]
    g = L["grid"]
    layers[name] = (L, np.fromfile(f"{GEO}/{name}.bin", dtype="<i2").reshape(g, g).astype(float), lift)
def ground(x, z):
    """Hauteur du terrain de la scène en (x, z), comme le calcule slab.js (sommet le plus proche)."""
    out = np.zeros_like(x)
    done = np.zeros(x.shape, bool)
    for name in ("near", "mid"):
        L, h, lift = layers[name]
        size = L["size"] / UNIT; g = L["grid"]
        u = (x - L["cx"] / UNIT) / size + 0.5; v = 0.5 - (z - L["cz"] / UNIT) / size
        ok = (~done) & (u > 0.03) & (u < 0.97) & (v > 0.03) & (v < 0.97)
        col = np.clip(np.round(u * (g - 1)).astype(int), 0, g - 1); row = np.clip(np.round(v * (g - 1)).astype(int), 0, g - 1)
        hh = h[row, col] / UNIT * EXAG
        if name == "mid": hh = np.maximum(hh, LAKE)
        out = np.where(ok, hh + lift, out); done |= ok
    return out

d = np.load(f"{BLD}"); P, T, B = d["P"], d["T"], d["B"]
x = P[:, 0] / UNIT; z = P[:, 1] / UNIT
y = np.zeros(len(P))
for b in np.unique(B):
    m = B == b
    base_h = P[m, 2].min()
    cx, cz = x[m].mean(), z[m].mean()
    gy = ground(np.array([cx]), np.array([cz]))[0]
    # Un léger enfoncement : le pied du bâtiment ne flotte jamais au-dessus d'une pente.
    y[m] = gy - 0.15 + (P[m, 2] - base_h) / UNIT
pts = np.c_[x, y, z].astype(np.float64)
# Un sommet par coin de face : chaque coin moyenne les faces voisines à moins de 35° de la sienne
# (le toit du Rolex devient lisse, les arêtes des façades restent vives).
C = pts[T]                                            # (faces, 3 coins, xyz)
fn = np.cross(C[:, 1] - C[:, 0], C[:, 2] - C[:, 0])
area = np.linalg.norm(fn, axis=1)
ok = area > 1e-7
C, fn, area = C[ok], fn[ok], area[ok]
unit = fn / area[:, None]
corners = C.reshape(-1, 3)
face = np.repeat(np.arange(len(C)), 3)
_, group = np.unique(np.round(corners * 100).astype(np.int64), axis=0, return_inverse=True)
group = group.ravel()
order = np.argsort(group, kind="stable")
starts = np.r_[0, np.flatnonzero(np.diff(group[order])) + 1, len(order)]
normals = np.zeros_like(corners)
COS = np.cos(np.radians(35))
for a0, b0 in zip(starts[:-1], starts[1:]):
    idx = order[a0:b0]
    n = unit[face[idx]]; w = area[face[idx]]
    near = (n @ n.T) > COS
    m = near @ (n * w[:, None])
    normals[idx] = m / np.maximum(np.linalg.norm(m, axis=1, keepdims=True), 1e-9)
# Le haut de chaque verticale : la façade sait où elle est sous le toit.
_, col = np.unique(np.round(corners[:, [0, 2]] * 100).astype(np.int64), axis=0, return_inverse=True)
col = col.ravel()
top = np.full(col.max() + 1, -1e9)
np.maximum.at(top, col, corners[:, 1])
# Le pied, lui, est celui du bâtiment entier : les étages restent horizontaux sur les volumes en gradins.
owner = np.repeat(B[T[:, 0]][ok], 3)
base = np.full(owner.max() + 1, 1e9)
np.minimum.at(base, owner, corners[:, 1])
uv = np.c_[top[col], base[owner]]
faces = np.arange(len(corners), dtype=np.uint32).reshape(-1, 3)
blob = DracoPy.encode(corners.astype(np.float32), faces, quantization_bits=16, compression_level=8,
                      normals=normals, normal_quantization_bits=10,
                      tex_coord=uv, tex_coord_quantization_bits=14)
open(f"{GEO}/campus.drc", "wb").write(blob)
print("campus.drc", len(blob) // 1024, "Ko,", len(corners), "sommets,", len(faces), "triangles")

v = np.load(f"{VEG}"); VP, VS = v["P"], v["S"]
tx, tz = VP[:, 0] / UNIT, VP[:, 1] / UNIT
keep = np.hypot(tx, tz) < 175
tx, tz, VS = tx[keep], tz[keep], VS[keep]
ty = ground(tx, tz)
np.c_[tx, tz, ty, VS / UNIT].astype("<f4").tofile(f"{GEO}/trees.bin")
print("trees.bin", keep.sum(), "arbres")
