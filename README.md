# Flight Searcher

> 易遊網機票監控與比價工具

多段機票自動搜尋、預算過濾、價格監控、Telegram 通知。

---

## 🎯 整體架構

```
┌──────────────────── 🖥️  MacOS 本機(重活)───────────────────┐
│                                                              │
│  Cron(每天 / 每幾小時)                                       │
│       │                                                      │
│       ▼                                                      │
│  run-local-batch.py(主控)                                   │
│       │                                                      │
│       ├──► [TG] 🟢 開始掃描                                    │
│       │                                                      │
│       ├──► build-tasks.py                                    │
│       │      └── 從 Notion Targets DB 撈追蹤目標 ★            │
│       │      └── 用 task_expander.py 展開所有組合              │
│       │                                                      │
│       ├──► local-scrape.mjs(Playwright 完整版)               │
│       │      └── 第一段價 > 預算 → skip(剪枝)★              │
│       │      └── 找到符合預算 → [TG] 💰 即時通知 ★            │
│       │      └── 每 10% → [TG] 📊 進度(由 run-local 控)      │
│       │                                                      │
│       ├──► import-results.py                                 │
│       │      ├── 全部結果寫 SQLite                            │
│       │      └── 「符合預算」同步上 Notion Results DB         │
│       │                                                      │
│       └──► [TG] ✅ 完成總結                                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                              ↑↓
                       Notion API
                              ↑↓
┌──────────────────── 📋 Notion(資料中樞)────────────────────┐
│                                                              │
│  Targets DB(追蹤目標)                                       │
│    ├ 名稱 / 預算 / 4-segment 設定                            │
│    ├ Seg1 出發機場集合 + 日期集合                              │
│    ├ Seg2 出發 / 抵達 + 日期集合                              │
│    ├ Seg3 相對 Seg2 + N 天                                   │
│    ├ Seg4 出發機場 / 抵達機場 / 日期集合                       │
│    └ enabled, lastScanAt                                     │
│                                                              │
│  Results DB(符合預算的機票)                                  │
│    ├ 每個 target + 組合,只保留最新一筆                       │
│    ├ totalPrice, bookingUrl, 各段日期                         │
│    └ 寫入時間                                                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                              ↑↓
                              │
┌──────────────────── ☁️  Vercel(輕活)───────────────────────┐
│                                                              │
│  Next.js 16 UI                                               │
│    ├ 顯示 Notion 裡的 Targets + Results                       │
│    ├ 新增 / 編輯 Target(用 AirportPicker + DatePicker)      │
│    ├ 「重新掃描」按鈕                                          │
│    └ 價格變動圖表                                              │
│                                                              │
│  /api/targets/[id]/scan                                      │
│    └── 用 chromium-min + playwright-core 跑單一 target        │
│    └── 跌價達門檻 → [TG] 通知                                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 📐 設計原則

| 原則 | 說明 |
|------|------|
| **本機重活 / Vercel 輕活** | Playwright 完整爬蟲在本機,Vercel 只跑單筆 scan |
| **Notion 是事實源** | Targets 在 Notion(使用者編輯),Results 也在 Notion(批次同步上去顯示) |
| **SQLite 是歷史 / 分析倉** | 本機保留所有結果(含失敗 / 超預算),Notion 只放符合的 |
| **預算只看上限** | 超過上限直接 skip,節省爬蟲時間 |
| **Notion 不留歷史** | 同 target+組合,永遠覆蓋最新一筆 |
| **Telegram 分層通知** | 本機批次發進度,Vercel scan 發跌價 |

---

## 📦 完整檔案結構

```
flight_searcher/
├── app/                          # Next.js App Router
│   ├── api/
│   │   ├── targets/[id]/scan/
│   │   │   └── route.ts          # 單筆掃描,寫 Notion + 跌價通知
│   │   └── ...
│   ├── airport-picker-demo/      # 元件測試頁(可刪)
│   │   └── page.tsx
│   ├── date-picker-demo/         # 元件測試頁(可刪)
│   │   └── page.tsx
│   └── page.tsx
│
├── components/
│   ├── AirportPicker.tsx         # 機場多選元件 (~60 亞太機場)
│   └── DatePicker.tsx            # 日期多選元件
│
├── lib/
│   ├── airports.ts               # 機場資料 + 群組設定
│   ├── notion.ts                 # Notion API wrapper(現有)
│   ├── scraper.ts                # Vercel 端爬蟲(現有)
│   ├── telegram.ts               # Vercel 端 Telegram(現有)
│   └── ...
│
├── scripts/                      # 本機 Python / Node
│   ├── run-local-batch.py        # 主控,排程跑這個
│   ├── build-tasks.py            # 從 Notion 撈 target → 展開 JSONL ⚠️待改
│   ├── local-scrape.mjs          # Playwright 爬蟲(本機)
│   ├── import-results.py         # 寫 SQLite + 同步 Notion
│   ├── send-price-report.mjs     # 批次完成總表
│   ├── notify.py                 # Telegram 統一模組
│   ├── airport_groups.py         # 機場群組(Python 端)
│   ├── task_expander.py          # 組合展開邏輯
│   └── scan_config.py            # 預算等共用設定
│
├── data/
│   └── flight-results.sqlite     # 本機 SQLite(不上傳 git)
│
├── types/
│   └── ...                       # TypeScript 型別
│
├── .env.local                    # 環境變數(不上傳 git)
├── package.json
├── vercel.json
└── README.md
```

---

## 🔧 環境變數

`.env.local`(本機 + Vercel Project Settings 都要設):

```bash
# === Telegram(必填)===
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# === Notion(必填)===
NOTION_TOKEN=secret_xxxxxxxxxx
NOTION_TARGETS_DB_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
NOTION_RESULTS_DB_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# === 預算(可調)===
BUDGET_ECON=40000
BUDGET_BIZ=120000

