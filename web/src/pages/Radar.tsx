import { go, Status } from "../App";
import { daysFrom, loaders, money, useData } from "../data";

export default function Radar() {
  const digest = useData(() => loaders.digest());
  const catalog = useData(loaders.catalog);
  const inv = useData(loaders.inventory);
  if (!digest.data || !catalog.data) return <Status error={digest.error || catalog.error} />;
  const d = digest.data;
  const actNow = inv.data?.deployments.filter((x) => x.risk === "act-now" || x.risk === "retired").length;
  const p0 = d.actionItems.filter((a) => a.priority === "P0").length;
  const items = [...d.actionItems].sort((a, b) => (a.priority + (a.due ?? "9")).localeCompare(b.priority + (b.due ?? "9")));
  return (
    <>
      <header>
        <div className="eyebrow">週報 · {d.periodStart} 至 {d.periodEnd}</div>
        <h1>Release Radar</h1>
      </header>
      <p style={{ margin: 0, fontSize: 18, lineHeight: 1.7, maxWidth: 960 }}>{d.headline}</p>
      <section className="stats" aria-label="統計">
        <Stat label="新上架模型" value={catalog.data.models.length} />
        <Stat label="30 天內到期或已退役的路由" value={actNow ?? "—"} danger />
        <Stat label="P0 行動項目" value={p0} />
        <Stat label="資料更新日" value={catalog.data.asOf} />
      </section>
      <div className="row">
        <section className="card grow">
          <h2>行動項目</h2>
          {items.map((a) => (
            <div className="list-item" key={a.action}>
              <span className="mono" style={{ width: 96, flexShrink: 0 }}>
                {a.due ?? "—"}
                {a.due && <div className="note">{daysFrom(a.due) >= 0 ? `剩 ${daysFrom(a.due)} 天` : `已過 ${-daysFrom(a.due)} 天`}</div>}
              </span>
              <span className={`tag ${a.priority}`}>{a.priority}</span>
              <span style={{ fontSize: 15, lineHeight: 1.6 }}>{a.action}</span>
            </div>
          ))}
        </section>
        <aside className="side">
          <section className="card">
            <h2>九月新模型</h2>
            {catalog.data.models.map((m) => {
              const p = m.offerings.flatMap((o) => o.pricing).find((x) => x.input !== undefined);
              return (
                <a key={m.id} href={`#/models/${m.id}`} className="list-item" style={{ justifyContent: "space-between", color: "inherit" }}>
                  <span style={{ fontWeight: 500 }}>{m.name}</span>
                  <span className="note">{[...new Set(m.offerings.map((o) => o.cloud.toUpperCase()))].join("、")} · {money(p?.input)} / {money(p?.output)}</span>
                </a>
              );
            })}
            <p className="note">價格：每 1M tokens（USD），Global 部署。</p>
          </section>
          <section className="card">
            <h2>Watchlist</h2>
            {d.watchlist.map((w) => (
              <div key={w.name} className="list-item" style={{ display: "block" }}>
                <div style={{ fontWeight: 500 }}>{w.name}</div>
                <div className="note">{w.expected ?? w.status}</div>
              </div>
            ))}
          </section>
          <button className="card" style={{ font: "inherit", textAlign: "left", cursor: "pointer", border: "none", color: "var(--brand)" }} onClick={() => go("eol")}>查看平台清單與 EOL →</button>
        </aside>
      </div>
      {d.unverified.length > 0 && (
        <section className="card">
          <h2>尚未驗證</h2>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>{d.unverified.map((u) => <li key={u}>{u}</li>)}</ul>
        </section>
      )}
    </>
  );
}

function Stat({ label, value, danger }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div className="card stat">
      <div className="eyebrow">{label}</div>
      <div className="v" style={danger ? { color: "var(--danger)" } : undefined}>{value}</div>
    </div>
  );
}
