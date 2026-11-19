// Shared pieces of the v3 pages: sources, value objects and the generic "sections" every model view uses.
import { useState, type ReactNode } from "react";
import { useSources, type Rec, type Section, type Val } from "./data";

export { Empty, Filters, PageHead, Status, Tabs } from "../ui";

const BASIS: Record<string, string> = { official: "官方", independent: "獨立", community: "社群", derived: "推算", unverified: "未驗證", "internal-test": "內部實測" };
export function Basis({ b }: { b?: string | null }) {
  if (!b) return null;
  const cls = b === "community" || b === "unverified" ? "verif weak" : b === "official" ? "verif strong" : "verif";
  return <span className={cls} title={b}>{BASIS[b] ?? b}</span>;
}

/** Source ids as links (title as tooltip). Long lists collapse after `max`. */
export function Src({ ids, max = 3 }: { ids?: string[]; max?: number }) {
  const map = useSources();
  const [all, setAll] = useState(false);
  if (!ids?.length) return null;
  const shown = all ? ids : ids.slice(0, max);
  return (
    <span className="srcs">
      {shown.map((id) => {
        const s = map[id];
        return s ? <a key={id} href={s.url} target="_blank" rel="noreferrer" title={`${s.publisher}：${s.title}`}>[{s.publisher}]</a>
          : <span key={id} className="note">[{id}]</span>;
      })}
      {ids.length > max && !all && <button className="linklike" onClick={() => setAll(true)}>+{ids.length - max}</button>}
    </span>
  );
}

export const STATUS_CLS: Record<string, string> = { ga: "host-ga", preview: "pill", retired: "risk-retired", deprecated: "pill warn" };
export function Cell({ c }: { c?: { status?: string | null; statusLabel?: string; since?: string | null } }) {
  if (!c || !c.status) return <span className="note">—</span>;
  return <span className={`tag ${STATUS_CLS[c.status] ?? ""}`} title={c.since ? `since ${c.since}` : undefined}>{c.statusLabel ?? c.status}</span>;
}

/** One value: display text, where it applies, basis, last verified, sources, open conflict and history. */
export function ValLine({ v, showWhere = true }: { v: Val; showWhere?: boolean }) {
  const [hist, setHist] = useState(false);
  return (
    <div className="v3-val">
      <span>{v.display || String(v.value ?? "—")}</span>
      {showWhere && v.whereLabel && <span className="note"> · {v.whereLabel}</span>}
      {" "}<Basis b={v.basis} />
      {v.verified && <span className="note" title="最後核對日"> ✓{v.verified}</span>}
      {" "}<Src ids={v.src} />
      {v.conflict && <div className="pill warn" title={v.conflict.rule}>矛盾：{v.conflict.message}</div>}
      {!!v.history?.length && (
        <div>
          <button className="linklike" onClick={() => setHist(!hist)}>{hist ? "收起歷史" : `歷史 ${v.history.length} 筆`}</button>
          {hist && <ul className="bullets note">{v.history.map((h, i) => <li key={i}>{h.display} {h.since && `（${h.since} 起）`}<Src ids={h.src} /></li>)}</ul>}
        </div>
      )}
    </div>
  );
}

/** Values grouped by label (a key can repeat: several strengths, several regions…). */
export function Fields({ fields, showWhere }: { fields: Val[]; showWhere?: boolean }) {
  if (!fields.length) return null;
  const groups: [string, Val[]][] = [];
  for (const f of fields) {
    const g = groups.find(([l]) => l === f.label);
    if (g) g[1].push(f); else groups.push([f.label, [f]]);
  }
  return (
    <dl className="kv">
      {groups.map(([label, vs]) => (
        <div key={label} style={{ display: "contents" }}>
          <dt>{label}</dt>
          <dd>{vs.map((v, i) => <ValLine key={i} v={v} showWhere={showWhere} />)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A record's heading: an item id ("w1fcdd466") says nothing, so its first value is the heading instead. */
function recTitle(r: Rec): { title: string; rest: Val[] } {
  if (r.where && "item" in r.where && r.fields.length) return { title: r.fields[0].display, rest: r.fields.slice(1) };
  const label = Object.entries(r.where ?? {}).map(([, v]) => v).join(" · ");
  return { title: label || r.title, rest: r.fields };
}

export function Records({ records }: { records: Rec[] }) {
  if (!records.length) return null;
  return (
    <div className="v3-records">
      {records.map((r, i) => {
        const { title, rest } = recTitle(r);
        return (
          <div key={i} className="v3-rec">
            <div className="v3-rec-title">{title}</div>
            <Fields fields={rest} showWhere={false} />
          </div>
        );
      })}
    </div>
  );
}

export function Sections({ sections, empty = "沒有資料" }: { sections?: Section[]; empty?: ReactNode }) {
  const list = (sections ?? []).filter((s) => s.fields.length || s.records.length);
  if (!list.length) return <p className="note">{empty}</p>;
  return (
    <>
      {[...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((s) => (
        <section key={s.group} className="v3-section">
          <h3>{s.label}</h3>
          <Fields fields={s.fields} />
          <Records records={s.records} />
        </section>
      ))}
    </>
  );
}

export const Bullets = ({ items }: { items?: string[] }) =>
  items?.length ? <ul className="bullets">{items.map((i, n) => <li key={n}>{i}</li>)}</ul> : null;
