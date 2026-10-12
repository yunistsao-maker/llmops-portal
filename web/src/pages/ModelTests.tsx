import type { CompatRun, Model, PerfRun, SecurityRunSummary, TestPurpose } from "../../../schema/types";
import { fmt, loaders, useData } from "../data";
import { Empty, Status } from "../ui";

/**
 * 模型頁的「內部測試」：這個模型在平台 gateway 上的每一層測試（發布關卡 G3 相容性、G4 效能、G5 品質、G6 AI 安全），
 * 上線前測試（purpose = pre-release）置頂，其餘紀錄在下面。資料是 runs/compat、runs/perf、runs/security 的檔案，
 * 由平台團隊的測試工具產生、以 portalctl push 發布；research agent 不會改它們。測試結果不分每日版本。
 */
type Layer = "compat" | "perf" | "quality" | "security";
const LAYERS: { id: Layer; gate: string; name: string }[] = [
  { id: "compat", gate: "G3", name: "API 相容性" },
  { id: "perf", gate: "G4", name: "效能與容量" },
  { id: "quality", gate: "G5", name: "品質評測" },
  { id: "security", gate: "G6", name: "AI 安全測試" },
];
const PURPOSE: Record<TestPurpose | "none", string> = { "pre-release": "上線前", regression: "回歸", adhoc: "臨時", none: "未標示" };

interface Row { layer: Layer; at: string; purpose: TestPurpose | "none"; simulated: boolean; runId: string; body: JSX.Element; ok: boolean | null; verdict: string }

const day = (iso: string) => iso.slice(0, 10);
const ms = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v >= 1000 ? `${fmt(v / 1000, 1)} s` : `${fmt(v)} ms`);
const mockGateway = (gw: string) => /127\.0\.0\.1|localhost|mock/i.test(gw);

/** the routes of a gateway alias that stand for this model: "<id>" or "<id>@<where>" */
const routeOf = (m: Model) => (route: string) => route === m.id || route.startsWith(m.id + "@");

function securityTargets(run: SecurityRunSummary, m: Model): string[] {
  const names = new Set<string>([m.id, ...(m.vendorModelId ? [m.vendorModelId] : [])]);
  for (const o of m.offerings) {
    names.add(o.providerModelId);
    for (const t of o.inferenceTargets ?? []) names.add(t.id);
  }
  return run.targets
    .filter((t) => (t.modelId ? t.modelId === m.id : names.has(t.model) || names.has(t.label) || t.model.endsWith(m.id) || routeOf(m)(t.label)))
    .map((t) => t.label);
}

function compatRows(runs: CompatRun[], m: Model): Row[] {
  const mine = routeOf(m);
  return runs.flatMap((r) => {
    const rows = r.summary.filter((s) => (r.modelIds?.length ? r.modelIds.includes(m.id) && r.routes.includes(s.route) : mine(s.route)));
    if (!rows.length) return [];
    const requiredFails = rows.reduce((n, s) => n + s.requiredFailures.length, 0);
    return [{
      layer: "compat", at: r.finishedAt, purpose: r.purpose ?? "none", simulated: mockGateway(r.gateway), runId: r.runId,
      ok: requiredFails === 0, verdict: requiredFails === 0 ? "必要案例全過" : `必要案例失敗 ${requiredFails}`,
      body: (
        <>
          {r.litellmVersion && <div className="note">LiteLLM {r.litellmVersion}</div>}
          {rows.map((s) => (
            <div key={s.route}>
              <span className="mono">{s.route}</span>：<span className="pass">{s.pass} 過</span>
              {s.fail > 0 && <> · <span className="fail">{s.fail} 失敗</span></>}
              {s.error > 0 && <> · <span className="error">{s.error} 錯誤</span></>}
              {s.skip > 0 && <span className="skipped"> · {s.skip} 略過</span>}
              {s.requiredFailures.length > 0 && <div className="fail" style={{ fontSize: 13 }}>必要案例：{s.requiredFailures.join("、")}</div>}
            </div>
          ))}
        </>
      ),
    }];
  });
}