# === 本機 Node 路徑(可選,沒設會自動找)===
NODE20=/usr/local/bin/node
```

⚠️ **Vercel deploy**:要去 Project Settings → Environment Variables 設,`.env.local` 不會自動上 Vercel。

---

## 📋 Notion DB Schema

### Targets DB(使用者編輯)

| 欄位 | 類型 | 說明 |
|------|------|------|
| Name | title | 目標名稱 |
| Enabled | checkbox | 是否參與批次掃描 |
| Budget_Econ | number | 經濟艙預算上限 |
| Budget_Biz | number | 商務艙預算上限 |
| Cabins | multi_select | economy / business |
| Seg1_From | rich_text | JSON 陣列:`["NRT", "HND", ...]` |
| Seg1_Dates | rich_text | JSON 陣列:`["2026-03-02", ...]` |
| Seg2_To | rich_text | JSON 陣列 |
| Seg2_Dates | rich_text | JSON 陣列 |
| Seg3_StayMin | number | 最少停留天數 |
| Seg3_StayMax | number | 最多停留天數 |
| Seg4_From | rich_text | JSON 陣列(台北 / 松山) |
| Seg4_To | rich_text | JSON 陣列(可跟 Seg1 不同) |
| Seg4_Dates | rich_text | JSON 陣列 |
| NotifyDropPct | number | 跌幾 % 才通知(預設 5) |
| LastScanAt | date | 最後掃描時間 |

### Results DB(本機批次寫入)

| 欄位 | 類型 |
|------|------|
| Title | title |
| out1 | rich_text |
| out4 | rich_text |
| nz | rich_text |
| seg4_airport | rich_text |
| cabin | select(economy / business)|
| cheapestPrice | number |
| bookingUrl | url |
| seg1_date | date |
| seg2_date | date |
| seg3_date | date |
| seg4_date | date |
| variation_idx | number |
| updatedAt | date |

---

## 🚀 怎麼跑

### 本機批次(主流程)

```bash
cd scripts
python run-local-batch.py
```

選項:

```bash
# 跑批次但不發 Telegram
python run-local-batch.py --no-tg

