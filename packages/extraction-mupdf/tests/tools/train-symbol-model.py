#!/usr/bin/env python3
"""Train the model behind layer-free furniture reading and write src/furniture-symbol-model.ts.

Input: the dataset written by tests/tools/symbol-dataset.test.ts. Every drawing that
keeps its CAD layers labels itself there: its linework is read with the layers hidden,
exactly as a layer-free drawing is read, and each piece found is labelled with the
family of the layer it is drawn on (furniture, plant, sanitary, equipment, joinery) or
none. The measures are computed by the TypeScript reader itself, so training and
reading always see the same numbers.

  python3 tests/tools/train-symbol-model.py ../../tmp/symbol-dataset.json [--no-write]

Two things are learned:
  1. a random forest that tells a piece's family (or none) from its own measures;
  2. how much the pen counts: one pen draws one kind of thing, so a piece is weighed
     with the other pieces of its pen (three numbers, fitted on what the forest says
     about drawings it was not trained on).

Before training on everything, each drawing set is read by a model trained without it
(leave one document out) and its pieces are compared with what its own layers say.
More layered drawings make a better model: add PDFs, rerun the dataset tool, rerun this.

Needs numpy and scikit-learn.
"""
import base64
import json
import math
import struct
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression

CLASSES = ['none', 'furniture', 'plant', 'sanitary', 'equipment', 'joinery']
# Keep in step with SYMBOL_READER_DEFAULTS and decideBroadPiece (furniture-symbol-reader.ts).
READER = dict(minFamilyP=0.6, minCustomP=0.7, vetoP=0.1, minAloneP=0.7, minBesideP=0.5)
# Pieces whose centres are closer than half their lengths plus this stand beside each other (BESIDE_GAP_M).
BESIDE_GAP_M = 0.3
FOREST = dict(n_estimators=100, min_samples_leaf=2, max_features='sqrt', class_weight='balanced_subsample', random_state=0)
# A family other than plain furniture must lead it by this much to be believed (FAMILY_LEAD in the reader).
FAMILY_LEAD = 1.5
# A pen with few pieces says little: its mean is pulled to the sheet's by this many pieces.
PEN_SHRINK = 3


def trainable(r):
    """Labelled pieces the model will be asked about: not rule-rejected, and clearly on or off furniture layers."""
    return r['label'] is not None and not r['rule'] and not (0.2 < r['furnShare'] < 0.6)


def forest(rows):
    train = [r for r in rows if trainable(r)]
    return RandomForestClassifier(n_jobs=2, **FOREST).fit(np.array([r['x'] for r in train], dtype=np.float32), [CLASSES.index(r['label']) for r in train])


def first_look(model, rows):
    """The forest's word on the pieces the rules let through, copies of one block sharing
    one answer (readSymbols). Class probabilities by row id."""
    live = [r for r in rows if not r['rule']]
    if not live:
        return {}
    P = np.zeros((len(live), len(CLASSES)))
    P[:, model.classes_] = model.predict_proba(np.array([r['x'] for r in live], dtype=np.float32))
    by = defaultdict(list)
    for k, r in enumerate(live):
        by[(r['drawing'], r['copy'])].append(k)
    for ks in by.values():
        P[ks] = P[ks].mean(0)
    return {id(r): P[k] for k, r in enumerate(live)}


def logit(p):
    q = min(0.98, max(0.02, p))
    return math.log(q / (1 - q))