function perfRows(runs: PerfRun[], m: Model): Row[] {
  const mine = routeOf(m);
  return runs.filter((r) => (r.modelId ? r.modelId === m.id : mine(r.route))).map((r) => {
    const x = r.metrics;
    const sloMiss = (r.slo?.ttfatMs !== undefined && (x.ttfatMs.p90 ?? 0) > r.slo.ttfatMs) || (r.slo?.ttltMs !== undefined && (x.ttltMs.p90 ?? 0) > r.slo.ttltMs);
    const hasSlo = r.slo?.ttfatMs !== undefined || r.slo?.ttltMs !== undefined;
    return {
      layer: "perf" as const, at: r.finishedAt, purpose: r.purpose ?? "none", simulated: mockGateway(r.gateway), runId: r.runId,
      ok: hasSlo ? !sloMiss && x.errorRate === 0 : x.errorRate === 0 ? null : false,
      verdict: hasSlo ? (sloMiss ? "未達 SLO（p90）" : "達成 SLO（p90）") : x.errorRate > 0 ? `錯誤率 ${fmt(x.errorRate * 100, 1)}%` : "無 SLO（只記錄數字）",
      body: (
        <>
          <div><span className="mono">{r.route}</span> · profile {r.profile.name}{r.profile.reasoningEffort ? ` · effort ${r.profile.reasoningEffort}` : ""} · 並行 {r.profile.concurrency} × {r.profile.requests} 次
            {r.litellmVersion && <> · LiteLLM {r.litellmVersion}</>}{r.clientLocation && <> · 自 {r.clientLocation}</>}</div>
          <div className="note">TTFT p50 {ms(x.ttftMs.p50)} / p90 {ms(x.ttftMs.p90)} · TTLT p50 {ms(x.ttltMs.p50)} / p90 {ms(x.ttltMs.p90)} · 輸出 {fmt(x.outputTokensPerSec.p50, 1)} tokens/s（p50）
            · 錯誤率 {fmt(x.errorRate * 100, 1)}%{x.goodputPct !== undefined && <> · goodput {fmt(x.goodputPct, 1)}%</>}
            {hasSlo && <> · SLO：{r.slo?.ttfatMs !== undefined && `TTFAT ≤ ${ms(r.slo.ttfatMs)} `}{r.slo?.ttltMs !== undefined && `TTLT ≤ ${ms(r.slo.ttltMs)}`}</>}</div>
        </>
      ),
    };
  });
}

function securityRows(runs: SecurityRunSummary[], m: Model): Row[] {
  return runs.flatMap((r) => {
    const labels = securityTargets(r, m);
    if (!labels.length) return [];
    return labels.map((label) => {
      const items = r.items.filter((it) => it.results[label]);
      const count = (v: string) => items.filter((it) => it.results[label].verdict === v).length;
      const blockers = items.filter((it) => it.tier === "A" && it.results[label].verdict === "fail");
      const failed = items.filter((it) => it.results[label].verdict === "fail");
      const scored = items.length - count("nodata");
      return {
        layer: "security" as const, at: r.finishedAt, purpose: r.purpose ?? "none", simulated: r.simulated, runId: r.runId,
        ok: scored === 0 ? null : blockers.length === 0,
        verdict: scored === 0 ? "沒有可判定的樣本" : blockers.length ? `A 級未過 ${blockers.length} 項` : "A 級全過",
        body: (
          <>
            <div><span className="mono">{label}</span>{r.judge?.model && <span className="note"> · judge {r.judge.model}</span>}</div>
            <div className="note">{items.length} 項：<span className="pass">{count("pass")} 通過</span> · <span className="fail">{count("fail")} 未過</span> · {count("review")} 待判定 · {count("nodata")} 無樣本{count("info") > 0 && ` · ${count("info")} 僅記錄`}</div>
            {failed.length > 0 && <div style={{ fontSize: 13 }}>{failed.map((it) => (
              <div key={it.id} className={it.tier === "A" ? "fail" : "error"}>{it.id}{it.tier ? `（${it.tier} 級）` : ""} {it.title ?? ""}：{it.results[label].fail}/{it.results[label].scored}{it.results[label].verdictNote ? ` · ${it.results[label].verdictNote}` : ""}</div>))}</div>}
          </>
        ),
      };
    });
  });
}

