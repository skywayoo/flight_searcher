"""Shared scan configuration for local SQLite-based flight scans."""

import os

BASE_SEGMENT_DATES = ("2027-03-01", "2027-04-01", "2027-04-12", "2027-04-30")

JAPAN_OUTSTATIONS = [
    "CTS",
    "FUK",
    "HIJ",
    "HKD",
    "HND",
    "ISG",
    "KIX",
    "KMJ",
    "KOJ",
    "NGO",
    "NRT",
    "OKA",
    "SDJ",
    "SHI",
    "TAK",
    "UKB",
]

OTHER_OUTSTATIONS = [
    "BKK",
    "CNX",
    "DMK",
    "DPS",
    "GMP",
    "HKG",
    "ICN",
    "MFM",
    "PUS",
]

OUTSTATIONS = OTHER_OUTSTATIONS + JAPAN_OUTSTATIONS

VARIATIONS = [
    (0, 0, 0, 0),
    (1, -2, 3, -9),
    (-3, 4, 4, 1),
]

SEG4_OPTIONS = [
    {"airport": "TPE", "mode": "fixed_variation", "offset_days": None},
    {"airport": "TSA", "mode": "after_seg3", "offset_days": 0},
    {"airport": "TSA", "mode": "after_seg3", "offset_days": 1},
]


def get_budget_caps(env=None):
    source = env or os.environ
    econ = int(source.get("ECON_BUDGET_CAP") or source.get("ECON_CAP") or 50000)
    biz = int(source.get("BUSINESS_BUDGET_CAP") or source.get("BIZ_CAP") or 80000)
    return econ, biz
