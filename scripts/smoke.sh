#!/usr/bin/env bash
# 全链路冒烟：建项目 → 传文件 → 提快照 → 开 run → 上报 → 冻结 → 晋升 SOTA → 下载整包。
# 用法：./scripts/smoke.sh <base-url> <bearer-token>
set -euo pipefail

BASE="${1:-http://127.0.0.1:8787}"
TOKEN="${2:-dev}"
SLUG="smoke-$(date +%s)"
AUTH=(-H "Authorization: Bearer ${TOKEN}")
JSON=(-H "Content-Type: application/json")
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

step() { printf '\n\033[1;32m== %s ==\033[0m\n' "$1"; }

step "health"
curl -s --max-time 30 "$BASE/api/v1/health"; echo

step "create project ${SLUG}"
curl -s --max-time 30 "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/v1/projects" \
  -d "{\"slug\":\"${SLUG}\",\"name\":\"冒烟项目\",\"description\":\"scripts/smoke.sh\"}" | tee "$TMP/project.json"; echo

printf 'print("conceptual")\n' > "$TMP/run_conceptual.py"
printf '0,1,1\n' > "$TMP/canonical.txt"

for file in run_conceptual.py canonical.txt; do
  sha="$(shasum -a 256 "$TMP/$file" | cut -d' ' -f1)"
  step "upload $file ($sha)"
  curl -s --max-time 30 "${AUTH[@]}" -X PUT --data-binary "@$TMP/$file" "$BASE/api/v1/projects/$SLUG/blobs/$sha"; echo
  eval "SHA_${file//./_}=$sha"
done

step "create snapshot"
SNAPSHOT_BODY=$(cat <<JSONBODY
{"message":"初始化基线","files":{"run_conceptual.py":"$SHA_run_conceptual_py","canonical.txt":"$SHA_canonical_txt"}}
JSONBODY
)
curl -s --max-time 30 "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/v1/projects/$SLUG/snapshots" -d "$SNAPSHOT_BODY" | tee "$TMP/snapshot.json"; echo
SNAPSHOT_ID=$(python3 -c "import json,sys;print(json.load(open('$TMP/snapshot.json'))['snapshot']['id'])")

step "manifest"
curl -s --max-time 30 "${AUTH[@]}" "$BASE/api/v1/snapshots/$SNAPSHOT_ID/manifest"; echo

step "metrics contract"
curl -s --max-time 30 "${AUTH[@]}" "$BASE/api/v1/projects/$SLUG/metrics" | head -c 300; echo

step "bind a dataset pin (offline in local dev)"
curl -s --max-time 30 "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/v1/projects/$SLUG/dataset" \
  -d '{"dataset_id":"smoke-feed","note":"冒烟用"}' | head -c 300; echo

step "open run"
curl -s --max-time 30 "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/v1/projects/$SLUG/runs" -d '{"note":"冒烟"}' | tee "$TMP/run.json"; echo
RUN_ID=$(python3 -c "import json;print(json.load(open('$TMP/run.json'))['run']['id'])")
LAB=$(python3 -c "import json;print(json.load(open('$TMP/run.json'))['run']['lab'])")
REF=$(python3 -c "import json;print(json.load(open('$TMP/run.json'))['run']['external_ref'])")
test "$REF" = "autolabs:${SLUG}:${LAB}" || { echo "external_ref 不符合预期：$REF"; exit 1; }
PINNED=$(python3 -c "import json;print(json.load(open('$TMP/run.json'))['run']['dataset_pin_id'])")
test "$PINNED" != "None" || { echo "run 没有钉住数据集 pin"; exit 1; }

step "dispatch to a Cybion thread"
curl -s --max-time 30 "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/v1/runs/$RUN_ID/dispatch" -d '{"cybion_thread_id":"thr_smoke"}' >/dev/null

step "an undefined metric must be refused"
CODE=$(curl -s --max-time 30 -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/v1/runs/$RUN_ID/verdict" \
  -d '{"gates":[{"rule_id":"x","pass":true}],"metrics":{"win_rate":0.9}}')
test "$CODE" = "400" || { echo "期望 400，实际 $CODE"; exit 1; }

step "verdict (all gates pass)"
curl -s --max-time 30 "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/v1/runs/$RUN_ID/verdict" -d '{
  "gates":[
    {"rule_id":"no-future-leak","pass":true,"evidence":"causal execution audit"},
    {"rule_id":"canonical-byte-equal","pass":true,"evidence":"逐字节一致"}
  ],
  "metrics":{"trades":1234,"sharpe":1.4,"cumulative_return":0.31},"report_md":"## 结论\n冒烟通过"
}' | tee "$TMP/verdict.json" | head -c 400; echo
STATE=$(python3 -c "import json;print(json.load(open('$TMP/verdict.json'))['run']['state'])")
test "$STATE" = "frozen" || { echo "期望 frozen，实际 $STATE"; exit 1; }

step "promote to SOTA"
curl -s --max-time 30 "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/v1/projects/$SLUG/sota" \
  -d "{\"run_id\":\"$RUN_ID\",\"action\":\"promote\",\"reason\":\"冒烟\"}" | head -c 300; echo

step "leaderboard"
curl -s --max-time 30 "${AUTH[@]}" "$BASE/api/v1/projects/$SLUG/leaderboard"; echo

step "download tar.gz"
curl -s --max-time 30 "${AUTH[@]}" "$BASE/api/v1/snapshots/$SNAPSHOT_ID/tar.gz" -o "$TMP/snapshot.tar.gz"
tar tzf "$TMP/snapshot.tar.gz"

step "unknown api path answers JSON 404"
curl -s --max-time 30 -o /dev/null -w '%{http_code}\n' "$BASE/api/v1/definitely-not-a-route"

printf '\n\033[1;32mOK\033[0m project=%s snapshot=%s run=%s state=%s\n' "$SLUG" "$SNAPSHOT_ID" "$LAB" "$STATE"
