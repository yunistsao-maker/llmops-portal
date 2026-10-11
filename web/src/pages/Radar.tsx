import { useState } from "react";
import type { DigestFile, DigestItem, RadarActionItem, RadarFile, RadarItem, WatchItem } from "../../../schema/types";
import { go } from "../App";
import { daysFrom, loaders, money, useData } from "../data";
import { Bullets, Filters, PageHead, Sources, Status } from "../ui";
import { HEAT_LABEL } from "./OpenModels";

type SectionKey = "newModels" | "lifecycleChanges" | "pricingChanges" | "litellm" | "security" | "regulatory";
const SECTIONS: [SectionKey, string][] = [
  ["newModels", "新模型"], ["lifecycleChanges", "生命週期變動"], ["pricingChanges", "價格"], ["litellm", "LiteLLM"], ["security", "資安"], ["regulatory", "法規"],
];
const IMPACT: Record<DigestItem["impact"], string> = { high: "高", medium: "中", low: "低" };
const RETIRED: Record<string, string> = { expired: "已到期", closed: "已完成或取代", stale: "30 天未再提到" };
const ACTION_FILTERS = [["all", "全部"], ["new", "今天新增"], ["P0", "P0"], ["P1", "P1"], ["P2", "P2"]] as const;
const SHOW = 6;
const md = (iso: string) => iso.slice(5);

/**
 * Release Radar. Reads the merged view (data/radar.json, one version per day: the date is the version).
 * #/digest/<id> still opens one raw daily digest, as an audit record. Without radar.json the page falls back
 * to the newest digest, as before.
 */
export default function Radar({ digestId }: { digestId?: string }) {
  const radar = useData(loaders.radar);
  if (digestId) return <DigestView digestId={digestId} audit />;
  if (radar.error) return <DigestView />;
  if (!radar.data) return <Status />;
  return <MergedView r={radar.data} />;
}

