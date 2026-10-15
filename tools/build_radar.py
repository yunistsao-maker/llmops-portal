#!/usr/bin/env python3
"""Build data/radar.json: ONE current Release Radar merged from every digest.

The daily digests (data/digests/<date>.json) stay what they are: the immutable record of what one research run
found. The Radar page reads only the roll-up this script writes, stamped with the newest digest date - the date
is the version of the view, and each release (or git commit) keeps the roll-up of its day.

Rules (also written into the file, so the page can show them):
  * One card per subject. Entries of different days become one card (news: within one section; action items: all
    of them) when they are linked by
      (a) radar/curation.json `merge` (several texts given one id),
      (b) the same `topic` ("<area>:<subject>[:<aspect>]") - set by the digest entry, or assigned to legacy entry ids
          by curation `topics`,
      (c) `merges` - a digest entry names the exact titles (action texts) of EARLIER entries it updates,
      (d) the same text after normalising, or a nearly identical one (FUZZY).
    The newest statement gives the wording (news: title / detail / impact / date / vendor / clouds; action items:
    action / priority / due / relatedModelIds), sources are the union (newest first), firstSeen / lastSeen / seenIn
    cover the whole card and `updates` lists the earlier statements, newest first, dated by digest (a run of
    identical statements counts once, at its first date; the current wording is not repeated). The card id is the
    id of the oldest entry in it, so a card keeps its id while new statements join it.
  * Coverage notes - entries with `check: true` or listed in curation `checks` ("checked, no change") - are never
    news cards and take no part in merging. `checks` lists those of the last CHECK_DIGESTS digests; per section only
    the notes of the newest digest that has any.
  * Action items: an item stays on the page while
      - it has a due date that is not before asOf ("due"), or
      - it has no due date and a digest restated it within CARRY_DAYS ("open"),
    and nobody closed it in radar/curation.json. Items that dropped out in the last RETIRED_DAYS are listed as
    "retired" with the reason (expired / closed / stale).
  * News sections (new models, pricing, LiteLLM, security, regulatory): kept while a digest carried them within
    NEWS_DAYS. Lifecycle changes are also kept while their own date is today or later.
  * radar/curation.json `close` / `rewrite` name a card id or an id merged into it; they count while no other entry
    of the card restated the subject after that id's last statement (and a rewrite only while no digest restated
    the item after its `on`).
  * Watchlist: the catalog's watchlist (the maintained list), not a digest's copy.
  * Unverified: the lines of the digests of the last UNVERIFIED_DAYS, de-duplicated.
Deterministic: the same digests and curation give the same file (generatedAt = the newest digest's generatedAt).
Problems an author should fix (a `merges` title that names no earlier entry, a curation id that matches nothing)
are printed to stderr; they never change the output.

usage: build_radar.py [--root DIR] [--out FILE] [--as-of YYYY-MM-DD] [--curation FILE] [--check]
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
CHECK_DIGESTS = 3
FUZZY = 0.92  # SequenceMatcher ratio above which two normalised texts are the same entry
SECTIONS = ["newModels", "lifecycleChanges", "pricingChanges", "litellm", "security", "regulatory"]
PRIORITY_ORDER = {"P0": 0, "P1": 1, "P2": 2}
IMPACT_ORDER = {"high": 0, "medium": 1, "low": 2}
INPUT_ONLY = ("topic", "check", "merges")  # digest fields that steer merging; the card carries its own topic
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


def warn(msg: str) -> None:
    print(f"build_radar: warning: {msg}", file=sys.stderr)


def rules_text() -> list[str]:
    return [
        "同一件事只有一張卡：不同天的紀錄，只要 (1) radar/curation.json 的 merge 指定合併、(2) topic 相同"
        "（每日紀錄自己標的，或 curation 的 topics 替舊紀錄補上；新聞只在同一節內合併）、(3) 新紀錄的 merges 列出它更新的舊紀錄、"
        "或 (4) 文字相同或幾乎相同，就合併成一張。卡片顯示最新的說法；較早的說法依日期列在「更新紀錄」，來源全部保留。",
        f"行動項目：所有每日紀錄的行動項目合併成一份。有到期日的，到期日前都會顯示；沒有到期日的，最後一次被提到後 {CARRY_DAYS} 天內顯示；"
        "已完成的由 curation 關閉（之後又有新的說法併入時，以新的說法為準）。",
        f"最近 {RETIRED_DAYS} 天內移出的行動項目列在「已移出」，並註明原因（到期、已關閉、{CARRY_DAYS} 天未再提到）。",
        f"新模型、價格、LiteLLM、資安、法規：最後一次出現後 {NEWS_DAYS} 天內顯示；生命週期變動在它自己的日期之前也會一直顯示。",
        f"「已複查、沒有變動」的紀錄（每日紀錄標 check，或 curation 的 checks）不算新聞：只列最近 {CHECK_DIGESTS} 份每日紀錄裡、"
        "每一節最新一次的複查。",
        "Watchlist 取自模型目錄（catalog.json）維護中的清單。",
        f"尚未驗證：最近 {UNVERIFIED_DAYS} 天每日紀錄裡的項目，去除重複。",
        "下拉選單的日期是這份合併版本的日期；每天的原始紀錄保留在 data/digests/，作為稽核紀錄。",
    ]


class Merger:
    """Give each text an id: by curation merge, by normalised text, then by near-identical text (rule a + d)."""

    def __init__(self, prefix: str, alias: dict[str, str]):
        self.prefix, self.alias = prefix, alias
        self.curated = set(alias) | set(alias.values())  # ids a person placed: never re-assigned by fuzzy matching
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


class Groups:
    """Union-find over card ids; a group's root is the id that appeared first (so a card keeps its id as it grows)."""

    def __init__(self) -> None:
        self.parent: dict[str, str] = {}
        self.order: dict[str, int] = {}

    def add(self, k: str) -> None:
        if k not in self.parent:
            self.parent[k] = k
            self.order[k] = len(self.order)

    def find(self, k: str) -> str:
        while self.parent[k] != k:
            self.parent[k] = self.parent[self.parent[k]]
            k = self.parent[k]
        return k

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            if self.order[rb] < self.order[ra]:
                ra, rb = rb, ra
            self.parent[rb] = ra


