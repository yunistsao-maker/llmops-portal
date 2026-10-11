#!/usr/bin/env python3
"""Build data/radar.json: ONE current Release Radar merged from every digest.

The daily digests (data/digests/<date>.json) stay what they are: the immutable record of what one research run
found. The Radar page reads only the roll-up this script writes, stamped with the newest digest date - the date
is the version of the view, and each release (or git commit) keeps the roll-up of its day.

Rules (also written into the file, so the page can show them):
  * Action items: every item from every digest, merged when the text is the same after normalising (or nearly the
    same, or merged by radar/curation.json). An item stays on the page while
      - it has a due date that is not before asOf ("due"), or
      - it has no due date and a digest restated it within CARRY_DAYS ("open"),
    and nobody closed it in radar/curation.json. Items that dropped out in the last RETIRED_DAYS are listed as
    "retired" with the reason (expired / closed / stale).
  * News sections (new models, pricing, LiteLLM, security, regulatory): merged by title; kept while a digest
    carried them within NEWS_DAYS. Lifecycle changes are also kept while their own date is today or later.
  * radar/curation.json can merge entries, close action items and give an action item new wording (rewrite) - a
    rewrite counts only while no digest restated the item after it.
  * Watchlist: the catalog's watchlist (the maintained list), not a digest's copy.
  * Unverified: the lines of the digests of the last UNVERIFIED_DAYS, de-duplicated.
Deterministic: the same digests and curation give the same file (generatedAt = the newest digest's generatedAt).

usage: build_radar.py [--root DIR] [--out FILE] [--as-of YYYY-MM-DD] [--check]
  --check   exit 1 when the written file would differ from the one on disk (CI: the committed roll-up is current)
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import sys
import unicodedata
from datetime import date, timedelta
from pathlib import Path

CARRY_DAYS = 30
NEWS_DAYS = 30
RETIRED_DAYS = 14
UNVERIFIED_DAYS = 7
FUZZY = 0.92  # SequenceMatcher ratio above which two normalised texts are the same entry
SECTIONS = ["newModels", "lifecycleChanges", "pricingChanges", "litellm", "security", "regulatory"]
PRIORITY_ORDER = {"P0": 0, "P1": 1, "P2": 2}
IMPACT_ORDER = {"high": 0, "medium": 1, "low": 2}
# "【10-06 補充】" / "【2026-10-06 補充：…】" markers added when a digest was supplemented
_MARKER = re.compile(r"【[^】]{0,40}補充[^】]*】")
_PUNCT = re.compile(r"[\s，,。．.：:；;、（）()「」『』\"'“”‘’!！?？…—–\-/]+")


def norm(text: str) -> str:
    t = unicodedata.normalize("NFKC", text)
    t = _MARKER.sub("", t)
    return _PUNCT.sub(" ", t).strip().lower()


def strip_marker(text: str) -> str:
    return _MARKER.sub("", text).strip()


def hid(prefix: str, *parts: str) -> str:
    return prefix + hashlib.sha1("\x1f".join(parts).encode("utf-8")).hexdigest()[:10]


def day(s: str) -> date:
    return date.fromisoformat(s)


def rules_text() -> list[str]:
    return [
        f"行動項目：所有每日紀錄的行動項目合併成一份（文字相同或幾乎相同的視為同一項，或依 radar/curation.json 合併）。"
        f"有到期日的，到期日前都會顯示；沒有到期日的，最後一次被提到後 {CARRY_DAYS} 天內顯示；已完成的由 curation 關閉。",
        f"最近 {RETIRED_DAYS} 天內移出的行動項目列在「已移出」，並註明原因（到期、已關閉、{CARRY_DAYS} 天未再提到）。",
        f"新模型、價格、LiteLLM、資安、法規：依標題合併，最後一次出現後 {NEWS_DAYS} 天內顯示；生命週期變動在它自己的日期之前也會一直顯示。",
        "Watchlist 取自模型目錄（catalog.json）維護中的清單。",
        f"尚未驗證：最近 {UNVERIFIED_DAYS} 天每日紀錄裡的項目，去除重複。",
        "下拉選單的日期是這份合併版本的日期；每天的原始紀錄保留在 data/digests/，作為稽核紀錄。",
    ]


class Merger:
    """Merge entries by id, by normalised text, then by near-identical text; the newest restatement wins the wording."""

    def __init__(self, prefix: str, alias: dict[str, str]):
        self.prefix, self.alias = prefix, alias
        self.curated = set(alias) | set(alias.values())  # ids a person placed: never re-assigned by fuzzy matching
        self.by_id: dict[str, dict] = {}
        self.norms: dict[str, set[str]] = {}  # id -> every normalised text merged into it

    def key(self, text: str, scope: str = "") -> str:
        n = norm(text)
        own = hid(self.prefix, scope, n)
        resolved = self.alias.get(own, own)
        if own not in self.curated and resolved not in self.norms:  # not seen yet: a near-identical text already seen wins
            for other, texts in self.norms.items():
                if any(difflib.SequenceMatcher(None, n, o).ratio() >= FUZZY for o in texts):
                    resolved = other
                    break
        self.norms.setdefault(resolved, set()).add(n)
        return resolved

    def add(self, entry_id: str, digest_id: str, entry: dict) -> dict:
        cur = self.by_id.get(entry_id)
        if cur is None:
            cur = {"id": entry_id, "firstSeen": digest_id, "seenIn": []}
            self.by_id[entry_id] = cur
        if digest_id not in cur["seenIn"]:
            cur["seenIn"].append(digest_id)
        cur["lastSeen"] = digest_id
        cur["latest"] = entry
        return cur


def build(root: Path, as_of: str | None = None) -> dict:
    digests = []
    for p in sorted((root / "data/digests").glob("*.json")):
        digests.append(json.loads(p.read_text(encoding="utf-8")))
    if not digests:
        raise SystemExit("build_radar: no digests in data/digests/")
    digests.sort(key=lambda d: d["id"])
    if as_of:
        digests = [d for d in digests if d["id"] <= as_of]
    newest = digests[-1]
    as_of = newest["id"]
    today = day(as_of)

    cur_path = root / "radar/curation.json"
    curation = json.loads(cur_path.read_text(encoding="utf-8")) if cur_path.exists() else {"merge": [], "close": []}
    alias = {i: m["keep"] for m in curation.get("merge", []) for i in m["ids"] if i != m["keep"]}
    closed = {c["id"]: c for c in curation.get("close", []) if day(c["on"]) <= today}
    rewrites = {r["id"]: r for r in curation.get("rewrite", []) if day(r["on"]) <= today}

    # ---- action items
    actions = Merger("ai-", alias)
    for d in digests:
        for a in d.get("actionItems", []):
            text = strip_marker(a["action"])
            k = actions.key(text)
            actions.add(k, d["id"], {**a, "action": text})

    active, retired = [], []
    for e in actions.by_id.values():
        a = e["latest"]
        if e["id"] in rewrites:  # a person's wording for a merged or outdated entry (newer than every restatement it replaces)
            r = rewrites[e["id"]]
            if day(r["on"]) >= day(e["lastSeen"]):
                a = {**a, **{k: r[k] for k in ("action", "priority", "due") if k in r}}
                if r.get("due") is None and "due" in r:
                    a.pop("due", None)
        item = {
            "id": e["id"], "firstSeen": e["firstSeen"], "lastSeen": e["lastSeen"], "seenIn": e["seenIn"],
            "isNew": e["firstSeen"] == as_of, "priority": a["priority"], "action": a["action"],
        }
        if a.get("due"):
            item["due"] = a["due"]
        if a.get("relatedModelIds"):
            item["relatedModelIds"] = a["relatedModelIds"]
        if e["id"] in closed:
            c = closed[e["id"]]
            out = {**item, "state": "due" if a.get("due") else "open", "reason": "closed", "retiredOn": c["on"], "note": c["reason"]}
        elif a.get("due") and day(a["due"]) < today:
            out = {**item, "state": "due", "reason": "expired", "retiredOn": a["due"]}
        elif not a.get("due") and (today - day(e["lastSeen"])).days > CARRY_DAYS:
            out = {**item, "state": "open", "reason": "stale", "retiredOn": (day(e["lastSeen"]) + timedelta(days=CARRY_DAYS + 1)).isoformat()}
        else:
            active.append({**item, "state": "due" if a.get("due") else "open"})
            continue
        if (today - day(out["retiredOn"])).days <= RETIRED_DAYS:
            retired.append(out)

    active.sort(key=lambda x: (PRIORITY_ORDER.get(x["priority"], 9), x.get("due") or "9999-99-99", [-ord(c) for c in x["firstSeen"]]))
    retired.sort(key=lambda x: x["retiredOn"], reverse=True)

    # ---- news sections
    out_sections: dict[str, list] = {}
    for sec in SECTIONS:
        m = Merger("it-", alias)
        for d in digests:
            for it in d.get(sec, []):
                title = strip_marker(it["title"])
                k = m.key(title, sec)
                prev = m.by_id.get(k, {}).get("latest")
                merged = {**it, "title": title}
                if prev:  # keep every source ever cited, newest wording
                    seen = {s["id"] for s in it["sources"]}
                    merged["sources"] = list(it["sources"]) + [s for s in prev["sources"] if s["id"] not in seen]
                m.add(k, d["id"], merged)
        items = []
        for e in m.by_id.values():
            it = e["latest"]
            recent = (today - day(e["lastSeen"])).days <= NEWS_DAYS
            upcoming = sec == "lifecycleChanges" and it.get("date") and day(it["date"]) >= today
            if not (recent or upcoming):
                continue
            items.append({**it, "id": e["id"], "firstSeen": e["firstSeen"], "lastSeen": e["lastSeen"],
                          "seenIn": e["seenIn"], "isNew": e["firstSeen"] == as_of})
        items.sort(key=lambda x: (not x["isNew"], [-ord(c) for c in x["lastSeen"]], IMPACT_ORDER.get(x["impact"], 9)))
        out_sections[sec] = items

    # ---- watchlist, unverified
    cat_path = root / "data/catalog.json"
    watchlist = json.loads(cat_path.read_text(encoding="utf-8")).get("watchlist", []) if cat_path.exists() else newest.get("watchlist", [])
    unverified, seen_u = [], set()
    for d in reversed(digests):
        if (today - day(d["periodEnd"])).days > UNVERIFIED_DAYS:
            continue
        for u in d.get("unverified", []):
            n = norm(u)
            if n and n not in seen_u and not any(difflib.SequenceMatcher(None, n, o).ratio() >= FUZZY for o in seen_u):
                seen_u.add(n)
                unverified.append(strip_marker(u))

    return {
        "schema": "radar/v1",
        "generatedAt": newest["generatedAt"],
        "locale": newest.get("locale", "zh-TW"),
        "asOf": as_of,
        "headline": strip_marker(newest["headline"]) if newest["headline"].startswith("【") else newest["headline"],
        "coverage": {"start": min(d["periodStart"] for d in digests), "end": max(d["periodEnd"] for d in digests),
                     "digests": [d["id"] for d in digests]},
        "rules": rules_text(),
        "actionItems": active,
        "retired": retired,
        **out_sections,
        "watchlist": watchlist,
        "unverified": unverified,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    ap.add_argument("--out", default=None, help="default: <root>/data/radar.json")
    ap.add_argument("--as-of", default=None, help="build the view as it was on this digest date")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    root = Path(args.root)
    out = Path(args.out) if args.out else root / "data/radar.json"
    radar = build(root, args.as_of)
    text = json.dumps(radar, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        same = out.exists() and out.read_text(encoding="utf-8") == text
        print(f"radar.json {'is current' if same else 'is out of date: run tools/build_radar.py'}")
        return 0 if same else 1
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    print(f"built {out.relative_to(root) if out.is_relative_to(root) else out}: asOf {radar['asOf']}, "
          f"{len(radar['actionItems'])} active action items ({sum(a['isNew'] for a in radar['actionItems'])} new), "
          f"{len(radar['retired'])} retired, {len(radar['coverage']['digests'])} digests merged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