def pen_terms(rows, probs):
    """For each piece the rules let through: (logit of its own probability, logit of its
    pen's minus the sheet's). The pen's is the mean over the other pieces of the pen,
    its own copies left out, pulled to the sheet's mean (readSymbols)."""
    out = {}
    drawings = defaultdict(list)
    for r in rows:
        if id(r) in probs:
            drawings[r['drawing']].append(r)
    for live in drawings.values():
        own = {id(r): float(1 - probs[id(r)][0]) for r in live}
        sheet = sum(own.values()) / len(live)
        pens = defaultdict(lambda: [0.0, 0, defaultdict(lambda: [0.0, 0])])
        for r in live:
            pen = pens[r['pen']]
            pen[0] += own[id(r)]; pen[1] += 1
            pen[2][r['copy']][0] += own[id(r)]; pen[2][r['copy']][1] += 1
        for r in live:
            pen = pens[r['pen']]
            mine = pen[2][r['copy']]
            pen_p = (pen[0] - mine[0] + PEN_SHRINK * sheet) / (pen[1] - mine[1] + PEN_SHRINK)
            out[id(r)] = (logit(own[id(r)]), logit(pen_p) - logit(sheet))
    return out


def fit_context(rows, terms):
    """How much a piece's own measures and its pen count (a logistic fit)."""
    train = [r for r in rows if trainable(r) and id(r) in terms]
    lr = LogisticRegression(C=1.0).fit([terms[id(r)] for r in train], [int(r['label'] != 'none') for r in train])
    return dict(bias=float(lr.intercept_[0]), own=float(lr.coef_[0][0]), pen=float(lr.coef_[0][1]), shrink=PEN_SHRINK)


def second_look(ctx, term):
    return 1 / (1 + math.exp(-(ctx['bias'] + ctx['own'] * term[0] + ctx['pen'] * term[1])))


def held_out(rows, docs):
    """What a forest says about each document when trained on the others (and their terms)."""
    probs = {}
    for doc in docs:
        probs.update(first_look(forest([r for r in rows if r['doc'] != doc and r['doc'] in docs]), [r for r in rows if r['doc'] == doc]))
    return probs, pen_terms(rows, probs)


def beside(rows, final):
    """The highest probability among the pieces right beside each one, its copies left out (readSymbols)."""
    out = {}
    drawings = defaultdict(list)
    for r in rows:
        if id(r) in final:
            drawings[r['drawing']].append(r)
    for live in drawings.values():
        for r in live:
            best = 0.0
            for q in live:
                if q is r or q['copy'] == r['copy'] or final[id(q)] <= best:
                    continue
                gap = math.hypot(q['center']['x'] - r['center']['x'], q['center']['y'] - r['center']['y']) * r['mPerPt']
                if gap <= (r['w'] + q['w']) / 2 + BESIDE_GAP_M:
                    best = final[id(q)]
            out[id(r)] = best
    return out


def decide(r, p, probs, beside_p=0.0, cfg=READER):
    """decideBroadPiece, for a piece the rules let through. Returns (decision, family)."""
    best = int(np.argmax(probs[1:])) + 1
    fam = CLASSES[best] if p >= cfg['minFamilyP'] and (best == 1 or probs[best] >= FAMILY_LEAD * probs[1]) else 'furniture'
    classified = r['kinds'].get(fam) is not None
    if classified and (r['grammar'] or r['named']) and p >= cfg['vetoP']:
        return 'known', fam
    if r['plain']:
        need = max(cfg['minAloneP'], cfg['minFamilyP']) if r['repeats'] == 0 else cfg['minFamilyP']
    else:
        need = min(cfg['minBesideP'], cfg['minFamilyP']) if beside_p >= cfg['minFamilyP'] else cfg['minFamilyP']
    if p < need:
        return None, fam
    if classified:
        return 'known', fam
    return ('custom' if not r['thin'] and p >= cfg['minCustomP'] else None), fam


