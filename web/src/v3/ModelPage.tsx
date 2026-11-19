// One model (views/models/<id>.json): identity, card, channels, deep dive, LiteLLM, security, internal, timeline, quality.
import { useState } from "react";
import { fmt, linkTo, money, useView, type J, type Val } from "./data";
import { Cell, Fields, PageHead, Sections, Src, Status, Tabs } from "./parts";

const TABS = ["模型卡", "通路", "市場", "深度調查", "LiteLLM", "資安", "內部", "時間軸", "品質"] as const;
type Tab = (typeof TABS)[number];

export default function ModelPage({ id }: { id: string }) {
  const { data, error } = useView(`models/${encodeURIComponent(id)}`);
  const [picked, setTab] = useState<Tab | null>(null);
  if (!data) return <Status error={error && `${id}：${error}`} />;
  const row = data.row ?? {}, ident = data.identity ?? {};
  const offerings: J[] = Object.values(data.offerings ?? {});
  // open the first tab that has something: a model only the market roles know yet has no card or channels
  const tab: Tab = picked ?? (data.card ? "模型卡" : offerings.length ? "通路" : data.market ? "市場" : "時間軸");
  return (
    <>
      <p><a href={linkTo("models")}>← 模型目錄</a></p>
      <PageHead eyebrow={`${row.vendorLabel ?? ident.vendor ?? ""}${ident.family ? ` · ${ident.family}` : ""}${row.tierLabel ? ` · ${row.tierLabel}` : ""}`} title={row.name ?? ident.name ?? id}
        right={<span className="mono note">{id}</span>} />
      {row.summary && <p className="lead">{row.summary}</p>}
      {!offerings.length && data.market && (
        <div className="card" role="note" style={{ marginBottom: 16 }}>
          <b>通路資料還沒建立。</b> 市場紀錄：{(data.market.sections ?? []).flatMap((s: J) => s.fields).filter((f: Val) => f.key === "release.stage").map((f: Val) => `${f.display}${f.note ? `（${f.note}）` : ""}`).join("；") || "—"}。
          各通路的上架／GA 狀態、model id 與價格由 csp-* 角色寫入，模型卡由 model-cards 寫入；它們執行之後這裡才會有通路與模型卡。
        </div>
      )}
      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="card stat"><div className="note">發布日</div><div className="v">{row.releaseDate ?? "—"}</div></div>
        <div className="card stat"><div className="note">Context</div><div className="v">{fmt(row.contextWindow)}</div></div>
        <div className="card stat"><div className="note">最低價（in / out）</div><div className="v">{row.priceMin ? `${money(row.priceMin.input)} / ${money(row.priceMin.output)}` : "—"}</div></div>
        <div className="card stat"><div className="note">首次上線</div><div className="v">{data.firstLive ?? "—"}</div></div>
      </div>
      {!!ident.aliases?.length && <p className="note">別名：{ident.aliases.join("、")}</p>}
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <div className="card">
        {tab === "模型卡" && <Doc d={data.card} empty="還沒有模型卡。" />}
        {tab === "通路" && (offerings.length ? offerings.map((o) => <Offering key={o.channel} o={o} />) : <p className="note">還沒有上架到任何通路。</p>)}
        {tab === "市場" && <Doc d={data.market} empty="沒有市場紀錄。" />}
        {tab === "深度調查" && <Doc d={data.survey} empty="沒有深度調查（只做上線 30 天內的模型）。" />}
        {tab === "LiteLLM" && <Doc d={data.litellm} />}
        {tab === "資安" && <Doc d={data.security} />}
        {tab === "內部" && <Doc d={data.internal} empty="沒有內部決定。" />}
        {tab === "時間軸" && (data.timeline?.length ? (
          <table><thead><tr><th>日期</th><th>事件</th><th>通路</th><th>來源</th></tr></thead><tbody>
            {(data.timeline as J[]).map((t, i) => <tr key={i}><td className="mono">{t.date}</td><td>{t.what}</td><td>{t.where || "—"}</td><td><Src ids={t.src} max={2} /></td></tr>)}
          </tbody></table>) : <p className="note">沒有事件。</p>)}
        {tab === "品質" && (data.conflicts?.length ? (
          <ul className="bullets">{(data.conflicts as J[]).map((c) => <li key={c.id}><span className={`tag ${c.level === "warn" ? "P1" : "P2"}`}>{c.level}</span> {c.message} <span className="note mono">（{c.owner}）</span></li>)}</ul>
        ) : <p className="note">沒有待處理的問題。</p>)}
      </div>
      {!!data.news?.length && <div className="card" style={{ marginTop: 16 }}><h2>相關新聞</h2>
        <ul className="bullets">{(data.news as J[]).map((n, i) => <li key={i}><span className="note mono">{n.date}</span> {n.title} <Src ids={n.src} /></li>)}</ul></div>}
    </>
  );
}

function Doc({ d, empty }: { d?: J; empty?: string }) {
  if (!d) return <p className="note">{empty ?? "沒有資料。"}</p>;
  return (
    <>
      <p className="note">{d.verified ? `最後核對 ${d.verified}` : "尚未核對"}{d.updated ? ` · 更新 ${d.updated}` : ""}</p>
      <Sections sections={d.sections} empty={empty} />
    </>
  );
}

function Offering({ o }: { o: J }) {
  const prices: Val[] = o.pricing?.current ?? [];
  const scheduled: Val[] = o.pricing?.scheduled ?? [];
  const life: Val[] = Object.values(o.lifecycle?.summary ?? {});
  return (
    <section className="v3-section" style={{ borderBottom: "1px solid var(--line2)", paddingBottom: 16, marginBottom: 16 }}>
      <h2>{o.title} <Cell c={{ status: o.status, statusLabel: o.status?.toUpperCase(), since: o.since }} />{o.since && <span className="note mono"> since {o.since}</span>}</h2>
      <p className="note">{o.verified ? `最後核對 ${o.verified}` : "尚未核對"}</p>
      {!!prices.length && <><h3>價格</h3><Fields fields={prices} /></>}
      {!!scheduled.length && <><h3>已排定的調價</h3><Fields fields={scheduled} /></>}
      {!!life.length && <><h3>生命週期</h3><Fields fields={life} /></>}
      <Sections sections={o.sections} empty="" />
    </section>
  );
}
