import { useEffect, useState } from "react";
import type { OpenModel, OpenModelHosting, OpenModelSignal } from "../../../schema/types";
import { loaders, useData } from "../data";
import { Bullets, Empty, Filters, PageHead, Sources, Status, Verif } from "../ui";

export const HEAT_LABEL: Record<OpenModel["heat"], string> = { hit: "Hit 熱門", rising: "Rising 竄升", watch: "Watch 觀察" };
const HEATS = [["all", "全部"], ["hit", HEAT_LABEL.hit], ["rising", HEAT_LABEL.rising], ["watch", HEAT_LABEL.watch]] as const;
const ORIGINS = [["all", "全部來源地"], ["non-cn", "非中國"], ["cn", "中國"]] as const;
const HOSTED = [["all", "不限"], ["hosted", "三雲有託管版本"], ["none", "三雲沒有"]] as const;
const STATUS_LABEL: Record<OpenModel["status"], string> = { released: "權重已釋出", preview: "預覽中，權重未釋出", announced: "已宣布，尚未開放" };
const HOST_LABEL: Record<OpenModelHosting["status"], string> = { ga: "GA", preview: "Preview", restricted: "受限", "not-offered": "未上架", unknown: "未確認" };
const HOST_RANK: Record<OpenModelHosting["status"], number> = { ga: 0, preview: 1, restricted: 2, unknown: 3, "not-offered": 4 };
const SERVICES = [["bedrock", "Bedrock"], ["foundry", "Foundry"], ["agent-platform", "Agent Platform"]] as const;
const SIGNAL_LABEL: Record<OpenModelSignal["kind"], string> = {
  "openrouter-usage": "OpenRouter 用量", "hf-likes": "Hugging Face 讚數", "hf-downloads": "Hugging Face 下載", "hf-trending": "Hugging Face trending",
  "aa-index": "Artificial Analysis", press: "媒體報導", other: "其他",
};
const LICENSE_LABEL: Record<string, string> = { "apache-2.0": "Apache 2.0", mit: "MIT" };

const rowsFor = (m: OpenModel, service: string) => m.hosting.filter((h) => h.service === service).sort((a, b) => HOST_RANK[a.status] - HOST_RANK[b.status]);
const isHosted = (m: OpenModel) => m.hosting.some((h) => h.status === "ga" || h.status === "preview" || h.status === "restricted");
const isCn = (m: OpenModel) => m.origin.startsWith("中國");
const licenseShort = (m: OpenModel) => {
  const l = m.weights.license ? LICENSE_LABEL[m.weights.license] ?? m.weights.license : undefined;
  if (!m.weights.available) return l ? `未釋出（預告 ${l}）` : "未釋出（授權未公布）";
  return m.weights.customLicense ? "含自訂授權" : l ?? "—";
};
const HostTag = ({ h }: { h: OpenModelHosting }) => <span className={`tag host-${h.status}`}>{HOST_LABEL[h.status]}</span>;

