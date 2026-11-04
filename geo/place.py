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
import DracoPy, mapbox_earcut, contourpy
from PIL import Image, ImageDraw, ImageFilter
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
y = np.zeros(len(P)); raised = []
EXT0 = 1300; cover = Image.new("1", (2 * EXT0, 2 * EXT0), 0); dc = ImageDraw.Draw(cover)
flat_c = np.zeros(len(ids), bool)
for k, (m, base, g, real) in enumerate(info):
    above = base - c - real
    up = above / UNIT if above > 2.5 else 0.0
    if up > 0: raised.append((k, m, base, g))
    else: flat_c[k] = True
    y[m] = g - 0.06 + up + (P[m, 2] - base) / UNIT
for t in P[T[flat_c[comp[T[:, 0]]]]]:
    dc.polygon([(q[0] + EXT0, EXT0 - q[1]) for q in t], fill=1)
cover = np.asarray(cover)
# Un volume en l'air sans rien dessous n'est pas un étage : c'est un bâtiment dont le bas manque.
# Il descend jusqu'au sol. Seules les passerelles (étroites) restent suspendues.
down = 0; canopies = []
for k, m, base, g in raised:
    q = P[m]
    ix = np.clip((q[:, 0] + EXT0).astype(int), 0, 2 * EXT0 - 1); iz = np.clip((EXT0 - q[:, 1]).astype(int), 0, 2 * EXT0 - 1)
    w_, l_ = sorted((np.ptp(q[:, 0]), np.ptp(q[:, 1])))
    covered = cover[iz, ix].mean()
    if np.ptp(q[:, 2]) < 1.6:
        # Une plaque mince : un auvent, dont swisstopo n'a que le toit. Il garde sa hauteur, sur poteaux.
        if covered < 0.35 and w_ > 2 and not (21.5 < q[:, 0].mean() / UNIT < 39.3 and -11.2 < q[:, 1].mean() / UNIT < 12.7):
            xz = q[:, :2] / UNIT; cen_ = (xz.min(0) + xz.max(0)) / 2
            e_, v_ = np.linalg.eigh(np.cov((xz - xz.mean(0)).T)); ax_ = v_[:, 1]; by_ = np.array([-ax_[1], ax_[0]])
            pa, pb = (xz - cen_) @ ax_, (xz - cen_) @ by_
            cen_ = cen_ + ax_ * (pa.max() + pa.min()) / 2 + by_ * (pb.max() + pb.min()) / 2
            canopies.append([cen_[0], cen_[1], ax_[0], ax_[1], np.ptp(pa) / 2, np.ptp(pb) / 2, y[m].min(), g - 0.06])
        continue
    if covered > 0.35 or w_ < 7: continue
    low = m[P[m, 2] < base + 0.6]
    y[low] = g - 0.06
    down += 1
print("volumes en l'air", len(raised), "dont posés au sol", down, "auvents", len(canopies))
np.array(canopies, dtype="<f4").tofile(f"{GEO}/canopies.bin")
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
WING = np.array([(4.85, 26.6), (4.91, 21.18), (6.3, 21.19), (6.24, 26.61)])
EXTRA = [("BI aile", list(map(tuple, WING)), (1.9 - float(ground(WING[:, 0].copy(), WING[:, 1].copy()).min())) * UNIT), ("RTS boîte nord", box(25.4, 8.5, 7, 5.4, -35), 24.0), ("RTS boîte ouest", box(23.8, 0.4, 4.2, 6, 0), 18.0)]
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
# Le Rolex : son toit seul reste dans le maillage. Ses bords donnent les contours exacts (le
# pourtour et les patios), d'où seront construits le verre, la dalle et le plancher.
tri_c = corners.reshape(-1, 3, 3); cen = tri_c.mean(1)
inside = (np.abs(cen[:, 0]) < 14.2) & (np.abs(cen[:, 2]) < 10.45)
ny = np.abs(unit[:, 1])
crown = top[col].reshape(-1, 3).max(1) - tri_c[:, :, 1].max(1) < 0.08
roof = inside & (ny > 0.35) & crown
rt = tri_c[roof]
# Le contour : le toit tramé finement, lissé d'un rien, tracé ; chaque point prend sa hauteur exacte.
PX = 0.04; X0, Z0 = -14.6, -10.9; NW, NH = int(29.2 / PX), int(21.8 / PX)
ras = Image.new("L", (NW, NH), 0); dr2 = ImageDraw.Draw(ras)
for t in rt:
    dr2.polygon([((p[0] - X0) / PX, (p[2] - Z0) / PX) for p in t], fill=255)
