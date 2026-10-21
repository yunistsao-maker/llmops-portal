import { EDITION, linkTo, loaders, useData } from "../data";
import { Documented } from "./GatewayCsp";

/**
 * 方法與來源 → 測試方法: how the team's own tests work (G3 API 相容性 incl. Gateway → CSP, G4 效能, G6 AI 安全), what
 * each case checks, how to run them and how a result reaches a model page. The results themselves are on each model
 * page's 「內部測試」 tab. The commands are shown in the full edition only.
 */

/** The cases of tools/compat_suite.py + tools/gateway_csp_check.py (tools/selftest.py checks that this list matches). */
export const CASES: [id: string, surface: string, required: boolean, what: string, gatewayCheckOnly?: boolean][] = [
  ["chat.basic", "Chat Completions", true, "最基本的請求有非空回應"],
  ["chat.system", "Chat Completions", false, "system prompt 被接受"],
  ["chat.stream", "串流", true, "SSE 串流有內容 chunk"],
  ["chat.stream_usage", "串流", false, "stream_options.include_usage：最後一個 chunk 帶 usage（成本追蹤需要）"],
  ["stream.finish", "串流", true, "串流結尾有 finish_reason 與 data: [DONE]", true],
  ["params.max_tokens", "參數", true, "max_tokens 被接受"],
  ["params.max_completion_tokens", "參數", false, "max_completion_tokens 被接受（或被正確轉換）"],
  ["params.temperature", "參數", false, "temperature=0：推理模型常拒收，gateway 應丟棄而不是回 400"],
  ["params.reasoning_effort", "推理", false, "reasoning_effort=low 被接受並有回應"],
  ["tools.auto", "Tool calling", true, "tool_choice=auto 時會呼叫工具"],
  ["tools.forced", "Tool calling", false, "指定函式的 tool_choice 真的呼叫該函式（不是被靜默降級為 auto）"],
  ["stream.tools", "Tool calling", false, "串流的 tool call delta 能組回完整的 JSON arguments", true],
  ["structured.json_schema", "Structured output", false, "response_format json_schema 回合法 JSON 且有必填欄位"],
  ["vision.image", "影像輸入", false, "data URL 影像能被讀取"],
  ["usage.cache", "Prompt caching", false, "重複的長前綴，第二次請求回報 cached tokens"],
  ["responses.basic", "Responses API", false, "/v1/responses 有文字輸出"],
  ["responses.tools", "Responses API", false, "/v1/responses 的 function tool 會被呼叫"],
  ["messages.basic", "Anthropic Messages", false, "/v1/messages 有 text block"],
  ["meta.response_model", "可觀測性", false, "回應帶 model 欄位（看得出 alias / fallback）"],
  ["gw.cost_header", "可觀測性", false, "回應帶 x-litellm-response-cost > 0（cost map 有這個模型）", true],
  ["gw.no_fallback", "可觀測性", false, "x-litellm-attempted-fallbacks 為 0（不是別的模型代答）", true],
  ["err.invalid_max_tokens", "錯誤對應", false, "max_tokens = -1 應回 4xx（不是 500 或 200）", true],
  ["err.unknown_tool", "錯誤對應", false, "指定不存在的工具應回 4xx", true],
  ["err.bad_image", "錯誤對應", false, "壞掉的影像應回 4xx", true],
];

const LAYERS: [gate: string, name: string, tool: string, what: string, out: string][] = [
  ["G3", "API 相容性（各路由）", "tools/compat_suite.py", "17 個案例逐條路由（gateway alias）測：哪些 API 功能可用、必要案例是否全過。", "runs/compat/"],
  ["G3", "Gateway → CSP 相容性", "tools/gateway_csp_check.py", "同一組案例（24 個）經 gateway 送一次、直連路由背後的 CSP 端點再送一次，把每個失敗歸因到 gateway 或 CSP / 模型，並算出相容性指標。", "runs/compat/（kind: gateway-csp）"],
  ["G4", "效能與容量", "tools/perf_probe.py", "固定 profile 與 effort，量 TTFT / TTFAT / ITL / TTLT、tok/s、錯誤率與 goodput。", "runs/perf/"],
  ["G5", "品質評測", "（尚無工具）", "之後以同樣方式放進 runs/ 就會出現在模型頁。", "—"],
  ["G6", "AI 安全測試", "tools/sec_suite.py", "SEC-01 … SEC-16，見「AI 安全測試目錄」分頁；只發布彙總與遮蔽過的逐筆案例。", "runs/security/"],
];

const ATTRIBUTION: [string, string][] = [
  ["ok", "經 gateway 通過。"],
  ["Gateway 造成", "經 gateway 失敗、直連 CSP 通過：LiteLLM 的轉換、drop_params 或 proxy 設定造成——修 gateway（升級版本、換 provider prefix、補 model_info）。"],
  ["CSP / 模型限制", "直連 CSP 也失敗：平台或模型本身不支援——在 client 端避開、設 drop_params，或改走別的 CSP 路由。"],
  ["無法歸因", "沒有直連基準（沒加 --direct，或原生 API 沒有對應的請求，例如 Bedrock InvokeModel 不是 SSE 串流）。"],
];

