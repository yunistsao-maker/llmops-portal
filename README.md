# LLMOps 模型發布 Portal — 資料契約、首批研究資料與測試工具

研究截止：2026-09-24（台北時間）｜語系：zh-TW（技術名詞保留英文）

這個資料夾給 infra / 平台團隊用來建 LLMOps portal：
`schema/` 是 React UI 要用的資料契約，`data/` 是第一批研究資料（9 月新模型、三雲 EOL、LiteLLM 相容性、需求與發布關卡），`tools/` 是可直接對公司 LiteLLM gateway 跑的相容性、效能與清單同步工具。
UI 還沒設計也沒關係——頁面怎麼切、每頁讀哪個檔，見下方「Portal 資訊架構」。

## 目錄

```
schema/
  types.ts                 資料契約（source of truth，TypeScript）
  llmops.schema.json       由 types.ts 產生的 JSON Schema（npm run schema）
data/
  catalog.json             模型 × CSP 路由：規格、端點、區域、資料處理、功能、價格、配額、生命週期、LiteLLM
  models/<id>.json         每個新模型的 tech deep dive + onboarding
  lifecycle.json           三雲 + Anthropic 的 EOL / 退役行事曆（含日期衝突與來源）
  litellm.json             LiteLLM 支援窗口、建議版本、避免版本、安全公告、已知陷阱
  requirements.json        需求驗證（你的 12 項 + 16 項缺口）、G0–G10 發布關卡、指標定義、安全測試目錄
  digests/<日期>.json      每次研究的原始紀錄（不可改寫；每日研究任務新增）
  radar.json               Release Radar 的合併版本：所有 digest 合併、去重，未到期的行動項目全部保留（tools/build_radar.py 產生，不手改）
  open-models.json         開放權重模型的市場雷達（熱度 hit / rising / watch、三雲託管、授權）
  sources.json             所有來源，其他檔以 id 引用
  internal/platform-inventory.example.json   平台清單範例（sync_inventory 產生）
config/litellm.example.yaml   新模型的 LiteLLM 設定範例（路由命名、fallback、能力層 alias）
tools/
  compat_suite.py          API 相容性測試（17 個案例 × 每條路由）→ runs/compat/*.json
  perf_probe.py            TTFT / TTFAT / ITL / TTLT / tok/s / goodput → runs/perf/*.json
  sync_inventory.py        讀 LiteLLM /model/info，對照 EOL → data/internal/platform-inventory.json
  validate_data.py         Python：schema + 跨檔檢查（來源 id、重複 id、日期）
  validate.mjs             Node/ajv：schema 檢查（給前端 CI）
  mock_gateway.py          不花 token 的模擬 gateway
  selftest.py              端到端自測（mock → compat → perf → inventory → schema）
  build_site.mjs           組出 dist/：site/ + data/ + runs/ + config/，並產生 data/manifest.json（含 radarAsOf 與 release，供部署後檢查）
  build_radar.py           產生 data/radar.json；--check 檢查是否最新（npm run validate 會跑）
  build_versions.py        Amplify build：替最近 6 天的每日版本各建一份 Radar（versions/<日期>/，由 fetch_release.mjs 抓下）
  fetch_release.mjs        Amplify build 時抓 pipeline 上線中的 release（release 還沒有的 open-models.json 沿用 repo 的版本）
  sec_suite.py + secsuite/ AI 安全測試（G6）：核准後下載公開資料集、抽樣、執行、本機 UI（見 tools/secsuite/README.md）
runs/compat, runs/perf    測試結果（UI「測試結果」頁讀取，由 manifest 列出）
radar/curation.json       合併 Release Radar 時套用的人工決定：合併同義項目、關閉已完成的行動項目、改寫過時的說法
site/                     由 web/ build 出來的 portal UI（Amplify 直接使用，不在雲端 build JS）
web/                      portal UI 原始碼（React + Vite）；改畫面後 `cd web && npm run build`，再把 dist 的 index.html、assets/、security-tests.html 複製到 site/
amplify.yml               Amplify：validate_data.py → build_site.mjs → 發布 dist/
```

網站：AWS Amplify 連到這個 repo，push 到 `main` 就會重新發布。只改 `data/` 或 `runs/` 不需要重新 build JS——
UI 從 `data/manifest.json` 找週報、模型與測試結果。本機預覽：`node tools/build_site.mjs && python3 -m http.server -d dist`。

## 快速開始

