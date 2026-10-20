#!/usr/bin/env python3
"""Merge a research update bundle into an llmops data tree, record by record (never overwrites whole files).

usage: python3 tools/apply_update.py --root <repo-root> --patch <bundle>/patch [--dry-run]

Merge rules
  data/sources.json        insert sources whose id is absent (existing ids are left untouched)
  data/lifecycle.json      upsert events by id; an event is skipped if another id already has the same
                           (service, providerModelId, event, date)
  data/litellm.json        set asOf / generatedAt / supportedLines / recommended / minimumBaseline;
                           releases upsert by version, then `supported` recomputed from supportedLines;
                           avoid rows matching avoid_remove_regex removed, avoid_add upserted by `versions`;
                           knownPitfalls upsert by title; sources de-duplicated append; supportPolicy note appended once
  data/open-models.json    models upsert by id; header fields replaced; method text replacement
  data/catalog.json        watchlist only: names in `remove` dropped, items upserted by name; models untouched
  radar/curation.json      close / rewrite entries appended unless the same id+on already exists
  data/digests/*.json      copied from <bundle>/data/digests if not already present (never overwritten)
Writes JSON with ensure_ascii=False, indent=2 and a trailing newline (the repo's format).
"""
import argparse, json, re, shutil, sys
from pathlib import Path


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def save(p, obj, dry):
    txt = json.dumps(obj, ensure_ascii=False, indent=2) + "\n"
    if dry:
        print(f"  (dry-run) would write {p}")
    else:
        Path(p).write_text(txt, encoding="utf-8")


