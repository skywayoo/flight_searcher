#!/usr/bin/env python3
"""Tail /tmp/flight-direct-results.jsonl, push Telegram + write Notion +
write SQLite for each new in-budget hit. Periodically regenerates docs/
and pushes GH Pages so the public site stays live."""
import argparse
import json
import os
import sqlite3
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import notify  # noqa: E402

DB_PATH = os.path.join(ROOT, "data", "flight-results.sqlite")


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


def ensure_sqlite():
    """Recreate the legacy scrape_results table if missing so docs gen works."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scrape_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            out1 TEXT, out4 TEXT, nz TEXT, seg4_airport TEXT,
            variation_idx INTEGER,
            seg1_date TEXT, seg2_date TEXT, seg3_date TEXT, seg4_date TEXT,
            cabin TEXT,
            cheapest_price INTEGER, all_prices_json TEXT,
            booking_url TEXT,
            duration_ms INTEGER,
            scraped_at TEXT,
            error TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pair ON scrape_results(out1, out4, cabin)")
    conn.commit()
    return conn


def sqlite_insert_hit(conn, r):
    segs = r.get("segments", [])
    if len(segs) != 4:
        return
    nz_label = f"{segs[1]['to']}-{segs[2]['from']}"
    conn.execute("""
        INSERT INTO scrape_results
        (out1, out4, nz, seg4_airport, variation_idx,
         seg1_date, seg2_date, seg3_date, seg4_date,
         cabin, cheapest_price, all_prices_json,
         booking_url, duration_ms, scraped_at)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        r.get("out1"), r.get("out4"), nz_label, segs[3]["from"],
        segs[0]["date"], segs[1]["date"], segs[2]["date"], segs[3]["date"],
        r.get("cabin"), r["prices"][0]["price"],
        json.dumps(r["prices"], ensure_ascii=False),
        r.get("url", ""), r.get("durationMs", 0),
        time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    ))
    conn.commit()


def notion_upsert_result(env, target_id, target_name, r):
    token = env["NOTION_API_KEY"]
    db = env["NOTION_FLIGHT_RESULTS_DB_ID"]
    today = time.strftime("%Y-%m-%d")
    segs = r["segments"]
    nz_label = f"{segs[1]['to']}-{segs[2]['from']}"
    route = (
        f"{r.get('out1')}→TPE  ({segs[0]['date']}) | "
        f"TPE→{segs[1]['to']} ({segs[1]['date']}) | "
        f"{segs[2]['from']}→TPE ({segs[2]['date']}) | "
        f"{segs[3]['from']}→{r.get('out4')} ({segs[3]['date']})"
    )
    top5 = [{
        "airline": p["airline"],
        "totalPrice": p["price"],
        "cabin": r.get("cabin", "economy"),
        "outStation": r.get("out1"),
        "outboundAirport": r.get("out4"),
        "outboundDate": segs[0]["date"],
        "returnDate": segs[3]["date"],
        "bookingUrl": r.get("url", ""),
    } for p in r["prices"][:5]]
    props = {
        "Name": {"title": [{"text": {"content": target_name}}]},
        "TargetId": {"rich_text": [{"text": {"content": target_id}}]},
        "ScrapeDate": {"date": {"start": today}},
        "CheapestPrice": {"number": r["prices"][0]["price"]},
        "Top5": {"rich_text": [{"text": {"content": (json.dumps(top5, ensure_ascii=False) + "\n" + route)[:1900]}}]},
        "Source": {"select": {"name": "eztravel"}},
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


def regenerate_and_push():
    """Run generate-static.py, commit + push docs if changed."""
    print("  regenerating docs...", flush=True)
    subprocess.run(
        ["python3", os.path.join(ROOT, "scripts/generate-static.py")],
        cwd=ROOT,
        check=False,
    )
    # Stage + commit + push (no-op if no diff)
    subprocess.run(["git", "add", "docs/"], cwd=ROOT, check=False)
    rc = subprocess.run(
        ["git", "diff", "--cached", "--quiet"], cwd=ROOT
    ).returncode
    if rc == 0:
        print("  no doc changes; skipping push", flush=True)
        return
    subprocess.run(
        ["git", "commit", "-m", f"docs: live hits update {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}"],
        cwd=ROOT,
        check=False,
    )
    p = subprocess.run(["git", "push", "origin", "main"], cwd=ROOT, capture_output=True, text=True)
    print(f"  push rc={p.returncode}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default="/tmp/flight-direct-results.jsonl")
    ap.add_argument("--econ-cap", type=int, default=50000)
    ap.add_argument("--biz-cap", type=int, default=80000)
    ap.add_argument("--push-interval", type=int, default=300,
                    help="Seconds between GH Pages regen+push when new hits seen.")
    args = ap.parse_args()

    env = load_env()
    conn = ensure_sqlite()
    seen = set()
    best_by_target = {}
    last_push = 0
    pending_push = False

    offset = 0
    while True:
        try:
            size = os.path.getsize(args.results)
        except FileNotFoundError:
            time.sleep(2)
            continue
        if size > offset:
            with open(args.results, "rb") as f:
                f.seek(offset)
                chunk = f.read().decode("utf-8", "ignore")
                offset = f.tell()
            for line in chunk.split("\n"):
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:
                    continue
                prices = r.get("prices", [])
                if not prices:
                    continue
                cabin = r.get("cabin", "economy")
                cap = args.econ_cap if cabin == "economy" else args.biz_cap
                cheapest = prices[0]["price"]
                if cheapest > cap:
                    continue
                tname = r.get("target_name", "?")
                key = (tname, cabin, r.get("out1"), r.get("out4"))
                if key in seen:
                    continue
                seen.add(key)
                prev = best_by_target.get((tname, cabin), 10**9)
                # Always write SQLite + Notion for every new (out1, out4) combo,
                # but only Telegram-notify when it's a NEW BEST for the target.
                sqlite_insert_hit(conn, r)
                target_id = r.get("target_id", "")
                notion_upsert_result(env, target_id, tname, r)
                pending_push = True
                if cheapest < prev:
                    best_by_target[(tname, cabin)] = cheapest
                    msg = (
                        f"💰 {cabin} {cheapest:,} ｜ {tname}\n"
                        f"{r.get('out1')}→TPE→…→{r.get('out4')} ({prices[0]['airline']})\n"
                        f"{r.get('url','')}"
                    )
                    print(msg, flush=True)
                    notify.send(env, msg)
        # Periodic regen + push
        now = time.time()
        if pending_push and (now - last_push) >= args.push_interval:
            regenerate_and_push()
            last_push = now
            pending_push = False
        if size <= offset:
            time.sleep(3)


if __name__ == "__main__":
    main()
