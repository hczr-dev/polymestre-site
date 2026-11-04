# Cuisson des données géographiques du site : images aériennes et relief, centrés sur le
# Rolex Learning Center. Sortie : geo/{far,mid,near}.webp, geo/{far,mid,near}.bin (Int16,
# mètres au-dessus du sol du bâtiment), geo/meta.json.
import io, json, math, os, sys, time, urllib.request
import numpy as np
from PIL import Image

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
LAT = 46.5184
COS = math.cos(math.radians(LAT))
EARTH = 40075016.686
# Le centre du bâtiment, en pixels globaux au zoom 19 (mesuré sur l'image z19).
GX19, GY19 = 271706 * 256 + 983, 185426 * 256 + 963

SRC = {
    "swiss": "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg",
    "eox": "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg",
    "terrain": "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png",
}
CACHE = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(CACHE, exist_ok=True)

def get(src, z, x, y):
    path = os.path.join(CACHE, f"{src}-{z}-{x}-{y}")
    if os.path.exists(path):
        return open(path, "rb").read()
    url = SRC[src].format(z=z, x=x, y=y)
    req = urllib.request.Request(url, headers={"User-Agent": "studytrack-site-bake/1.0 (one-off static bake)"})
    for attempt in range(4):
        try:
            data = urllib.request.urlopen(req, timeout=40).read()
            open(path, "wb").write(data)
            return data
        except Exception as e:
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(url)

def center(z):
    f = 2 ** (19 - z)
    return GX19 / f, GY19 / f

def mpp(z):
    return EARTH * COS / (256 * 2 ** z)

def mosaic(src, z, n, mode="RGB"):
    cx, cy = center(z)
    x0 = int(math.floor(cx / 256 - n / 2)); y0 = int(math.floor(cy / 256 - n / 2))
    img = Image.new(mode, (256 * n, 256 * n))
    for j in range(n):
        for i in range(n):
            t = Image.open(io.BytesIO(get(src, z, x0 + i, y0 + j))).convert(mode)
            if t.size != (256, 256):
                t = t.resize((256, 256))
            img.paste(t, (256 * i, 256 * j))
    return img, x0, y0

def layer_meta(z, n, x0, y0):
    cx, cy = center(z)
    m = mpp(z)
    size = 256 * n * m
    # Centre de l'image par rapport au bâtiment, en mètres (x vers l'est, z vers le nord).
    ox = (x0 * 256 + 128 * n - cx) * m
    oz = -(y0 * 256 + 128 * n - cy) * m
    return {"z": z, "n": n, "size": size, "cx": ox, "cz": oz}

# --- Le relief --------------------------------------------------------------------------
def terrain(z, n):
    img, x0, y0 = mosaic("terrain", z, n)
    a = np.asarray(img).astype(np.float64)
    h = a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768
    return h, x0, y0

def sampler(h, z, x0, y0):
    # Hauteur en un point global (pixel au zoom 19) par interpolation bilinéaire.
    f = 2 ** (19 - z)
    def at(gx, gy):
        px = gx / f - x0 * 256 - 0.5; py = gy / f - y0 * 256 - 0.5
        px = np.clip(px, 0, h.shape[1] - 1.001); py = np.clip(py, 0, h.shape[0] - 1.001)
        ix = px.astype(int); iy = py.astype(int); fx = px - ix; fy = py - iy
        return (h[iy, ix] * (1 - fx) * (1 - fy) + h[iy, ix + 1] * fx * (1 - fy)
                + h[iy + 1, ix] * (1 - fx) * fy + h[iy + 1, ix + 1] * fx * fy)
    return at

h10, tx10, ty10 = terrain(10, 4)
coarse = sampler(h10, 10, tx10, ty10)
h13, tx13, ty13 = terrain(13, 3)
fine = sampler(h13, 13, tx13, ty13)
base = float(fine(np.array([GX19]), np.array([GY19]))[0])
print("base elevation", round(base, 1))

def heights(meta, grid, sample):
    # Grille grid×grid sur l'étendue de la couche, en pixels globaux z19.
    m19 = mpp(19)
    half = meta["size"] / 2
    xs = np.linspace(meta["cx"] - half, meta["cx"] + half, grid)
    zs = np.linspace(meta["cz"] + half, meta["cz"] - half, grid)  # du nord au sud (haut de l'image en premier)
    X, Z = np.meshgrid(xs, zs)
    gx = GX19 + X / m19; gy = GY19 - Z / m19
    return sample(gx, gy) - base

meta = {"base": base, "unit": 6.0, "layers": {}}
for name, src, z, n, grid, samp, q, size in [
    ("far", "eox", 11, 8, 257, coarse, 70, 2048),
    ("mid", "swiss", 14, 8, 257, fine, 74, 2048),
    ("near", "swiss", 18, 6, 97, fine, 74, 1536),
]:
    img, x0, y0 = mosaic(src, z, n)
    if img.width != size:
        img = img.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(OUT, f"{name}.webp"), "WEBP", quality=q, method=6)
    lm = layer_meta(z, n, x0, y0)
    h = heights(lm, grid, samp)
    if name == "near":
        # Le campus sous le bâtiment, à plat : le bâtiment pose sur y = 0.
        half = lm["size"] / 2
        xs = np.linspace(lm["cx"] - half, lm["cx"] + half, grid)
        zs = np.linspace(lm["cz"] + half, lm["cz"] - half, grid)
        X, Z = np.meshgrid(xs, zs)
        d = np.maximum(np.abs(X) / 95, np.abs(Z) / 72)
        w = np.clip((d - 1) / 1.2, 0, 1)
        h = h * w
    np.round(h).astype("<i2").tofile(os.path.join(OUT, f"{name}.bin"))
    lm["grid"] = grid
    lm["hmin"], lm["hmax"] = float(h.min()), float(h.max())
    meta["layers"][name] = lm
    print(name, json.dumps(lm))

json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"), indent=1)
