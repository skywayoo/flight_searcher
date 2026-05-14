# Flight Searcher

> 易遊網多段機票價格監控與比價工具

支援外站四段票（外站→TPE→NZ→NZ→TPE→外站）的 cartesian 機場 + 日期組合搜尋，預算過濾，命中時 Telegram 即時通知 + Notion 紀錄 + GitHub Pages 公開報告。

---

## 🎯 整體架構

```
┌────────────────── 🖥️  Mac 本機(全部重活)─────────────────┐
│                                                           │
│  scan-targets-direct.py  (orchestrator)                   │
│     │                                                     │
│     ├─► 1. 從 Notion 撈 active targets                    │
│     ├─► 2. cartesian 展開每個 target → JSONL              │
│     │                                                     │
│     ├─► local-scrape.mjs(playwright-core + 本機 chromium) │
│     │      ├── 每 worker 有自己 warm context (過 Incapsula)│
│     │      ├── 跑 6 workers 平行,~5s/scrape                │
│     │      └── 結果寫 JSONL                                │
│     │                                                     │
│     └─► 結束時:寫 Notion FlightResults + Telegram 總結    │
│                                                           │
│  watch-hits.py  (tailer, 邊跑邊看)                        │
│     ├── 即時讀 JSONL,每筆新命中(在預算內):                │
│     ├── 響鈴 Telegram(新最低價)                           │
│     ├── 寫 Notion FlightResults                            │
│     ├── 寫本機 SQLite scrape_results                       │
│     └── (可選)定期重生 docs/ + push GH Pages              │
│                                                           │
└───────────────────────────────────────────────────────────┘
                              ↑↓ API
                          Notion + Telegram
                              ↑
┌─────────── 📋 Notion(資料源 + 結果存放)─────────────────┐
│                                                           │
│  Flight Targets DB(使用者 / Next.js UI 編輯)              │
│    ├ Name / TripType / DepartureAirport                   │
│    ├ Segments (rich_text JSON, 4 段)                       │
│    ├ BudgetCapEcon / BudgetCapBusiness                     │
│    ├ IncludeBusiness (checkbox)                            │
│    └ Status(active/paused)                                │
│                                                           │
│  Flight Results DB(掃描命中時寫入)                       │
│    ├ Name / TargetId                                       │
│    ├ ScrapeDate / CheapestPrice / Top5                     │
│    └ Source(select: eztravel)                             │
│                                                           │
└───────────────────────────────────────────────────────────┘
                              ↑
┌─────────── ☁️  Next.js Dev UI(本機 localhost:3000)─────┐
│                                                           │
│   /targets/new   新增監控目標                              │
│      ├── 4-segment 多選機場(comma-separated)               │
│      ├── 預算分艙等(econ / biz)                            │
│      └── 寫 Notion Targets                                 │
│                                                           │
│   /                 首頁顯示所有 targets + latest results  │
│                                                           │
│   ⚠️ Vercel 部署目前因 team fair-use 被擋,只跑本機 dev   │
└───────────────────────────────────────────────────────────┘
                              ↑
┌─────────── 🌍 GitHub Pages(公開、唯讀靜態報告)──────────┐
│                                                           │
│  https://skywayoo.github.io/flight_searcher/              │
│    └── docs/index.html(從 SQLite 產生,scan 結束後推送) │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

---

## 🚀 快速使用（已建置好的環境）

### 0. 確認本機環境

```bash
# Node 20+（playwright 需要）
/opt/homebrew/opt/node@20/bin/node --version    # v20.x ✓

# Python 3.9+
python3 --version                                # 3.9+ ✓

# qpdf（若會處理加密 PDF，optional）
which qpdf || brew install qpdf
```

### 1. 啟動 Next.js Dev UI（建 target）

```bash
cd ~/claude_proj/flight_searcher
PATH=/opt/homebrew/opt/node@20/bin:$PATH npm run dev
# 開 http://localhost:3000/targets/new
```

在 UI 上填條件 → 寫進 Notion `Flight Targets` DB。

### 2. 跑批次掃描

```bash
# orchestrator（一次跑所有 active targets）
NODE20=/opt/homebrew/opt/node@20/bin/node python3 scripts/scan-targets-direct.py --concurrency 6
```

另開一個 terminal 跑 watcher（即時通知）：

```bash
python3 scripts/watch-hits.py
```

### 3. 觀察結果

- **即時**：Telegram 收到「💰 經濟艙 42,511 / KIX→…→NRT (國泰航空)」
- **掃完**：Notion `Flight Results` DB 看完整列表
- **公開**：(可選 push 時) https://skywayoo.github.io/flight_searcher/

---

## 📦 給別人用 / 重新部署的完整步驟

### Step 1. 拿到 source

```bash
git clone https://github.com/skywayoo/flight_searcher
cd flight_searcher
npm install
```

### Step 2. 準備外部服務

#### a. Telegram Bot

1. 找 @BotFather 創 bot → 拿 `TELEGRAM_BOT_TOKEN`
2. 跟你 bot 打一句話，去 `https://api.telegram.org/bot<TOKEN>/getUpdates` 找 `chat_id`

