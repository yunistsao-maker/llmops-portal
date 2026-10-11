import { useState } from "react";
import type { ReleaseGate } from "../../../schema/types";
import { go } from "../App";
import { loaders, useData, useLocal } from "../data";
import { Bullets, Filters, PageHead, Sources, Status, Tabs } from "../ui";

type GateState = { status: string; checks: Record<string, boolean>; evidence: string; reviewer: string; date: string };
const STATUSES = [["todo", "未開始"], ["doing", "進行中"], ["pass", "通過"], ["fail", "未通過"], ["na", "不適用"]] as const;
const STATUS_CLS: Record<string, string> = { todo: "P2", doing: "P1", pass: "risk-ok", fail: "P0", na: "P2" };
const VIEWS = ["發布紀錄", "關卡定義", "需求清單"] as const;

export default function Release({ model }: { model?: string }) {
  const req = useData(loaders.requirements);
  const catalog = useData(loaders.catalog);
  const [view, setView] = useState<(typeof VIEWS)[number]>(model ? "發布紀錄" : "關卡定義");
  if (!req.data || !catalog.data) return <Status error={req.error || catalog.error} />;
  return (
    <>
      <PageHead eyebrow="G0–G10：每個新模型或新路由上線前走一次" title="發布流程" />
      <Tabs tabs={VIEWS} value={view} onChange={setView} />
      {view === "發布紀錄" && <Record gates={req.data.gates} models={catalog.data.models.map((m) => ({ id: m.id, name: m.name }))} model={model ?? catalog.data.models[0].id} />}
      {view === "關卡定義" && <Gates gates={req.data.gates} />}
      {view === "需求清單" && <Requirements />}
    </>
  );
}

