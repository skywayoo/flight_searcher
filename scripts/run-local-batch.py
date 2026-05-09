#!/usr/bin/env python3
"""Run build-tasks -> local-scrape -> import-results -> send-price-report as one local batch."""

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE20 = "/opt/homebrew/Cellar/node@20/20.20.2/bin/node"
PYTHON = sys.executable or "python3"


def run(cmd):
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=ROOT, check=True)


def read_jsonl_lines(path):
    p = Path(path)
    if not p.exists():
        return []
    return [line for line in p.read_text().splitlines() if line.strip()]


def write_jsonl_lines(path, lines):
    Path(path).write_text("".join(f"{line}\n" for line in lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tasks", default="/tmp/flight_full_tasks.jsonl")
    ap.add_argument("--results", default="/tmp/flight_full_results.jsonl")
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--batch-size", type=int, default=150)
    ap.add_argument("--skip-report", action="store_true", help="Skip the final Telegram summary report.")
    args = ap.parse_args()

    started = time.time()
    run([PYTHON, os.path.join(ROOT, "scripts/build-tasks.py"), args.tasks, "all"])
    task_lines = read_jsonl_lines(args.tasks)
    total = len(task_lines)
    print({"total_tasks": total, "batch_size": args.batch_size, "concurrency": args.concurrency}, flush=True)

    for index in range(0, total, args.batch_size):
        batch_no = index // args.batch_size + 1
        batch_lines = task_lines[index:index + args.batch_size]
        batch_tasks = f"{args.tasks}.batch{batch_no}"
        batch_results = f"{args.results}.batch{batch_no}"
        write_jsonl_lines(batch_tasks, batch_lines)
        Path(batch_results).write_text("")
        print({"batch": batch_no, "tasks": len(batch_lines), "completed_before": index, "total": total}, flush=True)
        run([
            NODE20,
            os.path.join(ROOT, "scripts/local-scrape.mjs"),
            "--input", batch_tasks,
            "--output", batch_results,
            "--concurrency", str(args.concurrency),
        ])
        run([PYTHON, os.path.join(ROOT, "scripts/import-results.py"), batch_results])

    if args.skip_report:
        print("skipping final price report", flush=True)
    else:
        run([NODE20, os.path.join(ROOT, "scripts/send-price-report.mjs")])

    print({"elapsed_seconds": int(time.time() - started), "tasks": args.tasks, "results": args.results}, flush=True)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