#### b. Notion Integration

1. https://www.notion.com/my-integrations → 「+ New integration」
2. 拿 token (`NOTION_API_KEY`，`ntn_...` 開頭)
3. 在 Notion 創兩個 database：

##### Flight Targets DB

| 欄位 | 型別 | 說明 |
|------|------|------|
| Name | Title | 目標名稱（必填） |
| TripType | Select | `round_trip` / `one_way` / `multi_city_4` |
| DepartureAirport | Rich text | 預設出發機場（round/one-way 用）|
| Region | Select | 區域分類 |
| DestinationAirports | Multi-select | 限定目的地機場（空=全掃）|
| OutboundStart / OutboundEnd | Date | 出發日範圍 |
| TripLengthMin / TripLengthMax | Number | 行程天數 |
| Segments | Rich text | 4-segment JSON（multi_city_4 用） |
| BudgetCap | Number | 通用預算（legacy） |
| BudgetCapEcon | Number | 經濟艙上限 |
| BudgetCapBusiness | Number | 商務艙上限 |
| IncludeBusiness | Checkbox | 同時掃商務艙 |
| NotifyDropPct | Number | 跌價通知門檻 % |
| Status | Select | `active` / `paused` |
| CreatedAt / LastScrapeAt | Date | 系統管理 |
| OutStations | Rich text | (legacy, 可空) |

##### Flight Results DB

| 欄位 | 型別 |
|------|------|
| Name | Title |
| TargetId | Rich text |
| ScrapeDate | Date |
| CheapestPrice | Number |
| PrevCheapestPrice | Number |
| ChangePct | Number |
| Top5 | Rich text(JSON) |
| ScrapeDurationMs | Number |
| Source | Select(`eztravel`) |

4. 在每個 DB 右上選單 → 「+ Connections」→ 加上剛剛 create 的 integration。

#### c. (Optional) GitHub Pages

1. Repo Settings → Pages → Source: `main` branch / `/docs` folder
2. Push 後過 1-2 分鐘 https://&lt;user&gt;.github.io/flight_searcher/ 會生效

### Step 3. 寫 `.env.local`

```env
NOTION_API_KEY=ntn_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NOTION_FLIGHT_TARGETS_DB_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
NOTION_FLIGHT_RESULTS_DB_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
TELEGRAM_BOT_TOKEN=8000000000:AAxxxxxxxxxxxxxxxx
TELEGRAM_CHAT_ID=123456789

# 預算（可在 target 內 override）
ECON_CAP=50000
BUSINESS_BUDGET_CAP=80000

# Scraper 模式
SCRAPER_MODE=real
```

### Step 4. (可選) Vercel 部署

如果要遠端 UI：

```bash
npm i -g vercel
vercel login
vercel link    # 連到專案
vercel env pull .env.local
vercel --prod
```

⚠️ **Vercel Hobby plan 限 4hr Active CPU/月**。爬蟲走本機（不是 Vercel function），所以 Vercel 端只負責 UI 顯示。如果 team 因 fair-use 被擋（如 2026-05 出現過），dev 仍可本機 `npm run dev` 跑。

### Step 5. 跑第一次

```bash
# 啟動 dev UI（用來建 target）
PATH=/opt/homebrew/opt/node@20/bin:$PATH npm run dev &

# 開 http://localhost:3000/targets/new
# 建一個測試 target，select tripType=multi_city_4

# Orchestrator 掃描
NODE20=/opt/homebrew/opt/node@20/bin/node python3 scripts/scan-targets-direct.py --concurrency 4

# 另開 terminal 跑 watcher
python3 scripts/watch-hits.py
```

---

## 📐 設計重點

| 項目 | 說明 |
|------|------|
| **全部跑在本機** | Playwright + chromium 在 Mac 跑，避開 Vercel CPU 配額 |
| **Incapsula warm context** | eztravel 有 bot 防護，每個 worker 維持一個過 challenge 後的 context |
| **Cartesian 多選機場** | seg1/seg4 可填 12+ 機場，自動展開所有組合 |
| **分艙等預算** | econ / biz 各自上限，超過直接 skip 不寫 DB |
| **Telegram 只報新低** | 同一 target 同一艙等，價格沒突破前一次最低不再響鈴 |
| **GitHub Pages 是公開唯讀** | docs/ 從 SQLite 產生，scan 完成時推一次 |

---

## 📂 主要檔案