def line_of(version):
    m = re.match(r"v?(\d+)\.(\d+)", version)
    return f"v{m.group(1)}.{m.group(2)}.x" if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--patch", required=True)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    root, patch, dry = Path(a.root), Path(a.patch), a.dry_run
    log = []

    # digests
    newest = sorted(p.stem for p in (root / "data/digests").glob("*.json"))
    for d in sorted((patch.parent / "data/digests").glob("*.json")):
        dst = root / "data/digests" / d.name
        if dst.exists():
            log.append(f"digest {d.name}: already present, NOT overwritten (compare by hand)")
        else:
            later = [n for n in newest if n > "2026-10-11"]
            if later:
                log.append(f"WARNING: repo already has digests after 2026-10-11 ({', '.join(later)}); the research agents may have covered part of this period - review overlaps")
            if not dry:
                shutil.copy(d, dst)
            log.append(f"digest {d.name}: added")

    # sources
    sp = root / "data/sources.json"; S = load(sp)
    have = {s["id"] for s in S["sources"]}
    add = [s for s in load(patch / "sources.insert.json")["sources"] if s["id"] not in have]
    S["sources"].extend(add)
    save(sp, S, dry); log.append(f"sources: +{len(add)} (skipped {len(load(patch / 'sources.insert.json')['sources']) - len(add)} existing)")

    # lifecycle
    lp = root / "data/lifecycle.json"; L = load(lp); P = load(patch / "lifecycle.upsert.json")
    idx = {e["id"]: i for i, e in enumerate(L["events"])}
    keys = {(e["service"], e["providerModelId"], e["event"], e["date"]): e["id"] for e in L["events"]}
    ins = upd = skip = 0
    for e in P["events"]:
        k = (e["service"], e["providerModelId"], e["event"], e["date"])
        if e["id"] in idx:
            L["events"][idx[e["id"]]] = e; upd += 1
        elif k in keys:
            skip += 1; log.append(f"  lifecycle {e['id']}: same event already exists as {keys[k]} - skipped")
        else:
            L["events"].append(e); ins += 1
    # keep the file's own order (new events are appended)
    L["asOf"] = max(L["asOf"], P["asOf"]); L["generatedAt"] = max(L["generatedAt"], P["generatedAt"])
    save(lp, L, dry); log.append(f"lifecycle: +{ins} new, {upd} replaced, {skip} skipped as duplicates")

    # litellm
    gp = root / "data/litellm.json"; G = load(gp); Q = load(patch / "litellm.patch.json")
    for k in ("asOf", "generatedAt", "supportedLines", "recommended", "minimumBaseline"):
        G[k] = Q[k]
    rv = {r_["version"]: i for i, r_ in enumerate(G["releases"])}
    for r_ in Q["releases"]:
        if r_["version"] in rv:
            old = G["releases"][rv[r_["version"]]]
            r_.setdefault("date", old.get("date")) if old.get("date") else None
            G["releases"][rv[r_["version"]]] = r_
        else:
            G["releases"].append(r_)
    lines = set(Q["supportedLines"])
    for r_ in G["releases"]:
        r_["supported"] = r_["channel"] != "rc" and line_of(r_["version"]) in lines and "-rc" not in r_["version"]
    def vkey(r_):
        nums = [int(x) for x in re.findall(r"\d+", r_["version"])[:3]]
        return (nums, 0 if "-rc" in r_["version"] else 1)
    G["releases"].sort(key=vkey, reverse=True)
    rx = re.compile(Q["avoid_remove_regex"])
    before = len(G["avoid"])
    G["avoid"] = [x for x in G["avoid"] if not rx.match(x["versions"])]
    removed = before - len(G["avoid"])
    av = {x["versions"]: i for i, x in enumerate(G["avoid"])}
    for x in Q["avoid_add"]:
        if x["versions"] in av:
            G["avoid"][av[x["versions"]]] = x
        else:
            G["avoid"].append(x)
    kp = {x["title"]: i for i, x in enumerate(G["knownPitfalls"])}
    for x in Q["knownPitfalls"]:
        if x["title"] in kp:
            G["knownPitfalls"][kp[x["title"]]] = x
        else:
            G["knownPitfalls"].append(x)
    have_src = {s["id"] for s in G.get("sources", [])}
    G["sources"] = G.get("sources", []) + [s for s in Q["sources_add"] if s["id"] not in have_src]
    if Q["supportPolicy_note"] not in G.get("supportPolicy", ""):
        G["supportPolicy"] = (G.get("supportPolicy", "") + " " + Q["supportPolicy_note"]).strip()
    save(gp, G, dry); log.append(f"litellm: recommended {G['recommended']['version']}, baseline {G['minimumBaseline']['version']}, lines {G['supportedLines']}, avoid -{removed}/+{len(Q['avoid_add'])}")

    # open-models
    op = root / "data/open-models.json"
    if op.exists():
        O = load(op); OP = load(patch / "open-models.patch.json")
        h = OP["header"]
        for k in ("generatedAt", "asOf", "marketNotes"):
            O[k] = h[k]
        old_s, new_s = h["methodReplace"]
        O["method"] = [m.replace(old_s, new_s) for m in O["method"]]
        mi = {m["id"]: i for i, m in enumerate(O["models"])}
        n_new = 0
        for m in OP["upsert"]:
            if m["id"] in mi:
                O["models"][mi[m["id"]]] = m
            else:
                O["models"].append(m); n_new += 1
        save(op, O, dry); log.append(f"open-models: {len(OP['upsert']) - n_new} replaced, +{n_new} new")
    else:
        log.append("open-models: data/open-models.json not found - skipped")

    # catalog watchlist only (models / offerings are never touched by this tool)
    wp = patch / "catalog-watchlist.patch.json"
    if wp.exists():
        cat_p = root / "data/catalog.json"; CAT = load(cat_p); W = load(wp)
        rm = set(W["remove"])
        CAT["watchlist"] = [w for w in CAT["watchlist"] if w["name"] not in rm]
        wi = {w["name"]: i for i, w in enumerate(CAT["watchlist"])}
        for w in W["upsert"]:
            if w["name"] in wi:  # keep the dated history: append the new note, union the sources
                cur = CAT["watchlist"][wi[w["name"]]]
                for k in ("status", "expected", "vendor"):
                    if k in w:
                        cur[k] = w[k]
                if w["note"] not in cur["note"]:
                    cur["note"] = (cur["note"] + " " + w["note"]).strip()
                ids = {s["id"] for s in cur["sources"]}
                cur["sources"] += [s for s in w["sources"] if s["id"] not in ids]
            else:
                CAT["watchlist"].append(w)
        save(cat_p, CAT, dry); log.append(f"catalog watchlist: now {[w['name'] for w in CAT['watchlist']]} (models untouched)")

    # curation
    cp = root / "radar/curation.json"
    if cp.exists():
        C = load(cp); CP = load(patch / "curation.patch.json")
        for sec in ("close", "rewrite"):
            seen = {(x["id"], x.get("on")) for x in C.get(sec, [])}
            for x in CP.get(sec, []):
                if (x["id"], x.get("on")) not in seen:
                    C.setdefault(sec, []).append(x)
        save(cp, C, dry); log.append("curation: close/rewrite entries appended")

    print("\n".join(log))
    print("\nnext: python3 tools/validate_data.py && python3 tools/build_radar.py")


if __name__ == "__main__":
    main()
