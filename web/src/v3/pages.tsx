// The v3 pages: each reads one view (llmops-views/v1) of the selected release.
import { useState } from "react";
import { fmt, linkTo, money, useView, type J } from "./data";
import { Basis, Bullets, Cell, Empty, Fields, Filters, PageHead, Records, Sections, Src, Status } from "./parts";

const ModelLink = ({ id, name }: { id?: string; name?: string }) =>
  id ? <a href={linkTo(`models/${id}`)}>{name || id}</a> : <>{name ?? "—"}</>;
const prio = (p?: string) => (p ? <span className={`tag ${p}`}>{p}</span> : null);

// ---------------------------------------------------------------- 總覽
export function Overview() {
  const { data, error } = useView("overview");
  if (!data) return <Status error={error} />;
  const d = data.digest ?? {};
  return (
    <>
      <PageHead eyebrow={`資料日 ${data.asOf}${d.day ? ` · 最新研究 ${d.day}` : ""}`} title="今日重點" />
      <div className="stats">
        {(data.kpis ?? []).map((k: J) => (
          <a key={k.id} className="card stat" href={linkTo(String(k.href ?? "").replace(/^#\//, ""))} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="note">{k.label}</div><div className="v">{fmt(k.value)}</div>
          </a>
        ))}
      </div>
      {d.headline && <div className="card" style={{ marginTop: 16 }}><p className="lead">{d.headline}</p><Bullets items={(d.points ?? []).map((p: J) => (typeof p === "string" ? p : p.text ?? p.title))} /></div>}
      <div className="card" style={{ marginTop: 16 }}>
        <h2>待辦</h2>
        {data.actions?.length ? (
          <table><thead><tr><th>優先</th><th>事項</th><th>期限</th><th>模型</th></tr></thead><tbody>
            {data.actions.map((a: J, i: number) => (
              <tr key={i}><td>{prio(a.priority)}</td><td>{a.action}</td><td className="mono">{a.due ?? "—"}</td>
                <td>{(a.models ?? []).map((m: string) => <div key={m}><ModelLink id={m} /></div>)}</td></tr>
            ))}
          </tbody></table>
        ) : <p className="note">沒有待辦。</p>}
      </div>
      {!!data.qa?.length && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>統整複查（QA）</h2>
          <ul className="bullets">{data.qa.map((q: J, i: number) => <li key={i}>{q.verdict && <b>{q.verdict} </b>}{q.message ?? q.summary ?? JSON.stringify(q)}</li>)}</ul>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- 新聞
export function News() {
  const { data, error } = useView("news");
  const [sec, setSec] = useState("all");
  if (!data) return <Status error={error} />;
  const sections = (data.sections ?? []).filter((s: J) => sec === "all" || s.id === sec);
  return (
    <>
      <PageHead eyebrow={`最近 ${data.windowDays} 天 · ${data.count} 則 · 今天新增 ${data.newToday}`} title="新聞" />
      <Filters label="分類" value={sec} onChange={setSec}
        options={[["all", "全部"], ...(data.sections ?? []).map((s: J) => [s.id, `${s.label}（${s.items.length}）`] as const)]} />
      {sections.map((s: J) => (
        <section key={s.id}>
          <h2>{s.label}</h2>
          {s.items.map((it: J) => (
            <div key={it.itemId ?? it.topic} className="card list-item" style={{ marginBottom: 12 }}>
              <div className="note">{it.date}{it.impact === "high" && <span className="tag imp-high" style={{ marginLeft: 8 }}>高影響</span>}{it.isNew && <span className="tag tag-new" style={{ marginLeft: 8 }}>新</span>}</div>
              <h3 style={{ margin: "6px 0" }}>{it.title}</h3>
              <p>{it.summary}</p>
              <div className="note">{(it.models ?? []).map((m: string) => <span key={m} style={{ marginRight: 8 }}><ModelLink id={m} /></span>)} <Src ids={it.src} /></div>
              {!!it.history?.length && <details><summary className="note">之前的說法（{it.history.length}）</summary>
                <ul className="bullets note">{it.history.map((h: J, i: number) => <li key={i}>{h.date} {h.title ?? h.summary}</li>)}</ul></details>}
            </div>
          ))}
        </section>
      ))}
      {!!data.checks?.length && (
        <div className="card"><h2>複查紀錄</h2>
          <ul className="bullets">{data.checks.map((c: J, i: number) => <li key={i}><span className="note">{c.date}</span> {c.title}：{c.summary} <Src ids={c.src} /></li>)}</ul></div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- 模型目錄
export function Models() {
  const { data, error } = useView("models");
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("all");
  if (!data) return <Status error={error} />;
  const channels: J[] = data.channels ?? [];
  const tiers = Array.from(new Map((data.models as J[]).filter((m) => m.tier).map((m) => [m.tier, m.tierLabel ?? m.tier])).entries());
  const rows = (data.models as J[]).filter((m) => (tier === "all" || m.tier === tier) &&
    (!q || `${m.name} ${m.id} ${m.vendorLabel}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <PageHead eyebrow={`共 ${data.models.length} 個模型 · 資料日 ${data.asOf}`} title="模型目錄" />
      <div className="row" style={{ gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        <input placeholder="搜尋模型或廠商" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋" />
        <Filters label="分級" value={tier} onChange={setTier} options={[["all", "全部分級"], ...tiers.map(([t, l]) => [t, l] as const)]} />
      </div>
      <div className="card">
        <table>
          <thead><tr><th>模型</th><th>廠商</th><th>分級</th><th>發布</th><th>Context</th>{channels.map((c) => <th key={c.id}>{c.title}</th>)}<th>最低價（in / out）</th><th>旗標</th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td><ModelLink id={m.id} name={m.name} />{m.summary && <div className="note" style={{ maxWidth: 320 }}>{m.summary.slice(0, 80)}{m.summary.length > 80 ? "…" : ""}</div>}</td>
                <td>{m.vendorLabel}</td><td>{m.tierLabel ?? "—"}</td><td className="mono">{m.releaseDate ?? "—"}</td>
                <td className="mono">{fmt(m.contextWindow)}</td>
                {channels.map((c) => <td key={c.id}><Cell c={m.channels?.[c.id]} /></td>)}
                <td className="mono">{m.priceMin ? `${money(m.priceMin.input)} / ${money(m.priceMin.output)}` : "—"}</td>
                <td>{(m.flags ?? []).map((f: string) => <span key={f} className="pill warn" style={{ marginRight: 4 }}>{f}</span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty>沒有符合的模型</Empty>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- 矩陣
export function Matrix() {
  const { data, error } = useView("matrix");
  if (!data) return <Status error={error} />;
  const channels: J[] = data.channels ?? [];
  return (
    <>
      <PageHead eyebrow={`${data.rows.length} 個模型 × ${channels.length} 個通路 · 資料日 ${data.asOf}`} title="模型 × 通路" />
      <div className="card">
        <table>
          <thead><tr><th>模型</th>{channels.map((c) => <th key={c.id}>{c.title}</th>)}</tr></thead>
          <tbody>{(data.rows as J[]).map((r) => (
            <tr key={r.id}><td><ModelLink id={r.id} name={r.name} /><div className="note">{r.vendorLabel}</div></td>
              {channels.map((c) => {
                const cell = r.cells?.[c.id];
                return <td key={c.id}><Cell c={cell} />{cell?.since && <div className="note mono">{cell.since}</div>}
                  {cell?.price && <div className="note mono">{money(cell.price.input)} / {money(cell.price.output)}</div>}</td>;
              })}</tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- 價格
export function Pricing() {
  const { data, error } = useView("pricing");
  const [q, setQ] = useState("");
  if (!data) return <Status error={error} />;
  const cur = (data.current as J[]).filter((p) => !q || `${p.name} ${p.model} ${p.channel}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHead eyebrow={`單位 ${data.unit} · 資料日 ${data.asOf}`} title="價格" />
      {!!data.scheduled?.length && <div className="card"><h2>已排定的調價</h2>
        <table><thead><tr><th>生效日</th><th>模型</th><th>通路</th><th>項目</th><th>新價格</th><th>來源</th></tr></thead><tbody>
          {(data.scheduled as J[]).map((p, i) => <tr key={i}><td className="mono">{p.from}</td><td><ModelLink id={p.model} name={p.name} /></td><td>{p.channel}</td>
            <td>{p.label}<div className="note">{p.whereLabel}</div></td><td className="mono">{p.display}</td><td><Src ids={p.src} /></td></tr>)}
        </tbody></table></div>}
      {!!data.changes?.length && <div className="card" style={{ marginTop: 16 }}><h2>最近的變動</h2>
        <ul className="bullets">{(data.changes as J[]).map((c, i) => <li key={i}><span className="mono note">{c.date}</span> <b>{c.name}</b>：{c.summary} <Src ids={c.src} /></li>)}</ul></div>}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}><h2>目前價格（{cur.length}）</h2>
          <input placeholder="篩選模型或通路" value={q} onChange={(e) => setQ(e.target.value)} aria-label="篩選" /></div>
        <table><thead><tr><th>模型</th><th>通路</th><th>項目</th><th>價格</th><th>依據</th><th>核對</th></tr></thead><tbody>
          {cur.map((p, i) => <tr key={i}><td><ModelLink id={p.model} name={p.name} /></td><td>{p.channel}</td><td>{p.label}<div className="note">{p.whereLabel}</div></td>
            <td className="mono">{p.display}</td><td><Basis b={p.basis} /> <Src ids={p.src} max={1} /></td><td className="mono note">{p.verified ?? "—"}</td></tr>)}
        </tbody></table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- 市場
export function Market() {
  const { data, error } = useView("market");
  if (!data) return <Status error={error} />;
  return (
    <>
      <PageHead eyebrow={`${data.count} 個模型 · 資料日 ${data.asOf}`} title="市場追蹤" />
      {!!data.observations?.length && <div className="card"><h2>觀察</h2><Bullets items={data.observations} /></div>}
      <div className="card" style={{ marginTop: 16 }}>
        <table><thead><tr><th>模型</th><th>開發者</th><th>階段</th><th>熱度</th><th>發布 / 預期</th><th>授權</th></tr></thead><tbody>
          {(data.models as J[]).map((m) => (
            <tr key={m.id}><td><ModelLink id={m.id} name={m.name} /><div className="note">{m.summary ?? m.note}</div></td>
              <td>{m.developer ?? m.vendorLabel}{m.origin && <div className="note">{m.origin}</div>}</td>
              <td><span className="pill">{m.stageLabel ?? m.stage ?? "—"}</span></td>
              <td>{m.heatLabel ? <span className={`tag ${m.heat === "hit" ? "heat-hit" : ""}`} title={m.heatReason ?? ""}>{m.heatLabel}</span> : "—"}</td>
              <td className="note">{m.released ?? m.announced ?? ""}{m.expected && <div>{m.expected}</div>}</td>
              <td className="note">{m.license ?? "—"}</td></tr>
          ))}
        </tbody></table>
      </div>
      {!!data.method?.length && <details className="card" style={{ marginTop: 16 }}><summary>收錄方法</summary><Bullets items={data.method} /></details>}
    </>
  );
}

// ---------------------------------------------------------------- 退役
function LifeTable({ rows }: { rows: J[] }) {
  if (!rows?.length) return <p className="note">沒有項目。</p>;
  return (
    <table><thead><tr><th>日期</th><th>剩餘</th><th>模型</th><th>通路</th><th>類型</th><th>替代</th><th>來源</th></tr></thead><tbody>
      {rows.map((e, i) => (
        <tr key={i}><td className="mono">{e.date}</td><td className="mono">{e.days !== undefined ? `${e.days} 天` : "—"}</td>
          <td><ModelLink id={e.model} name={e.modelName ?? e.name} /><div className="note mono">{e.providerModelId}</div></td>
          <td>{e.channel}</td><td>{e.typeLabel ?? e.type}</td><td>{e.replacement ?? "—"}</td>
          <td><Basis b={e.basis} /> <Src ids={e.src} max={1} />{!!e.notes?.length && <details><summary className="note">說明</summary><Bullets items={e.notes} /></details>}</td></tr>
      ))}
    </tbody></table>
  );
}
export function Lifecycle() {
  const { data, error } = useView("lifecycle");
  if (!data) return <Status error={error} />;
  return (
    <>
      <PageHead eyebrow={`資料日 ${data.asOf}`} title="退役行事曆" />
      <div className="card"><h2>{data.windowDays} 天內（{data.upcoming?.length ?? 0}）</h2><LifeTable rows={data.upcoming} /></div>
      <div className="card" style={{ marginTop: 16 }}><h2>之後（{data.later?.length ?? 0}）</h2><LifeTable rows={data.later} /></div>
      <div className="card" style={{ marginTop: 16 }}><h2>最早退役日（no sooner than）</h2><LifeTable rows={data.noSoonerThan} /></div>
      <div className="card" style={{ marginTop: 16 }}><h2>最近已過</h2><LifeTable rows={data.recentlyPassed} /></div>
      {!!data.policies?.length && <div className="card" style={{ marginTop: 16 }}><h2>各通路的退役政策</h2>
        {(data.policies as J[]).map((p) => <div key={p.channel} style={{ marginBottom: 12 }}><b>{p.channel}</b><p>{p.summary}</p><Src ids={p.src} /></div>)}</div>}
    </>
  );
}

// ---------------------------------------------------------------- LiteLLM
export function Gateway() {
  const { data, error } = useView("gateway");
  if (!data) return <Status error={error} />;
  const r = data.recommended ?? {}, m = data.minimum ?? {};
  return (
    <>
      <PageHead eyebrow={`資料日 ${data.asOf}`} title="LiteLLM gateway" />
      <div className="grid2">
        <div className="card"><div className="note">建議版本</div><div className="stat"><div className="v">{r.version?.display ?? "—"}</div></div>
          {r.pinning && <p className="note">{r.pinning}</p>}<Bullets items={r.rationale} /><Src ids={r.version?.src} /></div>
        <div className="card"><div className="note">最低基準版本</div><div className="stat"><div className="v">{m.version?.display ?? "—"}</div></div>
          <Bullets items={m.rationale} /><Src ids={m.version?.src} /></div>
      </div>
      {data.supportPolicy && <div className="card" style={{ marginTop: 16 }}><h2>支援政策</h2><p>{data.supportPolicy}</p><Bullets items={data.supportedLines} /></div>}
      <div className="card" style={{ marginTop: 16 }}><Sections sections={data.sections} /></div>
      <div className="card" style={{ marginTop: 16 }}><h2>每個模型</h2>
        {(data.models as J[]).map((x) => <details key={x.id}><summary><ModelLink id={x.id} name={x.name} /></summary><Sections sections={x.sections} /></details>)}</div>
    </>
  );
}

// ---------------------------------------------------------------- 資安
export function Security() {
  const { data, error } = useView("security");
  if (!data) return <Status error={error} />;
  return (
    <>
      <PageHead eyebrow={`${data.advisories.length} 則公告 · 資料日 ${data.asOf}`} title="資安" />
      {(data.advisories as J[]).map((a) => (
        <div key={a.id} className="card" style={{ marginBottom: 12 }}>
          <div><span className={`tag ${a.severity === "critical" ? "sev-critical P0" : "P1"}`}>{a.severityLabel ?? a.severity}</span> <span className="mono note">{a.id}</span> <span className="note">{a.component}</span></div>
          <h3 style={{ margin: "6px 0" }}>{a.title}</h3>
          <p>{a.summary}</p>
          <dl className="kv">{a.affected && <><dt>影響版本</dt><dd>{a.affected}</dd></>}{a.fixedIn && <><dt>修正版本</dt><dd>{a.fixedIn}</dd></>}{a.action && <><dt>處理</dt><dd>{a.action}</dd></>}</dl>
          <Src ids={a.src} />
        </div>
      ))}
      <div className="card"><h2>模型安全</h2>
        {(data.models as J[]).map((x) => <details key={x.id}><summary><ModelLink id={x.id} name={x.name} /></summary><Sections sections={x.sections} /></details>)}</div>
    </>
  );
}

// ---------------------------------------------------------------- 合規
export function Compliance() {
  const { data, error } = useView("compliance");
  if (!data) return <Status error={error} />;
  return (
    <>
      <PageHead eyebrow={`資料日 ${data.asOf}`} title="合規與資料處理" />
      {!!data.items?.length && <div className="card"><h2>法規與政策</h2>
        {(data.items as J[]).map((it, i) => <div key={i} className="v3-rec"><div className="v3-rec-title">{it.title ?? it.id}</div>{it.summary && <p>{it.summary}</p>}
          {it.fields && <Fields fields={it.fields} />}{it.sections && <Sections sections={it.sections} />}<Src ids={it.src} /></div>)}</div>}
      <div className="card" style={{ marginTop: 16 }}>
        <table><thead><tr><th>模型</th><th>通路</th><th>台灣資料落地</th><th>ZDR</th><th>處理者</th></tr></thead><tbody>
          {(data.models as J[]).flatMap((m) => (m.dataProcessing ?? []).map((d: J, i: number) => (
            <tr key={m.id + d.channel}>{i === 0 && <td rowSpan={m.dataProcessing.length}><ModelLink id={m.id} name={m.name} /></td>}
              <td>{d.channel}</td><td>{d.taiwanResidency ?? "—"}</td><td>{d.zdr ?? "—"}</td><td className="note">{d.processor ?? "—"}</td></tr>)))}
        </tbody></table>
        {(data.models as J[]).filter((m) => m.sections?.length).map((m) => <details key={m.id}><summary>{m.name}</summary><Sections sections={m.sections} /></details>)}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- 品質
export function Quality() {
  const { data, error } = useView("quality");
  const [lvl, setLvl] = useState("all");
  if (!data) return <Status error={error} />;
  const rows = (data.conflicts as J[]).filter((c) => lvl === "all" || c.level === lvl);
  return (
    <>
      <PageHead eyebrow={`警告 ${data.counts?.warn ?? 0} · 提示 ${data.counts?.info ?? 0} · 資料日 ${data.asOf}`} title="資料品質" />
      <Filters label="層級" value={lvl} onChange={setLvl} options={[["all", "全部"], ["warn", "警告"], ["info", "提示"]]} />
      <div className="card">
        <table><thead><tr><th>層級</th><th>規則</th><th>說明</th><th>模型</th><th>負責角色</th></tr></thead><tbody>
          {rows.map((c) => <tr key={c.id}><td><span className={`tag ${c.level === "warn" ? "P1" : "P2"}`}>{c.level}</span></td><td className="mono note">{c.rule}</td>
            <td>{c.message}</td><td>{c.model && <ModelLink id={c.model} />}</td><td className="mono note">{c.owner}</td></tr>)}
        </tbody></table>
      </div>
    </>
  );
}

export { Records };
