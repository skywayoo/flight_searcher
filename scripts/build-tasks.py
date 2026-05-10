#!/usr/bin/env python3
"""Build a JSONL task list of pairs not yet successfully scraped.

Each line includes out1/out4/nz/seg4 metadata plus multi-city segments.
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta
from itertools import product
from scan_config import BASE_SEGMENT_DATES, OUTSTATIONS, SEG4_OPTIONS, VARIATIONS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "data", "flight-results.sqlite")

CABINS = ["economy", "business"]
SKIPPED_RESULTS_UNIQUE = "UNIQUE(out1, out4, nz, seg4_airport, variation_idx, seg4_date, cabin)"


def shift(iso, days):
    d = datetime.strptime(iso, "%Y-%m-%d") + timedelta(days=days)
    return d.strftime("%Y-%m-%d")


def make_segments(out1, out4, var, nz_out, nz_in, seg4_airport, seg4_date):
    o1, o2, o3, o4 = var
    base1, base2, base3, _base4 = BASE_SEGMENT_DATES
    return [
        {"from": out1, "to": "TPE", "date": shift(base1, o1)},
        {"from": "TPE", "to": nz_out, "date": shift(base2, o2)},
        {"from": nz_in, "to": "TPE", "date": shift(base3, o3)},
        {"from": seg4_airport, "to": out4, "date": seg4_date},
    ]


def build_seg4_variants(var):
    _o1, _o2, o3, o4 = var
    _base1, _base2, base3, base4 = BASE_SEGMENT_DATES
    seg3_date = shift(base3, o3)
    for option in SEG4_OPTIONS:
        if option["mode"] == "fixed_variation":
            seg4_date = shift(base4, o4)
        else:
            seg4_date = shift(seg3_date, option["offset_days"])
        yield option["airport"], seg4_date


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
    conn.execute(
        """
        INSERT OR REPLACE INTO skipped_results
        (out1,out4,nz,seg4_airport,variation_idx,seg1_date,seg2_date,seg3_date,seg4_date,
         cabin,cheapest_price,booking_url,duration_ms,scraped_at,reason)
        SELECT
            out1,
            out4,
            nz,
            COALESCE(seg4_airport, 'TPE'),
            variation_idx,
            seg1_date,
            seg2_date,
            seg3_date,
            seg4_date,
            cabin,
            cheapest_price,
            booking_url,
            duration_ms,
            scraped_at,
            reason
        FROM skipped_results_old
    """
    )
    conn.execute("DROP TABLE skipped_results_old")


# NZ configs: (out_airport, in_airport, label_for_db)
NZ_CONFIGS = [
    ("ZQN", "ZQN"),  # phase 1 default
    ("CHC", "CHC"),  # CHC same
    ("ZQN", "CHC"),  # open jaw
    ("CHC", "ZQN"),  # open jaw reverse
]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/tasks.jsonl"
    nz_filter = sys.argv[2] if len(sys.argv) > 2 else "all"  # "all" or "ZQN-ZQN" etc.
    conn = sqlite3.connect(DB_PATH)
    ensure_skipped_results_table(conn)
    # Skip already-done per (out1, out4, nz_out-nz_in, seg4_airport, variation, seg4_date, cabin)
    cur = conn.execute("""
        SELECT out1, out4, nz, COALESCE(seg4_airport, 'TPE'), variation_idx, seg4_date, cabin
        FROM scrape_results
        WHERE error IS NULL
    """)
    done = set(cur.fetchall())
    cur = conn.execute("""
        SELECT out1, out4, nz, COALESCE(seg4_airport, 'TPE'), variation_idx, seg4_date, cabin
        FROM skipped_results
    """)
    done.update(cur.fetchall())
    print(f"skipping {len(done)} already-done", file=sys.stderr)

    if nz_filter == "all":
        configs = NZ_CONFIGS
    else:
        configs = [tuple(nz_filter.split("-"))]

    written = 0
    with open(out, "w") as f:
        for nz_out, nz_in in configs:
            nz_label = f"{nz_out}-{nz_in}"
            for out1, out4 in product(OUTSTATIONS, OUTSTATIONS):
                for vi, var in enumerate(VARIATIONS[:2]):
                    for seg4_airport, seg4_date in build_seg4_variants(var):
                        segments = make_segments(out1, out4, var, nz_out, nz_in, seg4_airport, seg4_date)
                        for cabin in CABINS:
                            key = (out1, out4, nz_label, seg4_airport, vi, seg4_date, cabin)
                            if key in done:
                                continue
                            f.write(json.dumps({
                                "out1": out1,
                                "out4": out4,
                                "nz_out": nz_out,
                                "nz_in": nz_in,
                                "seg4_airport": seg4_airport,
                                "seg4_date": seg4_date,
                                "variation": vi,
                                "cabin": cabin,
                                "segments": segments,
                            }) + "\n")
                            written += 1

    print(f"wrote {written} tasks to {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