def merge_stream(prefix: str, scope: str, stream: list[tuple[str, dict, str]], alias: dict[str, str],
                 topics: dict[str, str], label: str, seen_ids: set[str]) -> list[list[dict]]:
    """``stream``: (digest id, entry, text) oldest first. Returns the groups (rules a-d), each a list of statements
    oldest first, in the order the groups first appeared."""
    m, g = Merger(prefix, alias), Groups()
    own_to_key: dict[str, str] = {}
    first_of_topic: dict[str, str] = {}
    stmts = []
    for did, entry, text in stream:
        own = hid(prefix, scope, norm(text))
        k = m.key(text, scope)
        g.add(k)
        seen_ids.update((own, k))
        for t in entry.get("merges", []):  # (c) earlier entries this one updates, named by their exact text
            target = own_to_key.get(hid(prefix, scope, norm(strip_marker(t))))
            if target is None:
                warn(f"{did} {label}: merges names no earlier entry: {t[:70]!r}")
            else:
                g.union(k, target)
        own_to_key[own] = k
        tops = [t for t in (entry.get("topic"), topics.get(own), topics.get(k)) if t]
        for t in dict.fromkeys(tops):  # (b) same topic
            if t in first_of_topic:
                g.union(k, first_of_topic[t])
            else:
                first_of_topic[t] = k
        stmts.append({"digest": did, "key": k, "entry": entry, "text": text, "topic": tops[0] if tops else None})
    groups: dict[str, list[dict]] = {}
    for s in stmts:
        groups.setdefault(g.find(s["key"]), []).append(s)
    return list(groups.values())


def history(stmts: list[dict], wording, render, include_current: bool = False) -> list[dict]:
    """Earlier statements, newest first: a run of identical wording counts once (at its first date); the run of the
    current wording is left out unless ``include_current`` (the card shows other wording, e.g. a curation rewrite)."""
    runs: list[tuple[object, dict]] = []
    for s in stmts:
        w = wording(s)
        if not runs or runs[-1][0] != w:
            runs.append((w, s))
    if not include_current:
        runs = runs[:-1]
    return [render(s) for _, s in reversed(runs)]


def provenance(gid: str, stmts: list[dict], as_of: str) -> dict:
    seen_in = sorted({s["digest"] for s in stmts})
    return {"id": gid, "firstSeen": seen_in[0], "lastSeen": seen_in[-1], "seenIn": seen_in, "isNew": seen_in[0] == as_of}


def card_topic(stmts: list[dict]) -> str | None:
    return next((s["topic"] for s in reversed(stmts) if s["topic"]), None)


