# Pose les bâtiments et les arbres de swisstopo sur le relief, dans les unités de la scène
# (1 unité = 6 m ; x vers l'est, z vers le nord, y vers le haut).
#  · chaque bâtiment est posé à part, sur le point le plus bas de son pied (un groupe de tuile en
#    contient plusieurs) ; un volume réellement au-dessus du sol y reste ;
#  · ce qu'OpenStreetMap connaît et que swissBUILDINGS3D n'a pas encore (la RTS) est extrudé ;
#  · sorties : campus.drc (Draco : normales lissées, uv = haut de la verticale et pied du bâtiment),
#    trees.bin (float32 x, z, sol, hauteur), et comps.json (un enregistrement par bâtiment).
# Usage : place.py <bld.npz> <veg.npz> <geo> <osm.json> <comps.json>
import json, math, sys
import numpy as np
import DracoPy, mapbox_earcut
from PIL import Image, ImageDraw
BLD, VEG, GEO, OSM, COMPS = sys.argv[1:6]
meta = json.load(open(f"{GEO}/meta.json"))
UNIT, EXAG, BASE_M = meta["unit"], 1.3, meta["base"]
LAKE = (372 - BASE_M) / UNIT * EXAG
LIFT = {"near": 0.08, "mid": 0.05}
layers = {}
for name in ("near", "mid"):
    L = meta["layers"][name]; g = L["grid"]
    layers[name] = (L, np.fromfile(f"{GEO}/{name}.bin", dtype="<i2").reshape(g, g).astype(float) * L.get("scale", 1))
def ground(x, z):
    """Hauteur du terrain de la scène en (x, z), comme slab.js (sommet le plus proche)."""
    out = np.zeros_like(x); done = np.zeros(x.shape, bool)
    for name in ("near", "mid"):
        L, h = layers[name]; size = L["size"] / UNIT; g = L["grid"]
        u = (x - L["cx"] / UNIT) / size + 0.5; v = 0.5 - (z - L["cz"] / UNIT) / size
        ok = (~done) & (u > 0.03) & (u < 0.97) & (v > 0.03) & (v < 0.97)
        col = np.clip(np.round(u * (g - 1)).astype(int), 0, g - 1); row = np.clip(np.round(v * (g - 1)).astype(int), 0, g - 1)
        hh = h[row, col] / UNIT * EXAG
        if name == "mid": hh = np.maximum(hh, LAKE)
        out = np.where(ok, hh + LIFT[name], out); done |= ok
    return out

d = np.load(BLD); P, T = d["P"], d["T"].astype(np.int64)
# Les bâtiments : composantes connexes du maillage.
_, inv = np.unique(np.round(P * 20).astype(np.int64), axis=0, return_inverse=True); inv = inv.ravel()
par = np.arange(inv.max() + 1)
def find(a):
    while par[a] != a:
        par[a] = par[par[a]]; a = par[a]
    return a
for t in inv[T]:
    a = find(t[0]); par[find(t[1])] = a; par[find(t[2])] = a
root = np.array([find(i) for i in range(len(par))])[inv]
ids, comp = np.unique(root, return_inverse=True); comp = comp.ravel()
print("bâtiments", len(ids))
x, z = P[:, 0] / UNIT, P[:, 1] / UNIT
order = np.argsort(comp, kind="stable"); cuts = np.r_[0, np.flatnonzero(np.diff(comp[order])) + 1, len(order)]
info = []
for a0, b0 in zip(cuts[:-1], cuts[1:]):
    m = order[a0:b0]; h = P[m, 2]; base = h.min()
    foot = m[h < base + 0.6]
    g = ground(x[foot], z[foot]).min()
    info.append((m, base, g, (g - LIFT["near"]) * UNIT / EXAG + BASE_M))
c = np.median([i[1] - i[3] for i in info])            # ellipsoïde → altitude
print("décalage altimétrique", round(float(c), 2))
y = np.zeros(len(P)); raised = 0
for m, base, g, real in info:
    above = base - c - real
    up = above / UNIT if above > 2.5 else 0.0
    raised += up > 0
    y[m] = g - 0.06 + up + (P[m, 2] - base) / UNIT
print("volumes au-dessus du sol", raised)
pts = np.c_[x, y, z]
owner_v = comp.copy()
# La RTS (OFFICE Kersten Geers David Van Severen, 2014-2025) : swissBUILDINGS3D n'en a que des
# fragments de chantier, on les retire. Quatre boîtes portent une dalle double hauteur suspendue à
# 8 m au-dessus du sol. Deux boîtes sont dans OSM, deux relevées sur la photo aérienne.
site = (21.5, 39.3, -11.2, 12.7)
stub = np.zeros(len(ids), bool)
for k, (m, *_rest) in enumerate(info):
    q = pts[m]
    stub[k] = q[:, 0].min() > site[0] and q[:, 0].max() < site[1] and q[:, 2].min() > site[2] and q[:, 2].max() < site[3] and np.ptp(q[:, 1]) < 3
