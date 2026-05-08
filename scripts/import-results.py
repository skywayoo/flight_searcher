#!/usr/bin/env python3
"""Import JSONL output from local-scrape.mjs into SQLite, also Telegram any hits."""
import json
import os
import sqlite3
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "data", "flight-results.sqlite")
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


def telegram(env, text):
    try:
        urllib.request.urlopen(urllib.request.Request(
            f"https://api.telegram.org/bot{env['TELEGRAM_BOT_TOKEN']}/sendMessage",
            data=json.dumps({"chat_id": env["TELEGRAM_CHAT_ID"], "text": text}).encode(),
            method="POST", headers={"Content-Type": "application/json"}), timeout=10).read()
    except Exception:
        pass


def main():
    if len(sys.argv) < 2:
        print("usage: import-results.py <jsonl>")
        sys.exit(1)
    path = sys.argv[1]
    env = load_env()
    conn = sqlite3.connect(DB_PATH)

    # Pre-load best-known per (out1, out4, cabin) to detect new hits
    cur = conn.execute("""
        SELECT out1, out4, cabin, MIN(cheapest_price)
        FROM scrape_results
        WHERE cheapest_price IS NOT NULL
        GROUP BY out1, out4, cabin
    """)
    best = {(o1, o4, c): p for o1, o4, c, p in cur.fetchall()}

    inserted = 0
    new_hits = []
    import time
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            out1, out4 = r["out1"], r["out4"]
            vi, cabin = r["variation"], r["cabin"]
            segs = r["segments"]
            ok = r.get("ok", False)
            prices = r.get("prices", []) if ok else []
            cheapest = prices[0]["price"] if prices else None
            url = r.get("url", "")
            err = None if ok else r.get("error", "?")
            dur = r.get("durationMs", 0)

            # Replace any existing row for same key (delete then insert)
            conn.execute("""
                DELETE FROM scrape_results
                WHERE out1=? AND out4=? AND variation_idx=? AND cabin=?
            """, (out1, out4, vi, cabin))
            conn.execute("""
                INSERT INTO scrape_results
                (out1,out4,nz,seg4_airport,variation_idx,seg1_date,seg2_date,seg3_date,seg4_date,
                 cabin,cheapest_price,all_prices_json,booking_url,duration_ms,scraped_at,error)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (out1, out4, "ZQN", "TPE", vi,
                  segs[0]["date"], segs[1]["date"], segs[2]["date"], segs[3]["date"],
                  cabin, cheapest,
                  json.dumps(prices, ensure_ascii=False) if prices else None,
                  url, dur, time.strftime("%Y-%m-%dT%H:%M:%S"), err))
            inserted += 1

            if cheapest and cheapest > 0:
                key = (out1, out4, cabin)
                prev = best.get(key, 10**9)
                cap = ECON_CAP if cabin == "economy" else BIZ_CAP
                if cheapest <= cap and cheapest < prev:
                    new_hits.append((out1, out4, cabin, cheapest, url, segs))
                    best[key] = cheapest

    conn.commit()
    print(f"imported {inserted}, new hits {len(new_hits)}")

    for out1, out4, cabin, p, url, segs in new_hits:
        tag = "💰 經濟艙" if cabin == "economy" else "✈️ 商務艙"
        msg = (f"{tag} ${p:,}\n{out1}-ZQN-TPE430-{out4}\n"
               f"{segs[0]['date']} / {segs[1]['date']} / {segs[2]['date']} / {segs[3]['date']}\n{url}")
        telegram(env, msg)


if __name__ == "__main__":
    main()
