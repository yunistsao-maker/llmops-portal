import { useState } from "react";
import { Status } from "../App";
import { loaders, money, useData } from "../data";

export default function Catalog() {
  const { data, error } = useData(loaders.catalog);
  const [cloud, setCloud] = useState("all");
  if (!data) return <Status error={error} />;
  const models = data.models.filter((m) => cloud === "all" || m.offerings.some((o) => o.cloud === cloud));
  return (
    <>
      <header>
        <div className="eyebrow">共 {data.models.length} 個模型 · 更新 {data.asOf}</div>
        <h1>模型目錄</h1>
      </header>
      <div className="filters" role="group" aria-label="依雲端篩選">
        {[["all", "全部"], ["aws", "AWS Bedrock"], ["azure", "Azure Foundry"], ["gcp", "GCP Agent Platform"]].map(([v, l]) => (
          <button key={v} aria-pressed={cloud === v} onClick={() => setCloud(v)}>{l}</button>
        ))}
      </div>
      <section className="card">
        <table>
          <thead><tr><th>模型</th><th>層級</th><th>發布</th><th>雲端</th><th>Global 價格 in / out</th><th>AA 指數</th><th>台灣境內處理</th><th>平台狀態</th></tr></thead>
          <tbody>
            {models.map((m) => {
              const p = m.offerings.flatMap((o) => o.pricing).find((x) => x.input !== undefined);
              const aa = m.benchmarks.find((b) => b.name.startsWith("Artificial Analysis") && b.version === "v4.3.2");
              const tw = m.offerings.some((o) => o.dataProcessing.taiwanResidency === "yes");
              return (
                <tr key={m.id}>
                  <td><a href={`#/models/${m.id}`} style={{ fontWeight: 700 }}>{m.name}</a><div className="note">{m.vendor}</div></td>
                  <td>{m.tier}</td>
                  <td className="mono">{m.releaseDate}</td>
                  <td>{[...new Set(m.offerings.map((o) => o.cloud.toUpperCase()))].join("、")}</td>
                  <td className="mono">{money(p?.input)} / {money(p?.output)}</td>
                  <td className="mono">{aa ? `${aa.score} ${aa.rank ?? ""}` : "—"}</td>
                  <td>{tw ? "有" : <span className="pill warn">無</span>}</td>
                  <td><span className="pill">{m.platformStatus}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
