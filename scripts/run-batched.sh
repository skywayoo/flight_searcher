#!/bin/zsh
# Grind a large scan through eztravel's session limit.
#
# eztravel serves roughly 2000 requests per session and then answers instantly
# with empty pages. Re-warming the context does not clear it; only waiting does
# (~30-45 min observed). local-scrape.mjs exits 3 when it detects that state, so
# this driver just resumes after a cooldown and repeats until the run completes.
#
#   nohup scripts/run-batched.sh > data/batched.log 2>&1 &
#
# Every batch appends to the same results file and --resume skips what is
# already there, so stopping and restarting this script is safe.
set -u

ROOT="${0:A:h:h}"
cd "$ROOT" || exit 1

RESULTS="${RESULTS:-/tmp/flight-run2-raw.jsonl}"
COOLDOWN="${COOLDOWN:-2700}"        # 45 min
MAX_BATCHES="${MAX_BATCHES:-20}"
CONCURRENCY="${CONCURRENCY:-6}"

for i in $(seq 1 "$MAX_BATCHES"); do
  echo "=== batch $i/$MAX_BATCHES  $(date '+%F %T') ==="
  python3 scripts/scan-json-only.py \
      --prefilter --prefilter-reuse --resume \
      --concurrency "$CONCURRENCY" \
      --sources eztravel \
      --progress-every 1800 \
      --max-tasks 50000 \
      --raw-results-path "$RESULTS"
  rc=$?
  echo "=== batch $i exit=$rc  $(date '+%F %T') ==="

  # 0 = the whole task list is done. 3 = blocked, worth resuming after a wait.
  if [ "$rc" -eq 0 ]; then
    echo "run complete"
    exit 0
  fi
  if [ "$rc" -ne 3 ]; then
    echo "unexpected exit $rc — stopping so it gets looked at"
    exit "$rc"
  fi
  echo "blocked; sleeping ${COOLDOWN}s before resuming"
  sleep "$COOLDOWN"
done
echo "hit MAX_BATCHES=$MAX_BATCHES without finishing"
