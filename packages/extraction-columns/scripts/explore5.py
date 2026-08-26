"""Scratch #5: canonical dedup + connected-component + closed-loop detection."""
import json, math, re
from collections import defaultdict, Counter

FIX = "../extraction-mupdf/extraction-results/secondary-fixture.json"
d = json.load(open(FIX))
mm = d["scaleMmPerPt"]
claimed = set()
wall_ids = set()
for c in d["claimed"]:
    claimed.update(c["sourceIds"])
    if c["kind"] == "wall":
        wall_ids.update(c["sourceIds"])

RE_SEG = re.compile(r"^(.*):seg:(\d+)$")
RE_L = re.compile(r"^(.*):L(\d+)$")
RE_S = re.compile(r"^(.*):s(\d+)$")

# wall envelope for context
wl = [l for l in d["lines"] if l["id"] in wall_ids]
wx = [p["x"] for l in wl for p in (l["a"], l["b"])]
wy = [p["y"] for l in wl for p in (l["a"], l["b"])]
print(f"wall bbox pt: x {min(wx):.0f}..{max(wx):.0f} y {min(wy):.0f}..{max(wy):.0f}")
print(f"wall bbox m : {(max(wx)-min(wx))*mm/1000:.1f} x {(max(wy)-min(wy))*mm/1000:.1f}")
allx = [p["x"] for l in d["lines"] for p in (l["a"], l["b"])]
ally = [p["y"] for l in d["lines"] for p in (l["a"], l["b"])]
print(f"all bbox pt : x {min(allx):.0f}..{max(allx):.0f} y {min(ally):.0f}..{max(ally):.0f}")

# canonical edges: geometric dedupe over unclaimed non-degenerate lines
Q = 0.01
def qk(x, y):
    return (round(x/Q), round(y/Q))
edges = {}
for l in d["lines"]:
    if l["id"] in claimed:
        continue
    a = (l["a"]["x"], l["a"]["y"]); b = (l["b"]["x"], l["b"]["y"])
    if math.hypot(b[0]-a[0], b[1]-a[1]) < 1e-6:
        continue
    ka, kb = qk(*a), qk(*b)
    key = (ka, kb) if ka <= kb else (kb, ka)
    e = edges.get(key)
    if e is None:
        edges[key] = {"a": a, "b": b, "ids": [l["id"]], "ops": {l["sourceOperationId"]}}
    else:
        e["ids"].append(l["id"]); e["ops"].add(l["sourceOperationId"])
print("canonical unique edges:", len(edges))
elist = list(edges.values())
klist = list(edges.keys())

# CC with snapping tolerance
TOL = 0.06
def sk(p):
    return (round(p[0]/TOL), round(p[1]/TOL))
parent = list(range(len(elist)))
def find(a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]; a = parent[a]
    return a
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb: parent[rb] = ra
pmap = defaultdict(list)
for i, e in enumerate(elist):
    pmap[sk(e["a"])].append(i); pmap[sk(e["b"])].append(i)
for idxs in pmap.values():
    for j in idxs[1:]:
        union(idxs[0], j)
comps = defaultdict(list)
for i in range(len(elist)):
    comps[find(i)].append(i)
print("components:", len(comps))
print("size hist:", Counter(min(len(v), 12) for v in comps.values()).most_common())

def bbox(idxs):
    xs = [c for i in idxs for c in (elist[i]["a"][0], elist[i]["b"][0])]
    ys = [c for i in idxs for c in (elist[i]["a"][1], elist[i]["b"][1])]
    return min(xs), min(ys), max(xs), max(ys)

# closed simple cycles (degree 2 everywhere, |V| == |E|)
cyc = []
for root, idxs in comps.items():
    if not (3 <= len(idxs) <= 24):
        continue
    deg = Counter()
    for i in idxs:
        deg[sk(elist[i]["a"])] += 1; deg[sk(elist[i]["b"])] += 1
    if len(deg) != len(idxs) or any(v != 2 for v in deg.values()):
        continue
    x0, y0, x1, y1 = bbox(idxs)
    cyc.append((len(idxs), (x1-x0)*mm, (y1-y0)*mm, (x0+x1)/2, (y0+y1)/2, idxs))
print("\nclosed simple cycles:", len(cyc))
print(" by edge count:", Counter(c[0] for c in cyc).most_common())
c4 = [c for c in cyc if c[0] == 4]
print(" quad cycles:", len(c4), "size buckets:", Counter((round(c[1]/25)*25, round(c[2]/25)*25) for c in c4).most_common(25))
comp4 = [c for c in c4 if 150 <= min(c[1], c[2]) and max(c[1], c[2]) <= 2500 and max(c[1], c[2]) <= 4*min(c[1], c[2])]
print(" compact quads:", len(comp4))
print("  sizes:", Counter((round(c[1]), round(c[2])) for c in comp4).most_common(30))
for c in sorted(comp4, key=lambda c: (-c[1]*c[2]))[:25]:
    print("   ", c[0], round(c[1]), round(c[2]), round(c[3], 1), round(c[4], 1))

# open near-closed components of 3 edges (implicit close rectangles)
tri = [c for c in cyc if c[0] == 3]
print("\ntriangle cycles:", len(tri))
