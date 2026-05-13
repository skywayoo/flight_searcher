"""Pure task expansion logic.

Takes a target specification (from Notion or CLI) and expands it into
all flight combinations. No I/O — can be reused by frontend preview API.

TargetSpec schema:
{
    "name": "日韓→紐西蘭",
    "budget_econ": 40000,
    "budget_biz": 120000,
    "cabins": ["economy", "business"],

    "seg1": {
        "from_groups": ["日韓主要"],
        "from_manual": ["HKG"],
        "to": ["TPE"],
        "dates": ["2026-03-02", "2026-03-03", "2026-03-04"]
    },
    "seg2": {
        "from": ["TPE"],
        "to_groups": ["紐西蘭南島"],
        "to_manual": [],
        "dates": ["2026-04-01", "2026-04-02", "2026-04-03"]
    },
    "seg3": {
        # from inherits from seg2.to
        "to": ["TPE"],
        "stay_min": 10,
        "stay_max": 15
    },
    "seg4": {
        "from_groups": ["台北"],
        "from_manual": [],
        "to_groups": ["日韓主要"],
        "to_manual": [],
        "dates": ["2026-05-01", "2026-05-02"]
    }
}
"""
from datetime import datetime, timedelta

from airport_groups import expand_airports


def _add_days(date_str, days):
    """'2026-04-01' + 10 → '2026-04-11'"""
    d = datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=days)
    return d.strftime("%Y-%m-%d")


def expand_target(spec, max_tasks=None):
    """Expand a target spec into all flight task combinations.

    Returns list of task dicts ready for scrape input.
    Pass max_tasks to early-stop (useful for previews).
    """
    seg1 = spec["seg1"]
    seg2 = spec["seg2"]
    seg3 = spec["seg3"]
    seg4 = spec["seg4"]

    seg1_from = expand_airports(seg1.get("from_groups"), seg1.get("from_manual"))
    seg1_to = seg1.get("to", ["TPE"])
    seg1_dates = seg1["dates"]

    seg2_from = seg2.get("from", ["TPE"])
    seg2_to = expand_airports(seg2.get("to_groups"), seg2.get("to_manual"))
    seg2_dates = seg2["dates"]

    seg3_to = seg3.get("to", ["TPE"])
    stay_min = seg3["stay_min"]
    stay_max = seg3["stay_max"]

    seg4_from = expand_airports(seg4.get("from_groups"), seg4.get("from_manual"))
    seg4_to = expand_airports(seg4.get("to_groups"), seg4.get("to_manual"))
    seg4_dates = seg4["dates"]

    cabins = spec.get("cabins", ["economy"])

    tasks = []
    variation_idx = 0

    for f1 in seg1_from:
        for t1 in seg1_to:
            for d1 in seg1_dates:
                for f2 in seg2_from:
                    for t2 in seg2_to:
                        for d2 in seg2_dates:
                            for stay in range(stay_min, stay_max + 1):
                                d3 = _add_days(d2, stay)
                                # seg3.from = seg2.to (t2),  seg3.to = seg3_to
                                for t3 in seg3_to:
                                    for f4 in seg4_from:
                                        for t4 in seg4_to:
                                            for d4 in seg4_dates:
                                                for cabin in cabins:
                                                    if max_tasks and len(tasks) >= max_tasks:
                                                        return tasks

                                                    task = {
                                                        "variation": variation_idx,
                                                        "cabin": cabin,
                                                        "out1": f1,
                                                        "out4": t4,
                                                        "seg4_airport": f4,
                                                        "seg4_date": d4,
                                                        "segments": [
                                                            {"from": f1, "to": t1, "date": d1},
                                                            {"from": f2, "to": t2, "date": d2},
                                                            {"from": t2, "to": t3, "date": d3},
                                                            {"from": f4, "to": t4, "date": d4},
                                                        ],
                                                    }
                                                    tasks.append(task)
                                                    variation_idx += 1

    return tasks


def count_combinations(spec):
    """Calculate total combination count WITHOUT generating tasks.

    Fast estimate for UI feedback.
    """
    seg1 = spec["seg1"]
    seg2 = spec["seg2"]
    seg3 = spec["seg3"]
    seg4 = spec["seg4"]

    n1_from = len(expand_airports(seg1.get("from_groups"), seg1.get("from_manual")))
    n1_to = len(seg1.get("to", ["TPE"]))
    n1_dates = len(seg1.get("dates", []))

    n2_from = len(seg2.get("from", ["TPE"]))
    n2_to = len(expand_airports(seg2.get("to_groups"), seg2.get("to_manual")))
    n2_dates = len(seg2.get("dates", []))

    n3_to = len(seg3.get("to", ["TPE"]))
    n3_stay = max(0, seg3.get("stay_max", 0) - seg3.get("stay_min", 0) + 1)

    n4_from = len(expand_airports(seg4.get("from_groups"), seg4.get("from_manual")))
    n4_to = len(expand_airports(seg4.get("to_groups"), seg4.get("to_manual")))
    n4_dates = len(seg4.get("dates", []))

    n_cabins = len(spec.get("cabins", ["economy"]))

    return (n1_from * n1_to * n1_dates
            * n2_from * n2_to * n2_dates
            * n3_stay * n3_to
            * n4_from * n4_to * n4_dates
            * n_cabins)


# ============================================================
# CLI test
# ============================================================

if __name__ == "__main__":
    import json

    # 你給的範例
    example_spec = {
        "name": "日韓→紐西蘭",
        "budget_econ": 40000,
        "budget_biz": 120000,
        "cabins": ["economy"],
        "seg1": {
            "from_groups": ["日韓主要"],
            "from_manual": [],
            "to": ["TPE"],
            "dates": ["2026-03-02", "2026-03-03", "2026-03-04"],
        },
        "seg2": {
            "from": ["TPE"],
            "to_groups": [],
            "to_manual": ["ZQN", "CHC"],
            "dates": ["2026-04-01", "2026-04-02", "2026-04-03"],
        },
        "seg3": {
            "to": ["TPE"],
            "stay_min": 10,
            "stay_max": 15,
        },
        "seg4": {
            "from_groups": ["台北"],
            "from_manual": [],
            "to_groups": ["日韓主要"],
            "to_manual": [],
            "dates": ["2026-05-01", "2026-05-02"],
        },
    }

    total = count_combinations(example_spec)
    print(f"預估組合: {total}")

    tasks = expand_target(example_spec, max_tasks=5)
    print(f"\n前 5 個展開的 task:")
    for t in tasks:
        print(json.dumps(t, ensure_ascii=False, indent=2))
