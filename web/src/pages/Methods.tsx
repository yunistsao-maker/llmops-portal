import { useState } from "react";
import { loaders, useData } from "../data";
import { Bullets, Filters, PageHead, Status, Tabs, Verif } from "../ui";

const VIEWS = ["指標定義", "AI 安全測試目錄", "可信度說明", "來源"] as const;

export default function Methods() {
  const req = useData(loaders.requirements);
  const src = useData(loaders.sources);
  const [view, setView] = useState<(typeof VIEWS)[number]>("指標定義");
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>("all");
  if (!req.data || !src.data) return <Status error={req.error || src.error} />;
  const types = [...new Set(src.data.sources.map((s) => s.type))];
  const sources = src.data.sources.filter((s) => (type === "all" || s.type === type) && (!q || (s.title + s.publisher + s.url).toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <PageHead eyebrow="portal 上數字的定義與出處" title="方法與來源" />
      <Tabs tabs={VIEWS} value={view} onChange={setView} />
      {view === "指標定義" && (
        <section className="card">
          <table><thead><tr><th>指標</th><th>定義</th><th>怎麼量</th><th>常見陷阱</th></tr></thead><tbody>
            {req.data.metricDefinitions.map((m) => <tr key={m.metric}><td><strong>{m.metric}</strong></td><td>{m.definition}</td><td>{m.howMeasured}</td><td><Bullets items={m.pitfalls} /></td></tr>)}
          </tbody></table>
        </section>)}
      {view === "AI 安全測試目錄" && (
        <section className="card">
          <p className="note" style={{ marginTop: 0 }}>類別對應 OWASP LLM Top 10 / Agentic Top 10 與數位發展部 AI 風險分類；通過標準以「不比現役模型差」為基準。</p>
          <table><thead><tr><th>ID</th><th>類別</th><th>OWASP</th><th>數發部風險類別</th><th>測什麼</th><th>通過標準</th><th>工具</th></tr></thead><tbody>
            {req.data.securityTestCatalog.map((t) => <tr key={t.id}><td className="mono">{t.id}</td><td><strong>{t.category}</strong></td><td className="mono">{t.owasp.join(" ")}</td><td>{t.modaRiskCategory ?? "—"}</td><td>{t.what}</td><td>{t.passCriteria}</td><td>{t.tools.join("、")}</td></tr>)}
          </tbody></table>
        </section>)}
      {view === "可信度說明" && (
        <section className="card">
          <table><tbody>
            {([["official", "CSP 或模型廠商的官方文件、模型卡、價格頁。"], ["independent", "獨立第三方量測或轉載官方內容（例：Artificial Analysis、release note 鏡像）。"], ["community", "社群來源（GitHub issue / PR、論壇、個人部落格）。上線前一定要核對。"], ["derived", "由官方數字推算（例：geo 價 = global + 10%）。"], ["unverified", "找不到可靠來源，只作提醒。"], ["internal-test", "你們在自己的 gateway 上量到的結果。"]] as const).map(([v, d]) => <tr key={v}><td style={{ width: 140 }}><Verif v={v} /></td><td>{d}</td></tr>)}
          </tbody></table>
        </section>)}
      {view === "來源" && (
        <>
          <div className="filters"><input type="search" aria-label="搜尋來源" placeholder="搜尋標題、發布者、網址" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Filters label="來源類型" options={[["all", `全部（${src.data.sources.length}）`] as const, ...types.map((t) => [t, t] as const)]} value={type} onChange={setType} />
          <section className="card">
            <table><thead><tr><th>發布者</th><th>標題</th><th>類型</th><th>存取日</th></tr></thead><tbody>
              {sources.map((s) => <tr key={s.id}><td>{s.publisher}</td><td><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a><div className="note mono">{s.id}</div></td><td>{s.type}</td><td className="mono">{s.accessed}</td></tr>)}
            </tbody></table>
          </section>
        </>)}
    </>
  );
}
