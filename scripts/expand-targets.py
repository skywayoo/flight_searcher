#!/usr/bin/env python3
"""Phase 1: ensure all 20 outstations × all 20 × ZQN + TPE430 targets exist
in Notion, and activate them. Pause everything else.

20 outstations: existing 16 (BKK, CNX, CTS, DMK, FUK, GMP, HIJ, HKG, ICN, ISG,
KMJ, KOJ, OKA, PUS, SDJ, SHI) + 4 new (HKD函館, NGO名古屋, UKB神戶, MFM澳門).
"""
import json
import os
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_env():
    env = {}
    with open(os.path.join(ROOT, ".env.local")) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            v = v.replace("\\n", "").replace("\\r", "")
            env[k] = v
    return env


def with_retry(f):
    for i in range(5):
        try:
            return f()
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503):
                time.sleep(5 + i * 5)
                continue
            raise
        except (TimeoutError, OSError):
            time.sleep(3 + i * 3)
    raise Exception("retries exhausted")


def main():
    env = load_env()
    nk = env["NOTION_API_KEY"]
    db = env["NOTION_FLIGHT_TARGETS_DB_ID"]

    OUTSTATIONS = [
        "BKK", "CNX", "CTS", "DMK", "FUK", "GMP", "HIJ", "HKG", "ICN", "ISG",
        "KMJ", "KOJ", "OKA", "PUS", "SDJ", "SHI",
        "HKD", "NGO", "UKB", "MFM", "DPS",  # new
    ]
    NZ = "ZQN"
    SEG4_DT_LABEL = "TPE430"
    SEG4_AIRPORT = "TPE"
    SEG4_DATE = "2027-04-30"

    # 1) Get all existing target names
    print("Fetching existing targets...", flush=True)
    existing = {}  # name -> id
    cursor = None
    while True:
        body = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor

        def f():
            req = urllib.request.Request(
                f"https://api.notion.com/v1/databases/{db}/query",
                data=json.dumps(body).encode(),
                method="POST",
                headers={
                    "Authorization": f"Bearer {nk}",
                    "Content-Type": "application/json",
                    "Notion-Version": "2022-06-28",
                },
            )
            return json.loads(urllib.request.urlopen(req, timeout=20).read())

        res = with_retry(f)
        for p in res["results"]:
            n = (p["properties"].get("Name", {}).get("title", [{}]) or [{}])[0].get(
                "plain_text", "?"
            )
            existing[n] = p["id"]
        if not res.get("has_more"):
            break
        cursor = res.get("next_cursor")
        time.sleep(0.3)
    print(f"  {len(existing)} existing targets", flush=True)

    # 2) Build desired set: 20 × 20 × {ZQN/TPE430}
    desired = []
    for out1 in OUTSTATIONS:
        for out4 in OUTSTATIONS:
            name = f"{out1}-{NZ}-{SEG4_DT_LABEL}-{out4}"
            desired.append((name, out1, out4))
    print(f"Desired ZQN/TPE430 set: {len(desired)} (= 20*20)")

    # 3) For each desired, either: create (if not exists) or activate (if exists)
    create_count = 0
    activate_count = 0
    desired_names_set = {name for name, _, _ in desired}

    for i, (name, out1, out4) in enumerate(desired):
        if name in existing:
            # ensure status active
            tid = existing[name]
            body = json.dumps({"properties": {"Status": {"select": {"name": "active"}}}}).encode()

            def f():
                req = urllib.request.Request(
                    f"https://api.notion.com/v1/pages/{tid}",
                    data=body,
                    method="PATCH",
                    headers={
                        "Authorization": f"Bearer {nk}",
                        "Content-Type": "application/json",
                        "Notion-Version": "2022-06-28",
                    },
                )
                urllib.request.urlopen(req, timeout=15).read()

            try:
                with_retry(f)
                activate_count += 1
            except Exception as e:
                print(f"  activate fail {name}: {str(e)[:50]}")
        else:
            # create new target
            segments = [
                {"from": out1, "to": "TPE", "date": "2027-03-01"},
                {"from": "TPE", "to": NZ, "date": "2027-04-01"},
                {"from": NZ, "to": "TPE", "date": "2027-04-12"},
                {"from": SEG4_AIRPORT, "to": out4, "date": SEG4_DATE},
            ]
            page = {
                "parent": {"database_id": db},
                "properties": {
                    "Name": {"title": [{"text": {"content": name}}]},
                    "Status": {"select": {"name": "active"}},
                    "TripType": {"select": {"name": "multi_city_4"}},
                    "DepartureAirport": {"rich_text": [{"text": {"content": "TPE"}}]},
                    "Region": {"select": {"name": "新西蘭"}},
                    "DestinationAirports": {"rich_text": [{"text": {"content": NZ}}]},
                    "OutStations": {"rich_text": [{"text": {"content": out1}}]},
                    "OutboundStart": {"date": {"start": "2027-04-01"}},
                    "OutboundEnd": {"date": {"start": "2027-04-12"}},
                    "TripLengthMin": {"number": 11},
                    "TripLengthMax": {"number": 16},
                    "BudgetCap": {"number": 50000},
                    "IncludeBusiness": {"checkbox": True},
                    "NotifyDropPct": {"number": 5},
                    "Segments": {"rich_text": [{"text": {"content": json.dumps(segments)}}]},
                },
            }

            def f():
                req = urllib.request.Request(
                    "https://api.notion.com/v1/pages",
                    data=json.dumps(page).encode(),
                    method="POST",
                    headers={
                        "Authorization": f"Bearer {nk}",
                        "Content-Type": "application/json",
                        "Notion-Version": "2022-06-28",
                    },
                )
                urllib.request.urlopen(req, timeout=20).read()

            try:
                with_retry(f)
                create_count += 1
            except Exception as e:
                print(f"  create fail {name}: {str(e)[:80]}")
        if (i + 1) % 50 == 0:
            print(f"  desired {i + 1}/{len(desired)}", flush=True)
        time.sleep(0.3)

    print(f"Created: {create_count}, activated existing: {activate_count}")

    # 4) Pause anything outside desired set
    pause_count = 0
    for name, tid in existing.items():
        if name in desired_names_set:
            continue
        body = json.dumps({"properties": {"Status": {"select": {"name": "paused"}}}}).encode()

        def f():
            req = urllib.request.Request(
                f"https://api.notion.com/v1/pages/{tid}",
                data=body,
                method="PATCH",
                headers={
                    "Authorization": f"Bearer {nk}",
                    "Content-Type": "application/json",
                    "Notion-Version": "2022-06-28",
                },
            )
            urllib.request.urlopen(req, timeout=15).read()

        try:
            with_retry(f)
            pause_count += 1
        except Exception as e:
            print(f"  pause fail {name}: {str(e)[:50]}")
        if pause_count % 200 == 0 and pause_count > 0:
            print(f"  paused {pause_count}", flush=True)
        time.sleep(0.3)

    print(f"DONE created={create_count} activated={activate_count} paused={pause_count}")


if __name__ == "__main__":
    main()
