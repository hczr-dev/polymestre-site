# La végétation 3D de swisstopo (i3dm, éventuellement dans des cmpt) → positions et tailles des
# arbres dans le plan local (est, nord, haut, mètres). Sortie : veg.npz
import json, math, struct, sys, urllib.parse
import numpy as np
SRC, OUT = sys.argv[1], sys.argv[2]
LAT, LON = math.radians(46.518353342942014), math.radians(6.568340957164764)  # le centre de la scène (pixel z19)
A, F = 6378137.0, 1 / 298.257223563
E2 = F * (2 - F)
n0 = A / math.sqrt(1 - E2 * math.sin(LAT) ** 2)
ORIGIN = np.array([n0 * math.cos(LAT) * math.cos(LON), n0 * math.cos(LAT) * math.sin(LON), n0 * (1 - E2) * math.sin(LAT)])
R = np.array([
    [-math.sin(LON), math.cos(LON), 0],
    [-math.sin(LAT) * math.cos(LON), -math.sin(LAT) * math.sin(LON), math.cos(LAT)],
    [math.cos(LAT) * math.cos(LON), math.cos(LAT) * math.sin(LON), math.sin(LAT)],
])
pos, scale, model = [], [], []
def i3dm(d):
    _, _, _, ftj, ftb, btj, btb, gf = struct.unpack("<4sIIIIIII", d[:32])
    ft = json.loads(d[32:32 + ftj]); fb = d[32 + ftj:32 + ftj + ftb]
    n = ft["INSTANCES_LENGTH"]
    rtc = np.array(ft.get("RTC_CENTER", [0, 0, 0]))
    p = np.frombuffer(fb, dtype="<f4", count=n * 3, offset=ft["POSITION"]["byteOffset"]).reshape(n, 3).astype(float) + rtc
    s = np.frombuffer(fb, dtype="<f4", count=n, offset=ft["SCALE"]["byteOffset"]).astype(float) if "SCALE" in ft else np.ones(n)
    uri = d[32 + ftj + ftb + btj + btb:].decode("utf-8", "ignore").strip("\x00 ") if gf == 0 else "embedded"
    pos.append((R @ (p - ORIGIN).T).T); scale.append(s); model.extend([uri] * n)
def cmpt(d):
    _, _, _, count = struct.unpack("<4sIII", d[:16])
    off = 16
    for _ in range(count):
        magic = d[off:off + 4]; length = struct.unpack("<I", d[off + 8:off + 12])[0]
        part = d[off:off + length]
        if magic == b"i3dm": i3dm(part)
        elif magic == b"cmpt": cmpt(part)
        off += length
for url, _, _ in json.load(open(f"{SRC}/leaves.json")):
    d = open(f"{SRC}/cache/" + urllib.parse.quote(url, safe=""), "rb").read()
    {b"i3dm": i3dm, b"cmpt": cmpt}.get(d[:4], lambda x: None)(d)
P = np.concatenate(pos); S = np.concatenate(scale)
np.savez_compressed(OUT, P=P, S=S, M=np.array(model))
print(len(P), "arbres · échelle", S.min().round(2), np.median(S).round(2), S.max().round(2), "· modèles", {m: model.count(m) for m in set(model)})
print("étendue", P[:, 0].min().round(), P[:, 0].max().round(), P[:, 1].min().round(), P[:, 1].max().round(), "H", P[:, 2].min().round(), P[:, 2].max().round())
