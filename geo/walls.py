# Les murs du campus, pour y construire les façades en 3D : les faces verticales de campus.drc sont
# regroupées par plan, découpées là où leur hauteur change, et orientées vers l'extérieur.
# Sortie : walls.bin (float32 : x0, z0, x1, z1, y0, y1, nx, nz, famille). Usage : walls.py <geo>
import sys
import numpy as np, DracoPy
from PIL import Image, ImageDraw
GEO = sys.argv[1]
m = DracoPy.decode(open(f"{GEO}/campus.drc", "rb").read())
P = np.asarray(m.points, dtype=float).reshape(-1, 3); F = np.asarray(m.faces, dtype=np.int64).reshape(-1, 3)
tri = P[F]
n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); a = np.linalg.norm(n, axis=1)
ok = a > 1e-6; tri, n, a = tri[ok], n[ok], a[ok]; n = n / a[:, None]
# Le plan des toits, pour savoir de quel côté est l'extérieur.
R, S = 210.0, 4200
plan = Image.new("F", (S, S), -1e6); d = ImageDraw.Draw(plan)
px = lambda x, z: ((x + R) / (2 * R) * S, (R - z) / (2 * R) * S)
roofs = tri[np.abs(n[:, 1]) > 0.3]
for t in roofs[np.argsort(roofs[:, :, 1].max(1))]:             # le plus haut en dernier
    d.polygon([px(p[0], p[2]) for p in t], fill=float(t[:, 1].max()))
plan = np.asarray(plan)
def solid(x, z, y):
    """Y a-t-il de la matière à ce point, à cette hauteur ? (un toit plus bas n'en est pas.)"""
    i = int((x + R) / (2 * R) * S); j = int((R - z) / (2 * R) * S)
    return 0 <= i < S and 0 <= j < S and plan[j, i] > y
styles = np.asarray(Image.open(f"{GEO}/styles.png").convert("L"))
def style(x, z):
    i = int((x / 220 + 0.5) * 1024); j = int((0.5 - z / 220) * 1024)
    return int(styles[j, i]) if 0 <= i < 1024 and 0 <= j < 1024 else 0
v = np.abs(n[:, 1]) < 0.08
tri, n = tri[v], n[v]
ang = np.mod(np.arctan2(n[:, 2], n[:, 0]), np.pi)              # le plan, sans son sens
key = np.round(ang / np.radians(2)).astype(int) % 90
planes = {}
for t, a_ in zip(tri, key):
    dirx, dirz = np.cos(a_ * np.radians(2)), np.sin(a_ * np.radians(2))
    off = t[:, 0].mean() * dirx + t[:, 2].mean() * dirz
    planes.setdefault((int(a_), int(round(off / 0.05))), []).append(t)
out = []
for (a_, o), ts in planes.items():
    nx, nz = np.cos(a_ * np.radians(2)), np.sin(a_ * np.radians(2)); tx, tz = -nz, nx
    us = [[p[0] * tx + p[2] * tz for p in t] for t in ts]
    ys = [[p[1] for p in t] for t in ts]
    br = np.unique(np.round(np.concatenate(us), 2))
    if len(br) < 2: continue
    off = o * 0.05; prev = None
    for u0, u1 in zip(br[:-1], br[1:]):
        c = (u0 + u1) / 2; lo, hi = 1e9, -1e9
        for u, y in zip(us, ys):
            if min(u) - 1e-3 <= c <= max(u) + 1e-3: lo, hi = min(lo, min(y)), max(hi, max(y))
        if hi - lo < 0.2:
            prev = None; continue
        if prev and abs(prev[2] - lo) < 0.1 and abs(prev[3] - hi) < 0.1 and abs(prev[1] - u0) < 0.02: prev[1] = u1
        else:
            prev = [u0, u1, lo, hi]; out.append((a_, off, prev))
