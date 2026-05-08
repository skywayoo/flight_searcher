#!/usr/bin/env python3
"""Build a JSONL task list of pairs not yet successfully scraped.

Each line: {"out1":"BKK","out4":"BKK","variation":0,"cabin":"economy","segments":[...]}
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta
from itertools import product

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "data", "flight-results.sqlite")

OUTSTATIONS = [
    "BKK", "CNX", "CTS", "DMK", "FUK", "GMP", "HIJ", "HKG", "ICN", "ISG",
    "KMJ", "KOJ", "OKA", "PUS", "SDJ", "SHI",
    "HKD", "NGO", "UKB", "MFM", "DPS",
]

VARIATIONS = [
    (0, 0, 0, 0),
    (1, -2, 3, -9),
]
CABINS = ["economy", "business"]


def shift(iso, days):
    d = datetime.strptime(iso, "%Y-%m-%d") + timedelta(days=days)
    return d.strftime("%Y-%m-%d")


def make_segments(out1, out4, var):
    o1, o2, o3, o4 = var
    base1, base2, base3, base4 = "2027-03-01", "2027-04-01", "2027-04-12", "2027-04-30"
    return [
        {"from": out1, "to": "TPE", "date": shift(base1, o1)},
        {"from": "TPE", "to": "ZQN", "date": shift(base2, o2)},
        {"from": "ZQN", "to": "TPE", "date": shift(base3, o3)},
        {"from": "TPE", "to": out4, "date": shift(base4, o4)},
    ]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/tasks.jsonl"
    conn = sqlite3.connect(DB_PATH)
    # Skip both priced AND empty rows: empty = scraper successfully rendered but
    # eztravel has no matching flight. No point re-scraping.
    cur = conn.execute("""
        SELECT out1, out4, variation_idx, cabin
        FROM scrape_results
        WHERE error IS NULL
    """)
    done = set(cur.fetchall())
    cur = conn.execute("""
        SELECT
          SUM(CASE WHEN cheapest_price IS NOT NULL THEN 1 ELSE 0 END),
          SUM(CASE WHEN cheapest_price IS NULL THEN 1 ELSE 0 END)
        FROM scrape_results WHERE error IS NULL
    """)
    priced, empty = cur.fetchone()
    print(f"skipping {len(done)} done ({priced} priced, {empty} empty)", file=sys.stderr)

    written = 0
    with open(out, "w") as f:
        for out1, out4 in product(OUTSTATIONS, OUTSTATIONS):
            for vi, var in enumerate(VARIATIONS):
                for cabin in CABINS:
                    if (out1, out4, vi, cabin) in done:
                        continue
                    f.write(json.dumps({
                        "out1": out1, "out4": out4,
                        "variation": vi, "cabin": cabin,
                        "segments": make_segments(out1, out4, var),
                    }) + "\n")
                    written += 1

    print(f"wrote {written} tasks to {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