def check(rows, cfg=READER, quiet=False):
    """Leave one document out. The answer key is what each drawing's own layers say."""
    labelled = [r for r in rows if r['label'] is not None]
    docs = sorted({r['doc'] for r in labelled})
    total = Counter()
    lines = []
    for doc in docs:
        others = [d for d in docs if d != doc]
        train = [r for r in labelled if r['doc'] != doc]
        test = [r for r in labelled if r['doc'] == doc]
        _, terms = held_out(train, others)
        ctx = fit_context(train, terms)
        probs = first_look(forest(train), test)
        own = pen_terms(test, probs)
        final = {k: second_look(ctx, t) for k, t in own.items()}
        near = beside(test, final)
        key = {(r['drawing'], r['keyId']) for r in test if r['keyId']}
        reachable = {(r['drawing'], r['keyId']) for r in test if r['keyId'] and not r['rule']}
        found, right, wrong, other, custom, kind_ok = set(), 0, 0, 0, 0, 0
        for r in test:
            if id(r) not in probs:
                continue
            decision, fam = decide(r, final[id(r)], probs[id(r)], near[id(r)], cfg)
            if not decision:
                continue
            custom += decision == 'custom'
            if r['keyId']:
                right += 1
                found.add((r['drawing'], r['keyId']))
                kind_ok += decision == 'known' and r['kinds'].get(fam) == r['keyKind']
            elif r['label'] == 'none':
                wrong += 1
            else:
                other += 1
        total.update(found=len(found), key=len(key), reach=len(reachable), right=right, wrong=wrong, other=other, custom=custom, kind=kind_ok)
        lines.append(f'  {doc[:32]:32s} found {len(found):3d} of {len(key):3d} (traced {len(reachable):3d})   wrong {wrong:3d}   other furniture {other:3d}   kind agrees {kind_ok}/{right}')
    precision = total['right'] / max(1, total['right'] + total['wrong'])
    if not quiet:
        print('Leave one document out:')
        print('\n'.join(lines))
        print(f'  {"all":32s} found {total["found"]:3d} of {total["key"]:3d} (traced {total["reach"]:3d})   wrong {total["wrong"]:3d}   '
              f'precision {precision:.2f}   custom items {total["custom"]}   kind agrees {total["kind"]}/{total["right"]}')
    return total, precision


def pack(model, n_features):
    """Nodes as little-endian records: feature int8 (-1 = leaf), threshold float32,
    left int16, right int16, then the class probabilities as uint8 (x 255)."""
    out = bytearray()
    sizes = []
    for est in model.estimators_:
        t = est.tree_
        assert t.node_count < 32767
        sizes.append(int(t.node_count))
        for n in range(t.node_count):
            leaf = t.children_left[n] < 0
            v = np.zeros(len(CLASSES))
            raw = t.value[n][0]
            v[model.classes_] = raw / max(raw.sum(), 1e-12)
            q = [int(round(x * 255)) for x in v]
            assert leaf or 0 <= t.feature[n] < min(n_features, 128)
            out += struct.pack('<bfhh6B', -1 if leaf else int(t.feature[n]), 0.0 if leaf else float(t.threshold[n]),
                               -1 if leaf else int(t.children_left[n]), -1 if leaf else int(t.children_right[n]), *q)
    return sizes, base64.b64encode(bytes(out)).decode('ascii')


