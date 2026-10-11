import { useState } from "react";
import { go } from "../App";
import { loaders, money, useData } from "../data";
import { Filters, PageHead, Status } from "../ui";

const CLOUDS = [["all", "全部雲端"], ["aws", "AWS Bedrock"], ["azure", "Azure Foundry"], ["gcp", "GCP Agent Platform"]] as const;
const TIERS = [["all", "全部層級"], ["frontier", "旗艦"], ["balanced", "主力"], ["efficient", "輕量"]] as const;

export default function Catalog() {
  const { data, error } = useData(loaders.catalog);
  const [cloud, setCloud] = useState<string>("all");
  const [tier, setTier] = useState<string>("all");
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<string[]>([]);
  if (!data) return <Status error={error} />;
  const models = data.models.filter((m) =>
    (cloud === "all" || m.offerings.some((o) => o.cloud === cloud)) && (tier === "all" || m.tier === tier) &&
    (!q || (m.name + m.vendor + m.tags.join(" ")).toLowerCase().includes(q.toLowerCase())));
  const toggle = (id: string) => setPick(pick.includes(id) ? pick.filter((x) => x !== id) : [...pick, id].slice(-3));
  return (
    <>
      <PageHead eyebrow={`共 ${data.models.length} 個模型 · 資料更新 ${data.asOf}`} title="模型目錄"
        right={<button className="btn primary" disabled={pick.length < 2} onClick={() => go(`compare/${pick.join(",")}`)}>比較已選（{pick.length}/3）</button>} />
      <div className="filters">
        <input type="search" aria-label="搜尋模型" placeholder="搜尋名稱、廠商、標籤" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Filters label="依雲端篩選" options={CLOUDS} value={cloud} onChange={setCloud} />
      <Filters label="依層級篩選" options={TIERS} value={tier} onChange={setTier} />
      <section className="card">
        <table>
          <thead><tr><th>比較</th><th>模型</th><th>層級</th><th>發布</th><th>雲端</th><th>Context</th><th>Global in / out</th><th>AA v4.3.2</th><th>台灣境內</th><th>平台狀態</th></tr></thead>
          <tbody>
            {models.map((m) => {
              const p = m.offerings.flatMap((o) => o.pricing).find((x) => x.input !== undefined);
              const aa = m.benchmarks.find((b) => b.name.startsWith("Artificial Analysis") && b.version === "v4.3.2");
              const tw = m.offerings.some((o) => o.dataProcessing.taiwanResidency === "yes");
              return (
                <tr key={m.id}>
                  <td><input type="checkbox" aria-label={`比較 ${m.name}`} checked={pick.includes(m.id)} onChange={() => toggle(m.id)} style={{ width: 18, height: 18 }} /></td>
                  <td><a href={`#/models/${m.id}`} style={{ fontWeight: 700 }}>{m.name}</a><div className="note">{m.vendor}</div></td>
                  <td>{m.tier}</td><td className="mono">{m.releaseDate}</td>
                  <td>{[...new Set(m.offerings.map((o) => o.cloud.toUpperCase()))].join("、")}</td>
                  <td className="mono">{(m.contextWindow / 1000).toFixed(0)}K</td>
                  <td className="mono">{money(p?.input)} / {money(p?.output)}</td>
                  <td className="mono">{aa ? aa.score : "—"}</td>
                  <td>{tw ? "有" : <span className="pill warn">無</span>}</td>
                  <td><span className="pill">{m.platformStatus}</span></td>
                </tr>);
            })}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>即將上線（watchlist）</h2>
        {data.watchlist.map((w) => <div key={w.name} className="list-item" style={{ display: "block" }}><strong>{w.name}</strong> <span className="note">{w.expected}</span><div className="note">{w.note}</div></div>)}
      </section>
    </>
  );
}
