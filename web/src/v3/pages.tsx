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
                {Object.keys(m.channels ?? {}).length || !m.stage
                  ? channels.map((c) => <td key={c.id}><Cell c={m.channels?.[c.id]} /></td>)
                  : <td colSpan={channels.length} className="note">市場紀錄：{m.stage === "released" ? "已釋出" : m.stage}（通路資料待 csp-* 角色建立）</td>}
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
  const [channel, setChannel] = useState("all");
  const [allChanges, setAllChanges] = useState(false);
  if (!data) return <Status error={error} />;
  const match = (p: J) => (channel === "all" || p.channel === channel) &&
    (!q || `${p.name} ${p.model} ${p.channel}`.toLowerCase().includes(q.toLowerCase()));
  const cur = pivot((data.current as J[]).filter(match));
  const sched = pivot((data.scheduled as J[] ?? []).filter(match), true);
  const channels = Array.from(new Set((data.current as J[]).map((p) => p.channel))).sort();
  const changes: J[] = data.changes ?? [];
  return (
    <>
      <PageHead eyebrow={`單位 ${data.unit} · 資料日 ${data.asOf}`} title="價格" />
      <div className="row" style={{ gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        <input placeholder="搜尋模型" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋模型" />
        <Filters label="通路" value={channel} onChange={setChannel} options={[["all", "全部通路"], ...channels.map((c) => [c, c] as const)]} />
      </div>
      <div className="card">
        <h2>目前價格 <span className="note">（{cur.length} 組 · USD / 1M tokens）</span></h2>
        <PriceTable rows={cur} />
      </div>
      {!!sched.length && <div className="card" style={{ marginTop: 16 }}>
        <h2>已排定的調價 <span className="note">（USD / 1M tokens）</span></h2>
        <PriceTable rows={sched} scheduled />
      </div>}
      {!!changes.length && <div className="card" style={{ marginTop: 16 }}><h2>最近的變動</h2>
        <ul className="bullets">{(allChanges ? changes : changes.slice(0, 6)).map((c, i) => <li key={i}><span className="mono note">{c.date}</span> <b>{c.name}</b>：{c.summary} <Src ids={c.src} /></li>)}</ul>
        {changes.length > 6 && <button className="linklike" onClick={() => setAllChanges(!allChanges)}>{allChanges ? "收起" : `顯示全部 ${changes.length} 則`}</button>}
      </div>}
    </>
  );
}

/** Price columns: the per-token prices; other keys (notes, long-context threshold, batch discount) go to 備註. */
const PRICE_COLS: [string, string][] = [
  ["price.input", "輸入"], ["price.output", "輸出"], ["price.cache-read", "快取讀取"],
  ["price.cache-write", "快取寫入"], ["price.cache-write-1h", "快取寫入 1h"],
];
interface PriceRow { model: string; name: string; channel: string; scope: string; from?: string; cells: Record<string, J>; extra: J[]; verified?: string; src: string[]; basis?: string }

const BASIS_RANK = ["official", "independent", "internal-test", "derived", "community", "unverified"];
/** One row per model × channel × scope (× effective date for scheduled prices). */
function pivot(items: J[], scheduled = false): PriceRow[] {
  const rows = new Map<string, PriceRow>();
  for (const p of items) {
    const scope = Object.entries(p.where ?? {}).map(([k, v]) => (k === "context" ? `${v} context` : String(v))).join(" · ") || "—";
    const id = [p.model, p.channel, scope, scheduled ? p.from : ""].join("|");
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { model: p.model, name: p.name, channel: p.channel, scope, from: p.from, cells: {}, extra: [], src: [] }));
    if (PRICE_COLS.some(([k]) => k === p.key) && !(p.key in r.cells)) r.cells[p.key] = p; else r.extra.push(p);
    if (p.verified && (!r.verified || p.verified < r.verified)) r.verified = p.verified; // the oldest check of the row
    for (const s of p.src ?? []) if (!r.src.includes(s)) r.src.push(s);
    if (p.basis && BASIS_RANK.indexOf(p.basis) > BASIS_RANK.indexOf(r.basis ?? "official")) r.basis = p.basis; // the weakest basis of the row
  }
  return [...rows.values()].sort((a, b) => (a.from ?? "").localeCompare(b.from ?? "") || a.name.localeCompare(b.name) || a.channel.localeCompare(b.channel) || a.scope.localeCompare(b.scope));
}

function PriceTable({ rows, scheduled = false }: { rows: PriceRow[]; scheduled?: boolean }) {
  if (!rows.length) return <Empty>沒有符合的價格</Empty>;
  return (
    <div className="v3-scroll">
      <table className="v3-prices">
        <thead><tr>
          {scheduled && <th>生效日</th>}<th>模型</th><th>通路</th><th>範圍</th>
          {PRICE_COLS.map(([k, l]) => <th key={k} className="num">{l}</th>)}
          <th>備註</th><th>核對</th><th>來源</th>
        </tr></thead>
        <tbody>{rows.map((r, i) => {
          const first = i === 0 || rows[i - 1].model !== r.model || (scheduled && rows[i - 1].from !== r.from);
          return (
            <tr key={i} className={first ? "v3-first" : undefined}>
              {scheduled && <td className="mono">{first ? r.from : ""}</td>}
              <td>{first && <ModelLink id={r.model} name={r.name} />}</td>
              <td className="mono">{r.channel}</td>
              <td className="note">{r.scope}</td>
              {PRICE_COLS.map(([k]) => {
                const c = r.cells[k];
                return <td key={k} className="num mono" title={c ? `${c.label}：${c.display}${c.note ? ` ${c.note}` : ""}` : undefined}>{c ? money(c.value as number) : <span className="note">—</span>}</td>;
              })}
              <td className="v3-extra" title={r.extra.map((x) => `${x.label}：${x.display}`).join("\n")}>
                {r.extra.slice(0, 2).map((x, n) => <div key={n} className="note"><b>{x.label}</b> {x.display}</div>)}
                {r.extra.length > 2 && <div className="note">+{r.extra.length - 2} 則（滑過看全部）</div>}
              </td>
              <td className="mono note">{r.verified ?? "—"}{r.basis && r.basis !== "official" && <> <Basis b={r.basis} /></>}</td>
              <td><Src ids={r.src} max={1} /></td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
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