```bash
npm install                       # ts-json-schema-generator、typescript、ajv
pip install httpx jsonschema pyyaml
npm run validate                  # ajv + Python 雙重驗證
npm run selftest                  # 不需憑證，約 20 秒
```

改了 `schema/types.ts` 之後：`npm run typecheck && npm run schema && npm run validate`。

## Portal 資訊架構（建議頁面 → 資料檔）

| 頁面 | 讀取 | 重點 |
|---|---|---|
| 首頁 / Release Radar | `radar.json`（合併版本；沒有時退回最新一份 digest）、`lifecycle.json` | 頁面上方的「資料版本」選單（每個研究頁面都有）切換最近 7 天；未到期的行動項目全部列出（當天新增的有標示）、最近 14 天移出的項目、各類新聞合併去重。原始紀錄在 `#/digest/<日期>`（稽核用） |
| 開源模型 | `open-models.json` | 熱度判定依據、三雲託管、授權與導入注意事項 |
| 模型目錄 | `catalog.json` → `models[]` | 依 vendor、tier、雲、platformStatus、`taiwanResidency`、價格篩選 |
| 模型頁 · 概覽 | `catalog.json` + `models/<id>.json` | tldr、strengths / weaknesses、bestFor / avoidFor |
| 模型頁 · 三雲與 API | `offerings[]`、deep dive `apiCompatibility`、`runs/compat` | 路由 × API 面矩陣；官方支援表與實測並列 |
| 模型頁 · 效能 | `performanceReference[]`、`runs/perf` | 外部參考與內部實測分開顯示，標明 effort 與 profile |
| 模型頁 · 智慧指數 | `benchmarks[]` | 只比較同 `name + version` 的分數 |
| 模型頁 · 安全 | `safety`、deep dive `safetyAndCompliance`、安全測試結果 | fallback / 拒答行為、信任存取計畫 |
| 模型頁 · 價格 | `offerings[].pricing[]` | 每任務成本試算（input / output / reasoning / cache），促銷到期提醒 |
| 模型頁 · LiteLLM | `litellm`（模型層）、`litellm.json`（平台層） | 最低版本、caveats、設定片段 |
| 模型頁 · Deep dive | `models/<id>.json` | whatsNew、vsPredecessor、breakingChanges、openQuestions |
| 模型頁 · Onboarding | `models/<id>.json` → `onboarding` | 步驟、alias、參數指引、程式範例、資料等級 |
| 平台清單與 EOL | `internal/platform-inventory.json`、`lifecycle.json` | risk：retired / act-now / watch / unknown |
| LiteLLM 與 gateway 安全 | `litellm.json` | 支援窗口、avoid 清單、公告、陷阱 |
| 發布流程 | `requirements.json` → `gates`、`requirements` | 每個模型的 release record（G0–G10） |
| 方法說明 | `requirements.json` → `metricDefinitions`、`securityTestCatalog` | 指標定義與量測陷阱 |

### UI 呈現規則（避免誤導）

1. **每個事實都要看得到來源與可信度**：`sources[]`（對應 `sources.json`）與 `verification`（official / independent / community / derived / unverified）。community 與 unverified 請用醒目標籤。
2. **顯示 `asOf` / `lastVerified`**：這些資料會過期，頁面要讓人知道是何時查的。
3. **EOL 有衝突就顯示衝突**：`lifecycle.json` 各事件的 `conflicts[]` 分兩種——`kind: "conflicting"` 是目前仍有官方頁面列出不同日期（倒數以最早日期計算，`date` 已是最早者）；`kind: "superseded"` 是被取代的舊公告日，只當歷史顯示，提醒使用者日期會變動（有時會提前）。
4. **智慧指數不跨版本比較**：Gemini 3.8 Flash 上市時 59 分、AA v4.3.2 為 41 分——同一模型、不同版本。
5. **延遲一定附上 effort 與 profile**：推理模型的首 token 可以從 15 秒到 350 秒，差別主要在 effort。
6. **`taiwanResidency: "no"` 要明顯**：9 月的新模型在三雲都沒有台灣境內處理選項。

## 在 React 中使用

```ts
import type { CatalogFile, DeepDive, LifecycleFile } from "../schema/types";

const catalog: CatalogFile = await fetch("/data/catalog.json").then((r) => r.json());
const opus: DeepDive = await fetch("/data/models/claude-opus-5-5.json").then((r) => r.json());
```

