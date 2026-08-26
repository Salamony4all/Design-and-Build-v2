"""Scratch #7: proper polygon reconstruction (explicit + implicit close) and classification."""
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
    if key not in edges: edges[key] = {"a": a, "b": b, "ids": []}
    edges[key]["ids"].append(l["id"])
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

def trace_ring(idxs):
    """Return ordered vertex ring if component is a single cycle OR a single open path (implicit close)."""
    adj = defaultdict(list); pos = {}
    for i in idxs:
        ka, kb = sk(elist[i]["a"]), sk(elist[i]["b"])
        pos[ka] = elist[i]["a"]; pos[kb] = elist[i]["b"]
        adj[ka].append((kb, i)); adj[kb].append((ka, i))
    degs = {k: len(v) for k, v in adj.items()}
    ends = [k for k, v in degs.items() if v == 1]
    if any(v > 2 for v in degs.values()): return None, "branch"
    if len(ends) == 0:
        if len(adj) != len(idxs): return None, "multi"
        start = next(iter(adj)); closed = True
    elif len(ends) == 2:
        start = ends[0]; closed = False
    else:
        return None, "open>2"
    ring = [start]; used = set(); cur = start; prev = None
    while True:
        nxt = None
        for (k, ei) in adj[cur]:
            if ei in used: continue
            nxt = (k, ei); break
        if nxt is None: break
        used.add(nxt[1]); cur = nxt[0]
        if cur == start: break
        ring.append(cur)
    if len(used) != len(idxs): return None, "partial"
    return [pos[k] for k in ring], ("closed" if closed else "implicit")

def merge_collinear(ring, ang_tol=0.06):
    n = len(ring)
    if n < 4: return ring
    out = []
    for i in range(n):
        p0 = ring[(i-1) % n]; p1 = ring[i]; p2 = ring[(i+1) % n]
        a1 = math.atan2(p1[1]-p0[1], p1[0]-p0[0]); a2 = math.atan2(p2[1]-p1[1], p2[0]-p1[0])
        da = abs((a2-a1+math.pi) % (2*math.pi) - math.pi)
        if da > ang_tol: out.append(p1)
    return out if len(out) >= 3 else ring

def parea(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]; x2, y2 = pts[(i+1) % len(pts)]
        a += x1*y2 - x2*y1
    return abs(a)/2

def classify(ring):
    v = merge_collinear(ring)
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    w = (max(xs)-min(xs))*mm; h = (max(ys)-min(ys))*mm
    area = parea(ring)*mm*mm
    perim = sum(math.hypot(ring[(i+1) % len(ring)][0]-ring[i][0], ring[(i+1) % len(ring)][1]-ring[i][1]) for i in range(len(ring)))*mm
    circularity = 4*math.pi*area/(perim*perim) if perim > 0 else 0
    cx = sum(p[0] for p in ring)/len(ring); cy = sum(p[1] for p in ring)/len(ring)
    rs = [math.hypot(p[0]-cx, p[1]-cy) for p in ring]
    rm = sum(rs)/len(rs)
    rdev = (max(abs(r-rm) for r in rs)/rm) if rm > 0 else 9
    return dict(nv=len(v), w=w, h=h, area=area, circularity=circularity, rdev=rdev,
                cx=(min(xs)+max(xs))/2, cy=(min(ys)+max(ys))/2, verts=v, ring=ring, rm=rm*mm)

recs = []
for root, idxs in comps.items():
    if len(idxs) > 80: continue
    ring, why = trace_ring(idxs)
    if ring is None or len(ring) < 3: continue
    c = classify(ring)
    if min(c["w"], c["h"]) < 120 or max(c["w"], c["h"]) > 3000: continue
    c["mode"] = why; c["ne"] = len(idxs)
    c["inside"] = WX0-30 <= c["cx"] <= WX1+30 and WY0-30 <= c["cy"] <= WY1+30
    recs.append(c)
print("ring components (120..3000mm):", len(recs), " inside:", sum(1 for r in recs if r["inside"]))
print("mode:", Counter(r["mode"] for r in recs))

def kind(r):
    ar = max(r["w"], r["h"])/max(min(r["w"], r["h"]), 1e-9)
    if r["nv"] >= 8 and r["rdev"] < 0.10 and r["circularity"] > 0.80: return "CIRCLE"
    if r["nv"] == 4 and r["circularity"] > 0.70 and ar <= 2.0: return "RECT"
    if r["nv"] == 4: return "RECT-LONG"
    if 5 <= r["nv"] <= 12: return "POLY"
    return "OTHER"
for r in recs: r["kind"] = kind(r)
print("kinds (inside):", Counter(r["kind"] for r in recs if r["inside"]))

for K in ("RECT", "CIRCLE", "RECT-LONG", "POLY"):
    sel = [r for r in recs if r["inside"] and r["kind"] == K]
    print(f"\n=== {K} ({len(sel)}) ===")
    print(" size buckets:", Counter((round(r['w']/25)*25, round(r['h']/25)*25) for r in sel).most_common(20))
    for r in sorted(sel, key=lambda r: (-r["w"]*r["h"]))[:28]:
        print(f"   ne={r['ne']:2d} nv={r['nv']:2d} {r['mode']:8s} {r['w']:7.0f}x{r['h']:7.0f}mm circ={r['circularity']:.2f} rdev={r['rdev']:.2f} at ({r['cx']:7.1f},{r['cy']:7.1f})")
