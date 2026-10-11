import type { ReactNode } from "react";
import { useSources, type SourceRef } from "./data";

export function Status({ error }: { error?: string }) {
  return <div className="card" role="status">{error ? `載入失敗：${error}` : "載入中…"}</div>;
}

export function PageHead({ eyebrow, title, right }: { eyebrow?: ReactNode; title: string; right?: ReactNode }) {
  return (
    <header className="pagehead">
      <div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1></div>
      {right && <div className="pagehead-right">{right}</div>}
    </header>
  );
}

export function Verif({ v }: { v?: string }) {
  if (!v) return <span className="note">—</span>;
  const cls = v === "community" || v === "unverified" ? "verif weak" : v === "official" ? "verif strong" : "verif";
  const label: Record<string, string> = { official: "官方", independent: "獨立", community: "社群", derived: "推算", unverified: "未驗證", "internal-test": "內部實測" };
  return <span className={cls} title={v}>{label[v] ?? v}</span>;
}

/** Renders SourceRefs as numbered links with titles as tooltips. */
export function Sources({ refs }: { refs?: SourceRef[] }) {
  const map = useSources();
  if (!refs?.length) return null;
  return (
    <span className="srcs">
      {refs.map((r) => {
        const s = map.get(r.id);
        return s ? <a key={r.id} href={s.url} target="_blank" rel="noreferrer" title={`${s.publisher}：${s.title}`}>[{s.publisher}]</a> : <span key={r.id} className="note">[{r.id}]</span>;
      })}
    </span>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly T[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => <button key={t} role="tab" aria-selected={value === t} onClick={() => onChange(t)}>{t}</button>)}
    </div>
  );
}

export function Filters<T extends string>({ label, options, value, onChange }: { label: string; options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="filters" role="group" aria-label={label}>
      {options.map(([v, l]) => <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export const Bullets = ({ items }: { items: string[] }) => <ul className="bullets">{items.map((i) => <li key={i}>{i}</li>)}</ul>;

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