TEMPLATE = '''/**
 * The trained model behind layer-free furniture reading (furniture-symbol-reader.ts):
 * a random forest that tells a traced symbol's family (or none) from its measures, and
 * how much the pen it is drawn in counts.
 *
 * Generated by tests/tools/train-symbol-model.py from the dataset that
 * tests/tools/symbol-dataset.test.ts reads off drawings that keep their CAD layers.
 * Do not edit by hand: add layered drawings and retrain.
 *
 * Trained {date} on {n_rows} pieces from {n_docs} drawing sets
 * ({counts}).
 * Leave-one-document-out check: {check}.
 */
export interface SymbolTree {{
  feature: Int8Array;
  threshold: Float32Array;
  left: Int16Array;
  right: Int16Array;
  /** Class probabilities at each node (read at leaves). */
  value: Float32Array[];
}}

export interface SymbolModel {{
  version: string;
  classes: string[];
  /** The measures the trees index, in order (SYMBOL_FEATURES when the model was trained). */
  features: string[];
  trees: SymbolTree[];
  /**
   * How a piece is weighed with the other pieces of its pen:
   * logit(p) = bias + own * logit(own p) + pen * (logit(pen's mean p) - logit(sheet's mean p)),
   * the pen's mean pulled to the sheet's by `shrink` pieces. Absent: the forest alone.
   */
  context?: {{ bias: number; own: number; pen: number; shrink: number }};
}}

const PACKED = {{
  version: '{version}',
  classes: {classes},
  features: {features},
  context: {context},
  sizes: {sizes},
  data: '{data}',
}};

function decodeBase64(s: string): Uint8Array {{
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0, acc = 0, o = 0;
  for (let i = 0; i < clean.length; i++) {{
    acc = ((acc << 6) | lookup[clean.charCodeAt(i)]) & 0xffffff;
    bits += 6;
    if (bits >= 8) {{ bits -= 8; out[o++] = (acc >> bits) & 0xff; }}
  }}
  return out;
}}

function unpack(p: typeof PACKED): SymbolModel {{
  const bytes = decodeBase64(p.data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const k = p.classes.length;
  const record = 9 + k;
  let at = 0;
  const trees: SymbolTree[] = p.sizes.map((n) => {{
    const t: SymbolTree = {{ feature: new Int8Array(n), threshold: new Float32Array(n), left: new Int16Array(n), right: new Int16Array(n), value: [] }};
    for (let i = 0; i < n; i++, at += record) {{
      t.feature[i] = view.getInt8(at);
      t.threshold[i] = view.getFloat32(at + 1, true);
      t.left[i] = view.getInt16(at + 5, true);
      t.right[i] = view.getInt16(at + 7, true);
      const v = new Float32Array(k);
      for (let c = 0; c < k; c++) v[c] = view.getUint8(at + 9 + c) / 255;
      t.value.push(v);
    }}
    return t;
  }});
  return {{ version: p.version, classes: p.classes, features: p.features, trees, context: p.context }};
}}

export const SYMBOL_MODEL: SymbolModel = unpack(PACKED);
'''


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    path = Path(args[0] if args else '../../tmp/symbol-dataset.json')
    ds = json.loads(path.read_text())
    assert ds['classes'] == CLASSES, ds['classes']
    rows = ds['rows']
    total, precision = check(rows)
    labelled = [r for r in rows if r['label'] is not None]
    docs = sorted({r['doc'] for r in labelled})
    _, terms = held_out(labelled, docs)
    ctx = fit_context(labelled, terms)
    print(f"The pen: logit(p) = {ctx['bias']:.2f} + {ctx['own']:.2f} x own + {ctx['pen']:.2f} x (pen - sheet)")
    model = forest(labelled)
    train = [r for r in labelled if trainable(r)]
    imp = sorted(zip(model.feature_importances_, ds['features']), reverse=True)
    print('Most used measures:', ', '.join(f'{f} {v:.3f}' for v, f in imp[:14]))
    sizes, data = pack(model, len(ds['features']))
    print(f'Forest: {len(sizes)} trees, {sum(sizes)} nodes, {len(data) // 1024} KB packed')
    if '--no-write' in sys.argv:
        return
    counts = Counter(r['label'] for r in train)
    check_text = (f"{total['found']} of {total['key']} layer-read pieces found, "
                  f"{total['wrong']} wrong (precision {precision:.2f})")
    ts = TEMPLATE.format(
        date=date.today().isoformat(), n_rows=len(train), n_docs=len(docs),
        counts=', '.join(f'{k} {v}' for k, v in counts.most_common()), check=check_text,
        version=f'forest-{date.today().isoformat()}-{len(docs)}d-{len(train)}',
        classes=json.dumps(CLASSES), features=json.dumps(ds['features']), sizes=json.dumps(sizes), data=data,
        context='{ ' + ', '.join(f'{k}: {round(v, 4)}' for k, v in ctx.items()) + ' }')
    target = Path(__file__).resolve().parents[2] / 'src' / 'furniture-symbol-model.ts'
    target.write_text(ts)
    print('wrote', target)


if __name__ == '__main__':
    main()
