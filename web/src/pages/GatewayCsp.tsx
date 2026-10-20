import { useState } from "react";
import type { CompatResult, CompatRun, GatewayRouteMetrics, LiteLLMFile, ProviderCompatibility } from "../../../schema/types";
import { fmt, linkTo } from "../data";
import { Sources, Verif } from "../ui";

/**
 * 測試結果 → Gateway → CSP: does each API feature survive the trip through the LiteLLM gateway to Bedrock / Foundry /
 * Agent Platform, and when it does not, is it the gateway or the provider? Measured runs (tools/gateway_csp_check.py,
 * CompatRun kind "gateway-csp") next to what the documentation says (litellm.json providerCompatibility).
 */

const CSP_LABEL: Record<string, string> = { aws: "AWS", azure: "Azure", gcp: "Google Cloud", "vendor-direct": "Vendor API", unknown: "未知" };
const ATTR: Record<string, [string, string]> = {
  ok: ["正常", "pass"], gateway: ["Gateway 造成", "fail"], provider: ["CSP / 模型限制", "error"], unknown: ["無法歸因（沒有直連基準）", "skipped"],
};
const DOC: Record<string, [string, string]> = {
  supported: ["支援", "pass"], partial: ["部分", "error"], "not-supported": ["不支援", "fail"], unknown: ["未知", "skipped"],
};
const pctOf = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? "—" : `${fmt(v * 100, d)}%`);
const isMock = (gw: string) => /127\.0\.0\.1|localhost|mock/i.test(gw);

/** The metrics shown here, in the words of requirements.json → metricDefinitions (方法與來源). */
const METRICS: [string, string][] = [
  ["相容率", "適用案例中通過的比例（略過不算）。必要案例的通過率是發布關卡 G3 的門檻：100%。"],
  ["Gateway 造成", "經 gateway 失敗、但同一個請求直連 CSP 通過：LiteLLM 的轉換、drop_params 或 proxy 設定造成，修 gateway。"],
  ["CSP / 模型限制", "直連 CSP 也失敗：是平台或模型本身不支援，gateway 無能為力（要在 client 端避開或換路由）。"],
  ["靜默降級", "HTTP 200、但回應違反了請求的約定（forced tool_choice 變成 auto、沒有 JSON、沒有 usage）：最危險，因為 client 不會報錯。"],
  ["錯誤對應率", "刻意送出的無效請求，有幾成得到 4xx 與 OpenAI 格式的 error（5xx 會讓 client 重試、200 會讓錯誤被吞掉）。"],
  ["成本追蹤率", "回應帶有 x-litellm-response-cost > 0 的比例：低於 100% 代表 cost map 缺這個模型或價格為 0，FinOps 報表會失準。"],
  ["Fallback 率", "回應帶有 x-litellm-attempted-fallbacks > 0 的比例：使用者以為呼叫的是 A，其實是 B 回答。"],
  ["延遲開銷", "同一個請求經 gateway 與直連 CSP 的延遲差（p50 / p95，非串流）；TTFT 開銷是第一個串流內容的時間差。"],
  ["Prompt token 差異", "同一個請求 gateway 與 CSP 回報的 prompt_tokens 差距（%）：成本計算的偏差來源。"],
];

