// The v3 portal (PORTAL_EDITION=v3): every page reads the research pipeline's live release (views/) at run time.
import { useEffect, useState } from "react";
import { addressVersion, go, manifest, SourcesCtx, taipei, useData, useView, type Manifest } from "./data";
import { Compliance, Gateway, Lifecycle, Market, Matrix, Models, News, Overview, Pricing, Quality, Security } from "./pages";
import ModelPage from "./ModelPage";
import { Status } from "./parts";

const parse = (h: string) => h.replace(/^#\/?/, "").split("?")[0].split("/").map(decodeURIComponent);

const NAV: [string, string][] = [
  ["", "總覽"], ["news", "新聞"], ["models", "模型目錄"], ["matrix", "通路矩陣"], ["pricing", "價格"], ["market", "市場"],
  ["lifecycle", "退役"], ["gateway", "LiteLLM"], ["security", "資安"], ["compliance", "合規"], ["quality", "品質"],
];

export default function App() {
  const [parts, setParts] = useState(parse(window.location.hash));
  const [version, setVersion] = useState(addressVersion());
  useEffect(() => {
    const on = () => { setParts(parse(window.location.hash)); setVersion(addressVersion()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const m = useData(manifest);
  const sources = useView<{ sources: Record<string, never> }>("sources");
  const [p, a] = parts;
  let page;
  switch (p) {
    case "models": page = a ? <ModelPage id={a} /> : <Models />; break;
    case "news": page = <News />; break;
    case "matrix": page = <Matrix />; break;
    case "pricing": page = <Pricing />; break;
    case "market": page = <Market />; break;
    case "lifecycle": page = <Lifecycle />; break;
    case "gateway": page = <Gateway />; break;
    case "security": page = <Security />; break;
    case "compliance": page = <Compliance />; break;
    case "quality": page = <Quality />; break;
    default: page = <Overview />;
  }
  return (
    <SourcesCtx.Provider value={sources.data?.sources ?? {}}>
      <a className="skip" href="#main-content" onClick={(e) => { e.preventDefault(); document.getElementById("main-content")?.focus(); }}>跳到內容</a>
      <header className="topbar">
        <div className="brand">LLM 平台 <span className="note">v3</span></div>
        <nav aria-label="主選單">
          {NAV.map(([path, label]) => <button key={label} aria-current={(p ?? "") === path ? "page" : undefined} onClick={() => go(path)}>{label}</button>)}
        </nav>
      </header>
      <main id="main-content" tabIndex={-1} key={version ?? "latest"}>
        {m.data ? <VersionBar m={m.data} version={version} onPick={(v) => go(parts.join("/"), v)} /> : m.error && <Status error={m.error} />}
        {m.data && page}
      </main>
      <footer className="foot">
        資料由每日研究 agents 產生、通過檢查後自動發布（v3 knowledge base）。標記「社群」「未驗證」的值與「矛盾」請先核對來源再使用。
        {m.data && <> 上線版本 <span className="mono">{m.data.releaseId}</span>（{taipei(m.data.publishedAt)} 台北）。</>}
      </footer>
    </SourcesCtx.Provider>
  );
}

function VersionBar({ m, version, onPick }: { m: Manifest; version: string | null; onPick: (v: string | null) => void }) {
  const list = [...(m.versions ?? [])].sort((x, y) => y.date.localeCompare(x.date));
  const latest = list[0]?.date;
  const current = version ?? latest ?? "";
  return (
    <section className={`versionbar${version && version !== latest ? " past" : ""}`} aria-label="資料版本">
      <label>資料版本{" "}
        <select value={current} onChange={(e) => onPick(e.target.value === latest ? null : e.target.value)} disabled={list.length < 2}>
          {version && !list.some((v) => v.date === version) && <option value={version}>{version}</option>}
          {list.map((v, i) => <option key={v.date} value={v.date}>{v.date}{i === 0 ? "（最新）" : ""}</option>)}
        </select>
      </label>
      {version && version !== latest
        ? <span>正在看 <b>{version}</b> 結束時上線的資料。 <button className="linklike" onClick={() => onPick(null)}>回到最新版本</button></span>
        : <span className="note">第 {m.sequence ?? "?"} 次發布 · {taipei(m.publishedAt)}（台北）{list.length > 1 ? ` · 保留 ${list.length} 天` : ""}</span>}
    </section>
  );
}
