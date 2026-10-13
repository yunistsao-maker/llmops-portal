#!/usr/bin/env python3
"""AI 安全測試套件（發布關卡 G6）— 對應 data/requirements.json 的 securityTestCatalog（SEC-01 … SEC-16）。

  python3 tools/sec_suite.py plan                      # 列出要下載什麼：大小、授權、內容風險
  python3 tools/sec_suite.py fetch --approve all       # 核准後才下載（或 --approve jbb-harmful,xstest,…）
  python3 tools/sec_suite.py ui                        # 本機 UI：選項目、抽樣、執行、看結果
  python3 tools/sec_suite.py run --bedrock global.anthropic.claude-sonnet-5-5,global.anthropic.claude-haiku-5-5 \
        --region us-east-1 --judge bedrock:global.anthropic.claude-opus-5-5 --n 10
  python3 tools/sec_suite.py run --mock                # 不呼叫任何模型，用內建模擬器驗證流程
  python3 tools/sec_suite.py report --out sec-report.html --redact   # 把最近一次結果輸出成單一 HTML
  python3 tools/sec_suite.py report --out site/security-tests.html --public   # 發布到 portal 的靜態頁

資料集與含 prompt／回應的完整結果都放在 .cache/secsuite/（已列入 .gitignore）。不要放進 runs/：
portal 的 build 會把 runs/ 原樣發布。要給 portal 用的是彙總與遮蔽版逐筆案例（publish <runId>）。
需要：先建立虛擬環境，再 pip install -r tools/secsuite/requirements.txt（httpx；Bedrock 另需 boto3）。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from secsuite import fetch, run as runner  # noqa: E402

RISK = {"none": "無", "low": "低", "medium": "中", "medium-high": "中高", "high": "高", "highest": "最高"}


def cmd_plan(args):
    rows = fetch.plan()
    total = sum(r["bytes"] for r in rows)
    print(f"{'項目':7} {'資料集':22} {'大小':>9}  {'風險':4} {'狀態':8} 授權")
    for r in rows:
        size = f"{r['bytes'] / 1024:.0f} KB" if r["download"] else "不下載"
        print(f"{r['item']:7} {r['id']:22} {size:>9}  {RISK[r['risk']]:4} {'已就緒' if r['ready'] else '未下載':8} {r['license']}")
        print(f"{'':7} └ {r['riskNote']}")
    print(f"\n合計約 {total / 1048576:.1f} MB。核准下載：python3 tools/sec_suite.py fetch --approve all")


def cmd_fetch(args):
    if not args.approve:
        cmd_plan(args)
        sys.exit("\n尚未核准任何下載。請先看上表，再用 --approve all 或 --approve <id,id,…>。")
    ids = list(fetch.DATASETS) if args.approve == "all" else [x.strip() for x in args.approve.split(",") if x.strip()]
    unknown = [i for i in ids if i not in fetch.DATASETS]
    if unknown:
        sys.exit(f"未知的資料集：{unknown}")
    for i in ids:
        print(f"[{i}]")
        r = fetch.fetch(i, approved=True)
        print(f"  完成：{r['rows']} 筆測試案例")


def _target(spec: str, args, label: str | None = None) -> dict:
    provider, _, model = spec.partition(":")
    t = {"label": label or model, "provider": provider, "model": model}
    if provider == "bedrock":
        t["region"] = args.region
    elif provider == "gateway":
        t["baseUrl"], t["apiKeyEnv"] = args.gateway, args.api_key_env or "LITELLM_API_KEY"
    elif provider == "anthropic":
        t["apiKeyEnv"] = args.api_key_env or "ANTHROPIC_API_KEY"
    if args.effort:
        t["effort"] = args.effort
    return t


def cmd_run(args):
    targets = []
    if args.mock:
        targets = [{"label": "模擬 A（較穩健）", "provider": "mock", "model": "mock-strong"},
                   {"label": "模擬 B（較脆弱）", "provider": "mock", "model": "mock-weak"}]
    for m in (args.bedrock or "").split(","):
        if m.strip():
            targets.append(_target("bedrock:" + m.strip(), args))
    for m in (args.routes or "").split(","):
        if m.strip():
            if not args.gateway:
                sys.exit("--routes 需要搭配 --gateway <base URL，含 /v1>")
            targets.append(_target("gateway:" + m.strip(), args))
    for m in (args.anthropic or "").split(","):
        if m.strip():
            targets.append(_target("anthropic:" + m.strip(), args))
    if not targets:
        sys.exit("請指定受測模型：--bedrock / --gateway + --routes / --anthropic，或 --mock")
    for pair in (args.model_ids or "").split(","):
        key, _, mid = pair.partition("=")
        if not pair.strip():
            continue
        hit = [t for t in targets if key.strip() in (t["label"], t["model"])]
        if not mid.strip() or not hit:
            sys.exit(f"--model-ids 的 {pair!r} 對不到任何受測模型（要寫 <label 或 model>=<catalog id>）")
        for t in hit:
            t["modelId"] = mid.strip()
    judge = None
    if args.judge:
        judge = _target(args.judge, args, "judge")
    elif args.mock:
        judge = {"label": "模擬 judge", "provider": "mock", "model": "mock-judge"}
    items = [i["id"] for i in runner.CATALOG["items"]] if args.items == "all" else [x.strip() for x in args.items.split(",")]
    missing = [d["id"] for d in fetch.plan() if d["download"] and not d["ready"] and d["item"] in items]
    if missing:
        print(f"注意：尚未下載 {missing}，相關項目會沒有樣本（先執行 fetch --approve …）。", file=sys.stderr)
    cfg = {"targets": targets, "judge": judge, "items": items, "n": args.n, "seed": args.seed, "trials": args.trials,
           "concurrency": args.concurrency, "maxTokens": args.max_tokens, "incumbent": args.incumbent, "litellmVersion": args.litellm_version,
           "purpose": args.purpose}
    doc = runner.run(cfg)
    print(f"run {doc['runId']}{'（模擬資料）' if doc['simulated'] else ''}")
    for it in doc["items"]:
        cells = "  ".join(f"{lab}: {s['fail']}/{s['scored']}{' +' + str(s['review']) + ' 待判定' if s['review'] else ''} [{s['verdict']}]"
                          for lab, s in it["results"].items())
        print(f"  {it['id']}  {cells}")
    print(f"完整結果：{runner.RESULTS / (doc['runId'] + '.json')}")
    if args.publish_summary:
        out = fetch.ROOT / "runs" / "security" / f"{doc['runId']}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(runner.summary_only(doc), ensure_ascii=False, indent=1) + "\n")
        print(f"彙總（不含 prompt 與回應文字）：{out}；要連逐筆案例（遮蔽版）一起發布：sec_suite.py publish {doc['runId']}")
    if args.fail_on_blocker:
        tiers = {i["id"]: i["tier"] for i in runner.CATALOG["items"]}
        bad = [it["id"] for it in doc["items"] if tiers[it["id"]] == "A" and any(s["verdict"] == "fail" for s in it["results"].values())]
        if bad:
            sys.exit(f"A 級項目未通過：{bad}")


def build_report(doc: dict, redact: bool, public: bool = False) -> str:
    if redact or public:
        doc = runner.redact(doc, public=public)
    embed = {"catalog": runner.CATALOG, "plan": fetch.plan(), "results": doc, "presets": {}, "runs": []}
    blob = json.dumps(embed, ensure_ascii=False).replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    html = (Path(__file__).resolve().parent / "secsuite" / "ui.html").read_text(encoding="utf-8")
    return html.replace("/*__EMBED__*/", "window.__EMBED__ = " + blob + ";", 1)


def cmd_report(args):
    doc = runner.load_run(args.run)
    if not doc:
        sys.exit("找不到測試結果，請先執行 run。")
    Path(args.out).write_text(build_report(doc, args.redact, args.public), encoding="utf-8")
    note = ("（公開版：高風險、中風險與授權不允許再散布的樣本內容已遮蔽）" if args.public else
            "（高風險樣本的內容已遮蔽）" if args.redact else "（含全部樣本內容，請勿對外分享或放進 runs/）")
    print(f"已輸出 {args.out}" + note)


def cmd_publish(args):
    """Write what the portal shows for a finished run: runs/security/<id>.json (aggregates) and <id>.cases.json (cases with
    the text of every sensitive dataset removed). The full run - every prompt and response - stays in .cache/secsuite/."""
    doc = runner.load_run(args.run)
    if not doc:
        sys.exit(f"找不到測試結果 {args.run}（.cache/secsuite/results/）")
    if args.purpose:
        doc["purpose"] = args.purpose
    # re-aggregate with this version of the tool: a run made before the portal fields existed (item definitions, input
    # tokens) gets them too; the verdict rules are the same
    items = (doc.get("config") or {}).get("items") or [it["id"] for it in doc["items"]]
    doc["items"] = runner.aggregate(doc["cases"], {**(doc.get("config") or {}), "items": items, "targets": doc["targets"]})
    for pair in (args.model_ids or "").split(","):
        key, _, mid = pair.partition("=")
        if not pair.strip():
            continue
        hit = [t for t in doc["targets"] if key.strip() in (t.get("label"), t.get("model"))]
        if not mid.strip() or not hit:
            sys.exit(f"--model-ids 的 {pair!r} 對不到這次測試的任何受測模型（要寫 <label 或 model>=<catalog id>）")
        for t in hit:
            t["modelId"] = mid.strip()
    out = fetch.ROOT / "runs" / "security"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{doc['runId']}.json").write_text(json.dumps(runner.summary_only(doc), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    written = [f"runs/security/{doc['runId']}.json"]
    if not args.summary_only:
        cases = runner.public_cases(doc)
        (out / f"{doc['runId']}.cases.json").write_text(json.dumps(cases, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        hidden = sum(c["redacted"] for c in cases["cases"])
        written.append(f"runs/security/{doc['runId']}.cases.json（{len(cases['cases'])} 筆，其中 {hidden} 筆敏感資料集只留判定、不含文字）")
    print("已寫出：\n  " + "\n  ".join(written))
    print("完整版 portal 會顯示逐筆案例（遮蔽版），乾淨版只顯示統計與總表。")


def cmd_ui(args):
    from secsuite import server
    server.serve(args.port)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("plan", help="列出資料集的大小、授權與風險").set_defaults(fn=cmd_plan)
    pb = sub.add_parser("publish", help="把一次已完成的測試寫成 portal 用的檔案（runs/security/：彙總＋遮蔽版逐筆案例）")
    pb.add_argument("run", nargs="?", default="latest", help="run id（.cache/secsuite/results/ 底下的檔名），預設最近一次")
    pb.add_argument("--purpose", choices=["pre-release", "regression", "adhoc"], help="測試目的：pre-release＝上線前（模型頁置頂）")
    pb.add_argument("--model-ids", help="受測模型對應的 catalog 模型 id：<label 或 model>=<id>，逗號分隔（沒給時由名稱比對）")
    pb.add_argument("--summary-only", action="store_true", help="只寫彙總，不寫逐筆案例")
    pb.set_defaults(fn=cmd_publish)
    f = sub.add_parser("fetch", help="核准後下載資料集")
    f.add_argument("--approve", help="all，或以逗號分隔的資料集 id")
    f.set_defaults(fn=cmd_fetch)
    r = sub.add_parser("run", help="執行測試")
    r.add_argument("--bedrock", help="Bedrock model ID／inference profile，逗號分隔")
    r.add_argument("--region", default="us-east-1")
    r.add_argument("--gateway", help="LiteLLM／OpenAI 相容 gateway 的 base URL（含 /v1）")
    r.add_argument("--routes", help="gateway 路由名稱，逗號分隔")
    r.add_argument("--anthropic", help="Anthropic API model ID，逗號分隔")
    r.add_argument("--api-key-env", help="存放金鑰的環境變數名稱")
    r.add_argument("--mock", action="store_true", help="用內建模擬器，不呼叫任何模型")
    r.add_argument("--judge", help="judge 模型，格式 provider:model（如 bedrock:global.anthropic.claude-opus-5-5）")
    r.add_argument("--incumbent", help="現役模型的名稱（需同時列在受測模型中），作為比較基準")
    r.add_argument("--items", default="all", help="all 或 SEC-01,SEC-03,…")
    r.add_argument("--n", type=int, default=10, help="每項樣本數")
    r.add_argument("--seed", type=int, default=7)
    r.add_argument("--trials", type=int, default=1, help="每筆重複次數（模型無法設 temperature 0，重複可看穩定度）")
    r.add_argument("--concurrency", type=int, default=4)
    r.add_argument("--max-tokens", type=int, default=2048)
    r.add_argument("--effort", help="low / medium / high；兩個模型預設不同，要比較請明確指定")
    r.add_argument("--litellm-version", help="gateway 的 LiteLLM 版本，供 SEC-16 檢查")
    r.add_argument("--publish-summary", action="store_true", help="另存不含文字的彙總到 runs/security/")
    r.add_argument("--purpose", choices=["pre-release", "regression", "adhoc"], help="測試目的：pre-release＝上線前的發布關卡證據（模型頁的內部測試優先顯示）")
    r.add_argument("--model-ids", help="受測模型對應的 catalog 模型 id：<label 或 model>=<id>，逗號分隔（沒給時由名稱比對）")
    r.add_argument("--fail-on-blocker", action="store_true", help="A 級項目未通過時以非零狀態結束（CI 用）")
    r.set_defaults(fn=cmd_run)
    p = sub.add_parser("report", help="把結果輸出成單一 HTML")
    p.add_argument("--run", default="latest")
    p.add_argument("--out", default="sec-report.html")
    p.add_argument("--redact", action="store_true", help="遮蔽高風險資料集的樣本內容")
    p.add_argument("--public", action="store_true", help="公開頁面用：另外遮蔽中風險與授權不允許再散布的資料集樣本")
    p.set_defaults(fn=cmd_report)
    u = sub.add_parser("ui", help="啟動本機 UI")
    u.add_argument("--port", type=int, default=8765)
    u.set_defaults(fn=cmd_ui)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
