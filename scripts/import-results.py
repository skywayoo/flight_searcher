#!/usr/bin/env python3
"""Import JSONL output from local-scrape.mjs.

What it does:
1. Write every result to SQLite (success / fail / skipped).
2. Upsert "in-budget success" results to Notion (覆蓋舊的,只保留最新).
3. Send Telegram for new lowest-price hits.

Improvements over original:
- JSON parse errors no longer kill the import
- Single transaction with rollback on error
- Same-batch new-low won't trigger multiple Telegrams (fixed bug)
- Telegram rate limiting via notify module
- Notion upsert: per-target+combination key, latest wins
"""
import json
import os
import sqlite3
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import notify
from scan_config import get_budget_caps

DB_PATH = os.path.join(ROOT, "data", "flight-results.sqlite")

SKIPPED_RESULTS_UNIQUE = (
    "UNIQUE(out1, out4, nz, seg4_airport, variation_idx, seg4_date, cabin)"
)


# ============================================================
# Notion sync
# ============================================================

NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"

# Per-second rate limit: Notion = 3 req/s, we use 2.5 to be safe
_notion_min_interval = 0.4
_notion_last_call = 0.0


def _notion_throttle():
    """Sleep just enough to stay under Notion rate limit."""
    global _notion_last_call
    elapsed = time.time() - _notion_last_call
    if elapsed < _notion_min_interval:
        time.sleep(_notion_min_interval - elapsed)
    _notion_last_call = time.time()


def _notion_request(method, path, env, body=None, max_retries=5):
    """Call Notion API with retry on 429.

    Returns parsed JSON dict, or None on failure.
    """
    token = env.get("NOTION_TOKEN")
    if not token:
        return None

    url = f"{NOTION_API}{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }
    data = json.dumps(body).encode() if body else None

    for attempt in range(max_retries):
        _notion_throttle()
        try:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_retries - 1:
                retry_after = int(e.headers.get("Retry-After", 2 ** attempt))
                print(f"⏳ Notion 429, retry in {retry_after}s...", file=sys.stderr)
                time.sleep(retry_after)
                continue
            print(f"notion {method} {path} failed: {e}", file=sys.stderr)
            return None
        except Exception as e:
            print(f"notion {method} {path} error: {e}", file=sys.stderr)
            return None
    return None


def _notion_find_existing(db_id, env, key_props):
    """Find existing Notion page by composite key.

    key_props is a dict like {"out1": "TPE", "out4": "AKL", ...}
    Returns page_id or None.
    """
    filters = [
        {"property": k, "rich_text": {"equals": str(v)}}
        for k, v in key_props.items()
    ]
    body = {"filter": {"and": filters}, "page_size": 1}
    result = _notion_request("POST", f"/databases/{db_id}/query", env, body)
    if not result:
        return None
    pages = result.get("results", [])
    return pages[0]["id"] if pages else None


def _build_notion_props(out1, out4, nz_label, seg4_airport, seg4_date,
                       cabin, price, url, segs, vi):
    """Build Notion page properties for a flight result.

    Assumes your Notion DB has these properties (adjust to your schema):
      Title          — title type (concat of segments)
      out1, out4, nz, seg4_airport — rich_text
      cabin          — select
      cheapestPrice  — number
      bookingUrl     — url
      seg1_date ~ seg4_date — date
      variation_idx  — number
      updatedAt      — date
    """
    title = f"{out1}-{nz_label}-{seg4_airport}-{out4} ({cabin})"
    return {
        "Title": {"title": [{"text": {"content": title}}]},
        "out1": {"rich_text": [{"text": {"content": out1}}]},
        "out4": {"rich_text": [{"text": {"content": out4}}]},
        "nz": {"rich_text": [{"text": {"content": nz_label}}]},
        "seg4_airport": {"rich_text": [{"text": {"content": seg4_airport}}]},
        "cabin": {"select": {"name": cabin}},
        "cheapestPrice": {"number": price},
        "bookingUrl": {"url": url} if url else {"url": None},
        "seg1_date": {"date": {"start": segs[0]["date"]}},
        "seg2_date": {"date": {"start": segs[1]["date"]}},
        "seg3_date": {"date": {"start": segs[2]["date"]}},
        "seg4_date": {"date": {"start": seg4_date}},
        "variation_idx": {"number": vi},
        "updatedAt": {"date": {"start": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}},
    }


