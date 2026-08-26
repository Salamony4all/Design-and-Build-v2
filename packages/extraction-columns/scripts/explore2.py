"""Scratch exploration #2 (NOT production code): connected-component + closed-loop analysis."""
import json, math
from collections import defaultdict, Counter

FIX = "../extraction-mupdf/extraction-results/secondary-fixture.json"
d = json.load(open(FIX))
mm = d["scaleMmPerPt"]
claimed = set()
for c in d["claimed"]:
    claimed.update(c["sourceIds"])

segs = []
for l in d["lines"]:
    if l["id"] in claimed:
        continue
    ax, ay, bx, by = l["a"]["x"], l["a"]["y"], l["b"]["x"], l["b"]["y"]
    if math.hypot(bx-ax, by-ay) < 1e-7:
        continue
    segs.append((l["id"], ax, ay, bx, by, l["sourceOperationId"]))
print("non-degenerate unclaimed segs:", len(segs))

TOL = 0.06  # pt ~ 1mm
def key(x, y):
    return (round(x/TOL), round(y/TOL))

parent = list(range(len(segs)))
def find(a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]
        a = parent[a]
    return a
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[rb] = ra

pmap = defaultdict(list)
for i, s in enumerate(segs):
    pmap[key(s[1], s[2])].append(i)
    pmap[key(s[3], s[4])].append(i)
for k, idxs in pmap.items():
    for j in idxs[1:]:
        union(idxs[0], j)

comps = defaultdict(list)
for i in range(len(segs)):
    comps[find(i)].append(i)
print("components:", len(comps))
print("comp size hist:", Counter(min(len(v), 30) for v in comps.values()).most_common())

def analyse(idxs):
    pts = []
    for i in idxs:
        s = segs[i]
        pts.append((s[1], s[2]))
        pts.append((s[3], s[4]))
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    w = (max(xs)-min(xs))*mm; h = (max(ys)-min(ys))*mm
    deg = Counter()
    for i in idxs:
        s = segs[i]
        deg[key(s[1], s[2])] += 1
        deg[key(s[3], s[4])] += 1
    nv = len(deg)
    closed = all(v == 2 for v in deg.values())
    return w, h, nv, closed, min(xs), min(ys), max(xs), max(ys)

# closed loops with 3..12 vertices, compact size
rects = []
for root, idxs in comps.items():
    n = len(idxs)
    if n < 3 or n > 40:
        continue
    w, h, nv, closed, x0, y0, x1, y1 = analyse(idxs)
    if not closed:
        continue
    if nv != n:  # simple cycle requires #vertices == #edges
        continue
    if w < 60 or h < 60 or w > 3000 or h > 3000:
        continue
    rects.append((n, nv, round(w), round(h), round((x0+x1)/2, 2), round((y0+y1)/2, 2), idxs))
print("closed simple cycles compact:", len(rects))
print("by nseg:", Counter(r[0] for r in rects).most_common())
four = [r for r in rects if r[0] == 4]
print("4-seg closed loops:", len(four))
print("size buckets (4seg):", Counter((r[2]//25*25, r[3]//25*25) for r in four).most_common(30))
big = [r for r in four if min(r[2], r[3]) >= 200]
print("4-seg >=200mm:", len(big))
print("  sizes:", Counter((r[2], r[3]) for r in big).most_common(30))
for r in sorted(big, key=lambda r: -r[2]*r[3])[:25]:
    print("   ", r[:6])
