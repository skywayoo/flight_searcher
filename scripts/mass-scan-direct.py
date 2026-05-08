#!/usr/bin/env python3
"""Mass scan via /api/scrape-direct, results stored in local SQLite.

Bypasses Notion entirely. Each scrape is one variation x one cabin call (~30s).
Concurrency 8 keeps total runtime tractable.

Usage:
  python3 scripts/mass-scan-direct.py [--phase 1|2]

Phase 1 (default):
  21 outstations x 21 = 441 pairs
  Single NZ pair: TPE -> ZQN -> TPE (no open jaw)
  Single seg4: TPE on 4/30
  3 date variations x 2 cabins = 6 scrapes/pair = 2646 total
  ~2.75hr at concurrency 8.

Hits (<=50k economy / <=80k business) get Telegram'd immediately.
"""
import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from itertools import product

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "data", "flight-results.sqlite")

OUTSTATIONS = [
    "BKK", "CNX", "CTS", "DMK", "FUK", "GMP", "HIJ", "HKG", "ICN", "ISG",
    "KMJ", "KOJ", "OKA", "PUS", "SDJ", "SHI",
    "HKD", "NGO", "UKB", "MFM", "DPS",  # new
]

# Date variations: (o1, o2, o3, o4) day offsets from base 3/1, 4/1, 4/12, 4/30
VARIATIONS = [
    (0, 0, 0, 0),     # base: 3/1, 4/1, 4/12, 4/30 (12d NZ)
    (1, -2, 3, -9),   # user $43k: 3/2, 3/30, 4/15, 4/21 (16d NZ)
    (-3, 4, 4, 1),    # 2/26, 4/5, 4/16, 5/1 (12d NZ)
]
CABINS = ["economy", "business"]
ECON_CAP = 50000
BIZ_CAP = 80000


def load_env():
    env = {}
    with open(os.path.join(ROOT, ".env.local")) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'").replace("\\n", "").replace("\\r", "")
            env[k] = v
    return env


def shift(iso, days):
    from datetime import datetime, timedelta
    d = datetime.strptime(iso, "%Y-%m-%d") + timedelta(days=days)
    return d.strftime("%Y-%m-%d")


def make_segments(out1, out4, nz, seg4_airport, var):
    o1, o2, o3, o4 = var
    base1, base2, base3, base4 = "2027-03-01", "2027-04-01", "2027-04-12", "2027-04-30"
    return [
        {"from": out1, "to": "TPE", "date": shift(base1, o1)},
        {"from": "TPE", "to": nz, "date": shift(base2, o2)},
        {"from": nz, "to": "TPE", "date": shift(base3, o3)},
        {"from": seg4_airport, "to": out4, "date": shift(base4, o4)},
    ]


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
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
    conn.execute("CREATE INDEX IF NOT EXISTS idx_price ON scrape_results(cheapest_price)")
    conn.commit()
    return conn


def telegram(env, text):
    try:
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{env['TELEGRAM_BOT_TOKEN']}/sendMessage",
            data=json.dumps({"chat_id": env["TELEGRAM_CHAT_ID"], "text": text}).encode(),
            method="POST", headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10).read()
    except Exception:
        pass


