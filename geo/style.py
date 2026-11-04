# La carte des façades : pour chaque bâtiment du campus, sa famille (relevée sur des photos), d'après
# son nom dans OpenStreetMap. 1024² sur ±110 unités ; rouge = numéro de famille. Sortie : styles.png.
# 0 divers · 1 Rolex · 2 aluminium clair à bandeaux · 3 ocre EL/IN · 4 volets inclinés (ME D) · 5 BI
# 6 BM · 7 mur-rideau · 8 métal sombre · 9 boîtes RTS · 10 dalle RTS · 11 bois (ArtLab)
import json, math, re, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
GEO, OSM = sys.argv[1], sys.argv[2]
UNIT = 6.0; GX, GY, M19, N = 271706 * 256 + 983, 185426 * 256 + 963, 52.59797 / 1536 * UNIT, 2 ** 19 * 256
R, S = 110.0, 1024
def sm(la, lo):
    return ((lo + 180) / 360 * N - GX) * M19 / UNIT, (GY - (1 - math.asinh(math.tan(math.radians(la))) / math.pi) / 2 * N) * M19 / UNIT
px = lambda p: ((p[0] + R) / (2 * R) * S, (R - p[1]) / (2 * R) * S)
RULES = [(r"^ME D", 4), (r"^BI$", 5), (r"^BM$", 6), (r"^BC$", 8), (r"^PAVILION", 11), (r"SwissTech|Starling", 7), (r"^RTS - ", 9), (r"^RTS \(", 10),
         (r"^(EL[A-Z]|IN[A-Z]|DIA|DLLEL|ODY)\b", 3), (r"^(ME|MA|CM|CE|CO|PH|GC|GR|CH|BS|AA[A-Z]|SG|SV|MX[A-Z]|PO|PPH|PPB|PSE|TCV|STT|STF|GA)\b", 2)]
o = json.load(open(OSM)); els = o["elements"] if isinstance(o, dict) else o
img = Image.new("L", (S, S), 0); d = ImageDraw.Draw(img); count = {}
polys = []
for e in els:
    g = e.get("geometry") or []
    if not g:   # une relation : son contour extérieur
        for m in e.get("members", []):
            if m.get("role") == "outer": g = g + (m.get("geometry") or [])
    if not g and e.get("bounds"):   # sans géométrie : son emprise
        b = e["bounds"]
        g = [{"lat": b["minlat"], "lon": b["minlon"]}, {"lat": b["minlat"], "lon": b["maxlon"]}, {"lat": b["maxlat"], "lon": b["maxlon"]}, {"lat": b["maxlat"], "lon": b["minlon"]}]
    if len(g) < 3: continue
    t = e.get("tags", {}); name = t.get("name", "")
    st = next((v for r, v in RULES if re.search(r, name)), 0)
    if not st and t.get("building:colour", "").upper() == "#D9BD97": st = 3
    if not st and t.get("building") in ("university", "school"): st = 2
    if st: polys.append((st, [sm(p["lat"], p["lon"]) for p in g])); count[st] = count.get(st, 0) + 1
for st, r in sorted(polys, key=lambda a: a[0] == 9):   # la dalle d'abord, les boîtes par-dessus
    if st == 10 or st != 9: d.polygon([px(p) for p in r], fill=st)
for st, r in polys:
    if st == 9: d.polygon([px(p) for p in r], fill=st)
def box(cx, cz, w, dd, deg):
    a = math.radians(deg); c, s = math.cos(a), math.sin(a)
    return [(cx + u * c - v * s, cz + u * s + v * c) for u, v in ((-w / 2, -dd / 2), (w / 2, -dd / 2), (w / 2, dd / 2), (-w / 2, dd / 2))]
for b in (box(25.4, 8.5, 7, 5.4, -35), box(23.8, 0.4, 4.2, 6, 0)): d.polygon([px(p) for p in b], fill=9)
a = np.asarray(img)
grown = np.asarray(img.filter(ImageFilter.MaxFilter(5)))
a = np.where(a == 0, grown, a)
img = Image.fromarray(a.astype("uint8")); d = ImageDraw.Draw(img)
d.rectangle([px((-14.3, 10.5)), px((14.2, -10.5))], fill=1)
img.save(f"{GEO}/styles.png", optimize=True)
print(sorted(count.items()))
