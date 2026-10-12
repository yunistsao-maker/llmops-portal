import { useState } from "react";
import type { Model } from "../../../schema/types";
import { go } from "../App";
import { daysFrom, EDITION, fmt, hasPage, linkTo, loaders, money, useData } from "../data";
import { Bullets, Empty, PageHead, Sources, Status, Tabs, Verif } from "../ui";
import ModelTests from "./ModelTests";

const ALL_TABS = ["概覽", "Deep dive", "三雲與 API", "效能與指數", "價格與試算", "安全與合規", "LiteLLM", "內部測試", "生命週期", "Onboarding"] as const;
type Tab = (typeof ALL_TABS)[number];
/** the clean edition has no Onboarding (its content is not even in that build's data) */
const TABS: readonly Tab[] = EDITION === "clean" ? ALL_TABS.filter((t) => t !== "Onboarding") : ALL_TABS;
const TW: Record<string, string> = { yes: "有", no: "無", unknown: "未知" };
const ZDR: Record<string, string> = { available: "可用", "on-request": "需申請", "not-available": "不提供", unknown: "未知" };
const ST = { supported: ["支援", "pass"], partial: ["部分", "error"], "not-supported": ["不支援", "fail"], unknown: ["待驗證", "skipped"] } as const;

export default function ModelPage({ id }: { id: string }) {
  const catalog = useData(loaders.catalog);
  // only models listed in the manifest have a deep dive file; others show the catalog view without a 404
  const dd = useData(async () => { const m = await loaders.manifest(); if (!m.models.includes(id)) throw new Error("no deep dive yet"); return loaders.deepDive(id); }, [id]);
  const [tab, setTab] = useState<Tab>("概覽");
  if (!catalog.data) return <Status error={catalog.error} />;
  const m = catalog.data.models.find((x) => x.id === id);
  if (!m) return <Status error={`找不到模型 ${id}`} />;
  const deep = dd.data;
  const noTw = m.offerings.every((o) => o.dataProcessing.taiwanResidency !== "yes");
  const needDeep = (el: React.ReactNode) => (deep ? el : dd.error ? <Empty>這個模型還沒有 deep dive（data/models/{id}.json）。</Empty> : <Status />);

  return (
    <>
      <PageHead eyebrow={<><a href={linkTo("models")}>模型目錄</a> / {m.vendor} · {m.tier} · {m.releaseDate} 發布 · 資料查核 {m.lastVerified}</>} title={m.name}
        right={<>
          <span className="pill">平台狀態：{m.platformStatus}</span>
          {noTw && <span className="pill warn">無台灣境內處理</span>}
          {hasPage("release") && <button className="btn" onClick={() => go(`release/${m.id}`)}>發布關卡紀錄</button>}
          <button className="btn" onClick={() => go(`compare/${m.id}`)}>比較</button>
        </>} />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "概覽" && (
        <div className="row">
          <section className="card grow">
            <h2>摘要</h2>
            <p className="lead" style={{ fontSize: 16 }}>{deep?.tldr ?? m.summary}</p>
            <dl className="kv" style={{ marginTop: 20 }}>
              <dt>Context / 最大輸出</dt><dd className="mono">{fmt(m.contextWindow)} / {fmt(m.maxOutputTokens)} tokens</dd>
              <dt>模態</dt><dd>輸入 {m.modalities.input.join("、")}；輸出 {m.modalities.output.join("、")}</dd>
              <dt>知識截止</dt><dd>{m.knowledgeCutoff ?? "—"}</dd>
              <dt>推理</dt><dd>{m.reasoning.alwaysOn ? "永遠開啟" : "可關閉"}；effort {(m.reasoning.effortLevels ?? []).join(" / ")}（預設 {m.reasoning.defaultEffort ?? "—"}）<div className="note">{m.reasoning.parameter}</div></dd>
              <dt>廠商模型 ID</dt><dd className="mono">{m.vendorModelId ?? "—"}</dd>
              <dt>文件</dt><dd>{m.systemCardUrl && <a href={m.systemCardUrl} target="_blank" rel="noreferrer">System card</a>} {m.modelCardUrl && <a href={m.modelCardUrl} target="_blank" rel="noreferrer">Model card</a>}</dd>
            </dl>
            <div className="grid2" style={{ marginTop: 20 }}>
              <div><h2>適合</h2><Bullets items={m.bestFor} /></div>
              <div><h2>避免</h2><Bullets items={m.avoidFor} /></div>
            </div>
          </section>
          <aside className="side">
            <section className="card"><h2>優勢</h2><Bullets items={m.strengths} /></section>
            <section className="card"><h2>劣勢與注意</h2><Bullets items={m.weaknesses} /></section>
          </aside>
        </div>)}

      {tab === "Deep dive" && needDeep(deep && (
        <>
          <section className="card"><h2>新功能與變化</h2>
            {deep.whatsNew.map((w) => <details key={w.title} open><summary>{w.title}</summary><p style={{ fontSize: 14, lineHeight: 1.7 }}>{w.detail}<Sources refs={w.sources} /></p></details>)}
          </section>
          {deep.vsPredecessor && (
            <section className="card"><h2>與前代比較（{deep.vsPredecessor.predecessorId}）</h2>
              <table><thead><tr><th>面向</th><th>之前</th><th>現在</th><th>影響</th></tr></thead><tbody>
                {deep.vsPredecessor.changes.map((c) => <tr key={c.area}><td>{c.area}</td><td>{c.before}</td><td>{c.after}</td><td>{c.impact}</td></tr>)}
              </tbody></table></section>)}
          <section className="card"><h2>Breaking changes 與遷移</h2>
            <table><thead><tr><th>項目</th><th>嚴重度</th><th>遷移方式</th></tr></thead><tbody>
              {deep.breakingChanges.map((b) => <tr key={b.title}><td><strong>{b.title}</strong><div className="note">{b.detail}</div></td><td><span className={`tag sev-${b.severity}`}>{b.severity}</span></td><td>{b.migration}<Sources refs={b.sources} /></td></tr>)}
            </tbody></table></section>
          <div className="grid2">
            <section className="card"><h2>企業導入重點（台灣）</h2><Bullets items={deep.enterpriseNotes} /></section>
            <section className="card"><h2>測試計畫重點</h2><Bullets items={deep.testPlanFocus} /></section>
          </div>
          <section className="card"><h2>開放問題</h2><Bullets items={deep.openQuestions} /></section>
        </>))}

      {tab === "三雲與 API" && (
        <>
          {m.offerings.map((o) => (
            <section className="card" key={o.id}>
              <h2>{o.cloud.toUpperCase()} · {o.service} <span className="note">（{o.status}，{o.availableSince ?? ""} 起）</span> <Verif v={o.verification} /></h2>
              <dl className="kv">
                <dt>Provider model ID</dt><dd className="mono">{o.providerModelId}</dd>
                <dt>Inference 目標</dt><dd>{o.inferenceTargets.map((t) => <div key={t.id} className="mono" style={{ fontSize: 13 }}>{t.id} <span className="note">{t.scope}</span></div>)}</dd>
                <dt>端點</dt><dd>{o.endpoints.map((e) => <div key={e.endpoint} style={{ marginBottom: 6 }}><span className="mono">{e.endpoint}</span> — {e.apis.length ? e.apis.join("、") : <span className="src">支援的 API 面待確認</span>}{e.notes?.map((n) => <div key={n} className="note">{n}</div>)}</div>)}</dd>
                <dt>亞太區域</dt><dd>{o.apacAvailability.length ? o.apacAvailability.map((r) => <div key={r.region}>{r.label}（{r.region}）：{r.scopes.join(" / ")} {r.note && <span className="note">{r.note}</span>}</div>) : "—"}</dd>
                <dt>資料處理</dt><dd>{o.dataProcessing.processor}；駐留 {o.dataProcessing.residencyOptions.join("、")}；台灣境內 <strong>{TW[o.dataProcessing.taiwanResidency]}</strong>；ZDR {ZDR[o.dataProcessing.zdr]}{o.dataProcessing.retentionNotes.map((n) => <div key={n} className="note">{n}</div>)}</dd>
                <dt>功能</dt><dd style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{o.features.map((f) => <span key={f.feature} className={`tag ${ST[f.status][1]}`} title={f.note} style={{ background: "var(--line)" }}>{f.feature}：{ST[f.status][0]}</span>)}</dd>
                <dt>配額</dt><dd>{o.quotas.length ? o.quotas.map((q, i) => <div key={i}>{q.scope}：{q.rpm ? `${fmt(q.rpm)} RPM ` : ""}{q.tpm ? `${fmt(q.tpm)} TPM ` : ""}{q.inputTpm ? `in ${fmt(q.inputTpm)} TPM ` : ""}{q.outputTpm ? `out ${fmt(q.outputTpm)} TPM` : ""} <span className="note">{q.note}</span> <Verif v={q.verification} /></div>) : "—"}</dd>
                <dt>LiteLLM</dt><dd className="mono">{o.litellmModel ?? "—"}</dd>
                <dt>上線注意</dt><dd><Bullets items={o.onboardingNotes} /></dd>
              </dl>
              <Sources refs={o.sources} />
            </section>))}
          {deep && (
            <section className="card"><h2>API 相容性總表（官方文件）</h2>
              <table><thead><tr><th>路由</th><th>API 面</th><th>狀態</th><th>備註</th></tr></thead><tbody>
                {deep.apiCompatibility.map((a, i) => <tr key={i}><td>{a.route}</td><td>{a.surface}</td><td className={ST[a.status][1]}>{ST[a.status][0]}</td><td className="note">{a.note}</td></tr>)}
              </tbody></table></section>)}
        </>)}

      {tab === "效能與指數" && (
        <div className="grid2">
          <section className="card"><h2>外部效能參考</h2>
            <table><thead><tr><th>來源 / 設定</th><th>tok/s</th><th>首 token</th><th>每任務</th></tr></thead><tbody>
              {m.performanceReference.map((p, i) => <tr key={i}><td>{p.provider}<div className="note">{p.variant} · {p.date}</div>{p.notes && <div className="note">{p.notes}</div>}<Sources refs={p.sources} /></td><td className="mono">{p.outputTokensPerSec ?? "—"}</td><td className="mono">{p.ttftSec !== undefined ? `${p.ttftSec}s` : "—"}</td><td className="mono">{p.costPerIndexTaskUsd !== undefined ? `$${p.costPerIndexTaskUsd}` : "—"}</td></tr>)}
            </tbody></table>
            <p className="note">廠商一方 API 的數字，不代表經 LiteLLM、從台灣出口的延遲；內部實測見「內部測試」分頁。</p>
          </section>
          <section className="card"><h2>評測分數</h2>
            <table><thead><tr><th>評測</th><th>版本 / 設定</th><th>分數</th></tr></thead><tbody>
              {m.benchmarks.map((b, i) => <tr key={i}><td>{b.name}<div className="note">{b.measuredBy === "vendor" ? "廠商自評" : "獨立評測"} · {b.date}</div>{b.notes && <div className="note">{b.notes}</div>}</td><td>{b.version} {b.variant}</td><td className="mono">{b.score}{b.unit === "percent" ? "%" : ""}{b.rank ? ` · ${b.rank}` : ""}</td></tr>)}
            </tbody></table>
            <p className="note">只比較同名稱、同版本；廠商自評與獨立評測分開看。</p>
          </section>
        </div>)}

      {tab === "價格與試算" && <Pricing m={m} />}

      {tab === "安全與合規" && (
        <>
          <div className="grid3">
            <section className="card"><h2>風險分級</h2><Bullets items={m.safety.classifications} /></section>
            <section className="card"><h2>會改變回應的行為</h2><Bullets items={m.safety.behaviours} /></section>
            <section className="card"><h2>信任存取計畫</h2><Bullets items={m.safety.programmes.length ? m.safety.programmes : ["—"]} /></section>
          </div>
          {needDeep(deep && (
            <section className="card"><h2>安全與合規細節</h2>
              <table><tbody>{deep.safetyAndCompliance.map((s) => <tr key={s.item}><td style={{ width: 220 }}><strong>{s.item}</strong></td><td>{s.detail}<Sources refs={s.sources} /></td></tr>)}</tbody></table>
              <p className="note">安全測試目錄與通過標準見「方法與來源」頁；紅隊結果放進 runs/ 後可在這裡並列。</p>
            </section>))}
        </>)}

      {tab === "LiteLLM" && (
        <section className="card">
          <dl className="kv">
            <dt>建議版本</dt><dd className="mono">{m.litellm.recommendedVersion}</dd>
            <dt>可路由最低版本</dt><dd className="mono">{m.litellm.minVersionRouting}</dd>
            {m.litellm.minVersionParams && <><dt>參數處理最低版本</dt><dd className="mono">{m.litellm.minVersionParams}</dd></>}
            {m.litellm.minVersionBundledCostMap && <><dt>內建 cost map</dt><dd className="mono">{m.litellm.minVersionBundledCostMap}</dd></>}
          </dl>
          <h2 style={{ marginTop: 24 }}>model 字串</h2>
          <table><thead><tr><th>通路</th><th>litellm model</th><th>備註</th></tr></thead><tbody>
            {m.litellm.providerStrings.map((p) => <tr key={p.model}><td>{p.service}</td><td className="mono">{p.model}</td><td className="note">{p.note}</td></tr>)}
          </tbody></table>
          <h2 style={{ marginTop: 24 }}>已知陷阱</h2><Bullets items={m.litellm.caveats} />
          {hasPage("gateway") && <p><a href={linkTo("gateway")}>平台層級的 LiteLLM 版本、公告與陷阱 →</a></p>}
        </section>)}

      {tab === "內部測試" && <ModelTests m={m} />}
      {tab === "生命週期" && <ModelLifecycle m={m} />}

      {tab === "Onboarding" && EDITION === "full" && needDeep(deep?.onboarding && (
        <div className="row">
          <section className="card grow">
            <p className="note">對象：{deep.onboarding.audience}</p>
            <h2>步驟</h2>
            <ol className="bullets" style={{ paddingLeft: 22 }}>{deep.onboarding.steps.map((s) => <li key={s.title} style={{ marginBottom: 8 }}><strong>{s.title}</strong>：{s.detail}</li>)}</ol>
            <h2 style={{ marginTop: 24 }}>程式範例</h2>
            {deep.onboarding.codeSamples.map((c) => <div key={c.title}><div className="note">{c.title}（{c.lang}）</div><pre className="code">{c.code}</pre></div>)}
          </section>
          <aside className="side">
            <section className="card hero-accent"><div style={{ fontSize: 13, opacity: 0.85 }}>應用團隊用這些名稱呼叫</div>
              {deep.onboarding.aliases.map((a) => <div key={a.alias} className="mono" style={{ fontSize: 16, marginTop: 10 }}>{a.alias}<div style={{ fontSize: 12, opacity: 0.85 }}>→ {a.target}{a.note ? `（${a.note}）` : ""}</div></div>)}</section>
            <section className="card"><h2>前置條件</h2><Bullets items={deep.onboarding.prerequisites} /></section>
            <section className="card"><h2>參數建議</h2>{deep.onboarding.parameterGuidance.map((p) => <p key={p.parameter} style={{ margin: "0 0 10px", fontSize: 14 }}><span className="mono">{p.parameter}</span>：{p.guidance}</p>)}</section>
            <section className="card"><h2>資料等級</h2><p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>{deep.onboarding.dataClassification}</p></section>
            <section className="card"><h2>支援窗口</h2><p style={{ margin: 0, fontSize: 14 }}>{deep.onboarding.support}</p></section>
          </aside>
        </div>))}
    </>
  );
}

