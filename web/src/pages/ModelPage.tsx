import { useState } from "react";
import { Status } from "../App";
import { loaders, money, useData } from "../data";

const TABS = ["概覽", "三雲與 API", "效能與指數", "價格", "LiteLLM", "Onboarding"] as const;
type Tab = (typeof TABS)[number];
const STATUS_LABEL = { supported: "支援", partial: "部分", "not-supported": "不支援", unknown: "待驗證" } as const;
const STATUS_COLOR = { supported: "var(--ok)", partial: "var(--warn)", "not-supported": "var(--danger)", unknown: "var(--muted)" } as const;

export default function ModelPage({ id }: { id: string }) {
  const catalog = useData(loaders.catalog);
  const dd = useData(() => loaders.deepDive(id), [id]);
  const [tab, setTab] = useState<Tab>("概覽");
  if (!catalog.data) return <Status error={catalog.error} />;
  const m = catalog.data.models.find((x) => x.id === id);
  if (!m) return <Status error={`找不到模型 ${id}`} />;
  const deep = dd.data;
  const noTw = m.offerings.every((o) => o.dataProcessing.taiwanResidency !== "yes");

  return (
    <>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div>
          <div className="eyebrow"><a href="#/models">模型目錄</a> / {m.vendor} · {m.tier} · {m.releaseDate} 發布</div>
          <h1>{m.name}</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <span className="pill">{m.platformStatus}</span>
          {noTw && <span className="pill warn">無台灣境內處理</span>}
        </div>
      </header>
      <div className="tabs" role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      {tab === "概覽" && (
        <div className="row">
          <section className="card grow">
            <h2>摘要</h2>
            <p style={{ lineHeight: 1.8, marginTop: 0 }}>{deep?.tldr ?? m.summary}</p>
            <Lists title="適合" items={m.bestFor} /><Lists title="避免" items={m.avoidFor} />
            {deep && deep.breakingChanges.length > 0 && (<>
              <h2 style={{ marginTop: 24 }}>Breaking changes</h2>
              <table><thead><tr><th>項目</th><th>嚴重度</th><th>遷移方式</th></tr></thead><tbody>
                {deep.breakingChanges.map((b) => <tr key={b.title}><td>{b.title}<div className="note">{b.detail}</div></td><td>{b.severity}</td><td>{b.migration}</td></tr>)}
              </tbody></table></>)}
          </section>
          <aside className="side">
            <section className="card"><h2>優勢</h2><ul style={ul}>{m.strengths.map((s) => <li key={s}>{s}</li>)}</ul></section>
            <section className="card"><h2>要注意</h2><ul style={ul}>{m.weaknesses.map((s) => <li key={s}>{s}</li>)}</ul></section>
          </aside>
        </div>
      )}

      {tab === "三雲與 API" && (
        <>
          <section className="card">
            <h2>通路</h2>
            <table><thead><tr><th>雲端</th><th>狀態</th><th>Provider model ID</th><th>端點與 API</th><th>台灣境內</th><th>可信度</th></tr></thead><tbody>
              {m.offerings.map((o) => (
                <tr key={o.id}>
                  <td>{o.cloud.toUpperCase()} · {o.service}</td><td>{o.status}</td><td className="mono">{o.providerModelId}</td>
                  <td>{o.endpoints.map((e) => <div key={e.endpoint}><span className="mono">{e.endpoint}</span><div className="note">{e.apis.join("、")}</div></div>)}</td>
                  <td>{o.dataProcessing.taiwanResidency}</td><td><Verif v={o.verification} /></td>
                </tr>))}
            </tbody></table>
          </section>
          {deep && (
            <section className="card">
              <h2>API 相容性（官方文件）</h2>
              <table><thead><tr><th>路由</th><th>API 面</th><th>狀態</th><th>備註</th></tr></thead><tbody>
                {deep.apiCompatibility.map((a, i) => (
                  <tr key={i}><td>{a.route}</td><td>{a.surface}</td><td style={{ color: STATUS_COLOR[a.status], fontWeight: 500 }}>{STATUS_LABEL[a.status]}</td><td className="note">{a.note}</td></tr>))}
              </tbody></table>
              <p className="note">內部實測結果請用 tools/compat_suite.py 產生 runs/compat/*.json 後並列顯示。</p>
            </section>)}
        </>
      )}

      {tab === "效能與指數" && (
        <div className="row">
          <section className="card grow">
            <h2>外部效能參考</h2>
            <table><thead><tr><th>來源</th><th>設定</th><th>tok/s</th><th>首 token（秒）</th><th>每任務成本</th></tr></thead><tbody>
              {m.performanceReference.map((p, i) => (
                <tr key={i}><td>{p.provider}</td><td>{p.variant}</td><td className="mono">{p.outputTokensPerSec ?? "—"}</td><td className="mono">{p.ttftSec ?? "—"}</td><td className="mono">{p.costPerIndexTaskUsd !== undefined ? `$${p.costPerIndexTaskUsd}` : "—"}</td></tr>))}
            </tbody></table>
            <p className="note">延遲高度取決於 effort；這是廠商一方 API 的數字，不是經 LiteLLM、從台灣出口的實測。</p>
          </section>
          <section className="card grow">
            <h2>評測分數</h2>
            <table><thead><tr><th>評測</th><th>版本 / 設定</th><th>分數</th></tr></thead><tbody>
              {m.benchmarks.map((b, i) => (
                <tr key={i}><td>{b.name}<div className="note">{b.measuredBy}</div></td><td>{b.version ?? ""} {b.variant}</td><td className="mono">{b.score}{b.rank ? ` (${b.rank})` : ""}</td></tr>))}
            </tbody></table>
            <p className="note">只比較同名稱、同版本的分數。</p>
          </section>
        </div>
      )}

      {tab === "價格" && (
        <section className="card">
          <h2>價格（USD / 1M tokens）</h2>
          <table><thead><tr><th>通路</th><th>範圍</th><th>Input</th><th>Output</th><th>Cache read</th><th>長文（&gt;門檻）</th><th>期限</th><th>可信度</th></tr></thead><tbody>
            {m.offerings.flatMap((o) => o.pricing.map((p, i) => (
              <tr key={o.id + i}>
                <td>{o.cloud.toUpperCase()}</td><td>{p.scope}</td><td className="mono">{money(p.input)}</td><td className="mono">{money(p.output)}</td>
                <td className="mono">{money(p.cacheRead)}</td>
                <td className="mono">{p.longContext ? `${money(p.longContext.input)} / ${money(p.longContext.output)}` : "—"}</td>
                <td>{p.validUntil ? <>至 {p.validUntil}{p.thereafter && <div className="note">之後 {money(p.thereafter.input)} / {money(p.thereafter.output)}</div>}</> : "—"}</td>
                <td><Verif v={p.verification} /></td>
              </tr>)))}
          </tbody></table>
        </section>
      )}

      {tab === "LiteLLM" && (
        <section className="card">
          <h2>LiteLLM</h2>
          <p>建議版本：<span className="mono">{m.litellm.recommendedVersion}</span>　可路由：<span className="mono">{m.litellm.minVersionRouting}</span></p>
          <table><thead><tr><th>通路</th><th>litellm model 字串</th><th>備註</th></tr></thead><tbody>
            {m.litellm.providerStrings.map((p) => <tr key={p.model}><td>{p.service}</td><td className="mono">{p.model}</td><td className="note">{p.note}</td></tr>)}
          </tbody></table>
          <h2 style={{ marginTop: 24 }}>已知陷阱</h2>
          <ul style={ul}>{m.litellm.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
        </section>
      )}

      {tab === "Onboarding" && (deep ? (
        <div className="row">
          <section className="card grow">
            <h2>步驟</h2>
            <ol style={{ ...ul, paddingLeft: 22 }}>{deep.onboarding.steps.map((s) => <li key={s.title} style={{ marginBottom: 10 }}><strong>{s.title}</strong>：{s.detail}</li>)}</ol>
            <h2 style={{ marginTop: 24 }}>程式範例</h2>
            {deep.onboarding.codeSamples.map((c) => (
              <div key={c.title}><div className="note">{c.title}</div>
                <pre className="mono" style={{ background: "#1e2228", color: "#e8eaee", padding: 16, borderRadius: 4, overflowX: "auto", fontSize: 13 }}>{c.code}</pre></div>))}
          </section>
          <aside className="side">
            <section className="card hero-accent">
              <div style={{ fontSize: 13, opacity: 0.85 }}>應用團隊用這些名稱呼叫</div>
              {deep.onboarding.aliases.map((a) => <div key={a.alias} className="mono" style={{ fontSize: 16, marginTop: 8 }}>{a.alias}<div style={{ fontSize: 12, opacity: 0.85 }}>→ {a.target}</div></div>)}
            </section>
            <section className="card"><h2>前置條件</h2><ul style={ul}>{deep.onboarding.prerequisites.map((p) => <li key={p}>{p}</li>)}</ul></section>
            <section className="card"><h2>參數建議</h2>{deep.onboarding.parameterGuidance.map((p) => <p key={p.parameter} style={{ margin: "0 0 10px", fontSize: 14 }}><span className="mono">{p.parameter}</span>：{p.guidance}</p>)}</section>
            <section className="card"><h2>資料等級</h2><p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>{deep.onboarding.dataClassification}</p></section>
          </aside>
        </div>) : <Status error={dd.error} />)}
    </>
  );
}

const ul = { margin: 0, paddingLeft: 20, lineHeight: 1.8, fontSize: 14 } as const;
function Lists({ title, items }: { title: string; items: string[] }) {
  return <><h2 style={{ marginTop: 16, fontSize: 16 }}>{title}</h2><ul style={ul}>{items.map((i) => <li key={i}>{i}</li>)}</ul></>;
}
function Verif({ v }: { v?: string }) {
  const weak = v === "community" || v === "unverified";
  return <span className={weak ? "src" : "note"}>{v ?? "—"}</span>;
}
