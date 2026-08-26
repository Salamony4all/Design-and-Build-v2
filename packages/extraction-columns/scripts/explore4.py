"""Scratch #4: subpath-polygon analysis. Classify every reconstructed subpath."""
import json, math, re
from collections import defaultdict, Counter

FIX = "../extraction-mupdf/extraction-results/secondary-fixture.json"
d = json.load(open(FIX))
mm = d["scaleMmPerPt"]
claimed = set()
for c in d["claimed"]:
    claimed.update(c["sourceIds"])

RE_SEG = re.compile(r"^(.*):seg:(\d+)$")
byop = defaultdict(dict)
famcount = Counter()
for l in d["lines"]:
    m = RE_SEG.match(l["id"])
    if m:
        famcount["seg"] += 1
        byop[m.group(1)][int(m.group(2))] = l
    elif re.match(r"^(.*):L(\d+)$", l["id"]):
        famcount["L"] += 1
    else:
        famcount["s"] += 1
print("family counts:", famcount)

def poly_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]; x2, y2 = pts[(i+1) % len(pts)]
        a += x1*y2 - x2*y1
    return abs(a)/2

rows = []
for op, segd in byop.items():
    ks = sorted(segd)
    pts = [(segd[ks[0]]["a"]["x"], segd[ks[0]]["a"]["y"])] + [(segd[k]["b"]["x"], segd[k]["b"]["y"]) for k in ks]
    # dedupe consecutive duplicates
    dp = [pts[0]]
    for p in pts[1:]:
        if math.hypot(p[0]-dp[-1][0], p[1]-dp[-1][1]) > 1e-7:
            dp.append(p)
    if len(dp) >= 2 and math.hypot(dp[0][0]-dp[-1][0], dp[0][1]-dp[-1][1]) < 1e-7:
        dp = dp[:-1]
    rows.append((op, dp, all(l["id"] in claimed for l in segd.values()), any(l["id"] in claimed for l in segd.values())))

nv_hist = Counter(len(r[1]) for r in rows)
print("distinct-vertex hist:", nv_hist.most_common(15))

# focus: 4-vertex polygons (rectangle candidates), unclaimed
quads = []
for op, pts, allc, anyc in rows:
    if len(pts) != 4 or anyc:
        continue
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    w = (max(xs)-min(xs))*mm; h = (max(ys)-min(ys))*mm
    ar = poly_area(pts)*mm*mm
    bb = (max(xs)-min(xs))*(max(ys)-min(ys))*mm*mm
    fill = ar/bb if bb > 0 else 0
    quads.append((op, w, h, fill, (min(xs)+max(xs))/2, (min(ys)+max(ys))/2, pts))
print("\nunclaimed 4-vertex polys:", len(quads))
print("fill-ratio hist:", Counter(round(q[3], 1) for q in quads).most_common())
sq = [q for q in quads if q[3] > 0.9]
print("rect-like (fill>0.9):", len(sq))
print("size buckets(50mm):", Counter((round(q[1]/50)*50, round(q[2]/50)*50) for q in sq).most_common(40))
compact = [q for q in sq if 150 <= min(q[1], q[2]) and max(q[1], q[2]) <= 2500 and max(q[1], q[2])/max(min(q[1], q[2]), 1e-9) <= 4]
print("\ncompact rect-like (min>=150mm, max<=2500mm, ar<=4):", len(compact))
print(" exact sizes:", Counter((round(q[1]), round(q[2])) for q in compact).most_common(40))
for q in sorted(compact, key=lambda q: -q[1]*q[2])[:20]:
    print("   ", q[0], round(q[1]), round(q[2]), round(q[3], 3), round(q[4], 1), round(q[5], 1))

# 13-vertex ops -> circles?
circ = [r for r in rows if 8 <= len(r[1]) <= 24 and not r[3]]
print("\n8..24-vertex unclaimed polys:", len(circ))
def circfit(pts):
    cx = sum(p[0] for p in pts)/len(pts); cy = sum(p[1] for p in pts)/len(pts)
    rs = [math.hypot(p[0]-cx, p[1]-cy) for p in pts]
    r = sum(rs)/len(rs)
    dev = max(abs(x-r) for x in rs)/r if r > 0 else 9
    return cx, cy, r, dev
cc = []
for op, pts, allc, anyc in circ:
    cx, cy, r, dev = circfit(pts)
    if dev < 0.12:
        cc.append((op, len(pts), round(2*r*mm), round(dev, 3), round(cx, 1), round(cy, 1)))
print("near-circular:", len(cc))
print(" diameter buckets:", Counter(c[2]//50*50 for c in cc).most_common(20))
for c in cc[:15]:
    print("   ", c)