function Pricing({ m }: { m: Model }) {
  const sheets = m.offerings.flatMap((o) => o.pricing.map((p) => ({ o, p })));
  const [sel, setSel] = useState(0);
  const [inTok, setIn] = useState(3000);
  const [outTok, setOut] = useState(1500);
  const [cachedPct, setCached] = useState(0);
  const [calls, setCalls] = useState(100000);
  const s = sheets[sel]?.p;
  const cost = s ? calls * ((inTok * (1 - cachedPct / 100) * s.input + inTok * (cachedPct / 100) * (s.cacheRead ?? s.input) + outTok * s.output) / 1e6) : 0;
  const after = s?.thereafter ? calls * ((inTok * (1 - cachedPct / 100) * s.thereafter.input + inTok * (cachedPct / 100) * (s.thereafter.cacheRead ?? s.thereafter.input) + outTok * s.thereafter.output) / 1e6) : undefined;
  const num = (label: string, v: number, set: (n: number) => void, step = 100) => (
    <label className="note" style={{ display: "flex", flexDirection: "column", gap: 4 }}>{label}<input type="text" inputMode="numeric" value={v} onChange={(e) => set(Number(e.target.value.replace(/\D/g, "")) || 0)} style={{ minWidth: 0 }} step={step} /></label>);
  return (
    <>
      <section className="card"><h2>價格表（USD / 1M tokens）</h2>
        <table><thead><tr><th>通路</th><th>範圍</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th><th>長文</th><th>有效期</th><th>可信度</th></tr></thead><tbody>
          {sheets.map(({ o, p }, i) => (
            <tr key={i}><td>{o.cloud.toUpperCase()}</td><td>{p.scope}</td><td className="mono">{money(p.input)}</td><td className="mono">{money(p.output)}</td><td className="mono">{money(p.cacheRead)}</td><td className="mono">{money(p.cacheWrite)}</td>
              <td className="mono">{p.longContext ? `>${fmt(p.longContext.thresholdInputTokens)}：${money(p.longContext.input)} / ${money(p.longContext.output)}` : "—"}</td>
              <td>{p.validUntil ? <>至 {p.validUntil}{p.thereafter && <div className="src">之後 {money(p.thereafter.input)} / {money(p.thereafter.output)}</div>}</> : "—"}</td>
              <td><Verif v={p.verification} /></td></tr>))}
          {/* A channel with no price sheet is shown explicitly, so a missing price is not mistaken for "same as the others". */}
          {m.offerings.filter((o) => o.pricing.length === 0).map((o) => (
            <tr key={o.id}><td>{o.cloud.toUpperCase()}</td><td colSpan={8} className="src">這個通路還沒有價格資料（官方尚未公布，或尚未查到來源）</td></tr>))}
        </tbody></table>
        {sheets.flatMap(({ p }) => p.notes ?? []).map((n) => <div key={n} className="note">・{n}</div>)}
      </section>
      <section className="card"><h2>每月成本試算</h2>
        <div className="grid3" style={{ gridTemplateColumns: "repeat(5,minmax(0,1fr))", alignItems: "end" }}>
          <label className="note" style={{ display: "flex", flexDirection: "column", gap: 4 }}>價格表
            <select value={sel} onChange={(e) => setSel(Number(e.target.value))}>{sheets.map(({ o, p }, i) => <option key={i} value={i}>{o.cloud.toUpperCase()} · {p.scope}</option>)}</select></label>
          {num("每次輸入 tokens", inTok, setIn)}{num("每次輸出 tokens（含 thinking）", outTok, setOut)}{num("快取命中 %", cachedPct, (n) => setCached(Math.min(100, n)), 5)}{num("每月呼叫次數", calls, setCalls, 1000)}
        </div>
        <p style={{ fontSize: 28, margin: "20px 0 4px" }} className="mono">${fmt(cost, 2)} <span className="note">/ 月</span></p>
        {after !== undefined && <p className="src">促銷到期後：${fmt(after, 2)} / 月</p>}
        <p className="note">推理模型的輸出 tokens 包含 thinking，實際用量請以內部 perf 實測的 usage 為準；未計入長文加價與 batch 折扣。</p>
      </section>
    </>
  );
}

