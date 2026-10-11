import { useState } from "react";
import type { Percentiles, PerfRun } from "../../../schema/types";
import { fmt, loaders, useData } from "../data";
import { Empty, PageHead, Status } from "../ui";

const STATUS: Record<string, [string, string]> = { pass: ["通過", "pass"], fail: ["失敗", "fail"], error: ["錯誤", "error"], skip: ["略過", "skipped"] };

export default function Tests() {
  const compat = useData(loaders.compatRuns);
  const perf = useData(loaders.perfRuns);
  const manifest = useData(loaders.manifest);
  const [ci, setCi] = useState(0);
  if (!compat.data || !perf.data || !manifest.data) return <Status error={compat.error || perf.error || manifest.error} />;
  const run = compat.data[ci];
  const isMock = (name: string) => name.includes("mock");
  return (
    <>
      <PageHead eyebrow="runs/compat 與 runs/perf（由 tools/ 產生）" title="測試結果" />
      <Empty>
        內部實測是發布關卡 G2（相容性）與 G3（效能）的證據。在你們的 gateway 上執行後把 JSON 放進 <span className="mono">runs/</span>，重新 build 就會出現在這裡：
        <pre className="code">{`python3 tools/compat_suite.py --gateway <GW>/v1 --routes claude-opus-5-5,claude-opus-5-5@vertex \\
  --litellm-version v1.102.1 --out runs/compat/$(date +%F)-opus55.json
python3 tools/perf_probe.py --gateway <GW>/v1 --route claude-opus-5-5 --profile zh-tw \\
  --effort medium --concurrency 4 --requests 40 --slo-ttfat-ms 8000 --slo-ttlt-ms 60000 \\
  --client-location "Taipei HQ" --out runs/perf/$(date +%F)-opus55-zh-tw.json`}</pre>
        目前顯示的 example-mock 是對模擬 gateway 跑的範例，用來示範版面，不代表任何模型的真實表現。
      </Empty>

      <section className="card">
        <div className="pagehead">
          <h2 style={{ margin: 0 }}>API 相容性</h2>
          {compat.data.length > 0 && (
            <label className="note">執行紀錄{" "}
              <select value={ci} onChange={(e) => setCi(Number(e.target.value))}>
                {compat.data.map((r, i) => <option key={r.runId} value={i}>{manifest.data!.compatRuns[i]}</option>)}
              </select></label>)}
        </div>
        {!run ? <p className="note">還沒有相容性測試紀錄。</p> : (
          <>
            <p className="note">{run.startedAt} · gateway {run.gateway} · LiteLLM {run.litellmVersion ?? "未標示"} {isMock(manifest.data.compatRuns[ci]) && <span className="verif weak">模擬資料</span>}</p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "12px 0" }}>
              {run.summary.map((s) => (
                <div key={s.route} className="card" style={{ padding: 16, minWidth: 200, boxShadow: "none", border: "1px solid var(--line2)" }}>
                  <div className="mono" style={{ fontWeight: 500 }}>{s.route}</div>
                  <div style={{ fontSize: 14, marginTop: 6 }}><span className="pass">{s.pass} 通過</span> · <span className="fail">{s.fail} 失敗</span> · <span className="error">{s.error} 錯誤</span> · {s.skip} 略過</div>
                  {s.requiredFailures.length > 0 ? <div className="fail" style={{ fontSize: 13, marginTop: 4 }}>必要案例失敗：{s.requiredFailures.join("、")}</div> : <div className="note" style={{ marginTop: 4 }}>必要案例全數通過</div>}
                </div>))}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th>案例</th>{run.routes.map((r) => <th key={r} className="mono">{r}</th>)}</tr></thead>
                <tbody>
                  {run.cases.map((c) => (
                    <tr key={c.id}>
                      <td><span className="mono">{c.id}</span>{c.required && <span className="tag P0" style={{ marginLeft: 6 }}>必要</span>}<div className="note">{c.title}</div></td>
                      {run.routes.map((r) => {
                        const res = run.results.find((x) => x.route === r && x.caseId === c.id);
                        if (!res) return <td key={r} className="note">—</td>;
                        const [label, cls] = STATUS[res.status];
                        return <td key={r}><span className={cls}>{label}</span>{res.httpStatus && <span className="note"> {res.httpStatus}</span>}{res.latencyMs !== undefined && <span className="note"> · {fmt(res.latencyMs)} ms</span>}{res.detail && res.status !== "pass" && <div className="note" style={{ maxWidth: 260 }}>{res.detail}</div>}</td>;
                      })}
                    </tr>))}
                </tbody>
              </table>
            </div>
          </>)}
      </section>

      <section className="card">
        <h2>效能</h2>
        {perf.data.length === 0 ? <p className="note">還沒有效能測試紀錄。</p> : perf.data.map((r, i) => <PerfCard key={r.runId} r={r} mock={isMock(manifest.data!.perfRuns[i])} />)}
        <p className="note">TTFT 為第一個任何內容（含 thinking）的時間；TTFAT 為第一個答案 token 的時間，推理模型以 TTFAT 判斷使用者體感。定義見「方法與來源」。</p>
      </section>
    </>
  );
}

function PerfCard({ r, mock }: { r: PerfRun; mock: boolean }) {
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