```
flight_searcher/
├── app/                                  # Next.js UI
│   ├── targets/new/page.tsx              # 建 target 表單(多選+分艙預算)
│   ├── targets/[id]/page.tsx             # 單個 target 詳情
│   ├── api/targets/route.ts              # POST 建 target
│   ├── api/targets/[id]/scan/route.ts    # 單筆掃描(dev only)
│   └── page.tsx                          # 首頁
│
├── components/
│   ├── AirportPicker.tsx                 # 多選機場
│   └── DatePicker.tsx                    # 多選日期
│
├── lib/
│   ├── notion.ts                         # Notion API wrapper
│   ├── airports.ts                       # 機場資料
│   ├── regions.ts                        # 區域分類
│   ├── scraper/                          # dev server 端 scraper
│   │   ├── index.ts                      # scrapeTarget(cartesian)
│   │   ├── eztravel-real.ts              # 真實 scrape 邏輯
│   │   └── playwright-runtime.ts         # browser launch + warm
│   └── telegram.ts                       # 通知
│
├── scripts/                              # 本機 Python/Node
│   ├── scan-targets-direct.py            # ⭐ orchestrator(主流程)
│   ├── watch-hits.py                     # ⭐ tail + 即時通知 + 寫 SQLite/Notion
│   ├── local-scrape.mjs                  # playwright + chromium 爬蟲
│   ├── generate-static.py                # SQLite → docs/index.html
│   ├── notify.py                         # Telegram 統一介面
│   ├── scan_config.py                    # 預算等共用設定
│   └── (legacy) build-tasks.py / mass-scan-direct.py / import-results.py
│
├── data/
│   └── flight-results.sqlite             # 本機 SQLite(gitignore)
│
├── docs/                                 # GitHub Pages root
│   ├── index.html                        # 公開靜態報告
│   └── results.json
│
├── .env.local                            # 環境變數(gitignore)
├── package.json
└── vercel.json
```

---

## 🔄 主要 flow

### A. 建一個 4-segment monitoring target

1. 開 `http://localhost:3000/targets/new`
2. 票種選 **外站四段**
3. 每段選機場（按 chip 或輸入後按 Enter 加入多選）+ 日期
4. 填預算（經濟艙 50,000、商務艙 80,000）
5. 「新增並立即掃描」→ Notion 寫一筆 + dev server 觸發 scan

### B. 批次跑所有 active targets

```bash
# 1. orchestrator
NODE20=/opt/homebrew/opt/node@20/bin/node python3 scripts/scan-targets-direct.py --concurrency 6

# 2. (另開 terminal) tailer 即時通知
python3 scripts/watch-hits.py

# 預期:
# - Telegram「🚀 直接掃描開始」一次
# - 每筆新低價 Telegram 響鈴
# - 結束「🏁 直接掃描完成 Xh / hits=Y」
```

### C. 看歷史

- **Telegram**：每筆命中
- **Notion Flight Results**：完整 history
- **GitHub Pages**：公開靜態（scan 完成時推送）

---

## 🐛 常見問題

### Q: scan 全部 0 命中、HTML body 永遠 length=0

eztravel 有 **Imperva Incapsula** 防爬機制。`local-scrape.mjs` 每個 worker 啟動時會先去 homepage 過 challenge 拿 cookie。如果 0 命中：

1. 檢查 `.env.local` 有沒有 `VERCEL=1`（若有會錯把 chromium 當 Lambda binary，已在 `playwright-runtime.ts` 加 `process.platform === 'linux'` 守衛）
2. 大量平行請求可能被 Incapsula 短期 ban → 等 15 分鐘 + 降 concurrency 到 3-4

### Q: GitHub Pages 看不到最新結果

`scan-targets-direct.py` 是寫 Notion 與本機 SQLite，**沒有自動 regen docs/**。要手動：

```bash
python3 scripts/generate-static.py
git add docs/ && git commit -m "refresh report" && git push
```

或讓 `watch-hits.py` 帶 `--push-interval` 自動推（commit noisy）。

### Q: Vercel deploy 跳 402 Payment Required

team 被 fair-use 擋。月初應該重置。本機 dev 不受影響。

### Q: Node 版本錯誤 (playwright 要 18+)

```bash
brew install node@20
/opt/homebrew/opt/node@20/bin/node --version
# 跑 script 時前面加 NODE20 環境變數
```

---

## 🛠️ Tech stack

| 層級 | 技術 |
|------|------|
| Frontend | Next.js 16 + React 19 + Tailwind |
| Local scraper | playwright-core + 本機 chromium |
| Vercel scraper | playwright-core + @sparticuz/chromium-min（線上才用） |
| Database (local) | SQLite |
| Database (cloud) | Notion |
| 通知 | Telegram Bot API |
| 公開頁面 | GitHub Pages（`/docs`） |

---

## 📝 開發筆記

### Next.js 16

- `params` 變 async Promise：`const { id } = await ctx.params`
- 任何 `app/api/.../[id]/route.ts` 都要記得

### Incapsula

- node_modules 進 fingerprint 偵測，每個 context 開銷 ~4s warm-up
- 每個 worker 維持 1 個 context、N 個 page 是正解

### 排程跑

```bash
# crontab -e
0 4 * * * cd /Users/way/claude_proj/flight_searcher && NODE20=/opt/homebrew/opt/node@20/bin/node python3 scripts/scan-targets-direct.py --concurrency 6 >> /tmp/flight-cron.log 2>&1
```

每天凌晨 4 點掃一次。cron 環境變數不一樣，把 PATH 顯式設好。

---

## 📄 License

私人專案。