function Record({ gates, models, model }: { gates: ReleaseGate[]; models: { id: string; name: string }[]; model: string }) {
  const empty: Record<string, GateState> = {};
  const [rec, setRec] = useLocal<Record<string, GateState>>(`llmops.release.${model}`, empty);
  const get = (g: string): GateState => rec[g] ?? { status: "todo", checks: {}, evidence: "", reviewer: "", date: "" };
  const put = (g: string, patch: Partial<GateState>) => setRec({ ...rec, [g]: { ...get(g), ...patch } });
  const passed = gates.filter((g) => ["pass", "na"].includes(get(g.id).status)).length;
  const blocked = gates.filter((g) => get(g.id).status === "fail");
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ schema: "release-record/v1", modelId: model, exportedAt: new Date().toISOString(), gates: rec }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `release-record-${model}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <section className="card">
        <div className="pagehead">
          <label className="note">模型{" "}
            <select value={model} onChange={(e) => go(`release/${e.target.value}`)}>{models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={exportJson}>匯出紀錄（JSON）</button>
            <button className="btn" onClick={() => { if (window.confirm?.("清除這個模型的發布紀錄？") ?? true) setRec({}); }}>清除</button>
          </div>
        </div>
        <p style={{ fontSize: 18, margin: "16px 0 4px" }}><strong className="mono">{passed} / {gates.length}</strong> 個關卡已通過或不適用{blocked.length > 0 && <span className="fail">　·　{blocked.map((g) => g.id).join("、")} 未通過</span>}</p>
        <p className="note">原型：紀錄只存在你的瀏覽器。正式版請改存資料庫或 Git，並接公司的變更管理與簽核流程（金融業：模型升級與 prompt 變更屬變更管理範圍）。</p>
      </section>
      {gates.map((g) => {
        const s = get(g.id);
        const done = g.checks.filter((c) => s.checks[c]).length;
        return (
          <section className="card" key={g.id}>
            <div className="pagehead">
              <h2 style={{ margin: 0 }}><span className="mono">{g.id}</span> {g.name} <span className="note">負責：{g.owner}</span></h2>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className={`tag ${STATUS_CLS[s.status]}`}>{STATUSES.find(([v]) => v === s.status)?.[1]}</span>
                <select aria-label={`${g.id} 狀態`} value={s.status} onChange={(e) => put(g.id, { status: e.target.value })}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </div>
            </div>
            <div className="grid2" style={{ marginTop: 12 }}>
              <div>
                <div className="note">檢查項目（{done}/{g.checks.length}）</div>
                {g.checks.map((c) => (
                  <label className="chk" key={c}><input type="checkbox" checked={!!s.checks[c]} onChange={(e) => put(g.id, { checks: { ...s.checks, [c]: e.target.checked } })} />{c}</label>))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="note">通過條件</div><Bullets items={g.exitCriteria} />
                <div className="note">應附證據：{g.evidence.join("、")}</div>
                <label className="note" style={{ display: "flex", flexDirection: "column", gap: 4 }}>證據連結或說明<input type="text" value={s.evidence} onChange={(e) => put(g.id, { evidence: e.target.value })} placeholder="例：runs/compat/2026-10-01-opus55.json" /></label>
                <div style={{ display: "flex", gap: 10 }}>
                  <label className="note" style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>審核人<input type="text" value={s.reviewer} onChange={(e) => put(g.id, { reviewer: e.target.value })} style={{ minWidth: 0 }} /></label>
                  <label className="note" style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>日期<input type="text" value={s.date} onChange={(e) => put(g.id, { date: e.target.value })} placeholder="YYYY-MM-DD" style={{ minWidth: 0 }} /></label>
                </div>
              </div>
            </div>
          </section>);
      })}
    </>
  );
}

function Gates({ gates }: { gates: ReleaseGate[] }) {
  return (
    <>
      <section className="card">
        <h2>流程總覽</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {gates.map((g, i) => <span key={g.id} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><span className="pill"><span className="mono">{g.id}</span> {g.name}</span>{i < gates.length - 1 && <span aria-hidden="true" className="note">→</span>}</span>)}
        </div>
      </section>
      {gates.map((g) => (
        <section className="card" key={g.id}>
          <h2><span className="mono">{g.id}</span> {g.name} <span className="note">負責：{g.owner}</span></h2>
          <div className="grid3">
            <div><div className="note">進入條件</div><Bullets items={g.entryCriteria} /></div>
            <div><div className="note">檢查</div><Bullets items={g.checks} /></div>
            <div><div className="note">通過條件</div><Bullets items={g.exitCriteria} /></div>
          </div>
          <p className="note">證據：{g.evidence.join("、")}　·　對應需求：{g.requirementIds.join("、")}</p>
        </section>))}
    </>
  );
}

function Requirements() {
  const { data, error } = useData(loaders.requirements);
  const [origin, setOrigin] = useState<string>("all");
  const [prio, setPrio] = useState<string>("all");
  if (!data) return <Status error={error} />;
  const list = data.requirements.filter((r) => (origin === "all" || r.origin === origin) && (prio === "all" || r.priority === prio));
  return (
    <>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Filters label="來源" options={[["all", "全部"], ["user", "你列的需求"], ["gap", "補充的缺口"]] as const} value={origin} onChange={setOrigin} />
        <Filters label="優先序" options={[["all", "全部"], ["P0", "P0"], ["P1", "P1"], ["P2", "P2"]] as const} value={prio} onChange={setPrio} />
      </div>
      <section className="card">
        <p className="note" style={{ marginTop: 0 }}>{list.length} 項。P0 = 上線前必備。</p>
        {list.map((r) => (
          <details key={r.id} id={r.id}>
            <summary><span className="mono">{r.id}</span> <span className={`tag ${r.priority}`}>{r.priority}</span> {r.title} <span className="note">{r.origin === "gap" ? "補充缺口" : "原始需求"}{r.gate && ` · 關卡 ${r.gate}`}</span></summary>
            <div className="grid2" style={{ marginTop: 12 }}>
              <div><div className="note">為什麼重要</div><p style={{ fontSize: 14, lineHeight: 1.8 }}>{r.why}<Sources refs={r.sources} /></p>
                <div className="note">驗收標準</div><Bullets items={r.acceptanceCriteria} /></div>
              <div><div className="note">怎麼做</div><Bullets items={r.howToImplement} />
                <div className="note" style={{ marginTop: 10 }}>工具：{r.tooling.join("、")}</div></div>
            </div>
          </details>))}
      </section>
    </>
  );
}
