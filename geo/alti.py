# Le relief du campus : swissALTI3D à 2 m (swisstopo) sur la couche « near », en décimètres.
# Usage : alti.py <geo> <cache> ; réécrit near.bin et meta.json (grid, scale).
import json, math, os, sys, urllib.request
import numpy as np, tifffile
GEO, CACHE = sys.argv[1], sys.argv[2]
os.makedirs(CACHE, exist_ok=True)
GX, GY, M19 = 271706 * 256 + 983, 185426 * 256 + 963, 0.20546   # m19 relu ci-dessous
meta = json.load(open(f"{GEO}/meta.json")); L = meta["layers"]["near"]
M19 = 52.59797 / 1536 * meta["unit"]
GRID = 527
N = 2 ** 19 * 256
def lv95(lat, lon):
    # Formules approchées de swisstopo (précision de l'ordre du mètre).
    p = (lat * 3600 - 169028.66) / 10000; l = (lon * 3600 - 26782.5) / 10000
    E = 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l ** 3
    Nn = 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p ** 3
    return E, Nn
half = L["size"] / 2
xs = np.linspace(L["cx"] - half, L["cx"] + half, GRID); zs = np.linspace(L["cz"] + half, L["cz"] - half, GRID)
X, Z = np.meshgrid(xs, zs)
gx = GX + X / M19; gy = GY - Z / M19
lon = gx / N * 360 - 180
lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * gy / N))))
E, Nn = lv95(lat, lon)
tiles = {}
def tile(e, n):
    if (e, n) not in tiles:
        name = f"swissalti3d_2019_{e}-{n}_2_2056_5728.tif"
        path = f"{CACHE}/{name}"
        if not os.path.exists(path):
            for year in (2019, 2021, 2023, 2024):
                name = f"swissalti3d_{year}_{e}-{n}_2_2056_5728.tif"
                url = f"https://data.geo.admin.ch/ch.swisstopo.swissalti3d/swissalti3d_{year}_{e}-{n}/{name}"
                try:
                    data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "studytrack-site-bake/1.0"}), timeout=60).read()
                    path = f"{CACHE}/{name}"; open(path, "wb").write(data); break
                except Exception: continue
        tiles[(e, n)] = tifffile.imread(path).astype(np.float32)
    return tiles[(e, n)]
H = np.zeros_like(E)
for e in range(int(E.min() // 1000), int(E.max() // 1000) + 1):
    for n in range(int(Nn.min() // 1000), int(Nn.max() // 1000) + 1):
        m = (E // 1000 == e) & (Nn // 1000 == n)
        if not m.any(): continue
        t = tile(e, n); s = t.shape[0]
        px = (E[m] - e * 1000) / 1000 * s - 0.5; py = ((n + 1) * 1000 - Nn[m]) / 1000 * s - 0.5
        x0 = np.clip(np.floor(px).astype(int), 0, s - 2); y0 = np.clip(np.floor(py).astype(int), 0, s - 2)
        fx = np.clip(px - x0, 0, 1); fy = np.clip(py - y0, 0, 1)
        H[m] = (t[y0, x0] * (1 - fx) * (1 - fy) + t[y0, x0 + 1] * fx * (1 - fy) + t[y0 + 1, x0] * (1 - fx) * fy + t[y0 + 1, x0 + 1] * fx * fy)
print("relief", round(float(H.min()), 1), round(float(H.max()), 1), "au centre", round(float(H[GRID // 2, GRID // 2]), 1))
h = H - meta["base"]
np.round(h * 10).astype("<i2").tofile(f"{GEO}/near.bin")
L.update(grid=GRID, scale=0.1, hmin=float(h.min()), hmax=float(h.max()))
json.dump(meta, open(f"{GEO}/meta.json", "w"), indent=1)