def scrape_one(env, segments, cabin, retries=1):
    """Single Vercel scrape-direct call. One retry on transient errors."""
    body = json.dumps({"segments": segments, "cabin": cabin}).encode()
    last_err = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            f"{env['NEXT_PUBLIC_BASE_URL']}/api/scrape-direct",
            data=body, method="POST",
            headers={"Content-Type": "application/json", "x-secret": env["CRON_SECRET"]},
        )
        try:
            res = json.loads(urllib.request.urlopen(req, timeout=130).read())
            return {"ok": True, **res}
        except urllib.error.HTTPError as e:
            last_err = f"http {e.code}"
            if e.code in (500, 502, 503, 504) and attempt == 0:
                time.sleep(3)
                continue
            return {"ok": False, "error": last_err}
        except Exception as e:
            last_err = str(e)[:100]
            if attempt == 0:
                time.sleep(3)
                continue
            return {"ok": False, "error": last_err}
    return {"ok": False, "error": last_err or "unknown"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", type=int, default=1)
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--variations", type=int, default=3, help="how many variations to try per pair")
    ap.add_argument("--cabins", default="economy,business")
    args = ap.parse_args()

    env = load_env()
    conn = init_db()

    cabins = args.cabins.split(",")
    variations = VARIATIONS[: args.variations]

    # Resume: skip tasks already in DB (matched by out1, out4, variation_idx, cabin)
    cur = conn.execute(
        "SELECT out1, out4, variation_idx, cabin FROM scrape_results"
    )
    done_set = set(cur.fetchall())
    if done_set:
        print(f"Resume: {len(done_set)} scrapes already in DB, skipping those")

    # Build task list (out1, out4, var_idx, cabin)
    tasks = []
    skipped = 0
    for out1, out4 in product(OUTSTATIONS, OUTSTATIONS):
        for vi, var in enumerate(variations):
            for cabin in cabins:
                if (out1, out4, vi, cabin) in done_set:
                    skipped += 1
                    continue
                tasks.append((out1, out4, vi, var, cabin))
    if skipped:
        print(f"  skipped {skipped} already-done")

    print(f"Phase {args.phase}: {len(OUTSTATIONS)}x{len(OUTSTATIONS)} pairs, "
          f"{args.variations} variations, {len(cabins)} cabins = {len(tasks)} scrapes")
    print(f"Concurrency: {args.concurrency}")
    print(f"DB: {DB_PATH}")
    print(f"Estimated runtime: {len(tasks) * 30 / args.concurrency / 60:.0f} min "
          f"(~{len(tasks) * 30 / args.concurrency / 3600:.1f} hr)")

    telegram(env, f"🚀 Direct scan 開始：{len(tasks)} scrapes (conc {args.concurrency}, "
                  f"{args.variations} variations × {len(cabins)} cabins). "
                  f"預估 {len(tasks) * 30 / args.concurrency / 3600:.1f} 小時。")

    nz = "ZQN"
    seg4_airport = "TPE"
    started = time.time()
    completed = 0
    failures = 0
    hits_econ = []
    hits_biz = []
    last_telegram_summary = started

    # Track best price per (out1, out4, cabin) seen so far
    best_per_pair = {}  # (out1, out4, cabin) -> int price

    def run_task(t):
        out1, out4, vi, var, cabin = t
        segments = make_segments(out1, out4, nz, seg4_airport, var)
        t0 = time.time()
        res = scrape_one(env, segments, cabin)
        dur = int((time.time() - t0) * 1000)
        return t, segments, res, dur

    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futures = {ex.submit(run_task, t): t for t in tasks}
        for fut in as_completed(futures):
            try:
                (out1, out4, vi, var, cabin), segments, res, dur = fut.result()
            except Exception as e:
                print(f"  task crashed: {e}")
                continue
            completed += 1

            if not res.get("ok"):
                failures += 1
                conn.execute("""
                    INSERT INTO scrape_results
                    (out1,out4,nz,seg4_airport,variation_idx,seg1_date,seg2_date,seg3_date,seg4_date,
                     cabin,cheapest_price,all_prices_json,booking_url,duration_ms,scraped_at,error)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (out1, out4, nz, seg4_airport, vi,
                      segments[0]["date"], segments[1]["date"], segments[2]["date"], segments[3]["date"],
                      cabin, None, None, res.get("url", ""), dur,
                      time.strftime("%Y-%m-%dT%H:%M:%S"), res.get("error", "?")))
                conn.commit()
                if failures <= 5:
                    print(f"  fail {out1}-{out4} v{vi} {cabin}: {res.get('error','?')[:50]}", flush=True)
                continue

            prices = res.get("prices", [])
            cheapest = prices[0]["price"] if prices else 0
            url = res.get("url", "")

            conn.execute("""
                INSERT INTO scrape_results
                (out1,out4,nz,seg4_airport,variation_idx,seg1_date,seg2_date,seg3_date,seg4_date,
                 cabin,cheapest_price,all_prices_json,booking_url,duration_ms,scraped_at,error)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (out1, out4, nz, seg4_airport, vi,
                  segments[0]["date"], segments[1]["date"], segments[2]["date"], segments[3]["date"],
                  cabin, cheapest if cheapest else None,
                  json.dumps(prices, ensure_ascii=False), url, dur,
                  time.strftime("%Y-%m-%dT%H:%M:%S"), None))
            conn.commit()

            # Hit detection
            if cheapest > 0:
                key = (out1, out4, cabin)
                prev_best = best_per_pair.get(key, 10**9)
                if cheapest < prev_best:
                    best_per_pair[key] = cheapest
                cap = ECON_CAP if cabin == "economy" else BIZ_CAP
                if cheapest <= cap and cheapest < prev_best:
                    if cabin == "economy":
                        hits_econ.append((out1, out4, vi, cheapest, url))
                        telegram(env,
                            f"💰 經濟艙 ${cheapest:,}\n"
                            f"{out1}-ZQN-TPE430-{out4} (v{vi})\n"
                            f"{segments[0]['date']} / {segments[1]['date']} / "
                            f"{segments[2]['date']} / {segments[3]['date']}\n"
                            f"{url}")
                    else:
                        hits_biz.append((out1, out4, vi, cheapest, url))
                        telegram(env,
                            f"✈️ 商務艙 ${cheapest:,}\n"
                            f"{out1}-ZQN-TPE430-{out4} (v{vi})")

            # Progress reporting (every 50 completions)
            if completed % 50 == 0 or completed == len(tasks):
                elapsed = time.time() - started
                rate = completed / elapsed if elapsed > 0 else 0
                eta = (len(tasks) - completed) / rate if rate > 0 else 0
                print(f"[{completed}/{len(tasks)}] elapsed={int(elapsed)}s "
                      f"eta={int(eta)}s rate={rate:.2f}/s "
                      f"hits_econ={len(hits_econ)} hits_biz={len(hits_biz)} "
                      f"failures={failures}", flush=True)

            # Telegram summary every 30 min
            if time.time() - last_telegram_summary > 1800:
                last_telegram_summary = time.time()
                telegram(env,
                    f"⏳ 進度 {completed}/{len(tasks)} "
                    f"({completed * 100 // len(tasks)}%) "
                    f"hits 經濟={len(hits_econ)} 商務={len(hits_biz)} "
                    f"failures={failures}")

    total = int(time.time() - started)
    msg = (f"🏁 Direct scan 完成 {completed}/{len(tasks)} ({total}s)\n"
           f"hits 經濟={len(hits_econ)} 商務={len(hits_biz)}\n"
           f"failures={failures}")
    print(msg)
    telegram(env, msg)

    # Top 10 cheapest pairs
    cur = conn.execute("""
        SELECT out1, out4, cabin, MIN(cheapest_price) as p, booking_url
        FROM scrape_results
        WHERE cheapest_price IS NOT NULL AND cheapest_price > 0
        GROUP BY out1, out4, cabin
        HAVING p <= 80000
        ORDER BY p ASC LIMIT 30
    """)
    rows = cur.fetchall()
    if rows:
        lines = ["🏆 Top hits："]
        for out1, out4, cabin, p, _ in rows[:20]:
            tag = "經" if cabin == "economy" else "商"
            lines.append(f"  ${p:,} [{tag}] {out1}-ZQN-TPE430-{out4}")
        telegram(env, "\n".join(lines))


if __name__ == "__main__":
    main()
