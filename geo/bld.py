# swissBUILDINGS3D (swisstopo) autour de l'EPFL → un maillage local. Les tuiles b3dm (glTF + Draco)
# sont décodées, ramenées du repère terrestre (ECEF) au plan local centré sur le Rolex Learning
# Center (est, nord, haut, en mètres). Sortie : un npz pour l'étape suivante.
import json, math, struct, sys, urllib.parse
import numpy as np
import DracoPy

SRC, OUT = sys.argv[1], sys.argv[2]
LAT, LON = math.radians(46.518353342942014), math.radians(6.568340957164764)  # le centre de la scène (pixel z19)
A, F = 6378137.0, 1 / 298.257223563
E2 = F * (2 - F)
def ecef(lat, lon, h):
    n = A / math.sqrt(1 - E2 * math.sin(lat) ** 2)
    return np.array([(n + h) * math.cos(lat) * math.cos(lon), (n + h) * math.cos(lat) * math.sin(lon), (n * (1 - E2) + h) * math.sin(lat)])
ORIGIN = ecef(LAT, LON, 0)
R = np.array([
    [-math.sin(LON), math.cos(LON), 0],
    [-math.sin(LAT) * math.cos(LON), -math.sin(LAT) * math.sin(LON), math.cos(LAT)],
    [math.cos(LAT) * math.cos(LON), math.cos(LAT) * math.sin(LON), math.sin(LAT)],
])

def quat_mat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
def node_matrix(n):
    m = np.eye(4)
    if "matrix" in n:
        return np.array(n["matrix"]).reshape(4, 4).T
    if "scale" in n: m[:3, :3] = np.diag(n["scale"])
    if "rotation" in n: m[:3, :3] = quat_mat(n["rotation"]) @ m[:3, :3]
    if "translation" in n: m[:3, 3] = n["translation"]
    return m
Y_UP_TO_Z_UP = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], dtype=float)

pos_all, tri_all, col_all, bid_all = [], [], [], []
offset = 0; bid = 0
leaves = json.load(open(f"{SRC}/leaves.json"))
for url, _, _ in leaves:
    d = open(f"{SRC}/cache/" + urllib.parse.quote(url, safe=""), "rb").read()
    _, _, _, ftj, ftb, btj, btb = struct.unpack("<4sIIIIII", d[:28])
    ft = json.loads(d[28:28 + ftj]) if ftj else {}
    rtc = np.array(ft.get("RTC_CENTER", [0, 0, 0]))
    g = d[28 + ftj + ftb + btj + btb:]
    jl = struct.unpack("<I", g[12:16])[0]
    j = json.loads(g[20:20 + jl])
    bin_off = 20 + jl + 8
    binb = g[bin_off:]
    # Les nœuds enfants : on parcourt depuis les scènes.
    def visit(i, parent):
        global offset, bid
        n = j["nodes"][i]
        m = parent @ node_matrix(n)
        if "mesh" in n:
            for prim in j["meshes"][n["mesh"]]["primitives"]:
                ext = prim.get("extensions", {}).get("KHR_draco_mesh_compression")
                if not ext: continue
                bv = j["bufferViews"][ext["bufferView"]]
                raw = binb[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
                mesh = DracoPy.decode(raw)
                pts = np.asarray(mesh.points, dtype=float).reshape(-1, 3)
                faces = np.asarray(mesh.faces, dtype=np.int64).reshape(-1, 3)
                if not len(faces): continue
                h = np.c_[pts, np.ones(len(pts))]
                world = (Y_UP_TO_Z_UP @ m @ h.T).T[:, :3] + rtc
                enu = (R @ (world - ORIGIN).T).T
                mat = j["materials"][prim["material"]] if "material" in prim else {}
                c = mat.get("pbrMetallicRoughness", {}).get("baseColorFactor", [0.9, 0.9, 0.9, 1])[:3]
                pos_all.append(enu); tri_all.append(faces + offset)
                col_all.append(np.tile(c, (len(enu), 1))); bid_all.append(np.full(len(enu), bid))
                offset += len(enu)
            bid += 1
        for k in n.get("children", []):
            visit(k, m)
    for s in j.get("scenes", [{"nodes": list(range(len(j["nodes"])))}]):
        for i in s["nodes"]:
            visit(i, np.eye(4))

P = np.concatenate(pos_all); T = np.concatenate(tri_all); C = np.concatenate(col_all); B = np.concatenate(bid_all)
np.savez_compressed(OUT, P=P, T=T, C=C, B=B)
print("bâtiments", bid, "sommets", len(P), "triangles", len(T))
print("étendue E", P[:, 0].min().round(), P[:, 0].max().round(), "N", P[:, 1].min().round(), P[:, 1].max().round(), "H", P[:, 2].min().round(), P[:, 2].max().round())
near = (np.abs(P[:, 0]) < 90) & (np.abs(P[:, 1]) < 70)
print("près du centre", near.sum(), "H", P[near, 2].min().round(1) if near.any() else None, P[near, 2].max().round(1) if near.any() else None)
print("couleurs", np.unique(np.round(C, 2), axis=0)[:12])