export default function GatewayCsp({ runs, files, litellm }: { runs: CompatRun[]; files: string[]; litellm?: LiteLLMFile }) {
  const mine = runs.map((r, i) => ({ r, f: files[i] })).filter((x) => x.r.kind === "gateway-csp").sort((a, b) => (a.r.startedAt < b.r.startedAt ? 1 : -1));
  const [pick, setPick] = useState(0);
  const cur = mine[pick];
  return (
    <>
      <div className="empty">
        把同一組請求<b>經 LiteLLM gateway</b> 與<b>直連 CSP</b>（Bedrock、Foundry、Agent Platform 各自的原生端點）各送一次，
        判斷每一項 API 功能是否正常，以及失敗時是 gateway 造成、還是 CSP / 模型本身的限制。結果是 <span className="mono">runs/compat/</span> 裡
        <span className="mono"> kind: "gateway-csp"</span> 的紀錄，也會算進各模型頁的「內部測試」（G3）。在你們的網路裡執行：
        <pre className="code">{`export LITELLM_API_KEY=sk-...   AWS_BEARER_TOKEN_BEDROCK=...   AZURE_API_KEY=...
export GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token)
python3 tools/gateway_csp_check.py --gateway <GW>/v1 \\
  --routes-file gateway-routes.yaml --direct --litellm-version <版本> --purpose regression \\
  --out runs/compat/$(date +%F)-gateway-csp.json --fail-on-required`}</pre>
        路由檔的格式見 <span className="mono">tools/fixtures/gateway-routes.example.yaml</span>（每條 alias 標明 CSP、區域與直連端點；金鑰只從環境變數讀，不會寫進結果）。
        沒有 <span className="mono">--direct</span> 時只跑 gateway 端，失敗會標成「無法歸因」。
      </div>

      <section className="card">
        <div className="pagehead">
          <h2 style={{ margin: 0 }}>實測：Gateway → CSP</h2>
          {mine.length > 0 && (
            <label className="note">執行紀錄{" "}
              <select value={pick} onChange={(e) => setPick(Number(e.target.value))}>
                {mine.map((x, i) => <option key={x.r.runId} value={i}>{x.f}</option>)}
              </select></label>)}
        </div>
        {!cur ? <p className="note">還沒有 gateway → CSP 的實測紀錄。下面的「依公開文件」矩陣是目前唯一的參考——跑一次上面的指令，結果就會出現在這裡。</p> : <Measured run={cur.r} />}
      </section>

      {litellm?.providerCompatibility && <Documented doc={litellm.providerCompatibility} runs={mine.map((x) => x.r)} />}

      <section className="card">
        <h2>指標定義</h2>
        <dl className="kv" style={{ gridTemplateColumns: "150px 1fr" }}>
          {METRICS.map(([k, v]) => <><dt key={k}>{k}</dt><dd key={k + "d"}>{v}</dd></>)}
        </dl>
        <p className="note">完整定義與量測陷阱在 <a href={linkTo("methods")}>方法與來源</a>。延遲開銷只用兩邊都成功的請求計算；直連的基準必須和 gateway 走同一個區域與部署，否則差異包含了網路距離。</p>
      </section>
    </>
  );
}