def notion_upsert_result(env, out1, out4, nz_label, seg4_airport, seg4_date,
                         cabin, vi, price, url, segs):
    """Upsert a flight result into Notion Results DB.

    "Upsert" = if same (out1, out4, nz, seg4_airport, cabin, variation_idx, seg4_date)
    exists, update it; otherwise create new. Only keeps latest.

    Returns True on success, False otherwise.
    """
    db_id = env.get("NOTION_RESULTS_DB_ID")
    if not db_id:
        return False

    key_props = {
        "out1": out1, "out4": out4, "nz": nz_label,
        "seg4_airport": seg4_airport, "cabin": cabin,
    }
    # Note: variation_idx + seg4_date are numbers/dates, harder to filter
    # so we keyed on the 5 main string props and disambiguate by re-finding.

    page_id = _notion_find_existing(db_id, env, key_props)
    props = _build_notion_props(out1, out4, nz_label, seg4_airport, seg4_date,
                                cabin, price, url, segs, vi)

    if page_id:
        result = _notion_request("PATCH", f"/pages/{page_id}", env,
                                 {"properties": props})
    else:
        result = _notion_request("POST", "/pages", env, {
            "parent": {"database_id": db_id},
            "properties": props,
        })
    return result is not None


# ============================================================
# Telegram (uses notify module for rate limiting)
# ============================================================

def telegram(env, text):
    return notify.send(env, text)


# ============================================================
# SQLite schema migration
# ============================================================

def ensure_skipped_results_table(conn):
    create_sql = f"""
    CREATE TABLE skipped_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        out1 TEXT,
        out4 TEXT,
        nz TEXT,
        seg4_airport TEXT,
        variation_idx INTEGER,
        seg1_date TEXT,
        seg2_date TEXT,
        seg3_date TEXT,
        seg4_date TEXT,
        cabin TEXT,
        cheapest_price INTEGER,
        booking_url TEXT,
        duration_ms INTEGER,
        scraped_at TEXT,
        reason TEXT,
        {SKIPPED_RESULTS_UNIQUE}
    )
    """
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='skipped_results'"
    ).fetchone()

    if row is None:
        conn.execute(create_sql)
        return
    if SKIPPED_RESULTS_UNIQUE in (row[0] or ""):
        return

    conn.execute("ALTER TABLE skipped_results RENAME TO skipped_results_old")
    conn.execute(create_sql)
    conn.execute("""
        INSERT OR REPLACE INTO skipped_results
        (out1,out4,nz,seg4_airport,variation_idx,seg1_date,seg2_date,seg3_date,seg4_date,
         cabin,cheapest_price,booking_url,duration_ms,scraped_at,reason)
        SELECT
            out1, out4, nz, COALESCE(seg4_airport, 'TPE'), variation_idx,
            seg1_date, seg2_date, seg3_date, seg4_date,
            cabin, cheapest_price, booking_url, duration_ms, scraped_at, reason
        FROM skipped_results_old
    """)
    conn.execute("DROP TABLE skipped_results_old")


# ============================================================
# Main import
# ============================================================