ras = np.asarray(ras.filter(ImageFilter.GaussianBlur(2.2))).astype(float) / 255
gen = contourpy.contour_generator(x=X0 + np.arange(NW) * PX, y=Z0 + np.arange(NH) * PX, z=ras)
def height(px_, pz_):
    A_, B_, C_ = rt[:, 0], rt[:, 1], rt[:, 2]
    d = (B_[:, 2] - C_[:, 2]) * (A_[:, 0] - C_[:, 0]) + (C_[:, 0] - B_[:, 0]) * (A_[:, 2] - C_[:, 2])
    d = np.where(np.abs(d) < 1e-12, 1e-12, d)
    w0 = ((B_[:, 2] - C_[:, 2]) * (px_ - C_[:, 0]) + (C_[:, 0] - B_[:, 0]) * (pz_ - C_[:, 2])) / d
    w1 = ((C_[:, 2] - A_[:, 2]) * (px_ - C_[:, 0]) + (A_[:, 0] - C_[:, 0]) * (pz_ - C_[:, 2])) / d
    w2 = 1 - w0 - w1
    m = (w0 > -1e-3) & (w1 > -1e-3) & (w2 > -1e-3)
    if m.any():
        i = np.flatnonzero(m)[0]
        return w0[i] * A_[i, 1] + w1[i] * B_[i, 1] + w2[i] * C_[i, 1]
    c = rt.mean(1); i = np.argmin(np.hypot(c[:, 0] - px_, c[:, 2] - pz_))
    return rt[i, :, 1].mean()
loops = []
for l in gen.lines(0.5):
    if len(l) < 20: continue
    if np.hypot(*(l[0] - l[-1])) > 1e-6: continue
    # Un point tous les ~20 cm de scène, dans le sens de la longueur.
    seg = np.hypot(*np.diff(l, axis=0).T); arc = np.r_[0, np.cumsum(seg)]
    n_ = max(12, int(arc[-1] / 0.2))
    t_ = np.linspace(0, arc[-1], n_, endpoint=False)
    x_, z_ = np.interp(t_, arc, l[:, 0]), np.interp(t_, arc, l[:, 1])
    cx_, cz_ = x_.mean(), z_.mean()
    y_ = np.array([height(a_ + (cx_ - a_) * 0, b_) for a_, b_ in zip(x_, z_)])
    y_ = np.convolve(np.r_[y_[-3:], y_, y_[:3]], np.ones(7) / 7, "valid")
    loops.append(np.c_[x_, y_, z_])