T = T[~stub[comp[T[:, 0]]]]
print("fragments retirés", stub.sum())
def box(cx, cz, w, d, deg):
    a = math.radians(deg); c, s_ = math.cos(a), math.sin(a)
    return [(cx + u * c - v * s_, cz + u * s_ + v * c) for u, v in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]
EXTRA = [("RTS boîte nord", box(25.4, 8.5, 7, 5.4, -35), 24.0), ("RTS boîte ouest", box(23.8, 0.4, 4.2, 6, 0), 18.0)]
SPEC = {"RTS (Radio Télévision Suisse) - Lausanne-Ecublens)": (8.0, 17.0), "RTS - Emergence Sud": (0, 34.0), "RTS - Emergence Est": (0, 30.0)}

# Ce qui manque : un plan au mètre de tout ce que couvre le modèle.
EXT = 1200; S = 2 * EXT
plan = Image.new("1", (S, S), 0); dr = ImageDraw.Draw(plan)
for t in pts[T][:, :, [0, 2]] * UNIT:
    dr.polygon([(p[0] + EXT, EXT - p[1]) for p in t], fill=1)
plan = np.asarray(plan)
GX, GY, M19, N = 271706 * 256 + 983, 185426 * 256 + 963, 52.59797 / 1536 * UNIT, 2 ** 19 * 256
def scene_m(lat, lon):
    gx = (lon + 180) / 360 * N
    gy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * N
    return (gx - GX) * M19, (GY - gy) * M19
o = json.load(open(OSM)); els = o["elements"] if isinstance(o, dict) else o
added = []; nv = len(pts); newp, newt, newo = [], [], []; nid = len(ids)
def prism(r, low, high):
    """Un volume extrudé : murs, toit, et dessous s'il est en l'air (hauteurs en mètres depuis le sol)."""
    global nid
    gy = ground(r[:, 0].copy(), r[:, 1].copy()).min() - 0.06
    y0, y1 = gy + low / UNIT, gy + high / UNIT
    q = np.roll(r, -1, 0)
    if (r[:, 0] * q[:, 1] - q[:, 0] * r[:, 1]).sum() < 0: r = r[::-1]
    k = len(r); off = nv + sum(len(a) for a in newp)
    newp.append(np.r_[np.c_[r[:, 0], np.full(k, y0), r[:, 1]], np.c_[r[:, 0], np.full(k, y1), r[:, 1]]])
    tri = [[i, (i + 1) % k, k + i] for i in range(k)] + [[(i + 1) % k, k + (i + 1) % k, k + i] for i in range(k)]
    cap = mapbox_earcut.triangulate_float64(r, np.array([k], dtype=np.uint32)).reshape(-1, 3)
    faces_ = [np.array(tri), cap + k] + ([cap] if low > 0 else [])
    newt.append(np.concatenate(faces_) + off); newo.append(np.full(2 * k, nid)); nid += 1
names = []
for e in els:
    g = e.get("geometry") or []
    if len(g) < 4: continue
    t = e.get("tags", {})
    ring = np.array([scene_m(p["lat"], p["lon"]) for p in g[:-1]])
    names.append((ring.mean(0), t.get("name") or t.get("addr:housename"), t.get("building:levels")))
    if np.abs(ring).max() > EXT - 5: continue
    px, py = ring[:, 0] + EXT, EXT - ring[:, 1]
    bx, by = int(px.min()), int(py.min()); bw, bh = int(px.max()) - bx + 2, int(py.max()) - by + 2
    mask = Image.new("1", (bw, bh), 0); ImageDraw.Draw(mask).polygon(list(zip(px - bx, py - by)), fill=1)
    mask = np.asarray(mask)
    area = mask.sum()
    if area < 60 or t.get("building") in ("roof", "construction", "ruins") or t.get("layer", "0").startswith("-"): continue
    spec = SPEC.get(t.get("name"))
    if spec is None and plan[by:by + bh, bx:bx + bw][mask].mean() > 0.2: continue
    levels = float(t.get("building:levels", 3)); h = float(t.get("height", levels * 3.4))
    prism(ring / UNIT, *(spec or (0, h)))
    added.append((t.get("name"), t.get("addr:street"), round(float(ring[:, 0].mean())), round(float(ring[:, 1].mean())), int(area), levels))
for name, ring, h in EXTRA:
    prism(np.array(ring), 0, h); added.append((name, None, 0, 0, 99999, h))
print("ajoutés depuis OSM", len(added)); [print("  ", a) for a in sorted(added, key=lambda a: -a[4])[:24]]
if newp:
    pts = np.r_[pts, np.concatenate(newp)]; T = np.r_[T, np.concatenate(newt)]; owner_v = np.r_[owner_v, np.concatenate(newo)]

