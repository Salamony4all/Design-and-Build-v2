"""Scratch #8: context probe around square candidates + branched compact components."""
import json, math
from collections import defaultdict, Counter

FIX = "../extraction-mupdf/extraction-results/secondary-fixture.json"
d = json.load(open(FIX))
mm = d["scaleMmPerPt"]
claimed = set(); wall_ids = set()
for c in d["claimed"]:
    claimed.update(c["sourceIds"])
    if c["kind"] == "wall": wall_ids.update(c["sourceIds"])

allseg = []
for l in d["lines"]:
    a = (l["a"]["x"], l["a"]["y"]); b = (l["b"]["x"], l["b"]["y"])
    if math.hypot(b[0]-a[0], b[1]-a[1]) < 1e-6: continue
    allseg.append((a, b, l["id"] in claimed, l["id"] in wall_ids, l["id"]))
print("all non-degenerate:", len(allseg))

def probe(cx, cy, half, label):
    inside = [s for s in allseg if min(s[0][0], s[1][0]) >= cx-half and max(s[0][0], s[1][0]) <= cx+half
              and min(s[0][1], s[1][1]) >= cy-half and max(s[0][1], s[1][1]) <= cy+half]
    uniq = set()
    for s in inside:
        uniq.add((round(s[0][0], 2), round(s[0][1], 2), round(s[1][0], 2), round(s[1][1], 2)))
    wallish = sum(1 for s in inside if s[3])
    print(f"  {label} @({cx},{cy}) half={half}: rawsegs={len(inside)} uniqgeom={len(uniq)} wallclaimed={wallish}")
    return uniq

print("\n695 square @ (796.5,697.9) half=25 (bbox half=19.9):")
u = probe(796.5, 697.9, 22, "695sq")
for g in sorted(u)[:12]: print("     ", g)

print("\n470 square @ (384.7,401.8) half=16 (bbox half=13.4):")
u = probe(384.7, 401.8, 16, "470sq")
for g in sorted(u)[:12]: print("     ", g)

print("\nwider context around a 470 square (half=45):")
u = probe(384.7, 401.8, 45, "470sq-wide")
for g in sorted(u)[:25]: print("     ", g)

print("\n893x1042 branched @ (717.1,973.6):")
u = probe(717.1, 973.6, 32, "893x1042")
print("   sample:")
for g in sorted(u)[:20]: print("     ", g)

print("\n909 circle @ (646.3,969.8):")
u = probe(646.3, 969.8, 28, "909circ")
for g in sorted(u)[:14]: print("     ", g)
