// v3 data layer: the portal reads the research pipeline's published views (llmops-views/v1) at run time.
//
//   portal-config.json            {"dataBaseUrl": "https://<cloudfront>/<token>/"}  (written by tools/build_site.mjs, PORTAL_EDITION=v3)
//   <dataBaseUrl>manifest.json     portal-manifest/v1: the live release (basePath) and the daily versions
//   <dataBaseUrl><basePath>views/<name>.json   immutable views of that release
//
// The address keeps the selected daily version (#/models?v=2026-11-18); without it the live release is shown.
import { createContext, useContext, useEffect, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type J = any;

/** One value from a KB fact (docs/data-format.md §9.1). */
export interface Val {
  key: string; label: string; value: unknown; display: string; note?: string;
  where?: Record<string, string>; whereLabel?: string; basis?: string; src?: string[];
  verified?: string | null; recorded?: string; since?: string; state?: string;
  conflict?: { id: string; rule: string; message: string } | null; history?: Val[];
}
export interface Rec { where: Record<string, string>; title: string; fields: Val[] }
export interface Section { group: string; label: string; order?: number; fields: Val[]; records: Rec[] }
export interface Source { url: string; title: string; publisher: string; type?: string; tier?: string; accessed?: string }
export interface Manifest {
  schema: string; releaseId: string; basePath: string; publishedAt: string; sequence?: number;
  source?: { kind: string; by?: string }; history?: { releaseId: string; publishedAt: string; kind: string; summary?: string }[];
  versions?: { date: string; releaseId: string; publishedAt?: string }[];
}

const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const RELEASE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function addressVersion(): string | null {
  const v = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("v");
  return v && DAY.test(v) ? v : null;
}
export const linkTo = (path: string) => { const v = addressVersion(); return "#/" + path + (v ? `?v=${v}` : ""); };
export const go = (path: string, version: string | null = addressVersion()) => {
  window.location.hash = "/" + path + (version ? `?v=${version}` : "");
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}（${url.replace(/\/[0-9a-f]{16,64}\//, "/…/")}）`);
  return r.json() as Promise<T>;
}

let baseP: Promise<string> | undefined;
/** Where the data lives: portal-config.json next to index.html. */
const base = () =>
  (baseP ??= json<{ dataBaseUrl?: string }>("portal-config.json", { cache: "no-cache" }).then((c) => {
    const u = (c.dataBaseUrl ?? "").trim();
    if (!/^https?:\/\//.test(u)) throw new Error("portal-config.json 沒有 dataBaseUrl");
    return u.endsWith("/") ? u : u + "/";
  }));

let manifestP: Promise<Manifest> | undefined;
export const manifest = () =>
  (manifestP ??= base().then((b) => json<Manifest>(b + "manifest.json", { cache: "no-cache" })).then((m) => {
    if (m.schema !== "portal-manifest/v1" || !RELEASE.test(m.releaseId)) throw new Error("manifest.json 的格式不對");
    return m;
  }));

/** The release a daily version shows (null = the live release). */
export async function releaseFor(version: string | null): Promise<{ id: string; basePath: string; live: boolean }> {
  const m = await manifest();
  if (!version) return { id: m.releaseId, basePath: m.basePath, live: true };
  const v = (m.versions ?? []).filter((x) => x.date <= version).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!v || !RELEASE.test(v.releaseId)) throw new Error(`沒有 ${version} 這一版`);
  return { id: v.releaseId, basePath: `releases/${v.releaseId}/`, live: v.releaseId === m.releaseId };
}

const cache = new Map<string, Promise<unknown>>();
/** views/<name>.json of the selected version's release. Release files never change: cached for the session. */
export function view<T = J>(name: string): Promise<T> {
  const v = addressVersion();
  return releaseFor(v).then(async ({ basePath }) => {
    const url = (await base()) + basePath + `views/${name}.json`;
    if (!cache.has(url)) cache.set(url, json<T>(url).catch((e) => { cache.delete(url); throw e; }));
    return cache.get(url) as Promise<T>;
  });
}

export function useData<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [state, set] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    let live = true;
    set({});
    load().then((data) => live && set({ data }), (e) => live && set({ error: String(e?.message ?? e) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
export const useView = <T = J>(name: string) => useData<T>(() => view<T>(name), [name, addressVersion()]);

export const SourcesCtx = createContext<Record<string, Source>>({});
export const useSources = () => useContext(SourcesCtx);

export const money = (n?: number | null) =>
  n === undefined || n === null ? "—" : `$${Number.isInteger(n) ? n : n < 0.1 ? n.toFixed(3).replace(/0$/, "") : n.toFixed(2)}`;
export const fmt = (n?: number | null) => (n === undefined || n === null ? "—" : n.toLocaleString("en-US"));
export const taipei = (iso?: string | null) =>
  iso ? new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : "—";