function ModelLifecycle({ m }: { m: Model }) {
  const lc = useData(loaders.lifecycle);
  if (!lc.data) return <Status error={lc.error} />;
  const ids = new Set(m.offerings.map((o) => o.providerModelId).concat(m.vendorModelId ?? "", m.id));
  const evs = lc.data.events.filter((e) => ids.has(e.providerModelId) || e.modelName === m.name);
  return (
    <section className="card">
      <table><thead><tr><th>通路</th><th>EOL 不早於</th><th>Legacy 期</th><th>退役</th><th>替代</th></tr></thead><tbody>
        {m.offerings.map((o) => <tr key={o.id}><td>{o.cloud.toUpperCase()} · {o.service}</td><td className="mono">{o.lifecycle.eolNoSoonerThan ?? "—"}</td><td>{o.lifecycle.legacyPeriod ?? "—"}</td><td className="mono">{o.lifecycle.retirementDate ?? "—"}</td><td>{o.lifecycle.replacement ?? "—"}</td></tr>)}
      </tbody></table>
      {evs.length > 0 && <><h2 style={{ marginTop: 20 }}>行事曆事件</h2>{evs.map((e) => <div key={e.id} className="list-item"><span className="mono">{e.date}</span><span>{e.service} · {e.event}（剩 {daysFrom(e.date)} 天）</span><Verif v={e.verification} /></div>)}</>}
    </section>);
}
