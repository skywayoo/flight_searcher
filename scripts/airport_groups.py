"""Airport groups for flight search task expansion.

Define preset groups so UI / Notion can use short names like '日本主要',
which get expanded to actual airport codes when building tasks.

Override / extend by editing this file or via Notion's per-target manual lists.
"""

AIRPORT_GROUPS = {
    # === 日本 ===
    "日本主要": ["NRT", "HND", "KIX", "NGO"],
    "日本關東": ["NRT", "HND"],
    "日本關西": ["KIX"],
    "日本中部": ["NGO"],
    "日本九州": ["FUK"],
    "日本北海道": ["CTS"],
    "日本沖繩": ["OKA"],
    "日本全部": [
        "NRT", "HND", "KIX", "NGO", "FUK", "CTS", "OKA",
        "KOJ", "HIJ", "TAK", "KMJ", "KIJ",
    ],
    # Every Japanese airport with a scheduled direct service to Taiwan,
    # Okinawa prefecture (OKA/ISG/MMY) deliberately left out.
    "日本直飛台灣": [
        "NRT", "HND", "KIX", "NGO", "FUK", "CTS",          # 主要門戶
        "SDJ", "KMQ", "OKJ", "HIJ", "TAK", "MYJ",          # 仙台 小松 岡山 廣島 高松 松山
        "KMJ", "KOJ", "NGS", "OIT", "KKJ", "UBJ",          # 熊本 鹿兒島 長崎 大分 北九州 山口宇部
        "FSZ", "KIJ", "HKD", "AOJ", "TOY", "KCZ",          # 靜岡 新潟 函館 青森 富山 高知
        "TKS", "IBR", "AKJ", "FKS", "YGJ", "ASJ",          # 德島 茨城 旭川 福島 米子 奄美
    ],
    "日本直飛台灣_門戶": ["NRT", "HND", "KIX", "NGO", "FUK", "CTS"],

    # === 韓國 ===
    "韓國主要": ["ICN", "GMP"],
    "韓國全部": ["ICN", "GMP", "PUS", "CJU", "TAE"],

    # === 日韓合併(常用) ===
    "日韓主要": ["NRT", "HND", "KIX", "NGO", "ICN", "GMP"],
    "日韓全部": [
        "NRT", "HND", "KIX", "NGO", "FUK", "CTS", "OKA",
        "ICN", "GMP", "PUS", "CJU",
    ],

    # === 台灣 ===
    "台北": ["TPE", "TSA"],
    "台北桃園": ["TPE"],
    "台北松山": ["TSA"],

    # === 紐西蘭 ===
    "紐西蘭南島": ["ZQN", "CHC", "DUD", "NSN", "WLG"],  # WLG 為北島但常含
    "紐西蘭北島": ["AKL", "WLG", "ROT"],
    "紐西蘭主要": ["AKL", "CHC", "ZQN", "WLG"],
    "紐西蘭全部": ["AKL", "WLG", "CHC", "ZQN", "DUD", "NSN", "ROT"],

    # === 香港澳門 ===
    "港澳": ["HKG", "MFM"],

    # === 泰國 / 印尼（放在東南亞主要之前，讓 pair_group 先配到國家而不是大區）===
    "泰國": ["BKK", "DMK", "CNX", "HKT"],
    "峇里島": ["DPS"],

    # === 東南亞主要 ===
    "東南亞主要": ["SIN", "BKK", "KUL", "MNL", "CGK", "SGN"],
}


def expand_groups(group_names):
    """Expand a list of group names into a flat airport code list (deduped).

    >>> expand_groups(["日本主要", "韓國主要"])
    ['NRT', 'HND', 'KIX', 'NGO', 'ICN', 'GMP']
    """
    seen = set()
    result = []
    for name in group_names:
        for code in AIRPORT_GROUPS.get(name, []):
            if code not in seen:
                seen.add(code)
                result.append(code)
    return result


def expand_airports(group_names=None, manual_codes=None):
    """Combine group names and manual codes into final airport list.

    >>> expand_airports(["日本主要"], ["ICN", "HKG"])
    ['NRT', 'HND', 'KIX', 'NGO', 'ICN', 'HKG']
    """
    result = expand_groups(group_names or [])
    seen = set(result)
    for code in manual_codes or []:
        code = code.strip().upper()
        if code and code not in seen:
            seen.add(code)
            result.append(code)
    return result


if __name__ == "__main__":
    # 自我測試
    import json
    print("Available groups:")
    for name, codes in AIRPORT_GROUPS.items():
        print(f"  {name:12s} = {codes}")
    print()
    print("Example expand:")
    test = expand_airports(["日韓主要", "台北"], ["BKK"])
    print(json.dumps(test, ensure_ascii=False))
