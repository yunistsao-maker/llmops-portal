# LLMOps Portal — new UI (llm-ops-frontend)

A static, read-only site built from the "LLMOps Portal UI 版本" design (總覽 / 模型 × 雲端矩陣 / 導入看板 / 模型頁).
No backend and no browser storage: the page loads `data/ui.json` from the same site and renders it with plain JavaScript.

| Route | Page |
|---|---|
| `#/` | 總覽：本期重點、這週三件事、KPI、本期動態、30 天內退役、依用途挑模型、開放權重、內部測試、申請流程 |
| `#/models` | 模型 × 雲端矩陣（上架與價格 / 台北與駐留；旗艦 / 主力 / 輕量）＋同價位 AA 分數比較 |
| `#/adoption` | 導入看板：需要決策、待辦與期限、關卡看板（G0–G10）、每個模型的關卡進度 |
| `#/model/<id>` | 模型頁：KPI、三雲比較、內部測試、成本試算、行為變更、可取代的退役模型、相關動態 |

## Data: two schemas

- **Research data (old-UI schema)** — `data/*.json`, `data/digests/*`, `data/models/*`, `runs/*`, validated against
  `schema/llmops.schema.json` (`tools/validate_data.py`, `tools/validate.mjs`). The previous portal (main) reads these.
- **UI view model (new-UI schema)** — `frontend/data/ui.json`, schema `llmops-ui/v1` in `schema/ui.schema.json`.
  Generated, never hand-edited:

```bash
python3 tools/build_ui_data.py           # regenerate frontend/data/ui.json from the research data
node tools/validate_ui.mjs               # schema + cross-reference check
python3 tools/build_frontend.py          # assemble dist-frontend/
python3 -m http.server -d dist-frontend 8080
```

`frontend/ui-curation.json` holds the few hand-written UI items the research data does not carry (the week's three
priorities, the decisions list, and availability that is only in the digest, e.g. GPT-6 private preview on GCP).

Gate states on the adoption board are derived, not approvals: G1 is done when a deep dive exists; G2 is "in progress"
after research (approval records are not wired in yet); G6 follows the latest security run; G7 is "in progress" when list
prices exist.

## Deploy (AWS Amplify, static)

`amplify.yml` on this branch validates both schemas and serves `dist-frontend/`; `customHttp.yml` adds CSP and
security headers. Create a new Amplify app → GitHub → this repo → branch `llm-ops-frontend`; no backend environment.