CI 建議：資料變更的 PR 必須通過 `npm run validate`；schema 變更需同時更新 `types.ts` 與重新產生 `llmops.schema.json`。

## 工具用法

API 相容性（每條路由都要跑；需要分辨 gateway 或 CSP 問題時，另外直連 CSP 跑一次）：

```bash
export LITELLM_API_KEY=sk-...
python3 tools/compat_suite.py --gateway https://llm-gateway.example.internal/v1 \
  --routes claude-opus-5-5,claude-opus-5-5@bedrock-jp,claude-opus-5-5@vertex,claude-opus-5-5@azure \
  --litellm-version v1.102.1 --out runs/compat/$(date +%F)-opus55.json --fail-on-required
python3 tools/compat_suite.py --list      # 看所有案例
```

效能（固定 effort 與 profile；從實際網路出口量測；每天 3 個時段 × 3 天）：

```bash
python3 tools/perf_probe.py --gateway https://llm-gateway.example.internal/v1 \
  --route claude-opus-5-5 --profile zh-tw --effort medium --concurrency 4 --requests 40 \
  --slo-ttfat-ms 8000 --slo-ttlt-ms 60000 --client-location "Taipei HQ" \
  --out runs/perf/$(date +%F)-opus55-zh-tw-medium.json
```

AI 安全測試（G6；securityTestCatalog 的 SEC-01 … SEC-16，每項抽樣後看方法、樣本、指標與通過準則）：

```bash
python3 -m venv .venv && source .venv/bin/activate && pip install -r tools/secsuite/requirements.txt
python3 tools/sec_suite.py plan                  # 先看資料集的大小、授權與內容風險
python3 tools/sec_suite.py fetch --approve all   # 核准後才下載到 .cache/secsuite/（不進版控）
python3 tools/sec_suite.py ui                    # http://127.0.0.1:8765
```

資料集與含 prompt／回應的結果只放在 `.cache/`；`runs/` 會被發布，只能放 `run --publish-summary` 產生的彙總。

平台清單（「我們平台上有哪些模型、何時退役」）：

```bash
export LITELLM_MASTER_KEY=sk-...
python3 tools/sync_inventory.py --gateway https://llm-gateway.example.internal
```

Azure 部署名稱是自訂的，請在 LiteLLM 設定的 `model_info` 加 `base_model`（例：`azure/gpt-4o`）與 `model_version`（例：`2024-11-20`），否則會被標成 `unknown` 或以最早日期保守計算。

## Release Radar 的版本與合併規則

每一次研究產生一份 digest（`data/digests/<日期>.json`），寫入後不再修改——它是「那一天查到什麼」的稽核紀錄。
Release Radar 頁讀的是 `data/radar.json`：`tools/build_radar.py` 把所有 digest 合併成一份目前狀態，日期就是版本（Amplify 每次 build 都重新產生；舊版本留在 pipeline 的 release 與 git 歷史）。

- 行動項目：文字相同或幾乎相同的視為同一項；有到期日的在到期前都顯示，沒有到期日的在最後一次被提到後 30 天內顯示。
- `radar/curation.json` 放人（或整理用的 agent）做的決定：`merge`（同一件事的不同說法）、`close`（已完成或被取代，附理由）、`rewrite`（改寫過時的說法；之後的 digest 又提到時以 digest 為準）。
- 新聞類（新模型、價格、LiteLLM、資安、法規）依標題合併，30 天後移出；生命週期變動在它自己的日期之前一直顯示。

```bash
python3 tools/build_radar.py            # 產生 data/radar.json
python3 tools/build_radar.py --as-of 2026-10-10 --out /tmp/radar-1010.json   # 重建某一天的版本
```

### 每日版本（每一頁的日期選單）

日期就是版本，每一版都是「那一天結束時上線的完整資料」——仍然有效的舊項目加上當天新增的，不是當天的變動。

- 資料來源：research pipeline 的 `manifest.json` 有 `versions`（每天一筆：那天最後上線的 release，保留 7 天；
  llmops-research-agent 的 `releases.dated_versions`）。舊的 pointer 沒有這個欄位時，從發布紀錄推算。
- Amplify build：`tools/fetch_release.mjs` 抓今天（上線版本 → `data/`）與之前 6 個日曆天（各自的 release → `versions/<日期>/data/`；
  沒有發布的日子沿用前一天）；`tools/build_versions.py` 替每一天建當天的 Radar；`tools/build_site.mjs` 把它們放到
  `dist/data/versions/<日期>/`，並寫 `dist/data/versions.json`（選單的內容）。
