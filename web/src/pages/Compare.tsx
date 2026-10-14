import { go } from "../App";
import { linkTo, loaders, money, useData } from "../data";
import { Empty, PageHead, Status } from "../ui";
import type { BenchmarkResult, Model } from "../../../schema/types";

const isAA = (b: BenchmarkResult) => b.name.startsWith("Artificial");
/** "v4.3.2" -> [4, 3, 2]; null for a version that is not a dotted number (e.g. a note about an older index). */
const versionKey = (v?: string) => { const m = /^v?(\d+(?:\.\d+)*)$/.exec((v ?? "").trim()); return m ? m[1].split(".").map(Number) : null; };
const newer = (a: number[], b: number[]) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0); return false; };

/** The newest Artificial Analysis index version any of these models has a score for (scores compare only within one version). */
function newestAAVersion(models: Model[]): string | undefined {
  let best: { v: string; k: number[] } | undefined;
  for (const b of models.flatMap((m) => m.benchmarks.filter(isAA))) {
    const k = versionKey(b.version);
    if (k && b.version && (!best || newer(k, best.k))) best = { v: b.version, k };
  }
  return best?.v;
}

function aaCell(m: Model, version?: string) {
  const mine = m.benchmarks.filter(isAA);
  const b = mine.filter((x) => x.version === version).sort((x, y) => y.date.localeCompare(x.date))[0];
  if (b) return b.rank ? `${b.score}（${b.rank}）` : `${b.score}`;
  const other = mine.filter((x) => versionKey(x.version)).sort((x, y) => y.date.localeCompare(x.date))[0];
  return <>—{other && <div className="note">只有 {other.version} 的分數（{other.score}），不同版本不比較</div>}</>;
}

const rows = (aa?: string): [string, (m: Model) => React.ReactNode][] => [
  ["廠商 / 層級", (m) => `${m.vendor} · ${m.tier}`],
  ["發布", (m) => m.releaseDate],
  ["雲端", (m) => [...new Set(m.offerings.map((o) => `${o.cloud.toUpperCase()}（${o.status}）`))].join("、")],
  ["Context / 最大輸出", (m) => `${(m.contextWindow / 1000).toFixed(0)}K / ${(m.maxOutputTokens / 1000).toFixed(0)}K`],
  ["推理", (m) => `${m.reasoning.alwaysOn ? "永遠開啟" : "可關閉"} · effort：${(m.reasoning.effortLevels ?? []).join(" / ")}`],
  ["Global 價格 in / out", (m) => { const p = m.offerings.flatMap((o) => o.pricing).find((x) => x.input !== undefined); return `${money(p?.input)} / ${money(p?.output)}`; }],
  [aa ? `AA ${aa}` : "AA 智慧指數", (m) => aaCell(m, aa)],
  ["AA 每任務成本", (m) => { const p = m.performanceReference.find((x) => x.costPerIndexTaskUsd !== undefined); return p ? `$${p.costPerIndexTaskUsd}` : "—"; }],
  ["輸出速度 / 首 token", (m) => { const p = m.performanceReference.find((x) => x.outputTokensPerSec); return p ? `${p.outputTokensPerSec} tok/s · ${p.ttftSec ?? "—"} 秒（${p.variant}）` : "—"; }],
  ["台灣境內處理", (m) => (m.offerings.some((o) => o.dataProcessing.taiwanResidency === "yes") ? "有" : "無")],
  ["LiteLLM 建議版本", (m) => m.litellm.recommendedVersion],
  ["適合", (m) => <ul className="bullets">{m.bestFor.map((x) => <li key={x}>{x}</li>)}</ul>],
  ["要注意", (m) => <ul className="bullets">{m.weaknesses.slice(0, 4).map((x) => <li key={x}>{x}</li>)}</ul>],
];

export default function Compare({ ids }: { ids: string[] }) {
  const { data, error } = useData(loaders.catalog);
  if (!data) return <Status error={error} />;
  const models = ids.map((id) => data.models.find((m) => m.id === id)).filter(Boolean) as Model[];
  const aa = newestAAVersion(models);
  return (
    <>
      <PageHead eyebrow="最多 3 個模型並排" title="模型比較" />
      <div className="filters">
        {data.models.map((m) => (
          <button key={m.id} aria-pressed={ids.includes(m.id)} onClick={() => {
            const next = ids.includes(m.id) ? ids.filter((x) => x !== m.id) : [...ids, m.id].slice(-3);
            go(`compare/${next.join(",")}`);
          }}>{m.name}</button>))}
      </div>
      {models.length < 2 ? <Empty>選兩到三個模型開始比較。價格、效能與分數都來自外部參考，上線決策請搭配內部實測（測試結果頁）。</Empty> : (
        <section className="card">
          <table>
            <thead><tr><th style={{ width: 180 }}></th>{models.map((m) => <th key={m.id}><a href={linkTo(`models/${m.id}`)} style={{ fontWeight: 700, fontSize: 16 }}>{m.name}</a></th>)}</tr></thead>
            <tbody>{rows(aa).map(([label, f]) => <tr key={label}><td className="note">{label}</td>{models.map((m) => <td key={m.id}>{f(m)}</td>)}</tr>)}</tbody>
          </table>
          <p className="note">智慧指數只在相同版本{aa ? `（${aa}，所選模型中最新的版本）` : ""}比較；延遲依 effort 差異極大，請看各模型的效能頁。</p>
        </section>)}
    </>
  );
}
