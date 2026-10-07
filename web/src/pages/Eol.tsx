import { useState } from "react";
import { Status } from "../App";
import { daysFrom, loaders, useData } from "../data";

const RISKS = [["all", "全部"], ["retired", "已退役"], ["act-now", "30 天內"], ["watch", "90 天內"], ["unknown", "未對應"], ["ok", "正常"]] as const;
const LABEL: Record<string, string> = { retired: "已退役", "act-now": "30 天內", watch: "90 天內", unknown: "未對應", ok: "正常" };

export default function Eol() {
  const inv = useData(loaders.inventory);
  const lc = useData(loaders.lifecycle);
  const [risk, setRisk] = useState<string>("all");
  if (!inv.data || !lc.data) return <Status error={inv.error || lc.error} />;
  const order = { retired: 0, "act-now": 1, watch: 2, unknown: 3, ok: 4 };
  const rows = inv.data.deployments.filter((d) => risk === "all" || d.risk === risk).sort((a, b) => order[a.risk] - order[b.risk] || (a.daysToNextEvent ?? 9e9) - (b.daysToNextEvent ?? 9e9));
  const upcoming = lc.data.events.filter((e) => { const n = daysFrom(e.date); return n >= 0 && n <= 90; });
  const example = inv.data.gateway.includes("fixtures");
  return (
    <>
      <header>
        <div className="eyebrow">LiteLLM /model/info × lifecycle.json · 產生於 {inv.data.generatedAt}{example && "（範例資料）"}</div>
        <h1>平台清單與 EOL</h1>
      </header>
      <div className="filters" role="group" aria-label="依風險篩選">
        {RISKS.map(([v, l]) => <button key={v} aria-pressed={risk === v} onClick={() => setRisk(v)}>{l}</button>)}
      </div>
      <section className="card">
        <table>
          <thead><tr><th>風險</th><th>路由</th><th>LiteLLM model</th><th>下一個事件</th><th>日期</th><th>剩餘天數</th><th>建議替代</th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.modelName}>
                <td><span className={`tag risk-${d.risk}`}>{LABEL[d.risk]}</span></td>
                <td className="mono">{d.modelName}</td>
                <td className="mono note">{d.litellmModel}</td>
                <td>{d.lifecycle?.nextEvent ?? "—"}</td>
                <td className="mono">{d.lifecycle?.nextEventDate ?? "—"}</td>
                <td className="mono">{d.daysToNextEvent ?? "—"}</td>
                <td>{d.lifecycle?.replacement ?? (d.risk === "unknown" ? "補 model_info.base_model" : "—")}</td>
              </tr>))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>90 天內的生命週期事件（全部通路）</h2>
        <table>
          <thead><tr><th>日期</th><th>通路</th><th>模型</th><th>事件</th><th>替代</th><th>可信度</th></tr></thead>
          <tbody>
            {upcoming.map((e) => (
              <tr key={e.id}>
                <td className="mono">{e.date}<div className="note">剩 {daysFrom(e.date)} 天</div></td>
                <td>{e.service}</td>
                <td>{e.modelName}{e.version && <span className="note"> {e.version}</span>}</td>
                <td>{e.event}{e.conflicts?.some((c) => c.kind === "conflicting") && <div className="src">官方頁面日期不一致</div>}{e.conflicts?.some((c) => c.kind === "superseded") && <div className="note">日期改過</div>}</td>
                <td>{e.replacement ?? "—"}</td>
                <td className={e.verification === "community" || e.verification === "unverified" ? "src" : "note"}>{e.verification}</td>
              </tr>))}
          </tbody>
        </table>
      </section>
    </>
  );
}