function Measured({ run }: { run: CompatRun }) {
  const m = run.metrics;
  const info = new Map((run.routeInfo ?? []).map((r) => [r.route, r]));
  const res = (route: string, caseId: string) => run.results.find((x) => x.route === route && x.caseId === caseId);
  const surfaces = m?.bySurface ?? [];
  const problems = run.results.filter((r) => r.status !== "pass" && r.status !== "skip");
  return (
    <>
      <p className="note">
        {run.startedAt.slice(0, 16).replace("T", " ")} UTC · gateway {run.gateway} · LiteLLM {run.litellmVersion ?? "未標示"} ·
        基準 {run.baseline === "direct" ? "直連 CSP" : "沒有（只跑 gateway）"}{run.purpose && <> · {run.purpose}</>}{" "}
        {isMock(run.gateway) && <span className="verif weak">模擬資料：對 tools/mock_gateway.py 跑的範例，不代表任何模型或 CSP 的真實表現</span>}
      </p>

      {m && (
        <div className="stats" style={{ marginTop: 12 }}>
          {m.byCsp.map((c) => (
            <div key={c.csp} className="card stat" style={{ minWidth: 230 }}>
              <div className="eyebrow">{CSP_LABEL[c.csp] ?? c.csp} · {c.routes} 條路由</div>
              <div className="v">{pctOf(c.compatibilityRate)}</div>
              <div className="note">相容率（{c.pass}/{c.applicable}）· 必要案例 {pctOf(c.requiredPassRate)}</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>
                <span className={c.gatewayInduced ? "fail" : "pass"}>Gateway 造成 {c.gatewayInduced}</span> · <span className={c.providerLimited ? "error" : "pass"}>CSP 限制 {c.providerLimited}</span> ·{" "}
                <span className={c.silentDegradations ? "fail" : "pass"}>靜默降級 {c.silentDegradations}</span>
              </div>
              <div className="note">錯誤對應 {pctOf(c.errorMappingRate)} · 成本追蹤 {pctOf(c.costTrackingRate)} · 延遲開銷 p50 {c.overheadMsP50 === null ? "—" : `${fmt(c.overheadMsP50)} ms`}</div>
            </div>))}
        </div>)}

      {m && (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table>
            <thead><tr><th>路由</th><th>CSP · 區域</th><th>相容率</th><th>必要</th><th>Gateway 造成</th><th>CSP 限制</th><th>靜默降級</th><th>錯誤對應</th><th>成本追蹤</th><th>Fallback</th><th>延遲開銷 p50 / p95</th><th>TTFT 開銷 p50</th><th>Prompt token 差異</th></tr></thead>
            <tbody>
              {m.byRoute.map((r: GatewayRouteMetrics) => {
                const ri = info.get(r.route);
                return (
                  <tr key={r.route}>
                    <td className="mono">{r.route}{ri?.modelId && <div className="note">{ri.modelId}</div>}</td>
                    <td>{CSP_LABEL[r.csp] ?? r.csp} · {r.service}{ri?.region && <div className="note">{ri.region}{ri.direct && ` · 基準 ${ri.direct.protocol}`}</div>}</td>
                    <td className="mono">{pctOf(r.compatibilityRate)}</td>
                    <td className={r.requiredPassRate === 1 ? "pass" : "fail"}>{pctOf(r.requiredPassRate)}</td>
                    <td className={r.gatewayInduced ? "fail" : "pass"}>{r.gatewayInduced}</td>
                    <td className={r.providerLimited ? "error" : "pass"}>{r.providerLimited}</td>
                    <td className={r.silentDegradations ? "fail" : "pass"}>{r.silentDegradations}<span className="note"> ({pctOf(r.silentDegradationRate, 1)})</span></td>
                    <td className="mono">{pctOf(r.errorMappingRate)}</td>
                    <td className="mono">{pctOf(r.costTrackingRate)}</td>
                    <td className="mono">{pctOf(r.fallbackRate)}</td>
                    <td className="mono">{r.overheadMs.n ? `${fmt(r.overheadMs.p50)} / ${fmt(r.overheadMs.p95)} ms` : "—"}<span className="note"> n={r.overheadMs.n}</span></td>
                    <td className="mono">{r.ttftOverheadMs.n ? `${fmt(r.ttftOverheadMs.p50)} ms` : "—"}</td>
                    <td className="mono">{r.promptTokenDeltaPct === null ? "—" : `${fmt(r.promptTokenDeltaPct, 1)}%`}</td>
                  </tr>);
              })}
            </tbody>
          </table>
        </div>)}

      <h3 style={{ marginTop: 20 }}>API 功能 × 路由</h3>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>功能</th>{run.routes.map((r) => <th key={r} className="mono" style={{ maxWidth: 180 }}>{r}</th>)}</tr></thead>
          <tbody>
            {surfaces.map((s) => {
              const cases = run.cases.filter((c) => c.surface === s.surface);
              return (
                <tr key={s.surface}>
                  <td>{s.title}<div className="note mono">{cases.map((c) => c.id).join(" · ")}</div></td>
                  {run.routes.map((route) => {
                    const rs = cases.map((c) => res(route, c.id)).filter((x): x is CompatResult => !!x);
                    const appl = rs.filter((x) => x.status !== "skip");
                    const ok = appl.filter((x) => x.status === "pass").length;
                    const bad = appl.filter((x) => x.status !== "pass");
                    if (!appl.length) return <td key={route} className="skipped">略過</td>;
                    return (
                      <td key={route}>
                        <span className={bad.length ? "fail" : "pass"}>{ok}/{appl.length}</span>
                        {bad.map((b) => <div key={b.caseId} className="note"><span className="mono">{b.caseId}</span> · <span className={ATTR[b.attribution ?? "unknown"][1]}>{ATTR[b.attribution ?? "unknown"][0]}</span>{b.silent && " · 靜默"}</div>)}
                      </td>);
                  })}
                </tr>);
            })}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 20 }}>需要處理的項目（{problems.length}）</h3>
      {problems.length === 0 ? <p className="note">全部通過。</p> : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>路由</th><th>案例</th><th>經 gateway</th><th>直連 CSP</th><th>判斷</th><th>說明</th></tr></thead>
            <tbody>
              {problems.map((p) => (
                <tr key={p.route + p.caseId}>
                  <td className="mono">{p.route}</td>
                  <td className="mono">{p.caseId}</td>
                  <td><span className={p.status === "error" ? "error" : "fail"}>{p.status}</span>{p.httpStatus !== undefined && <span className="note"> HTTP {p.httpStatus}</span>}{p.silent && <div className="fail" style={{ fontSize: 12 }}>靜默降級</div>}</td>
                  <td>{p.direct ? <><span className={p.direct.status === "pass" ? "pass" : p.direct.status === "skip" ? "skipped" : "fail"}>{p.direct.status}</span>{p.direct.httpStatus !== undefined && <span className="note"> HTTP {p.direct.httpStatus}</span>}</> : <span className="note">—</span>}</td>
                  <td><span className={ATTR[p.attribution ?? "unknown"][1]}>{ATTR[p.attribution ?? "unknown"][0]}</span></td>
                  <td className="note" style={{ maxWidth: 380 }}>{p.detail}</td>
                </tr>))}
            </tbody>
          </table>
        </div>)}
    </>
  );
}

