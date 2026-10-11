import { useState } from "react";
import type { LifecycleEvent } from "../../../schema/types";
import { daysFrom, linkTo, loaders, useData } from "../data";
import { Bullets, Filters, PageHead, Sources, Status, Verif } from "../ui";

const RISKS = [["all", "全部"], ["retired", "已退役"], ["act-now", "30 天內"], ["watch", "90 天內"], ["unknown", "未對應"], ["ok", "正常"]] as const;
const RISK_LABEL: Record<string, string> = { retired: "已退役", "act-now": "30 天內", watch: "90 天內", unknown: "未對應", ok: "正常" };
const EVENT_LABEL: Record<string, string> = { retirement: "退役", legacy: "進入 Legacy / 限制新用戶", deprecation: "Deprecated", "extended-access": "進入 extended access", "eol-no-sooner-than": "退役不早於", "price-change": "價格變動" };
const SERVICE_LABEL: Record<string, string> = { bedrock: "Bedrock", foundry: "Foundry", "agent-platform": "Agent Platform", "anthropic-api": "Anthropic API", "openai-api": "OpenAI API", "gemini-api": "Gemini API" };
const RANGES = [["90", "90 天內"], ["180", "6 個月內"], ["all", "全部（含已過）"]] as const;

export default function Eol() {
  const inv = useData(loaders.inventory);
  const lc = useData(loaders.lifecycle);
  const [risk, setRisk] = useState<string>("all");
  const [svc, setSvc] = useState<string>("all");
  const [range, setRange] = useState<string>("180");
  if (!inv.data || !lc.data) return <Status error={inv.error || lc.error} />;
  const order = { retired: 0, "act-now": 1, watch: 2, unknown: 3, ok: 4 };
  const counts = inv.data.deployments.reduce<Record<string, number>>((a, d) => ({ ...a, [d.risk]: (a[d.risk] ?? 0) + 1 }), {});
  const rows = inv.data.deployments.filter((d) => risk === "all" || d.risk === risk)
    .sort((a, b) => order[a.risk] - order[b.risk] || (a.daysToNextEvent ?? 9e9) - (b.daysToNextEvent ?? 9e9));
  const example = inv.data.gateway.includes("fixtures");
  // The channel filter follows the data: one button per service that has events (known services first, in SERVICE_LABEL order).
  const present = new Set<string>(lc.data.events.map((e) => e.service));
  const services: (readonly [string, string])[] = [["all", "全部通路"],
    ...[...Object.keys(SERVICE_LABEL), ...[...present].filter((s) => !(s in SERVICE_LABEL))].filter((s) => present.has(s)).map((s) => [s, SERVICE_LABEL[s] ?? s] as const)];
  const events = lc.data.events.filter((e) => {
    const n = daysFrom(e.date);
    return (svc === "all" || e.service === svc) && (range === "all" ? true : n >= 0 && n <= Number(range));
  });
  const recent = lc.data.events.filter((e) => { const n = daysFrom(e.date); return e.event === "retirement" && n < 0 && n >= -30; });
  const byMonth = events.reduce<Record<string, LifecycleEvent[]>>((a, e) => { (a[e.date.slice(0, 7)] ??= []).push(e); return a; }, {});

  return (
    <>
      <PageHead eyebrow={<>LiteLLM /model/info × lifecycle.json · 清單產生於 {inv.data.generatedAt}{inv.data.litellmVersion && ` · LiteLLM ${inv.data.litellmVersion}`}</>}
        title="平台清單與 EOL" right={example && <span className="pill warn">範例資料：請執行 sync_inventory.py</span>} />

      <section className="card">
        <h2>我們平台上的路由</h2>
        <p className="note" style={{ marginTop: -6 }}>風險依下一個生命週期事件計算：30 天內為「30 天內」，90 天內為「90 天內」；「未對應」代表查不到對應的 catalog 或 EOL 資料，需要補 model_info。</p>
        <Filters label="依風險篩選" options={RISKS.map(([v, l]) => [v, v === "all" ? `${l}（${inv.data!.deployments.length}）` : `${l}（${counts[v] ?? 0}）`] as const)} value={risk} onChange={setRisk} />
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>風險</th><th>路由（model_name）</th><th>LiteLLM model</th><th>對應模型</th><th>下一個事件</th><th>日期</th><th>剩餘天數</th><th>建議替代</th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.modelName}>
                <td><span className={`tag risk-${d.risk}`}>{RISK_LABEL[d.risk]}</span></td>
                <td className="mono">{d.modelName}</td>
                <td className="mono note">{d.litellmModel}</td>
                <td>{d.catalogModelId ? <a href={linkTo(`models/${d.catalogModelId}`)}>{d.catalogModelId}</a> : <span className="note">{d.matchedProviderModelId ?? "—"}</span>}</td>
                <td>{d.lifecycle?.nextEvent ? EVENT_LABEL[d.lifecycle.nextEvent] ?? d.lifecycle.nextEvent : "—"}</td>
                <td className="mono">{d.lifecycle?.nextEventDate ?? "—"}</td>
                <td className="mono">{d.daysToNextEvent ?? "—"}</td>
                <td>{d.lifecycle?.replacement ?? (d.risk === "unknown" ? "補 model_info.base_model / catalog_id" : "—")}</td>
              </tr>))}
          </tbody>
        </table>
      </section>

      {recent.length > 0 && (
        <section className="card" style={{ borderLeft: "none" }}>
          <h2>最近 30 天已退役（呼叫會失敗）</h2>
          {recent.map((e) => <div key={e.id} className="list-item"><span className="mono">{e.date}</span><span>{e.service} · {e.modelName}{e.version && ` ${e.version}`}</span><span className="note">{e.scopeNote}</span></div>)}
        </section>)}

      <section className="card">
        <h2>生命週期行事曆（所有通路）</h2>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Filters label="依通路篩選" options={services} value={svc} onChange={setSvc} />
          <Filters label="時間範圍" options={RANGES} value={range} onChange={setRange} />
        </div>
        <div className="timeline">
          {Object.entries(byMonth).map(([month, evs]) => (
            <div key={month}>
              <div className="tl-month">{month}</div>
              <table><tbody>
                {evs.map((e) => {
                  const n = daysFrom(e.date);
                  return (
                    <tr key={e.id}>
                      <td className="mono" style={{ width: 120 }}>{e.date}<div className="note">{n >= 0 ? `剩 ${n} 天` : `${-n} 天前`}</div></td>
                      <td style={{ width: 140 }}>{e.service}</td>
                      <td><strong>{e.modelName}</strong>{e.version && <span className="note"> {e.version}</span>}
                        {e.scopeNote && <div className="note">範圍：{e.scopeNote}</div>}
                        {e.notes?.map((x) => <div key={x} className="note">・{x}</div>)}</td>
                      <td style={{ width: 180 }}>{EVENT_LABEL[e.event] ?? e.event}
                        {e.conflicts?.filter((c) => c.kind === "conflicting").map((c) => <div key={c.date} className="src">另一官方頁寫 {c.date}（{c.note}）</div>)}
                        {e.conflicts?.filter((c) => c.kind === "superseded").map((c) => <div key={c.date} className="note">原公告 {c.date}：{c.note}</div>)}</td>
                      <td style={{ width: 200 }}>{e.replacement ?? "—"}</td>
                      <td style={{ width: 120 }}><Verif v={e.verification} /><Sources refs={e.sources} /></td>
                    </tr>);
                })}
              </tbody></table>
            </div>))}
          {events.length === 0 && <p className="note">這個範圍沒有事件。</p>}
        </div>
      </section>

      <section className="card">
        <h2>各通路的生命週期規則</h2>
        {lc.data.policies.map((p) => (
          <details key={p.service}>
            <summary>{p.service} <span className="note">— 通知期：{p.noticePeriod}</span></summary>
            <p style={{ fontSize: 14, lineHeight: 1.8 }}>{p.summary}<Sources refs={p.sources} /></p>
          </details>))}
        <h2 style={{ marginTop: 20 }}>對平台的建議</h2>
        <Bullets items={[
          "倒數以最早日期計算；「原公告」只當歷史，提醒日期會改、也可能提前。",
          "不要拿即將退役的模型當 fallback：Bedrock Legacy 期 15 天未使用可能失去存取，平常沒有流量的 DR / fallback 專案也最容易在退役時先被封鎖。",
          "每天在 CI 執行 sync_inventory.py 並用 CSP API 核對生命週期；act-now 發告警給路由擁有者。",
        ]} />
      </section>
    </>
  );
}
