#!/usr/bin/env python3
"""Import JSONL output from local-scrape.mjs into SQLite, also Telegram any hits."""
import json
import os
import sqlite3
import sys
import time
import urllib.request

from scan_config import get_budget_caps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "data", "flight-results.sqlite")


def load_env():
    env = {}
    env_path = os.path.join(ROOT, ".env.local")
    if not os.path.exists(env_path):
        print(f"warning: {env_path} not found; Telegram notifications disabled", file=sys.stderr)
        return env

    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'").replace("\n", "").replace("\r", "")
            env[k] = v
    return env


def telegram(env, text):
    token = env.get("TELEGRAM_BOT_TOKEN")
    chat_id = env.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        print("telegram skipped: missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID", file=sys.stderr)
        return False

    try:
        urllib.request.urlopen(
            urllib.request.Request(
                f"https://api.telegram.org/bot{token}/sendMessage",
                data=json.dumps({"chat_id": chat_id, "text": text}).encode(),
                method="POST",
                headers={"Content-Type": "application/json"},
            ),
            timeout=10,
        ).read()
        return True
    except Exception as exc:
        print(f"telegram send failed: {exc}", file=sys.stderr)
        return False


def main():
    if len(sys.argv) < 2:
        print("usage: import-results.py <jsonl>")
        sys.exit(1)
    path = sys.argv[1]
    env = load_env()
    econ_cap, biz_cap = get_budget_caps(env)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS skipped_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            out1 TEXT,
            out4 TEXT,
            nz TEXT,
            variation_idx INTEGER,
            cabin TEXT,
            cheapest_price INTEGER,
            scraped_at TEXT,
            reason TEXT,
            UNIQUE(out1, out4, nz, variation_idx, cabin)
        )
    """
    )

    cur = conn.execute(
        """
        SELECT out1, out4, nz, cabin, MIN(cheapest_price)
        FROM scrape_results
        WHERE cheapest_price IS NOT NULL
        GROUP BY out1, out4, nz, cabin
    """
    )
    best = {(o1, o4, n, c): p for o1, o4, n, c, p in cur.fetchall()}

    inserted = 0
    new_hits = []
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
            nz_out = segs[1]["to"]
            nz_in = segs[2]["from"]
            nz_label = f"{nz_out}-{nz_in}"

            cap = econ_cap if cabin == "economy" else biz_cap

            conn.execute(
                """
                DELETE FROM scrape_results
                WHERE out1=? AND out4=? AND nz=? AND variation_idx=? AND cabin=?
            """,
                (out1, out4, nz_label, vi, cabin),
            )
            conn.execute(
                """
                DELETE FROM skipped_results
                WHERE out1=? AND out4=? AND nz=? AND variation_idx=? AND cabin=?
            """,
                (out1, out4, nz_label, vi, cabin),
            )

            if cheapest and cheapest > cap:
                conn.execute(
                    """
                    INSERT INTO skipped_results
                    (out1,out4,nz,variation_idx,cabin,cheapest_price,scraped_at,reason)
                    VALUES (?,?,?,?,?,?,?,?)
                """,
                    (
                        out1,
                        out4,
                        nz_label,
                        vi,
                        cabin,
                        cheapest,
                        time.strftime("%Y-%m-%dT%H:%M:%S"),
                        f"over_budget>{cap}",
                    ),
                )
                inserted += 1
                continue

            conn.execute(
                """
                INSERT INTO scrape_results
                (out1,out4,nz,seg4_airport,variation_idx,seg1_date,seg2_date,seg3_date,seg4_date,
                 cabin,cheapest_price,all_prices_json,booking_url,duration_ms,scraped_at,error)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
                (
                    out1,
                    out4,
                    nz_label,
                    "TPE",
                    vi,
                    segs[0]["date"],
                    segs[1]["date"],
                    segs[2]["date"],
                    segs[3]["date"],
                    cabin,
                    cheapest,
                    json.dumps(prices, ensure_ascii=False) if prices else None,
                    url,
                    dur,
                    time.strftime("%Y-%m-%dT%H:%M:%S"),
                    err,
                ),
            )
            inserted += 1

            if cheapest and cheapest > 0:
                key = (out1, out4, nz_label, cabin)
                prev = best.get(key, 10**9)
                if cheapest <= cap and cheapest < prev:
                    new_hits.append((out1, out4, nz_label, cabin, cheapest, url, segs))
                    best[key] = cheapest

    conn.commit()

    telegram_sent = 0
    for out1, out4, nz_label, cabin, price, url, segs in new_hits:
        tag = "💰 經濟艙" if cabin == "economy" else "✈️ 商務艙"
        msg = (
            f"{tag} ${price:,}\n{out1}-{nz_label}-TPE-{out4}\n"
            f"{segs[0]['date']} / {segs[1]['date']} / {segs[2]['date']} / {segs[3]['date']}\n{url}"
        )
        if telegram(env, msg):
            telegram_sent += 1

    print(f"imported {inserted}, new hits {len(new_hits)}, telegram_sent {telegram_sent}")


if __name__ == "__main__":
    main()
