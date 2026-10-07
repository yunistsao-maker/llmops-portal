# LLMOps Portal（React 原型）

Vite + React 18 + TypeScript。型別直接引用 `../schema/types.ts`，資料來自 `../data/`（啟動時複製到 `public/data/`）。

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # 產出 dist/，可放任何靜態主機（S3 + CloudFront 等）
```

頁面（hash 路由）：
- `#/`              Release Radar（最新 digest、行動項目、新模型、watchlist）
- `#/models`        模型目錄（依雲端篩選）
- `#/models/<id>`   模型頁：概覽、三雲與 API、效能與指數、價格、LiteLLM、Onboarding
- `#/eol`           平台清單與 EOL（讀 `data/internal/platform-inventory.json`，沒有時用 example）

更新資料：改 `../data/*.json` → `npm run validate`（在上層）→ 重新 `npm run dev` / `build`。
新增週報時，把日期加進 `src/data.ts` 的 `DIGESTS`。
樣式在 `src/styles.css` 的 CSS 變數，換品牌色只改 `:root`。