rows = []
for a_, off, (u0, u1, lo, hi) in out:
    if u1 - u0 < 0.35: continue
    nx, nz = np.cos(a_ * np.radians(2)), np.sin(a_ * np.radians(2)); tx, tz = -nz, nx
    c = (u0 + u1) / 2; mx, mz = nx * off + tx * c, nz * off + tz * c
    e = 0.35
    probe = hi - 0.25
    p, q = solid(mx + nx * e, mz + nz * e, probe), solid(mx - nx * e, mz - nz * e, probe)
    if p == q: continue                                         # une cloison, pas une façade
    if p: nx, nz = -nx, -nz
    s = style(mx - nx * 0.5, mz - nz * 0.5)
    x0, z0 = np.cos(a_ * np.radians(2)) * off + tx * u0, np.sin(a_ * np.radians(2)) * off + tz * u0
    x1, z1 = np.cos(a_ * np.radians(2)) * off + tx * u1, np.sin(a_ * np.radians(2)) * off + tz * u1
    rows.append((x0, z0, x1, z1, lo, hi, nx, nz, s))
A = np.array(rows, dtype="<f4"); A.tofile(f"{GEO}/walls.bin")
# Le Rolex : un montant tous les 2,40 m, à la hauteur exacte du toit à cet endroit.
def top_at(ts, us, u):
    best = -1e9
    for t, q in zip(ts, us):
        if not (min(q) - 1e-3 <= u <= max(q) + 1e-3): continue
        for i in range(3):
            a0, a1 = q[i], q[(i + 1) % 3]
            if a0 == a1: best = max(best, t[i][1], t[(i + 1) % 3][1]); continue
            f = (u - a0) / (a1 - a0)
            if -1e-3 <= f <= 1 + 1e-3: best = max(best, t[i][1] + f * (t[(i + 1) % 3][1] - t[i][1]))
    return best
mull = []
STEP = 2.4 / 6
pid = 0
for (a_, o), ts in planes.items():
    nx0, nz0 = np.cos(a_ * np.radians(2)), np.sin(a_ * np.radians(2)); tx, tz = -nz0, nx0; off = o * 0.05
    us = [[p[0] * tx + p[2] * tz for p in t] for t in ts]
    lo_u, hi_u = min(map(min, us)), max(map(max, us))
    c = (lo_u + hi_u) / 2
    if style(nx0 * off + tx * c, nz0 * off + tz * c) != 1 and style(nx0 * off + tx * c + nx0 * .3, nz0 * off + tz * c + nz0 * .3) != 1: continue
    n_ = max(1, int(round((hi_u - lo_u) / STEP)))
    pid += 1
    for k in range(n_ + 1):
        u = lo_u + (hi_u - lo_u) * k / n_
        x_, z_ = nx0 * off + tx * u, nz0 * off + tz * u
        t_ = top_at(ts, us, u)
        if t_ < -1e8: continue
        e = 0.25
        p_, q_ = solid(x_ + nx0 * e, z_ + nz0 * e, t_ - 0.3), solid(x_ - nx0 * e, z_ - nz0 * e, t_ - 0.3)
        if p_ == q_: continue
        sgn = -1 if p_ else 1
        mull.append((x_, z_, t_, nx0 * sgn, nz0 * sgn, pid * 4096 + k))
# Un mur coupé en deux par swisstopo donne une rangée trop basse : seul le haut compte.
Q = np.array(mull, dtype=float)
near = np.hypot(Q[:, None, 0] - Q[None, :, 0], Q[:, None, 1] - Q[None, :, 1]) < 0.26
Q = Q[~(near & (Q[None, :, 2] > Q[:, None, 2] + 0.2)).any(1)]
M_ = Q.astype("<f4"); M_.tofile(f"{GEO}/mullions.bin"); print("montants", len(M_), "plans", pid)
L = np.hypot(A[:, 2] - A[:, 0], A[:, 3] - A[:, 1]) * 6; H = (A[:, 5] - A[:, 4]) * 6
print("murs", len(A), "Ko", A.nbytes // 1024)
for s in np.unique(A[:, 8]):
    k = A[:, 8] == s
    print("famille", int(s), "murs", k.sum(), "longueur m", int(L[k].sum()), "surface m²", int((L[k] * H[k]).sum()), "travées 3.6x3.6", int((L[k] * H[k]).sum() / 13))
