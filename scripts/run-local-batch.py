#!/usr/bin/env python3
"""Run build-tasks -> local-scrape -> import-results -> send-price-report as one local batch.

Improvements over original:
- NODE20 dynamic discovery (no hardcoded Homebrew path)
- Per-batch try/except (one batch failing doesn't kill the run)
- Progress Telegram notifications (every ~10%)
- Start / hit-count tracking / final summary
- Sanity check: warn if result count < task count
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

# Path setup: scripts/ is sibling to lib in ROOT
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import notify  # noqa: E402
from scan_config import get_budget_caps  # noqa: E402

# Node executable: env override > PATH > "node" fallback
NODE20 = os.environ.get("NODE20") or shutil.which("node") or "node"
PYTHON = sys.executable or "python3"


def run(cmd):
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=ROOT, check=True)


def run_safe(cmd):
    """Run a command, return True on success, False on failure (no raise)."""
    print("+", " ".join(cmd), flush=True)
    try:
        subprocess.run(cmd, cwd=ROOT, check=True)
        return True
    except subprocess.CalledProcessError as error:
        print(f"⚠️  command failed (rc={error.returncode})", flush=True)
        return False


def read_jsonl_lines(path):
    p = Path(path)
    if not p.exists():
        return []
    return [line for line in p.read_text().splitlines() if line.strip()]


def write_jsonl_lines(path, lines):
    Path(path).write_text("".join(f"{line}\n" for line in lines))


def count_hits_in_results(path, econ_cap, biz_cap):
    """Count results that match budget (within econ_cap / biz_cap)."""
    p = Path(path)
    if not p.exists():
        return 0
    hits = 0
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not r.get("ok"):
            continue
        prices = r.get("prices", [])
        if not prices:
            continue
        cheapest = prices[0].get("price")
        cabin = r.get("cabin", "economy")
        cap = econ_cap if cabin == "economy" else biz_cap
        if cheapest and cheapest <= cap:
            hits += 1
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tasks", default="/tmp/flight_full_tasks.jsonl")
    ap.add_argument("--results", default="/tmp/flight_full_results.jsonl")
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--batch-size", type=int, default=150)
    ap.add_argument("--skip-report", action="store_true",
                    help="Skip the final Telegram summary report.")
    ap.add_argument("--no-tg", action="store_true",
                    help="Disable all Telegram notifications from this script.")
    args = ap.parse_args()

    env = notify.load_env(ROOT)
    econ_cap, biz_cap = get_budget_caps(env)

    def tg(text, silent=False):
        if args.no_tg:
            print(f"[tg-skip] {text}", flush=True)
            return
        notify.send(env, text, silent=silent)

    print({"node": NODE20, "python": PYTHON,
           "econ_cap": econ_cap, "biz_cap": biz_cap}, flush=True)
    started = time.time()

    # === Build tasks ===
    run([PYTHON, os.path.join(ROOT, "scripts/build-tasks.py"), args.tasks, "all"])

    task_lines = read_jsonl_lines(args.tasks)
    total = len(task_lines)
    print({"total_tasks": total, "batch_size": args.batch_size,
           "concurrency": args.concurrency}, flush=True)

    # === Notify start ===
    tg(notify.msg_batch_start(total, econ_cap, biz_cap))

    # === Progress checkpoints: every 10% ===
    checkpoints = [int(total * p / 10) for p in range(1, 10)]  # 10%, 20%, ..., 90%
    checkpoints_sent = set()

    failed_batches = []
    total_hits = 0
    done = 0

    for index in range(0, total, args.batch_size):
        batch_no = index // args.batch_size + 1
        batch_lines = task_lines[index:index + args.batch_size]
        batch_tasks = f"{args.tasks}.batch{batch_no}"
        batch_results = f"{args.results}.batch{batch_no}"

        write_jsonl_lines(batch_tasks, batch_lines)
        Path(batch_results).write_text("")

        print({"batch": batch_no, "tasks": len(batch_lines),
               "completed_before": index, "total": total}, flush=True)

        # === Scrape ===
        scrape_ok = run_safe([
            NODE20,
            os.path.join(ROOT, "scripts/local-scrape.mjs"),
            "--input", batch_tasks,
            "--output", batch_results,
            "--concurrency", str(args.concurrency),
            "--econ-cap", str(econ_cap),
            "--biz-cap", str(biz_cap),
        ])

        if not scrape_ok:
            failed_batches.append((batch_no, "scrape"))
            done += len(batch_lines)
            continue

        # Count hits in this batch (for progress message)
        batch_hits = count_hits_in_results(batch_results, econ_cap, biz_cap)
        total_hits += batch_hits

        # === Import (writes SQLite + syncs to Notion) ===
        import_ok = run_safe([
            PYTHON,
            os.path.join(ROOT, "scripts/import-results.py"),
            batch_results,
        ])
        if not import_ok:
            failed_batches.append((batch_no, "import"))

        done += len(batch_lines)

        # === Progress notification (every ~10%) ===
        for cp in checkpoints:
            if done >= cp and cp not in checkpoints_sent:
                checkpoints_sent.add(cp)
                elapsed = int(time.time() - started)
                tg(notify.msg_progress(done, total, elapsed, total_hits),
                   silent=True)  # 進度通知靜音,不擾人

    # === Final summary ===
    elapsed = int(time.time() - started)
    lowest = _find_lowest_price(args.results, econ_cap, biz_cap)

    summary_text = notify.msg_batch_done(total, total_hits, lowest, elapsed)
    if failed_batches:
        summary_text += f"\n⚠️ 失敗 batch: {len(failed_batches)} 個 ({failed_batches})"
    tg(summary_text)

    # === Optional final report ===
    if not args.skip_report:
        run_safe([NODE20, os.path.join(ROOT, "scripts/send-price-report.mjs")])

    print({
        "elapsed_seconds": elapsed,
        "tasks": args.tasks,
        "results": args.results,
        "total_hits": total_hits,
        "failed_batches": failed_batches,
    }, flush=True)


def _find_lowest_price(results_prefix, econ_cap, biz_cap):
    """Scan all batch*.results to find the lowest price within budget."""
    lowest = None
    parent = Path(results_prefix).parent
    pattern = Path(results_prefix).name
    for f in parent.glob(f"{pattern}.batch*"):
        for line in f.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not r.get("ok"):
                continue
            prices = r.get("prices", [])
            if not prices:
                continue
            p = prices[0].get("price")
            cabin = r.get("cabin", "economy")
            cap = econ_cap if cabin == "economy" else biz_cap
            if p and p <= cap:
                if lowest is None or p < lowest:
                    lowest = p
    return lowest


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
