# Parcourt un tileset 3D Tiles de swisstopo et télécharge les tuiles les plus fines qui touchent
# une zone autour de l'EPFL. Usage : crawl.py <couche> <rayon_m> <dossier>
import json, math, os, sys, urllib.request, urllib.parse, time

LAYER, RADIUS, OUT = sys.argv[1], float(sys.argv[2]), sys.argv[3]
BASE = f"https://3d.geo.admin.ch/{LAYER}/v1/"
LAT, LON = math.radians(46.5184), math.radians(6.5681)
DLAT = RADIUS / 6371000
DLON = RADIUS / (6371000 * math.cos(LAT))
ZONE = (LON - DLON, LAT - DLAT, LON + DLON, LAT + DLAT)
os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "studytrack-site-bake/1.0 (one-off static bake)"}

def get(url):
    path = os.path.join(OUT, "cache", urllib.parse.quote(url, safe=""))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        return open(path, "rb").read()
    for attempt in range(4):
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
            open(path, "wb").write(data)
            return data
        except Exception as e:
            err = e
            time.sleep(1 + attempt)
    raise RuntimeError(f"{url}: {err}")

def hits(region):
    w, s, e, n = region[:4]
    return not (e < ZONE[0] or w > ZONE[2] or n < ZONE[1] or s > ZONE[3])

leaves = []
def walk(node, base):
    bv = node["boundingVolume"]
    if "region" in bv and not hits(bv["region"]):
        return
    content = node.get("content", {})
    uri = content.get("uri") or content.get("url")
    kids = node.get("children", [])
    if uri:
        url = urllib.parse.urljoin(base, uri)
        if uri.endswith(".json"):
            sub = json.loads(get(url))
            walk(sub["root"], url)
            return
        if not kids:
            leaves.append((url, node.get("geometricError", 0), node.get("transform")))
            return
    for k in kids:
        walk(k, base)
    # Un nœud avec contenu dont aucun enfant ne touche la zone : on garde le sien.
    if uri and not uri.endswith(".json") and kids and not any("region" in k["boundingVolume"] and hits(k["boundingVolume"]["region"]) for k in kids):
        leaves.append((urllib.parse.urljoin(base, uri), node.get("geometricError", 0), node.get("transform")))

root = json.loads(get(BASE + "tileset.json"))
walk(root["root"], BASE + "tileset.json")
kinds = {}
for url, ge, tr in leaves:
    data = get(url)
    kinds[data[:4]] = kinds.get(data[:4], 0) + 1
json.dump(leaves, open(os.path.join(OUT, "leaves.json"), "w"))
print(LAYER, len(leaves), "tuiles", kinds, sum(os.path.getsize(os.path.join(OUT, "cache", urllib.parse.quote(u, safe=""))) for u, _, _ in leaves) // 1024, "Ko")
