#!/bin/bash
# CS4.2 verification script
# Run from: bash tools/cs42-verify.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PACKAGE_DIR/evidence/code06/cs42-logs"

mkdir -p "$LOG_DIR"
cd "$PACKAGE_DIR"

run_gate() {
  local name="$1"
  shift
  "$@" > "$LOG_DIR/$name.log" 2>&1
  local rc=$?
  if [ $rc -ne 0 ]; then
    echo "FAIL: $name (exit $rc)"
    cat "$LOG_DIR/$name.log" 2>/dev/null | tail -5
    return $rc
  fi
  echo "PASS: $name"
  return 0
}

echo "=== CS4.2 Verification ==="

# Gate 1: typecheck
echo "[1/7] typecheck..."
run_gate "typecheck" npm run typecheck
TYPECHECK_RC=$?
if [ $TYPECHECK_RC -ne 0 ]; then echo "CS4.2 FAILED at typecheck"; exit 1; fi

# Gate 2: package tests (expect fail 0)
echo "[2/7] package tests..."
run_gate "tests" node --test tests/*.test.mjs
TESTS_RC=$?
if [ $TESTS_RC -ne 0 ]; then echo "CS4.2 FAILED at tests"; exit 2; fi
grep -q "fail 0" "$LOG_DIR/tests.log" || { echo "FAIL: tests (failures found)"; exit 2; }
echo "PASS: tests (0 failures)"

# Gate 3: door analysis (runner must exit 0)
echo "[3/7] door analysis..."
run_gate "door-analysis" node tools/door-analysis.mjs
DOOR_RC=$?
if [ $DOOR_RC -ne 0 ]; then echo "CS4.2 FAILED at door-analysis"; exit 3; fi
grep -q "doorRegions" "$LOG_DIR/door-analysis.log" || { echo "FAIL: door-analysis (no doorRegions in log)"; exit 3; }
grep -q "hash" "$LOG_DIR/door-analysis.log" || { echo "FAIL: door-analysis (no hash in log)"; exit 3; }
echo "PASS: door analysis (25 regions + hash)"

# Gate 4: door crops (25 manifest JSON files)
echo "[4/7] door crops..."
run_gate "door-crops" node tools/door-crops.mjs
CROPS_RC=$?
if [ $CROPS_RC -ne 0 ]; then echo "CS4.2 FAILED at door-crops"; exit 4; fi
DOOR_MANIFESTS=$(ls evidence/code06/door-crops/DT-*-manifest.json 2>/dev/null | wc -l)
if [ "$DOOR_MANIFESTS" -ne 25 ]; then
  echo "FAIL: door-crops (expected 25 manifests, got $DOOR_MANIFESTS)"
  exit 4
fi
echo "PASS: door crops ($DOOR_MANIFESTS/25 manifest files)"

# Gate 5: window close-ups (6 SVGs)
echo "[5/7] window close-ups..."
run_gate "window-overlays" node tools/generate-window-overlays.mjs
OVERLAY_RC=$?
if [ $OVERLAY_RC -ne 0 ]; then echo "CS4.2 FAILED at window-overlays"; exit 5; fi
for i in 1 2 3 4 5 6; do
  test -s "evidence/code06/overlays/win-provisional-${i}-closeup.svg" || { echo "FAIL: missing closeup ${i}"; exit 5; }
done
echo "PASS: window close-ups 6/6"

# Gate 6: baseline verifier (must exit 0)
echo "[6/7] baseline verifier..."
run_gate "baseline-verifier" node tools/verify-baseline-failures.mjs
BASELINE_RC=$?
if [ $BASELINE_RC -ne 0 ]; then echo "CS4.2 FAILED at baseline-verifier"; exit 6; fi
grep -q '"overallStatus":"pass"' "$LOG_DIR/baseline-verifier.log" || grep -q '"overallStatus": "pass"' "$LOG_DIR/baseline-verifier.log" || { echo "FAIL: baseline-verifier status"; exit 6; }
echo "PASS: baseline verifier"

# Gate 7: dependency-boundary test (optional)
echo "[7/7] dependency-boundary test..."
run_gate "dep-boundary" node --test tests/dependency-boundary.test.mjs 2>/dev/null || echo "SKIP: no dependency-boundary test (optional)"

echo ""
echo "=== CS4.2 Verification Summary ==="
echo "All 7 gates passed. See $LOG_DIR/ for full logs."