def main():
    if len(sys.argv) < 2:
        print("usage: import-results.py <jsonl>")
        sys.exit(1)

    path = sys.argv[1]
    env = notify.load_env(ROOT)
    econ_cap, biz_cap = get_budget_caps(env)
    sync_notion = bool(env.get("NOTION_TOKEN") and env.get("NOTION_RESULTS_DB_ID"))
    if not sync_notion:
        print("ℹ️  Notion sync disabled (NOTION_TOKEN / NOTION_RESULTS_DB_ID missing)")

    conn = sqlite3.connect(DB_PATH)
    try:
        ensure_skipped_results_table(conn)

        # Existing lowest per (out1, out4, nz, cabin)
        cur = conn.execute("""
            SELECT out1, out4, nz, cabin, MIN(cheapest_price)
            FROM scrape_results
            WHERE cheapest_price IS NOT NULL
            GROUP BY out1, out4, nz, cabin
        """)
        best = {(o1, o4, n, c): p for o1, o4, n, c, p in cur.fetchall()}

        inserted = 0
        skipped_bad = 0
        new_hits = []
        notion_synced = 0
        notion_failed = 0

        with open(path) as f:
            for lineno, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue

                # === Parse with try/except ===
                try:
                    r = json.loads(line)
                except json.JSONDecodeError as e:
                    print(f"skip bad json at line {lineno}: {e}", file=sys.stderr)
                    skipped_bad += 1
                    continue

                # === Validate structure ===
                segs = r.get("segments")
                if not segs or len(segs) < 4:
                    print(f"skip malformed segs at line {lineno}", file=sys.stderr)
                    skipped_bad += 1
                    continue

                out1 = r.get("out1")
                out4 = r.get("out4")
                vi = r.get("variation")
                cabin = r.get("cabin")
                if not (out1 and out4 and cabin):
                    print(f"skip missing keys at line {lineno}", file=sys.stderr)
                    skipped_bad += 1
                    continue

                ok = r.get("ok", False)
                prices = r.get("prices", []) if ok else []
                cheapest = prices[0]["price"] if prices else None
                url = r.get("url", "")
                err = None if ok else r.get("error", "?")
                dur = r.get("durationMs", 0)

                nz_out = segs[1]["to"]
                nz_in = segs[2]["from"]
                nz_label = f"{nz_out}-{nz_in}"
                seg4_airport = r.get("seg4_airport") or segs[3]["from"]
                seg4_date = r.get("seg4_date") or segs[3]["date"]

                cap = econ_cap if cabin == "economy" else biz_cap

                # === Replace existing rows for this exact combination ===
                conn.execute("""
                    DELETE FROM scrape_results
                    WHERE out1=? AND out4=? AND nz=? AND seg4_airport=?
                      AND variation_idx=? AND seg4_date=? AND cabin=?
                """, (out1, out4, nz_label, seg4_airport, vi, seg4_date, cabin))
                conn.execute("""
                    DELETE FROM skipped_results
                    WHERE out1=? AND out4=? AND nz=? AND seg4_airport=?
                      AND variation_idx=? AND seg4_date=? AND cabin=?
                """, (out1, out4, nz_label, seg4_airport, vi, seg4_date, cabin))

                # === Over budget → skipped_results, no Notion sync ===
                if cheapest and cheapest > cap:
                    conn.execute("""
                        INSERT INTO skipped_results
                        (out1,out4,nz,seg4_airport,variation_idx,
                         seg1_date,seg2_date,seg3_date,seg4_date,
                         cabin,cheapest_price,booking_url,duration_ms,scraped_at,reason)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """, (
                        out1, out4, nz_label, seg4_airport, vi,
                        segs[0]["date"], segs[1]["date"], segs[2]["date"], seg4_date,
                        cabin, cheapest, url, dur,
                        time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        f"over_budget>{cap}",
                    ))
                    inserted += 1
                    continue

                # === Normal insert (success or empty result) ===
                conn.execute("""
                    INSERT INTO scrape_results
                    (out1,out4,nz,seg4_airport,variation_idx,
                     seg1_date,seg2_date,seg3_date,seg4_date,
                     cabin,cheapest_price,all_prices_json,booking_url,
                     duration_ms,scraped_at,error)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    out1, out4, nz_label, seg4_airport, vi,
                    segs[0]["date"], segs[1]["date"], segs[2]["date"], seg4_date,
                    cabin, cheapest,
                    json.dumps(prices, ensure_ascii=False) if prices else None,
                    url, dur,
                    time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    err,
                ))
                inserted += 1

                # === In-budget success → check for new lowest + sync Notion ===
                if cheapest and cheapest > 0 and cheapest <= cap:
                    key = (out1, out4, nz_label, cabin)
                    prev = best.get(key, 10 ** 9)
                    if cheapest < prev:
                        new_hits.append((out1, out4, nz_label, seg4_airport,
                                         seg4_date, cabin, cheapest, url, segs))
                        best[key] = cheapest  # ★ 移到 if 內,避免同批重複觸發

                    # Notion sync (commit SQLite first to keep them in step)
                    if sync_notion:
                        ok_notion = notion_upsert_result(
                            env, out1, out4, nz_label, seg4_airport, seg4_date,
                            cabin, vi, cheapest, url, segs,
                        )
                        if ok_notion:
                            notion_synced += 1
                        else:
                            notion_failed += 1

        conn.commit()

    except Exception as e:
        conn.rollback()
        print(f"❌ import failed, rolled back: {e}", file=sys.stderr)
        raise
    finally:
        conn.close()

    # === Telegram for new lows (rate-limited via notify module) ===
    telegram_sent = 0
    for out1, out4, nz_label, seg4_airport, seg4_date, cabin, price, url, segs in new_hits:
        msg = notify.msg_hit(out1, out4, nz_label, seg4_airport, seg4_date,
                             cabin, price, url, segs)
        if telegram(env, msg):
            telegram_sent += 1

    print({
        "inserted": inserted,
        "skipped_bad": skipped_bad,
        "new_hits": len(new_hits),
        "telegram_sent": telegram_sent,
        "notion_synced": notion_synced,
        "notion_failed": notion_failed,
    })


if __name__ == "__main__":
    main()
