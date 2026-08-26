"""Scratch #3: verify the op/subpath id scheme so subpaths can be reconstructed."""
import json, math, re
from collections import defaultdict, Counter

FIX = "../extraction-mupdf/extraction-results/secondary-fixture.json"
d = json.load(open(FIX))
mm = d["scaleMmPerPt"]
byop = defaultdict(lambda: {"s": {}, "seg": {}, "L": {}})
RE_S = re.compile(r"^(.*):s(\d+)$")
RE_SEG = re.compile(r"^(.*):seg:(\d+)$")
RE_L = re.compile(r"^(.*):L(\d+)$")
other = 0
for l in d["lines"]:
    i = l["id"]
    m = RE_SEG.match(i)
    if m:
        byop[m.group(1)]["seg"][int(m.group(2))] = l; continue
    m = RE_L.match(i)
    if m:
        byop[m.group(1)]["L"][int(m.group(2))] = l; continue
    m = RE_S.match(i)
    if m:
        byop[m.group(1)]["s"][int(m.group(2))] = l; continue
    other += 1
print("ops:", len(byop), "unparsed ids:", other)

# check seg vs L identity
same = diff = 0
for op, fam in list(byop.items())[:5000]:
    for k, sg in fam["seg"].items():
        lk = fam["L"].get(k)
        if lk is None:
            diff += 1
        elif lk["a"] == sg["a"] and lk["b"] == sg["b"]:
            same += 1
        else:
            diff += 1
print("seg==L identical:", same, "mismatch:", diff)

# check seg chaining: seg[i].b == seg[i+1].a
chain_ok = chain_bad = 0
for op, fam in list(byop.items())[:5000]:
    ks = sorted(fam["seg"])
    for a, b in zip(ks, ks[1:]):
        if b != a+1: continue
        if fam["seg"][a]["b"] == fam["seg"][b]["a"]: chain_ok += 1
        else: chain_bad += 1
print("seg chain ok:", chain_ok, "bad:", chain_bad)

# subpath chords: how many ops, and do chords delimit closed loops?
closed_chords = 0
open_chords = 0
for op, fam in byop.items():
    for k, s in fam["s"].items():
        if abs(s["a"]["x"]-s["b"]["x"]) < 1e-7 and abs(s["a"]["y"]-s["b"]["y"]) < 1e-7:
            closed_chords += 1
        else:
            open_chords += 1
print("subpath chords closed:", closed_chords, "open:", open_chords)

# reconstruct subpaths for a sample op with many segs
def reconstruct(op):
    fam = byop[op]
    ks = sorted(fam["seg"])
    if not ks: return []
    pts = [(fam["seg"][ks[0]]["a"]["x"], fam["seg"][ks[0]]["a"]["y"])]
    ids = []
    for k in ks:
        s = fam["seg"][k]
        pts.append((s["b"]["x"], s["b"]["y"]))
        ids.append(k)
    # split using chords
    chords = [fam["s"][k] for k in sorted(fam["s"])]
    subs = []
    i = 0
    for ch in chords:
        a = (ch["a"]["x"], ch["a"]["y"]); b = (ch["b"]["x"], ch["b"]["y"])
        if i >= len(pts): break
        # find j>=i with pts[j]==b (first match)
        j = i
        found = None
        while j < len(pts):
            if pts[j] == b and (j > i or a == b):
                found = j; break
            j += 1
        if found is None: break
        subs.append((i, found))
        i = found + 1
    return pts, subs, chords

samples = [op for op, fam in byop.items() if 4 <= len(fam["seg"]) <= 10 and len(fam["s"]) >= 1][:6]
for op in samples:
    pts, subs, chords = reconstruct(op)
    print(f"\nop {op}: npts={len(pts)} nchords={len(chords)} subs={subs}")
    print("   pts:", [(round(p[0],2), round(p[1],2)) for p in pts])
    print("   chords:", [((round(c['a']['x'],2), round(c['a']['y'],2)), (round(c['b']['x'],2), round(c['b']['y'],2))) for c in chords])

# global: how many ops have a single closed subpath of exactly 4 edges
counts = Counter()
quad = []
for op, fam in byop.items():
    ks = sorted(fam["seg"])
    if not ks: continue
    pts = [(fam["seg"][ks[0]]["a"]["x"], fam["seg"][ks[0]]["a"]["y"])] + [(fam["seg"][k]["b"]["x"], fam["seg"][k]["b"]["y"]) for k in ks]
    counts[len(pts)] += 1
    if len(pts) == 5 and pts[0] == pts[4]:
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        quad.append((op, (max(xs)-min(xs))*mm, (max(ys)-min(ys))*mm, (min(xs)+max(xs))/2, (min(ys)+max(ys))/2))
print("\npoint-count hist:", counts.most_common(15))
print("closed 4-edge ops:", len(quad))
print("size buckets:", Counter((round(q[1]/25)*25, round(q[2]/25)*25) for q in quad).most_common(30))
