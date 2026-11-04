# Les bâtiments autour du Rolex Learning Center (OpenStreetMap, ODbL) : empreintes et hauteurs,
# en unités de 6 m autour du bâtiment, posées sur le relief. Sortie : geo/buildings.bin
# (float32 : n, hauteur, sol, puis n couples x, z ; à la suite pour chaque bâtiment).
import json, math, sys
import numpy as np
OSM, GEO = sys.argv[1], sys.argv[2]
meta = json.load(open(f"{GEO}/meta.json"))
UNIT, EXAG = meta["unit"], 1.3
EARTH = 40075016.686
GX19, GY19 = 271706 * 256 + 983, 185426 * 256 + 963
def to_local(lat, lon):
    n = 256 * 2 ** 19
    gx = (lon + 180) / 360 * n
    lr = math.radians(lat)
    gy = (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n
    m = EARTH * math.cos(math.radians(46.5184)) / n
    return (gx - GX19) * m / UNIT, -(gy - GY19) * m / UNIT
grids = {}
for name in ("near", "mid"):
    L = meta["layers"][name]
    grids[name] = (L, np.fromfile(f"{GEO}/{name}.bin", dtype="<i2").reshape(L["grid"], L["grid"]).astype(float))
def ground(x, z):
    for name in ("near", "mid"):
        L, h = grids[name]
        size = L["size"] / UNIT
        u = (x - L["cx"] / UNIT) / size + 0.5; v = 0.5 - (z - L["cz"] / UNIT) / size
        if 0.02 < u < 0.98 and 0.02 < v < 0.98:
            g = L["grid"] - 1
            return h[int(round(v * g)), int(round(u * g))] / UNIT * EXAG
    return 0.0
def height(tags):
    try:
        if "height" in tags: return float(tags["height"].split()[0].replace(",", "."))
    except ValueError: pass
    try:
        if "building:levels" in tags: return float(tags["building:levels"]) * 3.3 + 1.5
    except ValueError: pass
    kind = tags.get("building", "yes")
    return {"house": 7, "detached": 7, "garage": 3, "shed": 3, "roof": 4, "university": 14, "school": 11,
            "apartments": 14, "commercial": 11, "industrial": 9}.get(kind, 9)
out, count = [], 0
for el in json.load(open(OSM))["elements"]:
    rings = []
    if el["type"] == "way" and "geometry" in el:
        rings.append(el["geometry"])
    elif el["type"] == "relation":
        rings += [m["geometry"] for m in el.get("members", []) if m.get("role") == "outer" and "geometry" in m]
    tags = el.get("tags", {})
    if tags.get("name", "").startswith("Rolex Learning"):
        continue
    for ring in rings:
        pts = [to_local(p["lat"], p["lon"]) for p in ring]
        if len(pts) < 4: continue
        if pts[0] == pts[-1]: pts = pts[:-1]
        cx = sum(p[0] for p in pts) / len(pts); cz = sum(p[1] for p in pts) / len(pts)
        if abs(cx) < 15.5 and abs(cz) < 11.5:  # le Rolex Learning Center lui-même
            continue
        base = min(ground(x, z) for x, z in pts)
        out += [len(pts), height(tags) / UNIT, base]
        for x, z in pts: out += [x, z]
        count += 1
np.array(out, dtype="<f4").tofile(f"{GEO}/buildings.bin")
print(count, "bâtiments", len(out) * 4 // 1024, "Ko")
