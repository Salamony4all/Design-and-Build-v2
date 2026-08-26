"""Scratch exploration of unclaimed geometry (NOT production code).
Read-only analysis to understand the CODE-06 vector soup before tuning the TS detector.
"""
import json, math, sys
from collections import defaultdict, Counter

FIX = "../extraction-mupdf/extraction-results/secondary-fixture.json"
d = json.load(open(FIX))
mm = d["scaleMmPerPt"]
claimed = set()
for c in d["claimed"]:
    claimed.update(c["sourceIds"])
lines = [l for l in d["lines"] if l["id"] not in claimed]
cubics = [c for c in d["cubics"] if c["id"] not in claimed]
print(f"unclaimed lines={len(lines)} cubics={len(cubics)} mmPerPt={mm:.4f}")

# degenerate check
deg = sum(1 for l in lines if math.hypot(l["b"]["x"]-l["a"]["x"], l["b"]["y"]-l["a"]["y"]) < 1e-9)
print("zero-length segs:", deg)

# length histogram in mm
LB = [0, 1, 10, 50, 100, 200, 300, 400, 600, 1000, 2000, 5000, 1e9]
h = Counter()
for l in lines:
    L = math.hypot(l["b"]["x"]-l["a"]["x"], l["b"]["y"]-l["a"]["y"]) * mm
    for i in range(len(LB)-1):
        if LB[i] <= L < LB[i+1]:
            h[i] += 1
            break
for i in sorted(h):
    print(f"  len {LB[i]:>6.0f}-{LB[i+1]:>7.0f}mm : {h[i]}")

# operation grouping: how many segments per sourceOperationId
ops = Counter(l["sourceOperationId"] for l in lines)
print("distinct ops:", len(ops))
print("ops size histogram:", Counter(min(v, 20) for v in ops.values()).most_common())

# Which ops have exactly 4/5 segments and form a closed axis-aligned rect?
def op_bbox(segs):
    xs = [p["x"] for s in segs for p in (s["a"], s["b"])]
    ys = [p["y"] for s in segs for p in (s["a"], s["b"])]
    return min(xs), min(ys), max(xs), max(ys)

byop = defaultdict(list)
for l in lines:
    byop[l["sourceOperationId"]].append(l)

cand = []
for op, segs in byop.items():
    if not (3 <= len(segs) <= 12):
        continue
    x0, y0, x1, y1 = op_bbox(segs)
    w, hgt = (x1-x0)*mm, (y1-y0)*mm
    if 100 <= w <= 2000 and 100 <= hgt <= 2000:
        cand.append((op, len(segs), round(w), round(hgt), round((x0+x1)/2, 2), round((y0+y1)/2, 2)))
print("op-level compact candidates:", len(cand))
for c in cand[:40]:
    print("   ", c)
sizes = Counter((c[2]//50*50, c[3]//50*50) for c in cand)
print("size buckets:", sizes.most_common(25))