export default function OpenModels({ id }: { id?: string }) {
  const om = useData(loaders.openModels);
  const [heat, setHeat] = useState<string>("all");
  const [origin, setOrigin] = useState<string>("all");
  const [hosted, setHosted] = useState<string>("all");
  const [open, setOpen] = useState<Set<string>>(new Set(id ? [id] : []));

  // #/open/<id> opens that model's card and scrolls to it.
  useEffect(() => {
    if (!id || !om.data) return;
    setOpen((s) => new Set(s).add(id));
    const t = requestAnimationFrame(() => document.getElementById(`om-${id}`)?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(t);
  }, [id, om.data]);

  if (om.error) {
    return (
      <>
        <PageHead eyebrow="市場雷達" title="開源模型（open-weight）" />
        <Empty>還沒有開放權重模型的資料。這一頁讀取 <span className="mono">data/open-models.json</span>（選用檔）；每週研究任務產出後就會出現在這裡。</Empty>
      </>
    );
  }
  if (!om.data) return <Status />;
  const d = om.data;
  const list = d.models.filter((m) =>
    (heat === "all" || m.heat === heat) &&
    (origin === "all" || (origin === "cn") === isCn(m)) &&
    (hosted === "all" || (hosted === "hosted") === isHosted(m)));
  const count = (f: (m: OpenModel) => boolean) => d.models.filter(f).length;
  const allOpen = list.length > 0 && list.every((m) => open.has(m.id));
  const toggle = (mid: string, on: boolean) => setOpen((s) => { const n = new Set(s); if (on) n.add(mid); else n.delete(mid); return n; });

  return (
    <>
      <PageHead eyebrow={`市場雷達 · 資料截至 ${d.asOf}`} title="開源模型（open-weight）" />
      <p className="lead">追蹤市場上受矚目的開放權重模型：哪些真的有人在用、三雲有沒有託管、授權與來源地能不能用。這是市場雷達，不是導入清單——列入不代表平台會提供。</p>

      <section className="stats" aria-label="統計">
        <div className="card stat"><div className="eyebrow">追蹤中的模型</div><div className="v">{d.models.length}</div></div>
        <div className="card stat"><div className="eyebrow">判定為 Hit（熱門）</div><div className="v">{count((m) => m.heat === "hit")}</div></div>
        <div className="card stat"><div className="eyebrow">權重還沒釋出</div><div className="v">{count((m) => !m.weights.available)}</div></div>
        <div className="card stat"><div className="eyebrow">三雲至少一朵有託管版本</div><div className="v">{count(isHosted)}</div></div>
      </section>

      <section className="card">
        <h2>總覽</h2>
        <div className="om-filters">
          <div className="om-filter"><span className="note">熱度</span>
            <Filters label="依熱度篩選" options={HEATS.map(([v, l]) => [v, v === "all" ? `${l}（${d.models.length}）` : `${l}（${count((m) => m.heat === v)}）`] as const)} value={heat} onChange={setHeat} /></div>
          <div className="om-filter"><span className="note">來源地</span><Filters label="依來源地篩選" options={ORIGINS} value={origin} onChange={setOrigin} /></div>
          <div className="om-filter"><span className="note">三雲託管</span><Filters label="依三雲託管篩選" options={HOSTED} value={hosted} onChange={setHosted} /></div>
        </div>
        {list.length === 0 ? <Empty>沒有符合條件的模型。</Empty> : (
          <table style={{ marginTop: 12, minWidth: 1040 }}>
            <thead><tr><th>模型</th><th>熱度</th><th>開發者 · 來源地</th><th>發布</th><th>授權</th>{SERVICES.map(([, l]) => <th key={l}>{l}</th>)}</tr></thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id}>
                  <td><a href={`#/open/${m.id}`} style={{ fontWeight: 500 }}>{m.name}</a><div className="note">{m.size}</div></td>
                  <td><span className={`tag heat-${m.heat}`}>{HEAT_LABEL[m.heat]}</span></td>
                  <td>{m.developer}<div className="note">{m.origin}</div></td>
                  <td className="mono">{m.releaseDate ?? "—"}<div className="note" style={{ fontFamily: "inherit" }}>{STATUS_LABEL[m.status]}</div></td>
                  <td>{licenseShort(m)}</td>
                  {SERVICES.map(([svc]) => {
                    const rows = rowsFor(m, svc);
                    return (
                      <td key={svc}>{rows.length === 0 ? <span className="note">—</span> : rows.map((h, i) => (
                        <div key={i} style={{ marginBottom: 4 }}><HostTag h={h} />{h.modelId && <div className="mono note om-id">{h.modelId}</div>}</div>))}</td>);
                  })}
                </tr>))}
            </tbody>
          </table>)}
        <p className="note" style={{ marginBottom: 0 }}>
          「未上架」是指沒有託管 API，不排除自行部署；「未確認」是查不到、但無法確定沒有；「受限」是有條件才能用（限資格，或只有 Provisioned Throughput）。點模型名稱看依據。
        </p>
      </section>

      <section className="card om-notes">
        <h2>市場觀察</h2>
        <Bullets items={d.marketNotes} />
      </section>

      <section aria-label="各模型" className="om-list">
        <div className="pagehead">
          <h2 style={{ margin: 0 }}>各模型的依據（{list.length}）</h2>
          <button className="btn" onClick={() => setOpen(allOpen ? new Set() : new Set(list.map((m) => m.id)))}>{allOpen ? "全部收合" : "全部展開"}</button>
        </div>
        {list.map((m) => (
          <details key={m.id} id={`om-${m.id}`} className="card om" open={open.has(m.id)} onToggle={(e) => toggle(m.id, e.currentTarget.open)}>
            <summary>
              <span className="om-name">{m.name}</span>
              <span className={`tag heat-${m.heat}`}>{HEAT_LABEL[m.heat]}</span>
              <span className="note">{m.developer} · {m.origin}{m.releaseDate && ` · ${m.releaseDate}`}</span>
            </summary>
            <p className="om-summary">{m.summary}<Sources refs={m.sources} /></p>
            <p className="om-why"><strong>為什麼是 {HEAT_LABEL[m.heat]}：</strong>{m.heatReason}</p>
            <dl className="kv">
              <dt>狀態</dt><dd>{STATUS_LABEL[m.status]} <Verif v={m.verification} /> <span className="note">最後查證 {m.lastVerified}</span></dd>
              <dt>權重與授權</dt>
              <dd>
                {m.weights.license ? LICENSE_LABEL[m.weights.license] ?? m.weights.license : "授權未公布"}
                {m.weights.customLicense && <span className="tag host-restricted" style={{ marginLeft: 8 }}>自訂授權，法務要讀全文</span>}
                {m.weights.repos && <div className="om-repos">{m.weights.repos.map((r) => <a key={r} className="mono" href={`https://huggingface.co/${r}`} target="_blank" rel="noreferrer">{r}</a>)}</div>}
                {m.weights.note && <div className="note om-note">{m.weights.note}</div>}
              </dd>
              <dt>規模</dt><dd>{m.size ?? "—"}</dd>
              <dt>Context</dt><dd className="mono">{m.contextWindow ? m.contextWindow.toLocaleString("en-US") : "—"}</dd>
              <dt>輸入</dt><dd>{m.modalities.join("、")}</dd>
            </dl>

            <h3>三雲託管</h3>
            <table className="om-host">
              <thead><tr><th>通路</th><th>狀態</th><th>Model ID</th><th>說明</th></tr></thead>
              <tbody>
                {SERVICES.flatMap(([svc, label]) => rowsFor(m, svc).map((h, i) => (
                  <tr key={svc + i}>
                    <td>{label}</td>
                    <td><HostTag h={h} /></td>
                    <td className="mono om-id">{h.modelId ?? "—"}</td>
                    <td>{h.note}<Sources refs={h.sources} /></td>
                  </tr>)))}
              </tbody>
            </table>

            <div className="grid2 om-cols">
              <div>
                <h3>導入前要知道</h3>
                <Bullets items={m.enterpriseNotes} />
                {m.priceNotes && m.priceNotes.length > 0 && <><h3>價格參考</h3><Bullets items={m.priceNotes} /></>}
              </div>
              <div>
                <h3>熱度訊號</h3>
                {m.signals.map((s) => (
                  <div className="list-item om-signal" key={s.kind + s.value}>
                    <span className="om-kind">{SIGNAL_LABEL[s.kind]}<div className="note mono">{s.asOf}</div></span>
                    <span>{s.value}<Sources refs={s.sources} /></span>
                  </div>))}
              </div>
            </div>
          </details>))}
      </section>

      <section className="card om-notes">
        <h2>熱度怎麼判定</h2>
        <Bullets items={d.method} />
        <p className="note" style={{ marginBottom: 0 }}>資料產生於 {d.generatedAt}。研究任務產出，尚未經平台團隊審核。</p>
      </section>
    </>
  );
}
