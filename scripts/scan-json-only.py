#!/usr/bin/env python3
"""JSON-only flight scan orchestrator.

Replaces scan-targets-direct.py for users who do not want Notion/SQLite.
Input: data/my-targets.json (or path via --targets)
Output: data/results.json (append-only by default, or --reset to overwrite)

Range support per segment:
  from: ["TPE", "TSA"]                       multi-airport
  to:   ["NRT", "HND"]                       multi-destination
  date_range: { start: "...", end: "..." }   inclusive date range

The cartesian product of all (from × to × date) across segments is expanded
into individual scrape tasks, dispatched to local-scrape.mjs (Playwright +
chromium), and the cheapest in-budget result per (target, cabin, source) is
written to results.json.

Telegram notification is optional via TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
in the environment (or .env.local). No external services required.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta
from itertools import product
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NODE = os.environ.get("NODE20") or shutil.which("node") or "node"


def load_env_file(path):
    env = {}
    if not os.path.exists(path):
        return env
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def daterange(start_iso, end_iso):
    start = datetime.strptime(start_iso, "%Y-%m-%d")
    end = datetime.strptime(end_iso, "%Y-%m-%d")
    if end < start:
        raise ValueError(f"date_range end ({end_iso}) before start ({start_iso})")
    cur = start
    while cur <= end:
        yield cur.strftime("%Y-%m-%d")
        cur += timedelta(days=1)


def expand_target(target):
    """Cartesian-expand one target into a list of scrape tasks.

    Each segment contributes (from × to × dates). Combining segments
    multiplies the option count, so be careful with very wide ranges.
    """
    name = target.get("name", "(unnamed)")
    segments_spec = target.get("segments", [])
    if not segments_spec:
        raise ValueError(f"target {name!r} has no segments")

    # Per-segment option list
    per_segment = []
    for idx, seg in enumerate(segments_spec):
        froms = seg.get("from") or []
        tos = seg.get("to") or []
        if isinstance(froms, str):
            froms = [froms]
        if isinstance(tos, str):
            tos = [tos]
        if not froms or not tos:
            raise ValueError(f"target {name!r} segment {idx} missing from/to")
        dr = seg.get("date_range") or {}
        if not dr.get("start") or not dr.get("end"):
            raise ValueError(f"target {name!r} segment {idx} missing date_range")
        dates = list(daterange(dr["start"], dr["end"]))
        options = []
        for f, t, d in product(froms, tos, dates):
            if f == t:
                continue  # skip nonsensical same-airport segments
            options.append({"from": f, "to": t, "date": d})
        if not options:
            raise ValueError(f"target {name!r} segment {idx} expanded to 0 options")
        per_segment.append(options)

    cabins = ["economy"]
    if target.get("include_business"):
        cabins.append("business")

    tasks = []
    for combo in product(*per_segment):
        for cabin in cabins:
            tasks.append({
                "target_name": name,
                "out1": combo[0]["from"],
                "out4": combo[-1]["to"],
                "cabin": cabin,
                "segments": list(combo),
            })
    return tasks


def cheapest_in_budget(rows, budget):
    """For each (source, cabin) bucket, find cheapest in-budget {airline, price, url, segments}.

    Raw row schema: {source, cabin, prices: [{airline, price}, ...], url, segments, ok}
    """
    out = {}
    for r in rows:
        if r.get("error") or not r.get("ok"):
            continue
        prices = r.get("prices") or []
        if not prices:
            continue
        cabin = r.get("cabin", "economy")
        source = r.get("source", "eztravel")
        cap = budget.get(cabin)
        for p in prices:
            price = p.get("price")
            if price is None:
                continue
            if cap is not None and price > cap:
                continue
            key = (source, cabin)
            prev = out.get(key)
            if prev is None or price < prev["price"]:
                out[key] = {
                    "price": price,
                    "airline": p.get("airline"),
                    "url": r.get("url"),
                    "segments": r.get("segments"),
                }
    return out


def maybe_telegram(env, msg):
    token = env.get("TELEGRAM_BOT_TOKEN") or os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = env.get("TELEGRAM_CHAT_ID") or os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        return False
    import urllib.parse
    import urllib.request
    body = urllib.parse.urlencode({
        "chat_id": chat,
        "text": msg[:4000],
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        urllib.request.urlopen(req, timeout=10).read()
        return True
    except Exception as e:
        print(f"  telegram failed: {e}", file=sys.stderr)
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--targets", default=str(ROOT / "data" / "my-targets.json"),
                    help="Path to targets JSON (default: data/my-targets.json)")
    ap.add_argument("--results", default=str(ROOT / "data" / "results.json"),
                    help="Path to results JSON (default: data/results.json)")
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--tasks-path", default="/tmp/flight-json-tasks.jsonl")
    ap.add_argument("--raw-results-path", default="/tmp/flight-json-results.jsonl")
    ap.add_argument("--reset", action="store_true",
                    help="Overwrite results.json (default: append run alongside existing)")
    ap.add_argument("--dry-run", action="store_true", help="Build tasks and stop without scraping")
    args = ap.parse_args()

    env = load_env_file(ROOT / ".env.local")

    if not os.path.exists(args.targets):
        print(f"❌ targets file not found: {args.targets}", file=sys.stderr)
        print(f"   tip: copy data/example-targets.json to data/my-targets.json and edit",
              file=sys.stderr)
        sys.exit(2)

    with open(args.targets) as f:
        targets = json.load(f)

    if not isinstance(targets, list) or not targets:
        print("❌ targets JSON must be a non-empty list", file=sys.stderr)
        sys.exit(2)

    print(f"📋 loaded {len(targets)} target(s) from {args.targets}")

    # Expand
    all_tasks = []
    by_target = {}
    for t in targets:
        try:
            tasks = expand_target(t)
        except Exception as e:
            print(f"❌ {t.get('name', '?')}: {e}", file=sys.stderr)
            sys.exit(2)
        by_target[t["name"]] = {"target": t, "tasks": tasks}
        all_tasks.extend(tasks)
        print(f"  • {t['name']}: {len(tasks)} task(s) (cartesian-expanded)")

    if not all_tasks:
        print("❌ nothing to scan after expansion", file=sys.stderr)
        sys.exit(2)

    print(f"\n🔢 total tasks: {len(all_tasks)} (× 2 sources each ≈ {len(all_tasks) * 2} scrapes)")

    # Write tasks.jsonl
    with open(args.tasks_path, "w") as f:
        for t in all_tasks:
            f.write(json.dumps(t, ensure_ascii=False) + "\n")
    print(f"📝 wrote {args.tasks_path}")

    if args.dry_run:
        print("(--dry-run set, stopping before scrape)")
        return

    # Make sure raw results file is empty
    open(args.raw_results_path, "w").close()

    # Spawn local-scrape.mjs
    scrape_script = ROOT / "scripts" / "local-scrape.mjs"
    cmd = [NODE, str(scrape_script),
           "--input", args.tasks_path,
           "--output", args.raw_results_path,
           "--concurrency", str(args.concurrency)]
    print(f"\n🛫 running scraper (concurrency={args.concurrency})…")
    print(f"   {' '.join(cmd)}")
    started = time.time()
    rc = subprocess.call(cmd)
    elapsed = time.time() - started
    if rc != 0:
        print(f"❌ scraper exit {rc} after {elapsed:.1f}s", file=sys.stderr)
        sys.exit(rc)
    print(f"✅ scraper done in {elapsed:.1f}s")

    # Parse raw results
    raw = []
    with open(args.raw_results_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                raw.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    print(f"📥 parsed {len(raw)} raw scrape result(s)")

    # Group by target_name
    grouped = {}
    for r in raw:
        grouped.setdefault(r.get("target_name", "?"), []).append(r)

    # Per-target: find cheapest in-budget per (source, cabin) and assemble hit summary
    run_summary = {
        "scan_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "targets": [],
    }
    telegram_lines = [f"✈️ <b>Flight scan complete</b> ({len(targets)} targets, {len(raw)} scrapes)"]
    for tname, info in by_target.items():
        target = info["target"]
        budget = target.get("budget") or {}
        rows = grouped.get(tname, [])
        hits = cheapest_in_budget(rows, budget)
        entry = {
            "name": tname,
            "budget": budget,
            "task_count": len(info["tasks"]),
            "scrape_count": len(rows),
            "hits": [
                {"source": k[0], "cabin": k[1], **v}
                for k, v in sorted(hits.items())
            ],
        }
        run_summary["targets"].append(entry)
        if hits:
            telegram_lines.append(f"\n🎯 <b>{tname}</b>")
            for k, v in sorted(hits.items()):
                src, cab = k
                telegram_lines.append(
                    f"  {src} {cab}: <b>${v.get('price')}</b> {v.get('airline', '')}"
                )
        else:
            telegram_lines.append(f"\n🎯 <b>{tname}</b>: no in-budget hit")

    # Append or reset results.json
    results_path = Path(args.results)
    results_path.parent.mkdir(parents=True, exist_ok=True)
    if args.reset or not results_path.exists():
        runs = []
    else:
        try:
            with open(results_path) as f:
                runs = json.load(f)
            if not isinstance(runs, list):
                runs = []
        except Exception:
            runs = []
    runs.append(run_summary)
    with open(results_path, "w") as f:
        json.dump(runs, f, ensure_ascii=False, indent=2)
    print(f"\n💾 results saved to {results_path} ({len(runs)} run(s) total)")

    # Telegram (if configured)
    if maybe_telegram(env, "\n".join(telegram_lines)):
        print("📲 Telegram summary sent")
    else:
        print("(telegram skipped — set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to enable)")

    # Print human-readable summary
    print("\n────── 結果摘要 ──────")
    for entry in run_summary["targets"]:
        print(f"\n🎯 {entry['name']}  (scanned {entry['scrape_count']} pages)")
        if entry["hits"]:
            for h in entry["hits"]:
                print(f"   {h['source']:8} {h['cabin']:8} ${h['price']:>7}  {h.get('airline') or ''}")
        else:
            print("   (no in-budget hit)")


if __name__ == "__main__":
    main()
