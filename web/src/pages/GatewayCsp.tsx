import type { CompatResult, CompatRun, GatewayRouteMetrics, ProviderCompatibility } from "../../../schema/types";
import { fmt } from "../data";
import { Sources, Verif } from "../ui";

/**
 * Gateway → CSP: does each API feature survive the trip through the LiteLLM gateway to Bedrock / Foundry / Agent Platform,
 * and when it does not, is it the gateway or the provider? `Measured` shows a run of tools/gateway_csp_check.py (CompatRun
 * kind "gateway-csp") for one model's routes on its 「內部測試」 tab; `Documented` is what the LiteLLM docs say
 * (litellm.json providerCompatibility), on 方法與來源 → 測試方法.
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

/** Per-CSP totals of some routes' metrics (the run's own byCsp counts every route of the run, other models too). */
function cspCards(rows: GatewayRouteMetrics[]) {
  const by = new Map<string, GatewayRouteMetrics[]>();
  rows.forEach((r) => by.set(r.csp, [...(by.get(r.csp) ?? []), r]));
  const mean = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const median = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
  return [...by].map(([csp, rs]) => {
    const applicable = rs.reduce((n, r) => n + r.applicable, 0), pass = rs.reduce((n, r) => n + r.pass, 0);
    return { csp, routes: rs.length, applicable, pass, compatibilityRate: applicable ? pass / applicable : null, requiredPassRate: mean(rs.map((r) => r.requiredPassRate)),
             gatewayInduced: rs.reduce((n, r) => n + r.gatewayInduced, 0), providerLimited: rs.reduce((n, r) => n + r.providerLimited, 0),
             silentDegradations: rs.reduce((n, r) => n + r.silentDegradations, 0), errorMappingRate: mean(rs.map((r) => r.errorMappingRate)),
             costTrackingRate: mean(rs.map((r) => r.costTrackingRate)), overheadMsP50: median(rs.map((r) => r.overheadMs.p50)) };
  });
}

/** A gateway-csp run, limited to `routes` (one model's gateway aliases). */
export function Measured({ run, routes }: { run: CompatRun; routes: string[] }) {
  const keep = new Set(routes);
  const byRoute = (run.metrics?.byRoute ?? []).filter((r) => keep.has(r.route));
  const m = run.metrics ? { byRoute, byCsp: cspCards(byRoute), bySurface: run.metrics.bySurface } : undefined;
  const info = new Map((run.routeInfo ?? []).map((r) => [r.route, r]));
  const res = (route: string, caseId: string) => run.results.find((x) => x.route === route && x.caseId === caseId);
  const surfaces = m?.bySurface ?? [];
  const problems = run.results.filter((r) => keep.has(r.route) && r.status !== "pass" && r.status !== "skip");
  run = { ...run, routes: run.routes.filter((r) => keep.has(r)) };
  return (
    <>
      <p className="note">
        {run.startedAt.slice(0, 16).replace("T", " ")} UTC · gateway {run.gateway} · LiteLLM {run.litellmVersion ?? "未標示"} ·
        基準 {run.baseline === "direct" ? "直連 CSP" : "沒有（只跑 gateway）"}{run.purpose && <> · {run.purpose}</>}{" "}
        {isMock(run.gateway) && <span className="verif weak">模擬資料</span>}
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

export function Documented({ doc }: { doc: ProviderCompatibility }) {
  const cell = (p: string, s: string) => doc.cells.find((c) => c.provider === p && c.surface === s);
  return (
    <section className="card">
      <div className="pagehead"><h2 style={{ margin: 0 }}>依公開文件：LiteLLM 各 provider 的支援範圍</h2><span className="note">資料日期 {doc.asOf}</span></div>
      <p className="note">
        依 LiteLLM 與各 CSP 的官方文件整理，<b>不是實測</b>：各模型的實測在模型頁的「內部測試」分頁；兩者不一致時以實測為準，並回報給維護這份資料的人。
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