# Un sommet par coin : chaque coin moyenne les faces voisines à moins de 35° de la sienne.
C = pts[T]
fn = np.cross(C[:, 1] - C[:, 0], C[:, 2] - C[:, 0]); area = np.linalg.norm(fn, axis=1)
ok = area > 1e-7
C, fn, area = C[ok], fn[ok], area[ok]
unit = fn / area[:, None]
corners = C.reshape(-1, 3); face = np.repeat(np.arange(len(C)), 3)
_, group = np.unique(np.round(corners * 100).astype(np.int64), axis=0, return_inverse=True); group = group.ravel()
order = np.argsort(group, kind="stable")
starts = np.r_[0, np.flatnonzero(np.diff(group[order])) + 1, len(order)]
normals = np.zeros_like(corners); COS = np.cos(np.radians(35))
for a0, b0 in zip(starts[:-1], starts[1:]):
    idx = order[a0:b0]; n = unit[face[idx]]; w = area[face[idx]]
    m = ((n @ n.T) > COS) @ (n * w[:, None])
    normals[idx] = m / np.maximum(np.linalg.norm(m, axis=1, keepdims=True), 1e-9)
# Le haut de chaque verticale, le pied du bâtiment entier.
_, col = np.unique(np.round(corners[:, [0, 2]] * 100).astype(np.int64), axis=0, return_inverse=True); col = col.ravel()
top = np.full(col.max() + 1, -1e9); np.maximum.at(top, col, corners[:, 1])
owner = np.repeat(owner_v[T[:, 0]][ok], 3)
base = np.full(owner.max() + 1, 1e9); np.minimum.at(base, owner, corners[:, 1])
uv = np.c_[top[col], base[owner]]
faces = np.arange(len(corners), dtype=np.uint32).reshape(-1, 3)
blob = DracoPy.encode(corners.astype(np.float32), faces, quantization_bits=16, compression_level=8,
                      normals=normals, normal_quantization_bits=12, tex_coord=uv, tex_coord_quantization_bits=14)
open(f"{GEO}/campus.drc", "wb").write(blob)
print("campus.drc", len(blob) // 1024, "Ko,", len(corners), "sommets,", len(faces), "triangles")

# Un enregistrement par bâtiment, pour les façades.
recs = []
for b in np.unique(owner):
    m = owner == b; p = corners[m]
    cx, cz = float((p[:, 0].min() + p[:, 0].max()) / 2), float((p[:, 2].min() + p[:, 2].max()) / 2)
    best = min(names, key=lambda q: math.hypot(q[0][0] / UNIT - cx, q[0][1] / UNIT - cz) if q[1] else 1e9)
    near = math.hypot(best[0][0] / UNIT - cx, best[0][1] / UNIT - cz)
    recs.append({"id": int(b), "x0": float(p[:, 0].min()), "x1": float(p[:, 0].max()), "z0": float(p[:, 2].min()), "z1": float(p[:, 2].max()),
                 "h": float((p[:, 1].max() - p[:, 1].min()) * UNIT), "name": best[1] if near < 12 else None})
json.dump(recs, open(COMPS, "w"))
big = sorted(recs, key=lambda r: -(r["x1"] - r["x0"]) * (r["z1"] - r["z0"]))[:3]
print("plus grands", [(r["name"], round(r["x0"], 2), round(r["x1"], 2), round(r["z0"], 2), round(r["z1"], 2)) for r in big])

# Les arbres : réels, sauf ceux qui tomberaient dans un bâtiment.
v = np.load(VEG); VP, VS = v["P"], v["S"]
tx, tz = VP[:, 0] / UNIT, VP[:, 1] / UNIT
ix = np.clip((tx * UNIT + EXT).astype(int), 0, S - 1); iz = np.clip((EXT - tz * UNIT).astype(int), 0, S - 1)
L = meta["layers"]["mid"]; size = L["size"] / UNIT
wet = np.asarray(Image.open(f"{GEO}/mid-lake.png").convert("L")).astype(float) / 255
wu = np.clip(((tx - L["cx"] / UNIT) / size + 0.5) * wet.shape[1], 0, wet.shape[1] - 1).astype(int)
wv = np.clip((0.5 - (tz - L["cz"] / UNIT) / size) * wet.shape[0], 0, wet.shape[0] - 1).astype(int)
keep = (np.hypot(tx, tz) < 175) & ~plan[iz, ix] & (wet[wv, wu] < 0.2)
tx, tz, VS = tx[keep], tz[keep], VS[keep]
np.c_[tx, tz, ground(tx, tz), VS / UNIT].astype("<f4").tofile(f"{GEO}/trees.bin")
print("trees.bin", keep.sum(), "arbres")