# 改 batch size / concurrency
python run-local-batch.py --batch-size 100 --concurrency 6

# 跳過最後的 send-price-report
python run-local-batch.py --skip-report
```

排程(macOS):

```bash
# crontab -e
0 6 * * * cd /path/to/flight_searcher/scripts && python run-local-batch.py >> /tmp/flight.log 2>&1
```

### Vercel(自動)

```bash
git push  # Vercel 自動 deploy
```

### 元件測試

```bash
npm run dev
# 開啟:
#   http://localhost:3000/airport-picker-demo
#   http://localhost:3000/date-picker-demo
```

---

## 🧪 各模組測試

```bash
# Telegram 通知
python scripts/notify.py "🧪 test"

# 機場群組展開
python scripts/airport_groups.py

# 組合展開(印出範例)
python scripts/task_expander.py
```

---

## 📊 Telegram 通知時機

| 來源 | 時機 | 範例 |
|------|------|------|
| 本機批次 | 開始 | 🟢 開始掃描 1234 組合 |
| 本機批次 | 每 10% | 📊 進度 50%(617/1234)|
| 本機批次 | 命中(每筆)| 💰 經濟艙 $32,000 / TPE-AKL-WLG-TPE |
| 本機批次 | 完成 | ✅ 完成,共 12 筆,最低 $28,500 |
| Vercel scan | 跌價達門檻 | 💸 跌 8% / $35,000 → $32,200 |

---

## 🏗️ 模組職責

### 📜 scripts/run-local-batch.py
批次主控,負責:
- 從 Notion 撈 enabled targets(透過 build-tasks)
- 切 batch、跑 scrape、import 結果
- 進度 / 完成 Telegram
- 失敗復原(一批失敗不會死整個)

### 📜 scripts/build-tasks.py ⚠️ **待改寫**
- ❌ 目前:舊版,可能還是用寫死 config 展開
- 🎯 目標:從 Notion Targets DB 撈所有 enabled targets
- 🎯 目標:對每個 target 呼叫 `task_expander.expand_target()`
- 🎯 目標:輸出 JSONL 給 scraper

### 📜 scripts/local-scrape.mjs ⚠️ **待加功能**
- ✅ Playwright 完整版(本機才能跑)
- ✅ 接收 JSONL,平行爬資料
- ❌ 待加:**剪枝** — 第一段 > 預算就 skip
- ❌ 待加:**即時 TG** — 找到符合就發

### 📜 scripts/import-results.py ✅
- ✅ 讀爬蟲 JSONL
- ✅ 寫 SQLite(全部結果)
- ✅ Upsert Notion Results(只有符合預算的)
- ✅ 比對歷史新低,發 Telegram
- ✅ JSON 防爛、transaction、避免重複 TG

### 📜 scripts/notify.py ✅
- ✅ 統一 Telegram 介面
- ✅ Rate limit(1.1s 間隔)
- ✅ 訊息範本(start / progress / hit / done)

### 📜 scripts/task_expander.py ✅
- ✅ 從 target spec(4-segment + 預算)展開所有組合
- ✅ 支援絕對日期 + 相對日期(Seg3 = Seg2 + N 天)
- ✅ `count_combinations()` 快速估數量(供 UI 預覽)

### 📜 scripts/airport_groups.py ✅
- ✅ 預設群組:日本主要、韓國、台北、紐西蘭...
- ✅ 對應前端 `lib/airports.ts` 的 `QUICK_GROUPS`

### 📦 lib/airports.ts ✅
- ✅ ~60 個亞太 + 紐西蘭機場
- ✅ code / 中文 / 英文 / 國家分組
- ✅ QUICK_GROUPS、searchAirports helper

### 🧩 components/AirportPicker.tsx ✅
- ✅ 機場多選元件
- ✅ 快速群組、國家分組、搜尋、chip
- ✅ Tailwind only,沒依賴 UI library

### 🧩 components/DatePicker.tsx ✅
- ✅ 日期多選元件
- ✅ 單點 / 範圍 兩模式
- ✅ 整月全選、過去禁用

### 🌐 app/api/targets/[id]/scan/route.ts ✅
Vercel 端單筆掃描:
- ✅ 從 Notion 撈 target
- ✅ 用 chromium-min 爬
- ✅ 寫回 Notion Results
- ✅ 跌價達門檻 → Telegram

---

## ✅ 已完成

### 後端
- ✅ Notion 同步(import-results.py 自動 upsert)
- ✅ Telegram 進度通知(start / 每 10% / hit / 完成)
- ✅ 4-segment 組合展開邏輯(支援相對日期)
- ✅ 機場群組設定(Python + TypeScript 同步)
- ✅ JSON 防爛、transaction、避免重複 TG 等 bug 修
- ✅ NODE20 動態尋找(原本寫死)
- ✅ 一批失敗不影響其他批

### 前端
- ✅ AirportPicker 元件(60 亞太機場)
- ✅ DatePicker 元件(單點 / 範圍)
- ✅ Demo 頁面

---

## 🚧 待辦清單

### 🔥 必要(下次優先做)
- [ ] **新版 `build-tasks.py`** — 從 Notion Targets DB 撈,用 task_expander 展開
- [ ] **scraper 剪枝** — `local-scrape.mjs` 加 `--econ-cap / --biz-cap`,第一段超預算 skip
- [ ] **scraper 即時 TG** — 找到符合預算立刻發
- [ ] **完整新增 Target 表單** — 整合 AirportPicker + DatePicker
- [ ] **`/api/targets` POST** — 表單 Save 寫 Notion

### 💡 加分
- [ ] **`/api/expand-preview`** — 前端即時算組合數
- [ ] **Notion sync 時 idempotency lock** — 用 `@vercel/kv`,防重複 scan
- [ ] **Targets 列表頁** — 顯示所有 target + 最近 Results
- [ ] **價格趨勢圖** — 從 SQLite 撈歷史畫圖

### 🐛 已知 bug / tech debt
- [ ] `lib/notion.ts` 是否有 retry / rate limit?(需要確認)
- [ ] `route.ts` 的 `getFlightResults(5)` magic number → 改 10 比較保險
- [ ] `today` 時區改成 Asia/Taipei

---

## ⚠️ 已知限制

1. **Vercel function 5 分鐘 timeout** — 單筆 scan 不能跑太多 segment 變化
2. **Notion API 3 req/s** — 大量同步時要小心 rate limit(已加 retry)
3. **`@vercel/kv` 沒用到** — 之前計畫加 idempotency lock,還沒做
4. **`build-tasks.py` 還是舊格式** — 沒改成從 Notion 撈,需要重寫

---

## 🛠️ Tech Stack

| 層級 | 技術 |
|------|------|
| Frontend | Next.js 16 + React 19 + Tailwind CSS |
| Vercel scraper | playwright-core + @sparticuz/chromium-min |
| Local scraper | playwright(完整版) |
| Database (local) | SQLite |
| Database (cloud) | Notion |
| Cache (cloud) | @vercel/kv(Redis,目前未用) |
| 通知 | Telegram Bot API |
| 部署 | Vercel |

---

## 📝 開發筆記

### Next.js 16 注意
這個 repo 用 Next 16,有 breaking change:

- `params` 變 Promise:`await ctx.params`
- 看 `AGENTS.md`,給 AI 工具讀 `node_modules/next/dist/docs/`

### `/compact` 後重連 Telegram
Claude Code `/compact` 後 Telegram bridge 可能掉線,要重新 pair。

### Notion rate limit
3 req/s/integration,大量同步用我寫的 `import-results.py` 有 retry,但仍要小心。

---

## 📄 License

私人專案。
