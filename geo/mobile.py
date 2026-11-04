# Les données des téléphones : images plus petites, campus recadré sur ce qu'on voit, relief à 4 m,
# maillage plus léger. Usage : mobile.py <geo> ; écrit dans <geo>/m/.
import json, os, sys
import numpy as np, DracoPy
from PIL import Image
GEO = sys.argv[1]; OUT = f"{GEO}/m"; os.makedirs(OUT, exist_ok=True)
for name, size, q in (("far", 1536, 64), ("mid", 1536, 62), ("near", 2048, 58)):
    Image.open(f"{GEO}/{name}.webp").convert("RGB").resize((size, size), Image.LANCZOS).save(f"{OUT}/{name}.webp", quality=q, method=6)
meta = json.load(open(f"{GEO}/meta.json")); L = meta["layers"]["near"]; g = L["grid"]
h = np.fromfile(f"{GEO}/near.bin", dtype="<i2").reshape(g, g)[::2, ::2]
h.astype("<i2").tofile(f"{OUT}/near.bin"); L["grid"] = h.shape[0]
json.dump(meta, open(f"{OUT}/meta.json", "w"))
m = DracoPy.decode(open(f"{GEO}/campus.drc", "rb").read())
P = np.asarray(m.points, dtype=float).reshape(-1, 3); F = np.asarray(m.faces).reshape(-1, 3)
N = np.asarray(m.normals, dtype=float).reshape(-1, 3); U = np.asarray(m.tex_coord, dtype=float).reshape(-1, 2)
c = P[F].mean(1); keep = np.hypot(c[:, 0], c[:, 2]) < 130
idx = F[keep].ravel()
blob = DracoPy.encode(P[idx].astype(np.float32), np.arange(len(idx), dtype=np.uint32).reshape(-1, 3), quantization_bits=15, compression_level=9,
                      normals=N[idx], normal_quantization_bits=8, tex_coord=U[idx], tex_coord_quantization_bits=12)
open(f"{OUT}/campus.drc", "wb").write(blob)
t = np.fromfile(f"{GEO}/trees.bin", dtype="<f4").reshape(-1, 4)
d = np.hypot(t[:, 0], t[:, 1]); t = t[(d < 60) | ((d < 130) & (np.arange(len(t)) % 2 == 0))]
t.tofile(f"{OUT}/trees.bin")
w = np.fromfile(f"{GEO}/walls.bin", dtype="<f4").reshape(-1, 10)
w = w[np.hypot((w[:, 0] + w[:, 2]) / 2, (w[:, 1] + w[:, 3]) / 2) < 95]
w.tofile(f"{OUT}/walls.bin")
for f in sorted(os.listdir(OUT)): print(f, os.path.getsize(f"{OUT}/{f}") // 1024, "Ko")
print("triangles", int(keep.sum()), "arbres", len(t), "murs", len(w))
Image.open(f"{GEO}/campus-photo.webp").convert("RGB").resize((2048, 2048), Image.LANCZOS).save(f"{OUT}/campus-photo.webp", quality=56, method=6)
print("campus-photo", os.path.getsize(f"{OUT}/campus-photo.webp") // 1024, "Ko")
