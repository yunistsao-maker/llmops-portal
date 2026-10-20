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
  gateway_csp_check.py     Gateway → CSP 相容性：同一組案例經 gateway 與直連 CSP 各跑一次，歸因並計算相容性指標 → runs/compat/*.json（kind gateway-csp）
  perf_probe.py            TTFT / TTFAT / ITL / TTLT / tok/s / goodput → runs/perf/*.json
  sync_inventory.py        讀 LiteLLM /model/info，對照 EOL → data/internal/platform-inventory.json
  validate_data.py         Python：schema + 跨檔檢查（來源 id、重複 id、日期）
  validate.mjs             Node/ajv：schema 檢查（給前端 CI）
  mock_gateway.py          不花 token 的模擬 gateway
  selftest.py              端到端自測（Radar 合併規則 → mock → compat → perf → inventory → schema）
  build_site.mjs           組出 dist/：site/ + data/ + runs/ + config/，並產生 data/manifest.json（含 radarAsOf 與 release，供部署後檢查）
  build_radar.py           產生 data/radar.json；--check 檢查是否最新（npm run validate 會跑）
  build_versions.py        Amplify build：替今天以前 29 天的每日版本各建一份 Radar（versions/<日期>/，由 fetch_release.mjs 抓下）
  fetch_release.mjs        Amplify build 時抓 pipeline 上線中的 release（release 還沒有的 open-models.json 沿用 repo 的版本）
  sec_suite.py + secsuite/ AI 安全測試（G6）：核准後下載公開資料集、抽樣、執行、本機 UI（見 tools/secsuite/README.md）
runs/compat, runs/perf    測試結果（各模型頁的「內部測試」分頁讀取，由 manifest 列出；只放真實的量測，示範用的模擬結果在 tools/fixtures/examples/）
radar/curation.json       合併 Release Radar 時套用的人工決定：合併同義項目、替舊紀錄補 topic、標出複查紀錄、關閉已完成的行動項目、改寫過時的說法
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
| 首頁 / Release Radar | `radar.json`（合併版本；沒有時退回最新一份 digest）、`lifecycle.json` | 頁面上方的「資料版本」選單（每個研究頁面都有）切換最近 30 天；未到期的行動項目全部列出（當天新增、當天更新的有標示）、最近 14 天移出的項目；同一件事不論哪天報導都只有一張卡（最新說法＋「更新紀錄」），「已複查、沒有變動」另外收合列出。原始紀錄在 `#/digest/<日期>`（稽核用） |
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
| 模型頁 · 內部測試 | `runs/compat`、`runs/perf`、`runs/security` | 這個模型的所有實測：各層上線前結論、紀錄，以及詳細結果（各路由案例表、Gateway → CSP 指標與歸因、效能數字），只列這個模型的路由 |
| 方法與來源 | `requirements.json` → `metricDefinitions`、`securityTestCatalog`；`litellm.json` → `providerCompatibility` | 指標定義、**測試方法**（測試分層、G3 案例清單、Gateway → CSP 歸因、執行與發布指令、依公開文件的 LiteLLM 支援矩陣）、AI 安全測試目錄、來源 |

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

### Gateway → CSP 相容性與指標（結果在模型頁「內部測試」，方法在「方法與來源 → 測試方法」）

同一組案例（compat_suite 的 17 個，加上串流結尾、串流 tool call、成本標頭、fallback、3 個錯誤對應案例，共 24 個）**經 gateway 送一次、直連路由背後的 CSP 端點再送一次**，
每個失敗都會被歸因：`gateway`（只有經 gateway 才失敗：LiteLLM 轉換、drop_params、proxy 設定，要修 gateway）、`provider`（直連也失敗：CSP 或模型的限制）、
`unknown`（沒有直連基準）。路由檔的格式見 `tools/fixtures/gateway-routes.example.yaml`；金鑰只從環境變數讀，結果檔只記錄直連端點的協定與 host。

```bash
export LITELLM_API_KEY=sk-...  AWS_BEARER_TOKEN_BEDROCK=...  AZURE_API_KEY=...  GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token)
python3 tools/gateway_csp_check.py --gateway https://llm-gateway.example.internal/v1 \
  --routes-file gateway-routes.yaml --direct --samples 5 --litellm-version v1.105.1 --purpose regression \
  --out runs/compat/$(date +%F)-gateway-csp.json --fail-on-required
python3 tools/gateway_csp_check.py --list      # 24 個案例與所屬的 API 功能
```

| 指標 | 計算 | 怎麼讀 |
| --- | --- | --- |
| 相容率 / 必要案例通過率 | 通過 ÷（通過 + 失敗 + 錯誤），略過不算 | 必要案例是 G3 門檻：100% |
| Gateway 造成 | 經 gateway 失敗、直連通過的案例數 | > 0 就是 gateway 該修（升級、改 prefix、改 `model_info`） |
| CSP / 模型限制 | 兩邊都失敗的案例數 | client 端避開、`drop_params`，或改走別的 CSP |
| 靜默降級率 | HTTP 200 但違反約定的回應 ÷ 所有 HTTP 200 | 最危險：client 不會報錯 |
| 錯誤對應率 | 無效請求得到 4xx 的比例 | 5xx 會被重試、200 代表錯誤被吞掉 |
| 成本追蹤率 | 回應帶 `x-litellm-response-cost` > 0 的比例 | < 100%：cost map 缺模型或價格為 0 |
| Fallback 率 | `x-litellm-attempted-fallbacks` > 0 的比例 | 測試時應為 0 |
| 延遲開銷 | gateway − 直連的 p50 / p95（`--samples` 成對），串流另算 TTFT 開銷 | 直連要和 gateway 同區域、同部署 |
| Prompt token 差異 | 兩邊回報的 prompt_tokens 差距（%） | 成本分攤的偏差 |

「方法與來源 → 測試方法」列出「依公開文件」的支援矩陣（`data/litellm.json` → `providerCompatibility`，LiteLLM 各 provider × 12 類 API 功能），在實測之前先有參考；
實測與文件不一致時以實測為準。完整定義在 `requirements.json` → `metricDefinitions`（「方法與來源」頁）。`tools/fixtures/examples/` 是對
`tools/mock_gateway.py` 跑的示範結果（不在 `runs/`，所以不會出現在網站上）；要在本機看版面，把它們複製進 `runs/` 再 build。

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

資料集與含 prompt／回應的完整結果只放在 `.cache/`；`runs/` 會被發布，只能放 `sec_suite.py publish` 產生的彙總與遮蔽過的逐筆案例（見下面的「上線前測試結果」）。

平台清單（「我們平台上有哪些模型、何時退役」）：

```bash
export LITELLM_MASTER_KEY=sk-...
python3 tools/sync_inventory.py --gateway https://llm-gateway.example.internal
```

Azure 部署名稱是自訂的，請在 LiteLLM 設定的 `model_info` 加 `base_model`（例：`azure/gpt-4o`）與 `model_version`（例：`2024-11-20`），否則會被標成 `unknown` 或以最早日期保守計算。

## Release Radar 的版本與合併規則

每一次研究產生一份 digest（`data/digests/<日期>.json`），寫入後不再修改——它是「那一天查到什麼」的稽核紀錄。
Release Radar 頁讀的是 `data/radar.json`：`tools/build_radar.py` 把所有 digest 合併成一份目前狀態，日期就是版本（Amplify 每次 build 都重新產生；舊版本留在 pipeline 的 release 與 git 歷史）。

**同一件事只有一張卡。** 不同天的紀錄（新聞只在同一節內；行動項目全部一起）符合下面任一條就合併：

1. `radar/curation.json` 的 `merge`：同一件事的不同說法，指定合併成 `keep` 那個 id。
2. 相同的 `topic`：每日紀錄的項目（`DigestItem.topic`、行動項目的 `topic`）自己標；沒有標的舊紀錄由 curation 的 `topics` 補上。
   格式 `<領域>:<主題>[:<面向>]`，全小寫，例如 `pricing:claude-sonnet-5-5`、`litellm:recommended-version`、`cve:cve-2026-89032`、
   `lifecycle:gemini-api:gemini-3-1-flash-image`、`regulation:eu-ai-act`。研究任務寫新的一期時，先看 `radar.json` 各卡片的 `topic`，同一件事沿用同一個 topic。
3. `merges`：新項目列出它更新的「較早」項目的完整標題（行動項目是完整的 `action` 文字，最多 10 個）；比對時忽略標點與「【…補充】」標記。找不到的標題會在 build 時印警告。
4. 文字相同或幾乎相同（正規化後相似度 ≥ 0.92）。

合併後的卡片：標題、說明、影響、日期、廠商、雲（行動項目是內容、優先順序、到期日、相關模型）取最新的一則；來源全部保留（最新的在前）；
`firstSeen` / `lastSeen` / `seenIn` 涵蓋整張卡；較早的說法依日期放在 `updates`（頁面上的「更新紀錄（N）」，最新的在前；連續幾天一字不差的說法只算一次，記第一天）。
卡片的 id 是卡片裡最早那一則的 id，新的說法加入時 id 不變。

- **複查紀錄不是新聞**：「查過、沒有變動」的項目（每日紀錄標 `check: true`，或舊紀錄列在 curation 的 `checks`）不會變成新聞卡，也不參與合併；
  `radar.json` 的 `checks` 只放最近 3 份每日紀錄裡、每一節最新一次的複查，頁面上收合在「已複查、沒有變動（N）」。原始紀錄仍在 `#/digest/<日期>`。
- 行動項目：有到期日的在到期前都顯示，沒有到期日的在最後一次被提到後 30 天內顯示。
- 新聞類（新模型、價格、LiteLLM、資安、法規）最後一次出現後 30 天移出；生命週期變動在它自己的日期之前一直顯示。
- `radar/curation.json` 放人（或整理用的 agent）做的決定：
  - `merge`：同一件事的不同說法（見上面第 1 條）。
  - `topics`：`{ topic, ids, reason }`，替還沒有 `topic` 的舊紀錄指定主題；`ids` 可以是新聞的 `it-…` 或行動項目的 `ai-…`，填卡片 id 或單則紀錄自己的 id 都可以。
  - `checks`：`{ ids, reason }`，舊紀錄裡屬於「複查、沒有變動」的新聞項目。
  - `close`（已完成或被取代，附理由）與 `rewrite`（改寫過時的說法）：填卡片 id 或併進卡片的任一則的 id；只要卡片裡沒有其他項目在那一則之後又提到這件事就有效
    （有新的說法併進來，就以新的說法為準）；`rewrite` 之後的 digest 又提到時也以 digest 為準。
  - 寫錯的 id（`topics` / `checks` 對不到任何紀錄）會在 build 時印警告；警告不影響產出的檔案。
- 每份 digest 寫入後不再修改；舊 digest 沒有 `topic` / `check` / `merges` 也照樣有效（三個欄位都是選填）。

```bash
python3 tools/build_radar.py            # 產生 data/radar.json
python3 tools/build_radar.py --as-of 2026-10-10 --out /tmp/radar-1010.json   # 重建某一天的版本
```

### 每日版本（每一頁的日期選單）

日期就是版本，每一版都是「那一天結束時上線的完整資料」——仍然有效的舊項目加上當天新增的，不是當天的變動。

- 資料來源：research pipeline 的 `manifest.json` 有 `versions`（每天一筆：那天最後上線的 release，保留 30 天；
  llmops-research-agent 的 `releases.dated_versions`）。舊的 pointer 沒有這個欄位時，從發布紀錄推算。
- Amplify build：`tools/fetch_release.mjs` 抓今天（上線版本 → `data/`）與之前 29 個日曆天（各自的 release → `versions/<日期>/data/`；
  沒有發布的日子沿用前一天；同一個 release 在好幾天上線也只抓一次）；`tools/build_versions.py` 替每一天建當天的 Radar；`tools/build_site.mjs` 把它們放到
  `dist/data/versions/<日期>/`，並寫 `dist/data/versions.json`（選單的內容）。
- UI：`?v=<日期>` 寫在網址裡（例如 `#/models?v=2026-10-10`），切換頁面時保留；看舊版本時剩餘天數以那一天為準。
  `發布流程` 與模型頁的「內部測試」不分版本。沒有設定 `PORTAL_DATA_BASE_URL`（用 repo 的資料 build）時只有今天一版。

## 兩個版本：完整版與乾淨版

同一個 repo、同一個 main，Amplify 環境變數 `PORTAL_EDITION` 決定是哪一個（`tools/build_site.mjs`）：

| | 完整版（`full`，預設） | 乾淨版（`clean`） |
| --- | --- | --- |
| 給誰 | 平台團隊 | 公司裡需要知道最新 LLM 資訊的所有人 |
| 沒有的頁面 | — | 發布流程、LiteLLM 與安全、上手指南（網址會導回 Release Radar）；「方法與來源 → 測試方法」不顯示執行指令與文件支援矩陣；模型頁的 Onboarding 分頁與「發布關卡紀錄」按鈕；「AI 安全測試（示範・模擬資料）」 |
| 沒有的資料 | — | deep dive 的 `onboarding`、`data/litellm.json`、`config/`、`security-tests.html` |
| App 外殼 | `site/` | `site-clean/` |

改了 `web/` 之後重建兩個外殼：`cd web && npm install && npm run site`（`npm run build` 是完整版、`npm run build:clean` 是乾淨版，
`scripts/prebuilt-site.mjs` 把它們放進 `site/`、`site-clean/`）。部署方式（第二個 Amplify app、兩個 webhook、兩份 ui-verify）見
llmops-research-agent 的 `docs/portal-editions-and-tests.md`。

## 上線前測試結果（模型頁的「內部測試」，兩個版本都有）

模型頁的「內部測試」分頁依發布關卡分層顯示這個模型的實測：G3 API 相容性（`runs/compat`）、G4 效能（`runs/perf`）、G5 品質評測（尚無工具）、
G6 AI 安全測試（`runs/security`）。`--purpose pre-release` 的測試置頂，每層顯示最近一次的結論；
其他紀錄在下面。三個工具都有 `--purpose` 與 `--model-id`（`sec_suite.py` 是 `--model-ids <label>=<id>`），不給時以路由名稱比對模型。

### G6 AI 安全測試的發布

`sec_suite.py run` 的完整結果（`.cache/secsuite/results/<runId>.json`，含題目與回應全文）不會進 `runs/`。跑完後：

```bash
python3 tools/sec_suite.py publish <runId> --purpose pre-release \
    --model-ids "<UI 上的 label 或路由>=<catalog id>,..."     # runId 可用 latest
```

產生兩個檔案：

| 檔案 | 內容 | 哪個版本顯示 |
| --- | --- | --- |
| `runs/security/<runId>.json` | 彙總：每個項目（SEC-01 … SEC-16）的結論、計數、測什麼／怎麼判／及格標準、tokens | 兩個版本 |
| `runs/security/<runId>.cases.json` | 逐筆案例（公開版遮蔽）：結果、judge 理由的分類、延遲、tokens；只有內容風險 none／low 的資料集保留題目與回應 | 只有完整版（乾淨版 build 時刪掉這個檔） |

遮蔽規則：資料集在 `tools/secsuite/manifest.json` 的 `risk` 是 medium 以上、或 `publish: false`、或不在 manifest 裡的案例，
system／prompt／回應／judge 說明／tool 呼叫全部清空並標 `redacted: true`。schema、`tools/validate_data.py` 與 pipeline 都會擋下
未遮蔽的高風險案例和沒有 `public: true` 的檔案；`--summary-only` 只產生彙總。分頁只顯示這個模型那一欄（同一批的其他模型不並排）。

有 data plane（`PORTAL_DATA_BASE_URL`）時，網站讀的是 pipeline 的 release：測試結果要用 llmops-research-agent 的
`portalctl push --portal <這個 repo> --only runs` 發布，只 commit 到 `runs/` 不會出現在網站上。沒有 data plane 時，commit 到 main 的
`runs/` 就是網站的內容。

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