area = lambda l: 0.5 * np.sum(l[:, 0] * np.roll(l[:, 2], -1) - np.roll(l[:, 0], -1) * l[:, 2])
loops = [l for l in loops if abs(area(l)) > 0.25]
loops.sort(key=lambda l: -abs(area(l)))
# Le premier est le pourtour : tous les contours sont orientés pour que l'extérieur soit à droite.
loops = [l if (area(l) > 0) == (i == 0) else l[::-1] for i, l in enumerate(loops)]
print("Rolex : toit", len(rt), "triangles,", len(loops), "contours", [round(abs(area(l))) for l in loops])
# La coupe réelle : le bâtiment pose au sol et ne se soulève que sous les collines du toit. La rive la
# plus basse est ramenée à la hauteur de la coupe (dalle + verre), le plancher suit le toit à distance
# constante, mais colle au sol tant qu'il n'y a pas de vraie arche.
SECTION = 0.74
outer = loops[0]
delta = np.percentile(outer[:, 1] - ground(outer[:, 0].copy(), outer[:, 2].copy()), 5) - SECTION
print("Rolex : toit abaissé de", round(float(delta * UNIT), 2), "m")
for l in loops: l[:, 1] -= delta
rt[:, :, 1] -= delta
tri_c[roof, :, 1] -= delta
def floor_of(x_, z_, roof_y):
    g_ = ground(np.asarray(x_, float), np.asarray(z_, float)); f_ = roof_y - SECTION + 0.02
    w = np.clip((f_ - g_ - 0.2) / 0.3, 0, 1); w = w * w * (3 - 2 * w)
    return g_ - 0.02 + (f_ - g_ + 0.02) * w
out_f = [float(len(loops))]
for l in loops:
    out_f += [float(len(l))] + np.c_[l, floor_of(l[:, 0], l[:, 2], l[:, 1])].ravel().tolist()
# Le plancher : une surface lisse sous le toit, patios ôtés.
ST = 0.4
gx = np.arange(-14.2, 14.21, ST); gz = np.arange(-10.4, 10.41, ST)
hh = np.zeros((len(gz), len(gx))); ok = np.zeros(hh.shape, bool)
for j, z_ in enumerate(gz):
    for i, x_ in enumerate(gx):
        px_ = int((x_ - X0) / PX); pz_ = int((z_ - Z0) / PX)
        ok[j, i] = 0 <= px_ < NW and 0 <= pz_ < NH and ras[pz_, px_] > 0.5
        if ok[j, i]: hh[j, i] = height(x_, z_)
fl = floor_of(*[a_.ravel() for a_ in np.meshgrid(gx, gz)], hh.ravel()).reshape(hh.shape)
tris = []
for j in range(len(gz) - 1):
    for i in range(len(gx) - 1):
        if ok[j, i] and ok[j, i + 1] and ok[j + 1, i] and ok[j + 1, i + 1]:
            a_, b_, c_, d_ = (gx[i], fl[j, i], gz[j]), (gx[i + 1], fl[j, i + 1], gz[j]), (gx[i + 1], fl[j + 1, i + 1], gz[j + 1]), (gx[i], fl[j + 1, i], gz[j + 1])
            tris += [a_, c_, b_, a_, d_, c_]
out_f += [float(len(tris) // 3)] + np.array(tris).ravel().tolist()
np.array(out_f, dtype="<f4").tofile(f"{GEO}/rolex.bin")
L0 = floor_of(outer[:, 0], outer[:, 2], outer[:, 1]) - ground(outer[:, 0].copy(), outer[:, 2].copy())
print("Rolex : arches, plancher au-dessus du sol m", np.percentile(L0 * UNIT, [10, 50, 90, 100]).round(1), "plancher", len(tris) // 3, "triangles")
keep = ~(inside & ~roof)
corners = tri_c[keep].reshape(-1, 3); normals = normals.reshape(-1, 3, 3)[keep].reshape(-1, 3); uv = uv.reshape(-1, 3, 2)[keep].reshape(-1, 2)
faces = np.arange(len(corners), dtype=np.uint32).reshape(-1, 3)
blob = DracoPy.encode(corners.astype(np.float32), faces, quantization_bits=16, compression_level=8,
                      normals=normals, normal_quantization_bits=12, tex_coord=uv, tex_coord_quantization_bits=14)
open(f"{GEO}/campus.drc", "wb").write(blob)
print("campus.drc", len(blob) // 1024, "Ko,", len(corners), "sommets,", len(faces), "triangles")

# Un enregistrement par bâtiment, pour les façades.
recs = []
owner = owner.reshape(-1, 3)[keep].ravel()
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
