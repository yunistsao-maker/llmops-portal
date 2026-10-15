import { useEffect, useMemo, useState } from "react";
import { addressVersion, EDITION, hasPage, loaders, selectedVersion, SourcesCtx, UNVERSIONED, useData, VERSION_DAYS, type VersionsFile } from "./data";
import Radar from "./pages/Radar";
import Catalog from "./pages/Catalog";
import Compare from "./pages/Compare";
import OpenModels from "./pages/OpenModels";
import ModelPage from "./pages/ModelPage";
import Eol from "./pages/Eol";
import Tests from "./pages/Tests";
import Release from "./pages/Release";
import Gateway from "./pages/Gateway";
import Onboarding from "./pages/Onboarding";
import Methods from "./pages/Methods";
import { Status } from "./ui";

/** Navigate within the portal; the selected daily version (?v=) stays selected. */
export const go = (path: string, version: string | null = addressVersion()) => {
  window.location.hash = "/" + path + (version ? `?v=${version}` : "");
};
const parse = (h: string) => h.replace(/^#\/?/, "").split("?")[0].split("/").map(decodeURIComponent);

const NAV: [string, string][] = [
  ["", "Release Radar"], ["models", "模型目錄"], ["compare", "比較"], ["open", "開源模型"], ["eol", "平台清單與 EOL"],
  ["tests", "測試結果"], ["release", "發布流程"], ["gateway", "LiteLLM 與安全"], ["onboarding", "上手指南"], ["methods", "方法與來源"],
];

export default function App() {
  const [parts, setParts] = useState(parse(window.location.hash));
  const [version, setVersion] = useState(selectedVersion());
  useEffect(() => {
    const on = () => { setParts(parse(window.location.hash)); setVersion(selectedVersion()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const versions = useData(loaders.versions);
  // the latest day is data/ itself: ?v=<today> (an old link, a bookmark from this morning) means "latest"
  useEffect(() => {
    if (version && versions.data && versions.data.versions[0]?.date === version) go(parts.join("/"), null);
  }, [version, versions.data, parts]);
  const sources = useData(loaders.sources, [version]);
  const srcMap = useMemo(() => new Map((sources.data?.sources ?? []).map((s) => [s.id, s])), [sources.data]);
  const [p0, a] = parts;
  const p = hasPage(p0 ?? "") ? p0 : ""; // a page this edition does not have opens the Release Radar
  const section = p === "models" && a ? "models" : p ?? "";
  let page;
  switch (p) {
    case "models": page = a ? <ModelPage id={a} /> : <Catalog />; break;
    case "compare": page = <Compare ids={a ? a.split(",") : []} />; break;
    case "open": page = <OpenModels id={a} />; break;
    case "eol": page = <Eol />; break;
    case "tests": page = <Tests />; break;
    case "release": page = <Release model={a} />; break;
    case "gateway": page = <Gateway />; break;
    case "onboarding": page = <Onboarding />; break;
    case "methods": page = <Methods />; break;
    default: page = <Radar digestId={p === "digest" ? a : undefined} />;
  }
  return (
    <SourcesCtx.Provider value={srcMap}>
      <a className="skip" href="#main-content" onClick={(e) => { e.preventDefault(); document.getElementById("main-content")?.focus(); }}>跳到內容</a>
      <header className="topbar">
        <div className="brand">LLM 平台</div>
        <nav aria-label="主選單">
          {NAV.filter(([path]) => hasPage(path)).map(([path, label]) => (
            <button key={label} aria-current={(section === path || (path === "" && p === "digest")) ? "page" : undefined} onClick={() => go(path)}>{label}</button>
          ))}
        </nav>
      </header>
      <main id="main-content" tabIndex={-1} key={version ?? "latest"}>
        {!UNVERSIONED.has(section) && <VersionBar index={versions.data} version={version} onPick={(v) => go(parts.join("/"), v)} />}
        {/* a named version waits for the list of versions: ?v=<today> is the latest (data/), not a folder */}
        {version && (versions.data ? versions.data.versions[0]?.date === version : !versions.error) ? <Status /> : page}
      </main>
      {EDITION === "full" && (
        <a className="sec-demo" href="./security-tests.html">AI 安全測試（示範・模擬資料）</a>
      )}
      <footer className="foot">每天一版：日期就是版本，每一版都是當天結束時仍然有效的全部資料（不是當天的變動），保留最近 {VERSION_DAYS} 天。研究由每日排程的 agent 更新；社群與未驗證資訊以紅字標示，使用前請核對來源。</footer>
    </SourcesCtx.Provider>
  );
}

/** The daily version menu on every research page. */
function VersionBar({ index, version, onPick }: { index?: VersionsFile; version: string | null; onPick: (v: string | null) => void }) {
  const list = index?.versions ?? [];
  const latest = list[0]?.date;
  const current = version ?? latest;
  const known = !version || list.some((v) => v.date === version);
  const label = (i: number) => {
    const v = list[i];
    const unchanged = i + 1 < list.length && v.releaseId !== null && v.releaseId === list[i + 1].releaseId;
    return `${v.date}${i === 0 ? "（最新）" : ""}${unchanged ? " · 當天沒有新發布" : ""}`;
  };
  return (
    <section className={`versionbar${version ? " past" : ""}`} aria-label="資料版本">
      <label>資料版本{" "}
        <select value={known ? current ?? "" : ""} onChange={(e) => onPick(e.target.value === latest ? null : e.target.value)} disabled={list.length < 2}>
          {!known && <option value="">{version}（沒有這一版）</option>}
          {list.map((v, i) => <option key={v.date} value={v.date}>{label(i)}</option>)}
        </select>
      </label>
      {version ? (
        <span>
          {known ? <>正在看 <b>{version}</b> 的版本：那天結束時上線的資料，含當時仍然有效的所有項目。</> : <>沒有 {version} 這一版（只保留最近 {VERSION_DAYS} 天）。</>}{" "}
          <button className="linklike" onClick={() => onPick(null)}>回到最新版本</button>
        </span>
      ) : (
        <span className="note">{list.length > 1 ? `每天一版，保留最近 ${list.length} 天；切換日期會換掉這一頁的全部資料。` : "目前只有今天這一版。"}</span>
      )}
    </section>
  );
}