function Documented({ doc, runs }: { doc: ProviderCompatibility; runs: CompatRun[] }) {
  const cell = (p: string, s: string) => doc.cells.find((c) => c.provider === p && c.surface === s);
  const measured = runs.length > 0;
  return (
    <section className="card">
      <div className="pagehead"><h2 style={{ margin: 0 }}>依公開文件：LiteLLM 各 provider 的支援範圍</h2><span className="note">資料日期 {doc.asOf}</span></div>
      <p className="note">
        依 LiteLLM 與各 CSP 的官方文件整理，<b>不是實測</b>{measured ? "；和上面的實測不一致時，以實測為準，並回報給維護這份資料的人" : "；在你們的 gateway 跑過上面的實測之前，這是唯一的參考"}。
        「部分」代表有條件（某些模型、需要特定 prefix 或設定）——看格子裡的說明。
      </p>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>功能</th>{doc.providers.map((p) => <th key={p.id}>{p.title}<div className="note mono">{p.litellmPrefix}</div></th>)}</tr></thead>
          <tbody>
            {doc.surfaces.map((s) => (
              <tr key={s.id}>
                <td>{s.title}</td>
                {doc.providers.map((p) => {
                  const c = cell(p.id, String(s.id));
                  if (!c) return <td key={p.id} className="skipped">—</td>;
                  const [label, cls] = DOC[c.status];
                  return (
                    <td key={p.id} style={{ maxWidth: 240 }}>
                      <span className={cls}>{label}</span> <Verif v={c.verification} /> <Sources refs={c.sources} />
                      {c.note && <div className="note">{c.note}</div>}
                    </td>);
                })}
              </tr>))}
          </tbody>
        </table>
      </div>
      {doc.knownIssues && doc.knownIssues.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>上游已知問題（{doc.knownIssues.length}）</h3>
          <ul className="bullets">
            {doc.knownIssues.map((k) => (
              <li key={k.title}><b>{k.title}</b> <span className="note">· {k.provider} · {k.surface} · {k.state === "open" ? "未解決" : "已關閉"}{k.date && ` · ${k.date}`}</span> <Sources refs={k.sources} /><div className="note">{k.summary}</div></li>))}
          </ul>
        </>)}
    </section>
  );
}