export default function TestMethods() {
  const documented = useData(loaders.providerCompatibility); // both editions (data/provider-compatibility.json)
  const full = EDITION === "full";
  return (
    <>
      <section className="card">
        <h2>測試分層</h2>
        <p className="note" style={{ marginTop: -6 }}>
          平台團隊在自己的 LiteLLM gateway 上量測的結果是發布關卡的證據。<b>結果放在各模型頁的「內部測試」分頁</b>（只顯示那個模型的路由）；
          這裡說明每一層怎麼測。指標的定義見 <a href={linkTo("methods/metrics")}>指標定義</a>。
        </p>
        <table>
          <thead><tr><th>關卡</th><th>測試</th><th>工具</th><th>測什麼</th><th>結果檔</th></tr></thead>
          <tbody>{LAYERS.map(([g, n, t, w, o]) => <tr key={n}><td className="mono">{g}</td><td><strong>{n}</strong></td><td className="mono">{t}</td><td>{w}</td><td className="mono">{o}</td></tr>)}</tbody>
        </table>
      </section>

      <section className="card">
        <h2>API 相容性的案例（G3）</h2>
        <p className="note" style={{ marginTop: -6 }}>標「必要」的案例是 G3 的門檻（必須全過）；標「Gateway → CSP」的只在 gateway_csp_check 裡跑。</p>
        <table>
          <thead><tr><th>案例</th><th>API 功能</th><th>檢查什麼</th></tr></thead>
          <tbody>
            {CASES.map(([id, surface, req, what, only]) => (
              <tr key={id}>
                <td><span className="mono">{id}</span>{req && <span className="tag P0" style={{ marginLeft: 6 }}>必要</span>}{only && <span className="tag tag-upd" style={{ marginLeft: 6 }}>Gateway → CSP</span>}</td>
                <td>{surface}</td><td>{what}</td>
              </tr>))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Gateway → CSP：失敗是誰造成的</h2>
        <p className="note" style={{ marginTop: -6 }}>
          每個案例經 gateway 送一次，再用路由背後 CSP 的原生端點（OpenAI 相容的 Chat Completions，或 Anthropic Messages：Foundry、Bedrock InvokeModel、
          Agent Platform rawPredict）送同一個請求。兩邊的結果比對後：
        </p>
        <dl className="kv" style={{ gridTemplateColumns: "150px 1fr" }}>
          {ATTRIBUTION.map(([k, v]) => [<dt key={k}>{k}</dt>, <dd key={k + "d"}>{v}</dd>])}
        </dl>
        <p className="note">
          另外量 HTTP 200 但違反約定的「靜默降級」、無效請求是否回 4xx（錯誤對應）、x-litellm-response-cost 與 fallback 標頭、以及 gateway 與直連的延遲差、prompt token 差。
          直連必須和 gateway 走同一個模型、區域與部署，否則差異來自別的地方。
        </p>
        {full && (
          <pre className="code">{`export LITELLM_API_KEY=sk-...  AWS_BEARER_TOKEN_BEDROCK=...  AZURE_API_KEY=...
export GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token)
python3 tools/gateway_csp_check.py --gateway <GW>/v1 --routes-file gateway-routes.yaml --direct \\
  --samples 5 --litellm-version <版本> --purpose pre-release \\
  --out runs/compat/$(date +%F)-gateway-csp.json --fail-on-required
# 路由檔範本：tools/fixtures/gateway-routes.example.yaml（每條 alias 標 modelId、CSP、區域與直連端點；金鑰只從環境變數讀）`}</pre>)}
      </section>

      {full && (
        <section className="card">
          <h2>執行與發布</h2>
          <p className="note" style={{ marginTop: -6 }}>
            上線前的測試加 <span className="mono">--purpose pre-release</span>（模型頁置頂）與 <span className="mono">--model-id</span>（或在路由檔寫 modelId），結果才會掛到正確的模型。
          </p>
          <pre className="code">{`python3 tools/compat_suite.py --gateway <GW>/v1 --routes <id>,<id>@bedrock --purpose pre-release --model-id <id> \\
  --litellm-version <版本> --out runs/compat/$(date +%F)-<id>.json
python3 tools/perf_probe.py --gateway <GW>/v1 --route <id> --purpose pre-release --model-id <id> \\
  --profile zh-tw --effort medium --concurrency 4 --requests 40 --out runs/perf/$(date +%F)-<id>.json
python3 tools/sec_suite.py run --gateway <GW>/v1 --routes <id> --purpose pre-release --model-ids <id>=<id> --publish-summary
# 發布（網站從 data-plane release 建置）：在 llmops-research-agent 執行
portalctl push --portal <portal repo> --only runs --note "<模型> 上線前測試"`}</pre>
        </section>)}

      {documented.data && <Documented doc={documented.data} />}
    </>
  );
}
