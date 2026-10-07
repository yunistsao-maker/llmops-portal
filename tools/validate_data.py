#!/usr/bin/env python3
"""Validate every JSON file under data/ (and runs/) against schema/llmops.schema.json.

Also runs cross-file checks the JSON Schema cannot express:
  * every SourceRef id exists in data/sources.json
  * model / offering / lifecycle-event ids are unique
  * each deep dive points at a model in the catalog
  * dates are real calendar dates

Usage:  python3 tools/validate_data.py [--root .]
Exit code 0 = all good, 1 = problems found.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from datetime import date

try:
    from jsonschema import Draft7Validator, FormatChecker
except ImportError:  # pragma: no cover
    sys.exit("pip install jsonschema")

FILE_TYPES = [
    ("data/sources.json", "SourcesFile"),
    ("data/catalog.json", "CatalogFile"),
    ("data/lifecycle.json", "LifecycleFile"),
    ("data/litellm.json", "LiteLLMFile"),
    ("data/requirements.json", "RequirementsFile"),
    ("data/digests/*.json", "DigestFile"),
    ("data/models/*.json", "DeepDive"),
    ("data/internal/platform-inventory*.json", "PlatformInventory"),
    ("runs/perf/*.json", "PerfRun"),
    ("runs/compat/*.json", "CompatRun"),
]


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def validator_for(schema, definition):
    sub = {"$schema": schema.get("$schema"), "definitions": schema["definitions"], "$ref": f"#/definitions/{definition}"}
    return Draft7Validator(sub, format_checker=FormatChecker())


def iter_source_refs(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "sources" and isinstance(v, list) and all(isinstance(x, dict) and "id" in x and set(x) <= {"id", "note"} for x in v):
                for x in v:
                    yield x["id"], f"{path}.{k}"
            else:
                yield from iter_source_refs(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from iter_source_refs(v, f"{path}[{i}]")


def iter_dates(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from iter_dates(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from iter_dates(v, f"{path}[{i}]")
    elif isinstance(node, str) and len(node) == 10 and node[4] == "-" and node[7] == "-" and node[:4].isdigit():
        yield node, path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.path.join(os.path.dirname(__file__), ".."))
    args = ap.parse_args()
    root = os.path.abspath(args.root)
    schema = load(os.path.join(root, "schema/llmops.schema.json"))
    problems: list[str] = []
    checked = 0
    docs: dict[str, object] = {}

    for pattern, definition in FILE_TYPES:
        v = validator_for(schema, definition)
        for path in sorted(glob.glob(os.path.join(root, pattern))):
            rel = os.path.relpath(path, root)
            try:
                doc = load(path)
            except json.JSONDecodeError as e:
                problems.append(f"{rel}: invalid JSON: {e}")
                continue
            docs[rel] = doc
            errs = sorted(v.iter_errors(doc), key=lambda e: list(e.absolute_path))
            for e in errs[:20]:
                loc = "/".join(str(p) for p in e.absolute_path) or "(root)"
                problems.append(f"{rel}: {loc}: {e.message[:200]}")
            if len(errs) > 20:
                problems.append(f"{rel}: … {len(errs) - 20} more schema errors")
            checked += 1

    # ---- cross-file checks
    source_ids = {s["id"] for s in docs.get("data/sources.json", {}).get("sources", [])}
    for rel, doc in docs.items():
        if rel == "data/sources.json" or rel.startswith("runs/"):
            continue
        for sid, where in iter_source_refs(doc):
            if sid not in source_ids:
                problems.append(f"{rel}: unknown source id '{sid}' at {where}")
        for d, where in iter_dates(doc):
            try:
                date.fromisoformat(d)
            except ValueError:
                problems.append(f"{rel}: invalid date '{d}' at {where}")

    catalog = docs.get("data/catalog.json")
    if catalog:
        mids = [m["id"] for m in catalog["models"]]
        oids = [o["id"] for m in catalog["models"] for o in m["offerings"]]
        for label, ids in (("model", mids), ("offering", oids)):
            dup = {i for i in ids if ids.count(i) > 1}
            if dup:
                problems.append(f"data/catalog.json: duplicate {label} ids: {sorted(dup)}")
        for rel, doc in docs.items():
            if rel.startswith("data/models/") and doc.get("modelId") not in mids:
                problems.append(f"{rel}: modelId '{doc.get('modelId')}' not in catalog")
    lifecycle = docs.get("data/lifecycle.json")
    if lifecycle:
        eids = [e["id"] for e in lifecycle["events"]]
        dup = {i for i in eids if eids.count(i) > 1}
        if dup:
            problems.append(f"data/lifecycle.json: duplicate event ids: {sorted(dup)}")

    if problems:
        print(f"✗ {len(problems)} problem(s) in {checked} file(s):")
        for p in problems:
            print("  -", p)
        sys.exit(1)
    print(f"✓ {checked} file(s) valid; {len(source_ids)} sources; cross-file checks passed")


if __name__ == "__main__":
    main()
