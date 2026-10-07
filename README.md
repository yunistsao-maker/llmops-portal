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
  digests/2026-09-24.json  第一份雷達摘要（每週排程任務會新增）
  sources.json             所有來源（125 筆），其他檔以 id 引用
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
  build_site.mjs           組出 dist/：site/ + data/ + runs/ + config/，並產生 data/manifest.json
runs/compat, runs/perf    測試結果（UI「測試結果」頁讀取，由 manifest 列出）
site/                     已 build 好的 portal UI（2026-10-06 portal-dist；只有編譯後的 JS）
web/                      舊版 React 原型原始碼（Amplify 已不再使用）
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
| 首頁 / Release Radar | `digests/*.json`（最新一份）、`lifecycle.json` | headline、行動項目、最近 90 天退役倒數 |
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

平台清單（「我們平台上有哪些模型、何時退役」）：

```bash
export LITELLM_MASTER_KEY=sk-...
python3 tools/sync_inventory.py --gateway https://llm-gateway.example.internal
```

Azure 部署名稱是自訂的，請在 LiteLLM 設定的 `model_info` 加 `base_model`（例：`azure/gpt-4o`）與 `model_version`（例：`2024-11-20`），否則會被標成 `unknown` 或以最早日期保守計算。

## 資料更新流程（建議）

每週排程研究任務（週一 09:00 台北）會產出新的 digest 與資料更新草稿，並寫回 claude.ai Project「3P New Model Release Research」。建議流程：

1. 排程任務產出 → 2. 開 PR 到 portal repo 的 `data/` → 3. 平台團隊審核（特別是 community / unverified）→ 4. `npm run validate` 通過後合併 → 5. UI 自動更新。

網路研究會出錯，也會漏掉 CSP 帳號層級的資訊，所以另外建議在內部 CI 每日用 CSP API 核對生命週期（Bedrock `ListFoundationModels` 的 `modelLifecycle`、Azure 退役表、Agent Platform 模型版本頁）。

## 已知限制（2026-09-24）

- GPT-6 Sol / Luna 在 Bedrock 的價格與區域取自社群 PR（官方模型卡尚未發布）。
- GPT-6 Astra 在 Azure 的退役日官方表尚未列入。
- Gemini 2.5 在 Agent Platform 的 10-20 封鎖規則與 2027 停止服務日，取自公開 GitHub issue 轉述的 Google 客戶通知（Agent Platform 文件頁是 JS 渲染，無法直接讀取）；`gemini-2.5-flash-image` 延到 2027-03-15 取自第三方轉載的 release note。
- Gemini 3.8 Flash 在 Agent Platform 的區域與價格取自第三方追蹤。
- `platformStatus` 全部預設為 `evaluating`——這是你們平台的決策欄位，請依發布關卡結果更新。
- 範例 gateway 網址、支援窗口與資料分級政策都是佔位內容，請換成公司實際值。