- UI：`?v=<日期>` 寫在網址裡（例如 `#/models?v=2026-10-10`），切換頁面時保留；看舊版本時剩餘天數以那一天為準。
  `測試結果`、`發布流程` 不分版本。沒有設定 `PORTAL_DATA_BASE_URL`（用 repo 的資料 build）時只有今天一版。

## 兩個版本：完整版與乾淨版

同一個 repo、同一個 main，Amplify 環境變數 `PORTAL_EDITION` 決定是哪一個（`tools/build_site.mjs`）：

| | 完整版（`full`，預設） | 乾淨版（`clean`） |
| --- | --- | --- |
| 給誰 | 平台團隊 | 公司裡需要知道最新 LLM 資訊的所有人 |
| 沒有的頁面 | — | 測試結果、發布流程、LiteLLM 與安全、上手指南（網址會導回 Release Radar）；模型頁的 Onboarding 分頁與「發布關卡紀錄」按鈕；「AI 安全測試（示範・模擬資料）」 |
| 沒有的資料 | — | deep dive 的 `onboarding`、`data/litellm.json`、`config/`、`security-tests.html` |
| App 外殼 | `site/` | `site-clean/` |

改了 `web/` 之後重建兩個外殼：`cd web && npm install && npm run site`（`npm run build` 是完整版、`npm run build:clean` 是乾淨版，
`scripts/prebuilt-site.mjs` 把它們放進 `site/`、`site-clean/`）。部署方式（第二個 Amplify app、兩個 webhook、兩份 ui-verify）見
llmops-research-agent 的 `docs/portal-editions-and-tests.md`。

## 上線前測試結果（模型頁的「內部測試」，兩個版本都有）

模型頁的「內部測試」分頁依發布關卡分層顯示這個模型的實測：G3 API 相容性（`runs/compat`）、G4 效能（`runs/perf`）、G5 品質評測（尚無工具）、
G6 AI 安全測試（`runs/security`，`sec_suite.py run --publish-summary` 的彙總）。`--purpose pre-release` 的測試置頂，每層顯示最近一次的結論；
其他紀錄在下面。三個工具都有 `--purpose` 與 `--model-id`（`sec_suite.py` 是 `--model-ids <label>=<id>`），不給時以路由名稱比對模型。

有 data plane（`PORTAL_DATA_BASE_URL`）時，網站讀的是 pipeline 的 release：測試結果要用 llmops-research-agent 的
`portalctl push --portal <這個 repo> --only runs` 發布，只 commit 到 `runs/` 不會出現在網站上。`runs/security/` 只能放彙總，含 prompt
與回應全文的檔案（有 `cases`）會被 schema 與 pipeline 擋下。

## 資料更新流程（建議）

正式流程是每天的 research agents（llmops-research-agent 的 `docs/daily-agents-design.md`：GitHub Actions 每天 07:17 啟動，7 個 role 依序研究、驗證、發布，Amplify 自動重新 build）。以下是沒有 pipeline 時的手動流程：

1. 排程任務產出 → 2. 開 PR 到 portal repo 的 `data/` → 3. 平台團隊審核（特別是 community / unverified）→ 4. `npm run validate` 通過後合併 → 5. UI 自動更新。

網路研究會出錯，也會漏掉 CSP 帳號層級的資訊，所以另外建議在內部 CI 每日用 CSP API 核對生命週期（Bedrock `ListFoundationModels` 的 `modelLifecycle`、Azure 退役表、Agent Platform 模型版本頁）。

## 已知限制（2026-09-24）

- GPT-6 Sol / Luna 在 Bedrock 的價格與區域取自社群 PR（官方模型卡尚未發布）。
- GPT-6 Astra 在 Azure 的退役日官方表尚未列入。
- Gemini 2.5 在 Agent Platform 的 10-20 封鎖規則與 2027 停止服務日，取自公開 GitHub issue 轉述的 Google 客戶通知（Agent Platform 文件頁是 JS 渲染，無法直接讀取）；`gemini-2.5-flash-image` 延到 2027-03-15 取自第三方轉載的 release note。
- Gemini 3.8 Flash 在 Agent Platform 的區域與價格取自第三方追蹤。
- `platformStatus` 全部預設為 `evaluating`——這是你們平台的決策欄位，請依發布關卡結果更新。
- 範例 gateway 網址、支援窗口與資料分級政策都是佔位內容，請換成公司實際值。