def curation_on_card(by_id: dict[str, dict], stmts: list[dict]) -> dict | None:
    """The close / rewrite entry that applies to this card: its id is in the card and no other entry of the card
    restated the subject after that id's last statement. The newest such entry wins."""
    last: dict[str, str] = {}
    for s in stmts:
        last[s["key"]] = s["digest"]
    newest = stmts[-1]["digest"]
    hits = [by_id[k] for k in last if k in by_id and last[k] == newest]
    return max(hits, key=lambda c: c["on"]) if hits else None


def build(root: Path, as_of: str | None = None, curation_path: Path | None = None) -> dict:
    """``root``: a folder with data/digests/ (a checkout, or one daily version of the site build). ``curation_path``:
    default ``<root>/radar/curation.json``; a daily version uses the repo's file (its entries carry their own dates)."""
    digests = []
    for p in sorted((root / "data/digests").glob("*.json")):
        digests.append(json.loads(p.read_text(encoding="utf-8")))
    if not digests:
        raise SystemExit("build_radar: no digests in data/digests/")
    digests.sort(key=lambda d: d["id"])
    complete = True
    if as_of:
        complete = all(d["id"] <= as_of for d in digests)
        digests = [d for d in digests if d["id"] <= as_of]
    newest = digests[-1]
    as_of = newest["id"]
    today = day(as_of)

    cur_path = curation_path or root / "radar/curation.json"
    curation = json.loads(cur_path.read_text(encoding="utf-8")) if cur_path.exists() else {"merge": [], "close": []}
    alias = {i: m["keep"] for m in curation.get("merge", []) for i in m["ids"] if i != m["keep"]}
    closed = {c["id"]: c for c in curation.get("close", []) if day(c["on"]) <= today}
    rewrites = {r["id"]: r for r in curation.get("rewrite", []) if day(r["on"]) <= today}
    topics: dict[str, str] = {}
    for t in curation.get("topics", []):
        for i in t["ids"]:
            if topics.setdefault(i, t["topic"]) != t["topic"]:
                warn(f"curation topics: {i} is listed under {topics[i]!r} and {t['topic']!r} (the first one counts)")
    check_ids = {i for c in curation.get("checks", []) for i in c["ids"]}
    seen_ids: set[str] = set()

    # ---- action items
    stream = []
    for d in digests:
        for a in d.get("actionItems", []):
            text = strip_marker(a["action"])
            stream.append((d["id"], {**a, "action": text}, text))
    active, retired = [], []
    for stmts in merge_stream("ai-", "", stream, alias, topics, "actionItems", seen_ids):
        prov = provenance(stmts[0]["key"], stmts, as_of)
        a = stmts[-1]["entry"]
        rewritten = False
        r = curation_on_card(rewrites, stmts)
        if r and day(r["on"]) >= day(prov["lastSeen"]):  # a person's wording, newer than every restatement it replaces
            a = {**a, **{k: r[k] for k in ("action", "priority", "due") if k in r}}
            if r.get("due") is None and "due" in r:
                a.pop("due", None)
            rewritten = True
        item = {**prov, "priority": a["priority"], "action": a["action"]}
        if a.get("due"):
            item["due"] = a["due"]
        if a.get("relatedModelIds"):
            item["relatedModelIds"] = a["relatedModelIds"]
        if card_topic(stmts):
            item["topic"] = card_topic(stmts)

        def wording(x: dict) -> tuple:
            return norm(x["action"]), x["priority"], x.get("due")

        updates = history(
            stmts, lambda s: wording(s["entry"]),
            lambda s: {"date": s["digest"], "action": s["text"], "priority": s["entry"]["priority"],
                       **({"due": s["entry"]["due"]} if s["entry"].get("due") else {})},
            include_current=rewritten and wording(a) != wording(stmts[-1]["entry"]))
        if updates:
            item["updates"] = updates
        c = curation_on_card(closed, stmts)
        if c:
            out = {**item, "state": "due" if a.get("due") else "open", "reason": "closed", "retiredOn": c["on"], "note": c["reason"]}
        elif a.get("due") and day(a["due"]) < today:
            out = {**item, "state": "due", "reason": "expired", "retiredOn": a["due"]}
        elif not a.get("due") and (today - day(prov["lastSeen"])).days > CARRY_DAYS:
            out = {**item, "state": "open", "reason": "stale", "retiredOn": (day(prov["lastSeen"]) + timedelta(days=CARRY_DAYS + 1)).isoformat()}
        else:
            active.append({**item, "state": "due" if a.get("due") else "open"})
            continue
        if (today - day(out["retiredOn"])).days <= RETIRED_DAYS:
            retired.append(out)

    active.sort(key=lambda x: (PRIORITY_ORDER.get(x["priority"], 9), x.get("due") or "9999-99-99", [-ord(c) for c in x["firstSeen"]]))
    retired.sort(key=lambda x: x["retiredOn"], reverse=True)

    # ---- news sections (coverage notes are set aside first: they never become cards)
    out_sections: dict[str, list] = {}
    notes: list[dict] = []
    for sec in SECTIONS:
        stream = []
        for d in digests:
            for it in d.get(sec, []):
                title = strip_marker(it["title"])
                own = hid("it-", sec, norm(title))
                if it.get("check") is True or own in check_ids or alias.get(own, own) in check_ids:
                    seen_ids.update((own, alias.get(own, own)))
                    notes.append({"id": own, "date": d["id"], "section": sec, "title": title, "detail": it["detail"],
                                  "sources": it["sources"], "_pos": len(notes)})
                    continue
                stream.append((d["id"], {**it, "title": title}, title))
        items = []
        for stmts in merge_stream("it-", sec, stream, alias, topics, sec, seen_ids):
            prov = provenance(stmts[0]["key"], stmts, as_of)
            it = {k: v for k, v in stmts[-1]["entry"].items() if k not in INPUT_ONLY}
            sources, seen = [], set()
            for s in reversed(stmts):  # every source ever cited, the newest statement's first
                for ref in s["entry"]["sources"]:
                    if ref["id"] not in seen:
                        seen.add(ref["id"])
                        sources.append(ref)
            it["sources"] = sources
            recent = (today - day(prov["lastSeen"])).days <= NEWS_DAYS
            upcoming = sec == "lifecycleChanges" and it.get("date") and day(it["date"]) >= today
            if not (recent or upcoming):
                continue
            card = {**it, **prov}
            if card_topic(stmts):
                card["topic"] = card_topic(stmts)
            updates = history(stmts, lambda s: (norm(s["text"]), norm(s["entry"]["detail"])),
                              lambda s: {"date": s["digest"], "title": s["text"], "detail": s["entry"]["detail"]})
            if updates:
                card["updates"] = updates
            items.append(card)
        items.sort(key=lambda x: (not x["isNew"], [-ord(c) for c in x["lastSeen"]], IMPACT_ORDER.get(x["impact"], 9)))
        out_sections[sec] = items

    # ---- coverage notes: the last CHECK_DIGESTS digests, per section the newest digest that has notes
    recent_ids = {d["id"] for d in digests[-CHECK_DIGESTS:]}
    checks = []
    for sec in SECTIONS:
        mine = [n for n in notes if n["section"] == sec and n["date"] in recent_ids]
        if mine:
            top = max(n["date"] for n in mine)
            checks += [n for n in mine if n["date"] == top]
    checks.sort(key=lambda n: (SECTIONS.index(n["section"]), n["_pos"]))
    checks.sort(key=lambda n: n["date"], reverse=True)
    checks = [{k: v for k, v in n.items() if k != "_pos"} for n in checks]

    # ids of later digests are legitimately unknown with --as-of, and in a daily version (the repo's curation, an older release)
    if complete and cur_path.resolve().is_relative_to(root.resolve()):
        for kind, ids in (("topics", topics), ("checks", check_ids)):
            for i in sorted(set(ids) - seen_ids):
                warn(f"curation {kind}: {i} matches no digest entry")

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
        "checks": checks,
        "watchlist": watchlist,
        "unverified": unverified,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    ap.add_argument("--out", default=None, help="default: <root>/data/radar.json")
    ap.add_argument("--as-of", default=None, help="build the view as it was on this digest date")
    ap.add_argument("--curation", default=None, help="default: <root>/radar/curation.json")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    root = Path(args.root)
    out = Path(args.out) if args.out else root / "data/radar.json"
    radar = build(root, args.as_of, Path(args.curation) if args.curation else None)
    text = json.dumps(radar, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        same = out.exists() and out.read_text(encoding="utf-8") == text
        print(f"radar.json {'is current' if same else 'is out of date: run tools/build_radar.py'}")
        return 0 if same else 1
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    news = sum(len(radar[s]) for s in SECTIONS)
    print(f"built {out.relative_to(root) if out.is_relative_to(root) else out}: asOf {radar['asOf']}, "
          f"{len(radar['actionItems'])} active action items ({sum(a['isNew'] for a in radar['actionItems'])} new), "
          f"{len(radar['retired'])} retired, {news} news cards, {len(radar['checks'])} coverage notes, "
          f"{len(radar['coverage']['digests'])} digests merged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
