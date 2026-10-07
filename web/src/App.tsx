import { useEffect, useState } from "react";
import Radar from "./pages/Radar";
import Catalog from "./pages/Catalog";
import ModelPage from "./pages/ModelPage";
import Eol from "./pages/Eol";

type Route = { page: "radar" } | { page: "catalog" } | { page: "model"; id: string } | { page: "eol" };

function parse(hash: string): Route {
  const [p, id] = hash.replace(/^#\/?/, "").split("/");
  if (p === "models" && id) return { page: "model", id };
  if (p === "models") return { page: "catalog" };
  if (p === "eol") return { page: "eol" };
  return { page: "radar" };
}

export const go = (path: string) => { window.location.hash = "/" + path; };

export default function App() {
  const [route, setRoute] = useState<Route>(parse(window.location.hash));
  useEffect(() => {
    const on = () => { setRoute(parse(window.location.hash)); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const nav: [string, string, boolean][] = [
    ["", "Release Radar", route.page === "radar"],
    ["models", "模型目錄", route.page === "catalog" || route.page === "model"],
    ["eol", "平台清單與 EOL", route.page === "eol"],
  ];
  return (
    <>
      <header className="topbar">
        <div className="brand">LLM 平台</div>
        <nav aria-label="主選單">
          {nav.map(([path, label, cur]) => (
            <button key={label} aria-current={cur ? "page" : undefined} onClick={() => go(path)}>{label}</button>
          ))}
        </nav>
        <div className="asof">資料來源：data/*.json</div>
      </header>
      <main>
        {route.page === "radar" && <Radar />}
        {route.page === "catalog" && <Catalog />}
        {route.page === "model" && <ModelPage id={route.id} />}
        {route.page === "eol" && <Eol />}
      </main>
    </>
  );
}

export function Status({ error }: { error?: string }) {
  return <div className="card" role="status">{error ? `載入失敗：${error}` : "載入中…"}</div>;
}
