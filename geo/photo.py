# Le sol du campus à 0,2 m par pixel : 16×16 tuiles SWISSIMAGE z19 autour du Rolex Learning Center.
# Usage : photo.py <geo> ; sorties : campus-photo.webp et campus-photo.json (bornes en unités de scène).
import io, json, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
GEO = sys.argv[1]
TX, TY, N = 271702, 185422, 16
PX, PY = 271706 * 256 + 983, 185426 * 256 + 963       # le centre du bâtiment, en pixels z19
RES = 52.59797 / 1536                                 # unités de scène par pixel z19
URL = "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/19/{x}/{y}.jpeg"
UA = {"User-Agent": "studytrack-site-bake/1.0 (one-off static bake)"}
def tile(ij):
    i, j = ij
    data = urllib.request.urlopen(urllib.request.Request(URL.format(x=TX + i, y=TY + j), headers=UA), timeout=40).read()
    return i, j, Image.open(io.BytesIO(data)).convert("RGB")
img = Image.new("RGB", (N * 256, N * 256))
with ThreadPoolExecutor(6) as pool:
    for i, j, t in pool.map(tile, [(i, j) for i in range(N) for j in range(N)]):
        img.paste(t, (i * 256, j * 256))
img.save(f"{GEO}/campus-photo.webp", quality=70, method=6)
x0 = (TX * 256 - PX) * RES; z1 = (PY - TY * 256) * RES
json.dump({"x0": x0, "x1": x0 + N * 256 * RES, "z0": z1 - N * 256 * RES, "z1": z1}, open(f"{GEO}/campus-photo.json", "w"))
