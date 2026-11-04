# Le masque du lac pour chaque couche : le relief suréchantillonné à la taille de l'image, l'eau
# là où il est au niveau du lac, bords adoucis. Sortie : geo/{far,mid}-lake.png (niveaux de gris).
import json, sys
import numpy as np
from PIL import Image, ImageFilter
GEO = sys.argv[1]
meta = json.load(open(f"{GEO}/meta.json"))
LAKE_M = 372 - meta["base"]
for name in ("far", "mid"):
    L = meta["layers"][name]
    g = L["grid"]
    h = np.fromfile(f"{GEO}/{name}.bin", dtype="<i2").reshape(g, g).astype(np.float32)
    up = np.asarray(Image.fromarray(h, mode="F").resize((2048, 2048), Image.BICUBIC))
    water = np.clip((LAKE_M + 2.0 - up) / 2.0, 0, 1)
    img = Image.fromarray((water * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6))
    img.save(f"{GEO}/{name}-lake.png", optimize=True)
    print(name, round(float(water.mean()), 3))
