import { useMemo, useState } from "react";
import type { SecurityCase, SecurityItemResult, SecurityRunSummary } from "../../../schema/types";
import { EDITION, fmt, loaders, useData } from "../data";
import { Status } from "../ui";

/**
 * G6 AI 安全測試 for one model: the layout of the sec_suite report (totals, the item table with each item's definition,
 * and - in the full portal only - the cases, redacted: a sensitive dataset's case keeps its verdict and loses its text).
 * Only this model's column is shown (other models of the same run are on their own pages).
 */
const VERDICT: Record<string, string> = { pass: "PASS", fail: "FAIL", review: "REVIEW", info: "INFO", nodata: "無樣本", error: "ERROR" };
const OUTCOME: Record<string, string> = { pass: "PASS", fail: "FAIL", review: "REVIEW", info: "INFO", error: "ERROR" };
const RISK: Record<string, string> = { none: "無", low: "低", medium: "中", "medium-high": "中高", high: "高", highest: "最高", unknown: "未知" };
const FILTERS = [["", "全部"], ["fail", "FAIL"], ["review", "REVIEW"], ["pass", "PASS"], ["info", "INFO"], ["nodata", "無樣本"]] as const;
const PAGE = 40;

const Pill = ({ v }: { v: string }) => <span className={`vpill ${v}`}>{VERDICT[v] ?? OUTCOME[v] ?? v}</span>;
const counts = (r: SecurityItemResult) => `${r.fail}/${r.scored} fail${r.review ? `, ${r.review} review` : ""}${r.error ? `, ${r.error} error` : ""}`;

