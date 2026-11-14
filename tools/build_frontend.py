#!/usr/bin/env python3
"""Assemble the static new-UI site into dist-frontend/ (what Amplify serves for the llm-ops-frontend branch).

  python3 tools/build_frontend.py

Copies frontend/{index.html, app.css, app.js, favicon.svg} and frontend/data/ui.json, and stamps app.css / app.js
with a content hash so browsers pick up new builds. No backend, no runtime fetches outside the site itself
(Google Fonts stylesheet is the only third-party request). Standard library only.
"""
import hashlib
import json
import os
import shutil

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "frontend")
OUT = os.path.join(ROOT, "dist-frontend")


def digest(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:10]


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, "data"))
    for name in ("app.css", "app.js", "favicon.svg"):
        shutil.copy2(os.path.join(SRC, name), os.path.join(OUT, name))
    ui_src = os.path.join(SRC, "data/ui.json")
    with open(ui_src, encoding="utf-8") as f:
        ui = json.load(f)
    if ui.get("schema") != "llmops-ui/v1":
        raise SystemExit("frontend/data/ui.json is not llmops-ui/v1")
    shutil.copy2(ui_src, os.path.join(OUT, "data/ui.json"))
    with open(os.path.join(SRC, "index.html"), encoding="utf-8") as f:
        html = f.read()
    html = html.replace('href="app.css"', f'href="app.css?v={digest(os.path.join(SRC, "app.css"))}"')
    html = html.replace('src="app.js"', f'src="app.js?v={digest(os.path.join(SRC, "app.js"))}"')
    with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)
    with open(os.path.join(OUT, "version.json"), "w", encoding="utf-8") as f:
        json.dump({"schema": ui["schema"], "asOf": ui["asOf"], "generatedAt": ui["generatedAt"], "digest": ui["inputs"]["digest"]}, f, ensure_ascii=False)
        f.write("\n")
    files = sum(len(fs) for _, _, fs in os.walk(OUT))
    print(f"built dist-frontend/: {files} files, data asOf {ui['asOf']}")


if __name__ == "__main__":
    main()
