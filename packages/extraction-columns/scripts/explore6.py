"""Scratch #6: full inventory of compact components with rich descriptors."""
import json, math, re
from collections import defaultdict, Counter

FIX = "../extraction-mupdf/extraction-results/secondary-fixture.json"
d = json.load(open(FIX))
mm = d["scaleMmPerPt"]
claimed = set(); wall_ids = set()
for c in d["claimed"]:
    claimed.update(c["sourceIds"])
    if c["kind"] == "wall": wall_ids.update(c["sourceIds"])
wl = [l for l in d["lines"] if l["id"] in wall_ids]
WX0 = min(p["x"] for l in wl for p in (l["a"], l["b"])); WX1 = max(p["x"] for l in wl for p in (l["a"], l["b"]))
WY0 = min(p["y"] for l in wl for p in (l["a"], l["b"])); WY1 = max(p["y"] for l in wl for p in (l["a"], l["b"]))

Q = 0.01
def qk(x, y): return (round(x/Q), round(y/Q))
edges = {}
for l in d["lines"]:
    if l["id"] in claimed: continue
    a = (l["a"]["x"], l["a"]["y"]); b = (l["b"]["x"], l["b"]["y"])
    if math.hypot(b[0]-a[0], b[1]-a[1]) < 1e-6: continue
    ka, kb = qk(*a), qk(*b)
    key = (ka, kb) if ka <= kb else (kb, ka)
    if key not in edges: edges[key] = {"a": a, "b": b, "ids": [l["id"]], "ops": set()}
    edges[key]["ids"].append(l["id"]); edges[key]["ops"].add(l["sourceOperationId"])
elist = list(edges.values())
TOL = 0.06
def sk(p): return (round(p[0]/TOL), round(p[1]/TOL))
parent = list(range(len(elist)))
def find(a):
    while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
    return a
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb: parent[rb] = ra
pmap = defaultdict(list)
for i, e in enumerate(elist):
    pmap[sk(e["a"])].append(i); pmap[sk(e["b"])].append(i)
for idxs in pmap.values():
    for j in idxs[1:]: union(idxs[0], j)
comps = defaultdict(list)
for i in range(len(elist)): comps[find(i)].append(i)

def hull(pts):
    pts = sorted(set(pts))
    if len(pts) <= 2: return pts
    def cross(o, a, b): return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lo = []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    up = []
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]
def parea(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]; x2, y2 = pts[(i+1) % len(pts)]
        a += x1*y2 - x2*y1
    return abs(a)/2

rows = []
for root, idxs in comps.items():
    if len(idxs) > 60: continue
    pts = [p for i in idxs for p in (elist[i]["a"], elist[i]["b"])]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    w = (max(xs)-min(xs))*mm; h = (max(ys)-min(ys))*mm
    if min(w, h) < 150 or max(w, h) > 2500: continue
    if max(w, h) > 4*max(min(w, h), 1e-9): continue
    H = hull(pts)
    ha = parea(H)*mm*mm
    bb = w*h
    deg = Counter()
    for i in idxs:
        deg[sk(elist[i]["a"])] += 1; deg[sk(elist[i]["b"])] += 1
    closed = all(v == 2 for v in deg.values()) and len(deg) == len(idxs)
    cx = (min(xs)+max(xs))/2; cy = (min(ys)+max(ys))/2
    rs = [math.hypot(p[0]-cx, p[1]-cy) for p in set(pts)]
    rmean = sum(rs)/len(rs)
    circdev = (max(abs(r-rmean) for r in rs)/rmean) if rmean > 0 else 9
    inside = WX0-20 <= cx <= WX1+20 and WY0-20 <= cy <= WY1+20
    rows.append(dict(n=len(idxs), w=w, h=h, cx=cx, cy=cy, fill=ha/bb if bb else 0,
                     closed=closed, nv=len(deg), circ=circdev, inside=inside,
                     maxdeg=max(deg.values()), idxs=idxs))
print("compact components (150..2500mm, ar<=4):", len(rows))
print("closed:", sum(1 for r in rows if r["closed"]), " inside walls:", sum(1 for r in rows if r["inside"]))
print("\n-- CLOSED, inside wall envelope, sorted by area --")
sel = [r for r in rows if r["closed"] and r["inside"]]
print("count:", len(sel))
for r in sorted(sel, key=lambda r: -r["w"]*r["h"])[:45]:
    kind = "CIRC" if r["circ"] < 0.15 else ("RECT" if r["n"] == 4 and r["fill"] > 0.9 else f"POLY{r['n']}")
    print(f"   n={r['n']:2d} {r['w']:7.0f}x{r['h']:7.0f}mm fill={r['fill']:.2f} circdev={r['circ']:.2f} at ({r['cx']:7.1f},{r['cy']:7.1f}) {kind}")
print("\nsize-class counter (closed+inside):", Counter((round(r['w']/25)*25, round(r['h']/25)*25) for r in sel).most_common(25))
print("\n-- NOT closed but compact & inside (hatched/open shapes) --")
op_ = [r for r in rows if not r["closed"] and r["inside"]]
print("count:", len(op_))
print(Counter((round(r['w']/50)*50, round(r['h']/50)*50) for r in op_).most_common(25))
for r in sorted(op_, key=lambda r: -r["w"]*r["h"])[:20]:
    print(f"   n={r['n']:2d} nv={r['nv']:2d} maxdeg={r['maxdeg']} {r['w']:7.0f}x{r['h']:7.0f} fill={r['fill']:.2f} at ({r['cx']:7.1f},{r['cy']:7.1f})")
