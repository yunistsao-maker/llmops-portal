import type { CompatRun, Percentiles, PerfRun } from "../../../schema/types";
import { fmt } from "../data";

/**
 * The detailed views of the team's own test results (runs/compat, runs/perf), shown on each model page's 「內部測試」
 * tab for that model's routes only.
 */
const STATUS: Record<string, [string, string]> = { pass: ["通過", "pass"], fail: ["失敗", "fail"], error: ["錯誤", "error"], skip: ["略過", "skipped"] };

/** One compatibility run, case by case, for the given routes (a gateway alias per column). */
export function CompatCaseTable({ run, routes }: { run: CompatRun; routes: string[] }) {
  const sums = run.summary.filter((s) => routes.includes(s.route));
  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "12px 0" }}>
        {sums.map((s) => (
          <div key={s.route} className="card" style={{ padding: 16, minWidth: 200, boxShadow: "none", border: "1px solid var(--line2)" }}>
            <div className="mono" style={{ fontWeight: 500 }}>{s.route}</div>
            <div style={{ fontSize: 14, marginTop: 6 }}><span className="pass">{s.pass} 通過</span> · <span className="fail">{s.fail} 失敗</span> · <span className="error">{s.error} 錯誤</span> · {s.skip} 略過</div>
            {s.requiredFailures.length > 0 ? <div className="fail" style={{ fontSize: 13, marginTop: 4 }}>必要案例失敗：{s.requiredFailures.join("、")}</div> : <div className="note" style={{ marginTop: 4 }}>必要案例全數通過</div>}
          </div>))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>案例</th>{routes.map((r) => <th key={r} className="mono">{r}</th>)}</tr></thead>
          <tbody>
            {run.cases.map((c) => (
              <tr key={c.id}>
                <td><span className="mono">{c.id}</span>{c.required && <span className="tag P0" style={{ marginLeft: 6 }}>必要</span>}<div className="note">{c.title}</div></td>
                {routes.map((r) => {
                  const res = run.results.find((x) => x.route === r && x.caseId === c.id);
                  if (!res) return <td key={r} className="note">—</td>;
                  const [label, cls] = STATUS[res.status];
                  return <td key={r}><span className={cls}>{label}</span>{res.httpStatus && <span className="note"> {res.httpStatus}</span>}{res.latencyMs !== undefined && <span className="note"> · {fmt(res.latencyMs)} ms</span>}{res.detail && res.status !== "pass" && <div className="note" style={{ maxWidth: 260 }}>{res.detail}</div>}</td>;
                })}
              </tr>))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function PerfCard({ r, mock }: { r: PerfRun; mock: boolean }) {
  const m = r.metrics;
  const row = (label: string, p: Percentiles, unit: string, d = 0) => (
    <tr><td>{label}</td><td className="mono">{fmt(p.p50, d)}</td><td className="mono">{fmt(p.p90, d)}</td><td className="mono">{fmt(p.p99, d)}</td><td className="mono">{fmt(p.mean, d)}</td><td className="note">{unit} · n={p.n}</td></tr>);
  return (
    <details open>
      <summary><span className="mono">{r.route}</span> · {r.profile.name} · effort {r.profile.reasoningEffort ?? "—"} · 並行 {r.profile.concurrency} × {r.profile.requests} 次 · {r.startedAt.slice(0, 16).replace("T", " ")} {mock && <span className="verif weak">模擬資料</span>}</summary>
      <div className="row" style={{ marginTop: 12 }}>
        <div className="grow">
          <table>
            <thead><tr><th>指標</th><th>p50</th><th>p90</th><th>p99</th><th>平均</th><th></th></tr></thead>
            <tbody>
              {row("TTFT（首 token）", m.ttftMs, "ms")}
              {row("TTFAT（首答案 token）", m.ttfatMs, "ms")}
              {row("ITL（token 間隔）", m.itlMs, "ms", 1)}
              {row("TTLT（完整回應）", m.ttltMs, "ms")}
              {row("單請求輸出速度", m.outputTokensPerSec, "tok/s", 1)}
            </tbody>
          </table>
        </div>
        <dl className="kv side" style={{ gridTemplateColumns: "150px 1fr", alignContent: "start" }}>
          <dt>總輸出速度</dt><dd className="mono">{fmt(m.aggregateOutputTokensPerSec, 1)} tok/s</dd>
          <dt>RPS</dt><dd className="mono">{fmt(m.requestsPerSec, 2)}</dd>
          <dt>錯誤率</dt><dd className="mono" style={{ color: m.errorRate > 0 ? "var(--danger)" : undefined }}>{fmt(m.errorRate * 100, 1)}%</dd>
          {m.goodputPct !== undefined && <><dt>Goodput（符合 SLO）</dt><dd className="mono">{fmt(m.goodputPct, 1)}%</dd></>}
          {r.slo && <><dt>SLO</dt><dd className="mono">TTFAT ≤ {fmt(r.slo.ttfatMs)} ms · TTLT ≤ {fmt(r.slo.ttltMs)} ms</dd></>}
          <dt>Tokens</dt><dd className="mono">in {fmt(r.usage.inputTokens)} · out {fmt(r.usage.outputTokens)} · 推理 {fmt(r.usage.reasoningTokens)} · 快取 {fmt(r.usage.cachedInputTokens)}</dd>
          <dt>量測位置</dt><dd>{r.clientLocation ?? "—"}</dd>
        </dl>
      </div>
      {r.notes.length > 0 && <ul className="bullets">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
    </details>);
}