function RunList({ rows }: { rows: Row[] }) {
  return (
    <>
      {rows.map((r) => (
        <div key={`${r.layer}-${r.runId}-${r.at}-${r.verdict}`} className="list-item" style={{ alignItems: "flex-start" }}>
          <span className="mono" style={{ minWidth: 92 }}>{day(r.at)}</span>
          <span style={{ minWidth: 110 }}>
            <span className={r.ok === false ? "fail" : r.ok ? "pass" : "skipped"}>{r.verdict}</span>
            <div className="note">{PURPOSE[r.purpose]}{r.simulated && <> · <span className="src">模擬資料</span></>}</div>
          </span>
          <span className="grow" style={{ fontSize: 14 }}>{r.body}<div className="note mono">{r.runId}</div></span>
        </div>
      ))}
    </>
  );
}

export default function ModelTests({ m }: { m: Model }) {
  const compat = useData(loaders.compatRuns);
  const perf = useData(loaders.perfRuns);
  const sec = useData(loaders.securityRuns);
  if (!compat.data || !perf.data || !sec.data) return <Status error={compat.error || perf.error || sec.error} />;
  const all = [...compatRows(compat.data, m), ...perfRows(perf.data, m), ...securityRows(sec.data, m)].sort((a, b) => (a.at < b.at ? 1 : -1));
  const pre = all.filter((r) => r.purpose === "pre-release");
  const other = all.filter((r) => r.purpose !== "pre-release");
  const latestPre = (layer: Layer) => pre.find((r) => r.layer === layer);

  return (
    <>
      <section className="card">
        <h2>上線前測試</h2>
        <p className="note" style={{ marginTop: -6 }}>每一層最近一次的上線前測試（發布關卡的證據）；下面列出全部紀錄。數字來自平台 gateway 的實測，與廠商公布的數字不同。</p>
        <div className="grid2" style={{ gap: 12 }}>
          {LAYERS.map((l) => {
            const r = latestPre(l.id);
            return (
              <div key={l.id} className="card" style={{ boxShadow: "none", border: "1px solid var(--line2)", padding: 16 }}>
                <div className="note">{l.gate} · {l.name}</div>
                {r ? (
                  <>
                    <div style={{ fontSize: 18, margin: "4px 0" }} className={r.ok === false ? "fail" : r.ok ? "pass" : ""}>{r.verdict}</div>
                    <div className="note">{day(r.at)}{r.simulated && <> · <span className="src">模擬資料</span></>}</div>
                  </>
                ) : (
                  <div className="note" style={{ marginTop: 6 }}>
                    {l.id === "quality" ? "尚未有品質評測的結果檔（之後以同樣方式放進 runs/ 就會出現在這裡）" : "還沒有上線前測試"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {pre.length > 0 && <section className="card"><h2>上線前測試紀錄（{pre.length}）</h2><RunList rows={pre} /></section>}
      {other.length > 0 && <section className="card"><h2>其他測試紀錄（{other.length}）</h2><p className="note" style={{ marginTop: -6 }}>回歸、臨時或未標示目的的測試。</p><RunList rows={other} /></section>}

      {all.length === 0 && (
        <Empty>
          還沒有 {m.name} 的內部測試。上線前在 gateway 上執行（加 <span className="mono">--purpose pre-release</span>，結果會出現在最上面）：
          <pre className="code">{`python3 tools/compat_suite.py --gateway <GW>/v1 --routes ${m.id} --purpose pre-release --model-id ${m.id} \\
  --litellm-version <版本> --out runs/compat/$(date +%F)-${m.id}.json
python3 tools/perf_probe.py --gateway <GW>/v1 --route ${m.id} --purpose pre-release --model-id ${m.id} \\
  --profile zh-tw --effort medium --out runs/perf/$(date +%F)-${m.id}.json
python3 tools/sec_suite.py run --gateway <GW>/v1 --routes ${m.id} --purpose pre-release \\
  --model-ids ${m.id}=${m.id} --judge bedrock:<judge model> --publish-summary`}</pre>
          然後在 llmops-research-agent 執行 <span className="mono">portalctl push --portal &lt;portal repo&gt; --only runs --note "{m.name} 上線前測試"</span>：網站會自動重新 build，結果出現在這裡。
        </Empty>
      )}
    </>
  );
}