function MergedView({ r }: { r: RadarFile }) {
  const catalog = useData(loaders.catalog);
  const inv = useData(loaders.inventory);
  const lc = useData(loaders.lifecycle);
  const [filter, setFilter] = useState<string>("all");
  if (!catalog.data) return <Status error={catalog.error} />;
  const urgent = inv.data?.deployments.filter((x) => x.risk === "act-now" || x.risk === "retired").length;
  const next30 = lc.data?.events.filter((e) => { const n = daysFrom(e.date); return n >= 0 && n <= 30 && e.event !== "eol-no-sooner-than"; }) ?? [];
  const items = r.actionItems.filter((a) => filter === "all" || (filter === "new" ? a.isNew : a.priority === filter));
  const newCount = r.actionItems.filter((a) => a.isNew).length;
  return (
    <>
      <PageHead eyebrow={`合併版本 · 涵蓋 ${r.coverage.start} 至 ${r.coverage.end} 的 ${r.coverage.digests.length} 份每日紀錄`} title="Release Radar" right={
        <label className="note">版本{" "}
          <select value={r.asOf} onChange={() => undefined} aria-describedby="radar-version-note"><option value={r.asOf}>{r.asOf}</option></select>
          <span id="radar-version-note" className="note" style={{ marginLeft: 8 }}>每天一版；舊版本保留在發布紀錄</span>
        </label>} />
      <p className="lead">{r.headline}</p>
      <section className="stats" aria-label="統計">
        <Stat label="目錄中的新模型" value={catalog.data.models.length} onClick={() => go("models")} />
        <Stat label="平台路由：30 天內到期或已退役" value={urgent ?? "—"} danger onClick={() => go("eol")} />
        <Stat label="全通路 30 天內生命週期事件" value={next30.length} />
        <Stat label={`進行中的行動項目（今天新增 ${newCount}）`} value={r.actionItems.length} />
      </section>
      <div className="row">
        <section className="card grow">
          <div className="pagehead" style={{ alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>行動項目</h2>
            <Filters label="篩選行動項目" options={ACTION_FILTERS.map(([v, l]) => [v, v === "all" ? `${l}（${r.actionItems.length}）` : v === "new" ? `${l}（${newCount}）` : `${l}（${r.actionItems.filter((a) => a.priority === v).length}）`] as const)} value={filter} onChange={setFilter} />
          </div>
          <p className="note">未到期的項目、以及仍在追蹤的項目都在這裡，不論是哪一天提出的；同一件事在不同天的說法已合併成一項。</p>
          {items.length === 0 ? <p className="note">沒有符合條件的項目。</p> : items.map((a) => <ActionRow key={a.id} a={a} />)}
          {r.retired.length > 0 && (
            <details className="radar-retired">
              <summary>最近 14 天移出的項目（{r.retired.length}）</summary>
              {r.retired.map((a) => (
                <div className="list-item" key={a.id}>
                  <span className="mono" style={{ width: 100, flexShrink: 0 }}>{a.retiredOn}</span>
                  <span className="tag P2">{RETIRED[a.reason]}</span>
                  <span style={{ fontSize: 14, lineHeight: 1.6, color: "var(--muted)" }}>{a.action}{a.note && <div className="note">{a.note}</div>}</span>
                </div>))}
            </details>)}
        </section>
        <Side watchlist={r.watchlist} />
      </div>
      <div className="grid2">
        {SECTIONS.map(([k, label]) => r[k].length > 0 && <SectionCard key={k} label={label} items={r[k]} />)}
      </div>
      {r.unverified.length > 0 && (
        <section className="card">
          <details><summary><strong>尚未驗證（最近 7 天，{r.unverified.length} 項）</strong></summary>
            <ul className="bullets">{r.unverified.map((u) => <li key={u} className="src" style={{ fontSize: 14 }}>{u}</li>)}</ul>
          </details>
        </section>)}
      <section className="card om-notes">
        <h2>這一頁怎麼合併</h2>
        <Bullets items={r.rules} />
        <details style={{ marginTop: 8 }}>
          <summary className="note">原始每日紀錄（稽核用）</summary>
          <p className="radar-digests">{r.coverage.digests.map((d) => <a key={d} href={`#/digest/${d}`} className="mono">{d}</a>)}</p>
        </details>
        <p className="note" style={{ marginBottom: 0 }}>版本 {r.asOf}（產生於 {r.generatedAt}）。研究任務產出，尚未經平台團隊逐項審核。</p>
      </section>
    </>
  );
}

function ActionRow({ a }: { a: RadarActionItem }) {
  return (
    <div className="list-item">
      <span className="mono" style={{ width: 100, flexShrink: 0 }}>{a.due ?? "持續"}
        {a.due && <div className="note">{daysFrom(a.due) >= 0 ? `剩 ${daysFrom(a.due)} 天` : `已過 ${-daysFrom(a.due)} 天`}</div>}</span>
      <span className={`tag ${a.priority}`}>{a.priority}</span>
      <span style={{ fontSize: 15, lineHeight: 1.6 }}>
        {a.isNew && <span className="tag tag-new" style={{ marginRight: 8 }}>今天新增</span>}{a.action}
        {a.relatedModelIds?.map((m) => <a key={m} href={`#/models/${m}`} className="note" style={{ marginLeft: 8 }}>{m}</a>)}
        <div className="note">{a.isNew ? `${md(a.firstSeen)} 提出` : `自 ${md(a.firstSeen)} 起 · 最後提到 ${md(a.lastSeen)}`}{a.seenIn.length > 1 && ` · 合併 ${a.seenIn.length} 份紀錄`}</div>
      </span>
    </div>
  );
}

function SectionCard({ label, items }: { label: string; items: RadarItem[] }) {
  const [all, setAll] = useState(false);
  const fresh = items.filter((i) => i.isNew).length;
  const shown = all ? items : items.slice(0, Math.max(SHOW, fresh));
  return (
    <section className="card">
      <h2>{label} <span className="note">{items.length} 項{fresh > 0 && ` · 今天新增 ${fresh}`}</span></h2>
      {shown.map((it) => (
        <details key={it.id}>
          <summary><span className={`tag imp-${it.impact}`}>{IMPACT[it.impact]}</span> {it.isNew && <span className="tag tag-new">新</span>} {it.title} {it.date && <span className="note mono">{it.date}</span>}</summary>
          <p style={{ fontSize: 14, lineHeight: 1.7 }}>{it.detail}<Sources refs={it.sources} /></p>
          <p className="note">第一次出現 {it.firstSeen}{it.lastSeen !== it.firstSeen && `，最後更新 ${it.lastSeen}`}（{it.seenIn.length} 份紀錄）</p>
        </details>))}
      {items.length > shown.length && <button className="btn" style={{ marginTop: 12 }} onClick={() => setAll(true)}>顯示其餘 {items.length - shown.length} 項</button>}
    </section>
  );
}

function Side({ watchlist }: { watchlist: WatchItem[] }) {
  const catalog = useData(loaders.catalog);
  const om = useData(loaders.openModels);
  return (
    <aside className="side">
      {catalog.data && (
        <section className="card">
          <h2>目錄中的模型</h2>
          {catalog.data.models.map((m) => {
            const p = m.offerings.flatMap((o) => o.pricing).find((x) => x.input !== undefined);
            return (
              <a key={m.id} href={`#/models/${m.id}`} className="list-item" style={{ justifyContent: "space-between", color: "inherit" }}>
                <span style={{ fontWeight: 500 }}>{m.name}</span>
                <span className="note">{[...new Set(m.offerings.map((o) => o.cloud.toUpperCase()))].join("、")} · {money(p?.input)} / {money(p?.output)}</span>
              </a>);
          })}
          <p className="note">價格：每 1M tokens（USD），Global 部署。</p>
        </section>)}
      {om.data && (
        <section className="card">
          <h2>開源模型雷達</h2>
          {om.data.models.filter((m) => m.heat !== "watch").map((m) => (
            <a key={m.id} href={`#/open/${m.id}`} className="list-item" style={{ justifyContent: "space-between", color: "inherit" }}>
              <span style={{ fontWeight: 500 }}>{m.name}</span>
              <span className={`tag heat-${m.heat}`}>{HEAT_LABEL[m.heat]}</span>
            </a>))}
          <p className="note">市場熱度（資料截至 {om.data.asOf}），不是導入清單。<a href="#/open">看全部 {om.data.models.length} 個與判定依據</a></p>
        </section>)}
      <section className="card">
        <h2>Watchlist</h2>
        {watchlist.map((w) => (
          <div key={w.name} className="list-item" style={{ display: "block" }}>
            <div style={{ fontWeight: 500 }}>{w.name} <span className="note">{w.status}</span></div>
            <div className="note">{w.expected} — {w.note}</div>
          </div>))}
      </section>
    </aside>
  );
}

/** One raw daily digest (the page as it was before the merged view; kept for audit and as a fallback). */
function DigestView({ digestId, audit }: { digestId?: string; audit?: boolean }) {
  const manifest = useData(loaders.manifest);
  const ids = manifest.data?.digests ?? [];
  const id = digestId ?? ids[ids.length - 1];
  const digest = useData(() => (id ? loaders.digest(id) : Promise.reject("no digest")), [id]);
  const catalog = useData(loaders.catalog);
  if (!digest.data || !catalog.data) return <Status error={digest.error || catalog.error || manifest.error} />;
  const d: DigestFile = digest.data;
  const items = [...d.actionItems].sort((a, b) => (a.priority + (a.due ?? "9")).localeCompare(b.priority + (b.due ?? "9")));
  return (
    <>
      <PageHead eyebrow={`${audit ? "原始每日紀錄（稽核用）" : "週報"} · ${d.periodStart} 至 ${d.periodEnd}`} title={audit ? `每日紀錄 ${d.id}` : "Release Radar"} />
      {audit && <p className="note radar-audit">這是 {d.id} 那一次研究的原始紀錄，只列當次的發現。目前的狀態請看 <a href="#/">Release Radar（合併版本）</a>。</p>}
      <p className="lead">{d.headline}</p>
      <div className="row">
        <section className="card grow">
          <h2>行動項目（當次）</h2>
          {items.map((a) => (
            <div className="list-item" key={a.action}>
              <span className="mono" style={{ width: 100, flexShrink: 0 }}>{a.due ?? "持續"}</span>
              <span className={`tag ${a.priority}`}>{a.priority}</span>
              <span style={{ fontSize: 15, lineHeight: 1.6 }}>{a.action}</span>
            </div>))}
        </section>
        <Side watchlist={d.watchlist} />
      </div>
      <div className="grid2">
        {SECTIONS.map(([k, label]) => d[k].length > 0 && (
          <section className="card" key={k}>
            <h2>{label}</h2>
            {d[k].map((it) => (
              <details key={it.title}>
                <summary><span className={`tag imp-${it.impact}`}>{IMPACT[it.impact]}</span> {it.title} {it.date && <span className="note mono">{it.date}</span>}</summary>
                <p style={{ fontSize: 14, lineHeight: 1.7 }}>{it.detail}<Sources refs={it.sources} /></p>
              </details>))}
          </section>))}
      </div>
      {d.unverified.length > 0 && (
        <section className="card"><h2>本期尚未驗證</h2><ul className="bullets">{d.unverified.map((u) => <li key={u} className="src" style={{ fontSize: 14 }}>{u}</li>)}</ul></section>)}
    </>
  );
}

function Stat({ label, value, danger, onClick }: { label: string; value: string | number; danger?: boolean; onClick?: () => void }) {
  const body = <><div className="eyebrow">{label}</div><div className="v" style={danger ? { color: "var(--danger)" } : undefined}>{value}</div></>;
  return onClick ? <button className="card stat statbtn" onClick={onClick}>{body}</button> : <div className="card stat">{body}</div>;
}
