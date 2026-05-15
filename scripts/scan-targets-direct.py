#!/usr/bin/env python3
"""Fast multi-target scan that bypasses the Next.js scrapeTarget code path.

Why this exists: the dev server's scrapeTarget opens a fresh chromium
browser per scrape (288× per target → ~60min/target). local-scrape.mjs
reuses one browser with a worker pool, so 6,912 scrapes total run in
under 3 hours at concurrency=4.

Flow:
  1. Pull all active FlightTargets from Notion (with segments JSON)
  2. Cartesian-expand each target's multi-airport segments
  3. Write everything to one big tasks.jsonl
  4. Invoke local-scrape.mjs --concurrency=N
  5. Read results, group by target, find cheapest per cabin within
     budget caps, push Notion FlightResult + Telegram per hit
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from itertools import product
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import notify  # noqa: E402

NODE20 = os.environ.get("NODE20") or shutil.which("node") or "node"


def load_env():
    env = {}
    with open(os.path.join(ROOT, ".env.local")) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k] = v.strip().strip('"').strip("'").replace("\\n", "")
    return env


def notion_query_active_targets(token, db):
    out = []
    cursor = None
    while True:
        body = {"page_size": 100, "filter": {"property": "Status", "select": {"equals": "active"}}}
        if cursor:
            body["start_cursor"] = cursor
        req = urllib.request.Request(
            f"https://api.notion.com/v1/databases/{db}/query",
            method="POST",
            headers={
                "Authorization": f"Bearer {token}",
                "Notion-Version": "2022-06-28",
                "Content-Type": "application/json",
            },
            data=json.dumps(body).encode(),
        )
        d = json.loads(urllib.request.urlopen(req, timeout=30).read())
        for p in d["results"]:
            props = p["properties"]
            def g(k, t):
                v = props.get(k, {})
                if v.get("type") != t:
                    return None
                if t == "title":
                    return "".join(x["plain_text"] for x in v["title"])
                if t == "rich_text":
                    return "".join(x["plain_text"] for x in v["rich_text"])
                if t == "number":
                    return v["number"]
                if t == "checkbox":
                    return v["checkbox"]
                if t == "select":
                    return v["select"]["name"] if v["select"] else None
                if t == "date":
                    return v["date"]["start"] if v["date"] else None
                return None

            segs_raw = g("Segments", "rich_text") or ""
            try:
                segs = json.loads(segs_raw) if segs_raw else []
            except json.JSONDecodeError:
                segs = []
            out.append({
                "id": p["id"],
                "name": g("Name", "title") or "?",
                "tripType": g("TripType", "select"),
                "segments": segs,
                "budgetCapEcon": g("BudgetCapEcon", "number") or g("BudgetCap", "number") or 0,
                "budgetCapBusiness": g("BudgetCapBusiness", "number") or 0,
                "includeBusiness": g("IncludeBusiness", "checkbox") or False,
            })
        if not d.get("has_more"):
            break
        cursor = d.get("next_cursor")
    return out


def expand_target(target):
    """Generate one task per (cabin, combo) for a single multi_city_4 target."""
    if target["tripType"] != "multi_city_4" or len(target["segments"]) != 4:
        return []
    segs = target["segments"]

    def split(s):
        return [c.strip().upper() for c in (s or "").split(",") if c.strip()]

    choices = [(split(s["from"]) or [""], split(s["to"]) or [""], s["date"]) for s in segs]
    cabins = ["economy"]
    if target["includeBusiness"]:
        cabins.append("business")

    tasks = []
    for f1, t1, f2, t2, f3, t3, f4, t4 in product(
        choices[0][0], choices[0][1],
        choices[1][0], choices[1][1],
        choices[2][0], choices[2][1],
        choices[3][0], choices[3][1],
    ):
        for cabin in cabins:
            tasks.append({
                "target_id": target["id"],
                "target_name": target["name"],
                "out1": f1, "out4": t4,
                "cabin": cabin,
                "segments": [
                    {"from": f1, "to": t1, "date": choices[0][2]},
                    {"from": f2, "to": t2, "date": choices[1][2]},
                    {"from": f3, "to": t3, "date": choices[2][2]},
                    {"from": f4, "to": t4, "date": choices[3][2]},
                ],
            })
    return tasks


def notify_telegram(env, msg, silent=False):
    notify.send(env, msg, silent=silent)


def notion_create_result(token, db, target_id, target_name, cheapest, scrape_date, top5, cabin, source_url):
    """Write a basic FlightResult row to Notion."""
    props = {
        "Name": {"title": [{"text": {"content": target_name}}]},
        "TargetId": {"rich_text": [{"text": {"content": target_id}}]},
        "ScrapeDate": {"date": {"start": scrape_date}},
        "CheapestPrice": {"number": cheapest},
        "Top5": {"rich_text": [{"text": {"content": json.dumps(top5, ensure_ascii=False)[:1900]}}]},
        "Source": {"rich_text": [{"text": {"content": "eztravel"}}]},
    }
    req = urllib.request.Request(
        "https://api.notion.com/v1/pages",
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
        },
        data=json.dumps({"parent": {"database_id": db}, "properties": props}).encode(),
    )
    try:
        urllib.request.urlopen(req, timeout=15).read()
        return True
    except Exception as e:
        print(f"  notion create failed: {e}", flush=True)
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--tasks-path", default="/tmp/flight-direct-tasks.jsonl")
    ap.add_argument("--results-path", default="/tmp/flight-direct-results.jsonl")
    ap.add_argument("--dry-run", action="store_true", help="Build tasks and stop")
    args = ap.parse_args()

    env = load_env()
    token = env["NOTION_API_KEY"]
    targets_db = env["NOTION_FLIGHT_TARGETS_DB_ID"]
    results_db = env["NOTION_FLIGHT_RESULTS_DB_ID"]

    print("Pulling active targets…", flush=True)
    targets = notion_query_active_targets(token, targets_db)
    print(f"  got {len(targets)} active targets")

    # Index by id for downstream lookup
    by_id = {t["id"]: t for t in targets}

    all_tasks = []
    for t in targets:
        all_tasks.extend(expand_target(t))
    print(f"Total tasks (after cartesian × cabins): {len(all_tasks)}")

    # Priority sort: TPE seg4 targets first (more likely to have flights),
    # TSA seg4 targets last. Within priority, interleave by target so any
    # dead-route batches don't monopolize the first hour.
    def prio_key(task):
        seg4_from = task["segments"][3]["from"].upper()
        return 0 if seg4_from == "TPE" else 1
    all_tasks.sort(key=prio_key)

    if not all_tasks:
        print("nothing to do")
        return

    # Write JSONL
    Path(args.tasks_path).parent.mkdir(parents=True, exist_ok=True)
    with open(args.tasks_path, "w") as f:
        for t in all_tasks:
            f.write(json.dumps(t, ensure_ascii=False) + "\n")
    print(f"wrote {args.tasks_path}")

    if args.dry_run:
        return

    Path(args.results_path).unlink(missing_ok=True)

    notify_telegram(env, f"🚀 直接掃描開始：{len(targets)} target → {len(all_tasks)} scrape (conc {args.concurrency})")

    # Invoke local-scrape.mjs
    cmd = [
        NODE20,
        os.path.join(ROOT, "scripts/local-scrape.mjs"),
        "--input", args.tasks_path,
        "--output", args.results_path,
        "--concurrency", str(args.concurrency),
    ]
    print("+", " ".join(cmd), flush=True)
    started = time.time()
    rc = subprocess.run(cmd, cwd=ROOT).returncode
    elapsed = int(time.time() - started)
    print(f"local-scrape finished rc={rc} in {elapsed}s", flush=True)

    # Read results, group by target_id + cabin
    grouped = {}  # (target_id, cabin) -> list of result dicts
    with open(args.results_path) as f:
        for line in f:
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
            key = (r["target_id"], r["cabin"])
            grouped.setdefault(key, []).append({
                "out1": r.get("out1"), "out4": r.get("out4"),
                "segments": r.get("segments"),
                "cheapest": prices[0]["price"],
                "airline": prices[0]["airline"],
                "url": r.get("url", ""),
                "all_prices": prices,
            })

    # Per target+cabin pick cheapest within budget, notify + write Notion
    today = time.strftime("%Y-%m-%d")
    total_hits = 0
    summaries = []
    for (target_id, cabin), entries in grouped.items():
        target = by_id.get(target_id)
        if not target:
            continue
        cap = target["budgetCapEcon"] if cabin == "economy" else target["budgetCapBusiness"]
        if not cap:
            cap = 10**9
        in_budget = [e for e in entries if e["cheapest"] <= cap]
        if not in_budget:
            continue
        in_budget.sort(key=lambda e: e["cheapest"])
        best = in_budget[0]
        total_hits += 1
        line = (
            f"💰 {cabin} {best['cheapest']:,} ｜ {target['name']} ｜ "
            f"{best['out1']}→TPE→…→{best['out4']} ({best['airline']})"
        )
        summaries.append(line)
        notify_telegram(env, line + (f"\n{best['url']}" if best.get("url") else ""))
        # Write to Notion (best-effort)
        top5 = in_budget[:5]
        top5_compact = [{
            "out1": e["out1"], "out4": e["out4"],
            "price": e["cheapest"], "airline": e["airline"],
        } for e in top5]
        notion_create_result(token, results_db, target_id, target["name"],
                             best["cheapest"], today, top5_compact, cabin, best["url"])

    final = (
        f"🏁 直接掃描完成 {elapsed//60}m{elapsed%60}s ｜ "
        f"hits={total_hits} ｜ scrapes={len(all_tasks)}"
    )
    notify_telegram(env, final)
    print(final, flush=True)


if __name__ == "__main__":
    main()