export default function SecurityPanel({ runs, labelOf }: { runs: SecurityRunSummary[]; labelOf: (r: SecurityRunSummary) => string }) {
  // newest first, pre-release runs ahead of the rest
  const ordered = useMemo(() => [...runs].sort((a, b) =>
    (a.purpose === "pre-release" ? 0 : 1) - (b.purpose === "pre-release" ? 0 : 1) || (a.finishedAt < b.finishedAt ? 1 : -1)), [runs]);
  const [pick, setPick] = useState(0);
  const run = ordered[Math.min(pick, ordered.length - 1)];
  if (!run) return null;
  return (
    <section className="card">
      <div className="pagehead" style={{ alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>G6 · AI 安全測試</h2>
        {ordered.length > 1 && (
          <label className="note">測試　<select value={pick} onChange={(e) => setPick(Number(e.target.value))}>
            {ordered.map((r, i) => <option key={r.runId} value={i}>{r.finishedAt.slice(0, 10)} · {r.purpose === "pre-release" ? "上線前" : r.purpose ?? "未標示"} · {r.runId}</option>)}
          </select></label>
        )}
      </div>
      <RunView key={run.runId} run={run} label={labelOf(run)} />
    </section>
  );
}

function RunView({ run, label }: { run: SecurityRunSummary; label: string }) {
  const [filter, setFilter] = useState<string>("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const target = run.targets.find((t) => t.label === label);
  const rows = run.items.map((it) => {
    const own = it.results[label];
    const gateway = !own && it.results.gateway ? it.results.gateway : undefined;
    return { it, r: own ?? gateway, gateway: Boolean(gateway) };
  }).filter((x) => x.r);
  const mine = rows.filter((x) => !x.gateway).map((x) => x.r as SecurityItemResult);
  const sum = (k: "n" | "pass" | "fail" | "review" | "error") => mine.reduce((n, r) => n + (r[k] ?? 0), 0);
  const tokens = (k: "inputTokens" | "outputTokens") => mine.reduce((n, r) => n + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);
  const byVerdict = (v: string) => rows.filter((x) => x.r?.verdict === v).length;
  const shown = rows.filter((x) => !filter || x.r?.verdict === filter);

  return (
    <>
      <p className="note" style={{ margin: "0 0 8px" }}>
        run <span className="mono">{run.runId}</span> · {run.startedAt.replace("T", " ").slice(0, 16)} – {run.finishedAt.slice(11, 16)}（UTC）
        · {run.purpose === "pre-release" ? "上線前測試" : run.purpose ? `目的：${run.purpose}` : "目的未標示"}
        {run.judge?.model && <> · judge <span className="mono">{run.judge.model}</span></>}
      </p>
      <div className={run.simulated ? "sec-banner sim" : "sec-banner"}>
        {run.simulated ? <><b>模擬資料</b>：由內建模擬器回答，沒有呼叫任何模型，只用來驗證流程。</>
          : <><b>真實呼叫</b>：受測模型 <b>{label}</b>{target && <>（<span className="mono">{target.provider}:{target.model}</span>{target.effort ? `，effort ${target.effort}` : ""}）</>}。</>}
      </div>

      <div className="sec-stats">
        <div><b>{fmt(sum("n"))}</b>案例</div>
        <div><b className="pass">{fmt(sum("pass"))}</b>pass</div>
        <div><b className="fail">{fmt(sum("fail"))}</b>fail</div>
        <div><b className="error">{fmt(sum("review"))}</b>review</div>
        <div><b>{fmt(sum("error"))}</b>error</div>
        {tokens("outputTokens") > 0 && <div><b>{fmt(tokens("inputTokens"))} / {fmt(tokens("outputTokens"))}</b>input / output tokens</div>}
      </div>

      <div className="pagehead" style={{ alignItems: "center", margin: "16px 0 8px" }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>各項結果</h3>
        <div className="filters" role="group" aria-label="依結果篩選">
          {FILTERS.map(([v, l]) => (
            <button key={v} aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}（{v ? byVerdict(v) : rows.length}）</button>
          ))}
        </div>
      </div>
      <div className="sec-wrap"><table className="sec-table">
        <thead><tr><th>項目</th><th>測試內容</th><th>級別</th><th>{label}</th><th>說明</th></tr></thead>
        <tbody>
          {shown.map(({ it, r, gateway }) => (
            <ItemRows key={it.id} it={it} r={r as SecurityItemResult} gateway={gateway} open={!!open[it.id]} toggle={() => setOpen({ ...open, [it.id]: !open[it.id] })} />
          ))}
        </tbody>
      </table></div>
      <p className="note">每一項依它自己的及格標準判定（點項目看「測什麼、怎麼判、及格標準」）。REVIEW 表示有案例需要人判定，可能改變結論；每個資料集的樣本數不多，比例的信賴區間很寬。</p>

      {EDITION === "full" && <Cases run={run} label={label} />}
    </>
  );
}

function ItemRows({ it, r, gateway, open, toggle }: { it: SecurityRunSummary["items"][number]; r: SecurityItemResult; gateway: boolean; open: boolean; toggle: () => void }) {
  return (
    <>
      <tr>
        <td><button className="linklike mono" onClick={toggle} aria-expanded={open}>{open ? "▾" : "▸"} {it.id}</button></td>
        <td>{it.title ?? "—"}</td>
        <td>{it.tier ? `${it.tier} 級` : "—"}</td>
        <td style={{ whiteSpace: "nowrap" }}><Pill v={r.verdict} /> <span className="mono note">{counts(r)}</span>{gateway && <div className="note">gateway（平台層級）</div>}</td>
        <td className="note">{r.verdictNote ?? ""}</td>
      </tr>
      {open && (
        <tr className="sec-def"><td colSpan={5}>
          <dl className="kv">
            <dt>測什麼</dt><dd>{it.methodology ?? "—"}</dd>
            <dt>怎麼判</dt><dd>{it.scoring ?? "—"}</dd>
            <dt>及格標準</dt><dd>{it.ruleText ?? "—"}</dd>
            <dt>資料集</dt><dd className="mono">{it.datasets.join("、") || "—"}</dd>
          </dl>
        </td></tr>
      )}
    </>
  );
}

function Cases({ run, label }: { run: SecurityRunSummary; label: string }) {
  const data = useData(() => loaders.securityCases(run.runId), [run.runId]);
  const [outcome, setOutcome] = useState("");
  const [item, setItem] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  if (!data.data && !data.error) return <Status />;
  if (!data.data) return <p className="note">這次測試沒有發布逐筆案例（sec_suite.py publish 會一起產生）。</p>;
  const all = data.data.cases.filter((c) => c.target === label || c.target === "gateway");
  const needle = q.trim().toLowerCase();
  const list = all.filter((c) => (!outcome || c.outcome === outcome) && (!item || c.item === item)
    && (!needle || `${c.dataset} ${c.caseId} ${c.label ?? ""} ${c.category ?? ""}`.toLowerCase().includes(needle)));
  const hidden = all.filter((c) => c.redacted).length;
  return (
    <>
      <h3 style={{ margin: "24px 0 4px", fontSize: 16 }}>逐筆案例（{all.length}）</h3>
      <p className="note" style={{ marginTop: 0 }}>只在完整版顯示。{hidden} 筆來自高／中風險或不允許轉載的資料集：只留判定，題目與回應不公開；完整內容只在測試者電腦上的報告裡。</p>
      <div className="sec-filters">
        <select value={outcome} onChange={(e) => { setOutcome(e.target.value); setLimit(PAGE); }} aria-label="結果">
          <option value="">全部結果</option>{["fail", "review", "pass", "info", "error"].map((o) => <option key={o} value={o}>{OUTCOME[o]}</option>)}
        </select>
        <select value={item} onChange={(e) => { setItem(e.target.value); setLimit(PAGE); }} aria-label="項目">
          <option value="">全部項目</option>{run.items.map((it) => <option key={it.id} value={it.id}>{it.id} {it.title ?? ""}</option>)}
        </select>
        <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="搜尋資料集、case id、判定標籤…" aria-label="搜尋" />
        <span className="note">{list.length} 筆</span>
      </div>
      {list.slice(0, limit).map((c, i) => <CaseCard key={`${c.item}-${c.dataset}-${c.caseId}-${c.trial ?? 0}-${i}`} c={c} />)}
      {list.length > limit && <button className="btn" onClick={() => setLimit(limit + PAGE)}>再顯示 {Math.min(PAGE, list.length - limit)} 筆</button>}
    </>
  );
}

function CaseCard({ c }: { c: SecurityCase }) {
  return (
    <article className={`sec-case o-${c.outcome}`}>
      <header>
        <Pill v={c.outcome} /> <span className="mono">{c.item} · {c.dataset} / {c.caseId}</span>
        {c.category && <span className="sec-tag">{c.category}</span>}
        {c.label && <span className="sec-tag mono">{c.label}</span>}
        {c.redacted && <span className="sec-tag risk">{RISK[c.risk] ?? c.risk}風險</span>}
      </header>
      <div className="note">
        {c.model && <>回應模型 <span className="mono">{c.model}</span></>}
        {c.latencyMs ? <> · {fmt(c.latencyMs / 1000, 1)} s</> : null}
        {c.outputTokens ? <> · {fmt(c.inputTokens ?? 0)} in / {fmt(c.outputTokens)} out tokens</> : null}
        {c.stopReason && <> · stop_reason <span className="mono">{c.stopReason}</span></>}
      </div>
      {c.redacted ? (
        <div className="note" style={{ marginTop: 4 }}>（{RISK[c.risk] ?? c.risk}風險或不允許轉載的資料集：題目與回應不公開）</div>
      ) : (
        <details>
          <summary>題目與回應</summary>
          {c.system && <div className="sec-kv"><b>System prompt</b><pre>{c.system}</pre></div>}
          {c.prompt.length > 0 && <div className="sec-kv"><b>送給模型</b>{c.prompt.map((m, i) => <div key={i}><span className="note mono">{m.role}</span><pre>{m.content}</pre></div>)}</div>}
          {c.tools && c.tools.length > 0 && <div className="sec-kv"><b>可用工具</b><span className="mono">{c.tools.join("、")}</span></div>}
          <div className="sec-kv"><b>模型回應</b><pre>{c.response || "（空白）"}</pre></div>
          {c.detail && <div className="sec-kv"><b>判定細節</b><pre>{c.detail}</pre></div>}
        </details>
      )}
    </article>
  );
}
