#!/usr/bin/env python3
"""Gateway → CSP API compatibility check: does each API feature survive the trip through the LiteLLM gateway to
Bedrock / Foundry / Agent Platform - and when it does not, is it the gateway or the provider?

For every route (a gateway alias such as "claude-sonnet-5-5@bedrock") the same cases are sent

  1. through the gateway (what the teams' applications do), and
  2. optionally straight to the CSP endpoint behind that route (the baseline, `direct:` in the routes file),

and every result is attributed: ok / gateway (fails only through the gateway: LiteLLM translation, drop_params,
proxy config) / provider (fails on the CSP itself) / unknown (no baseline). The run is a CompatRun
(schema/llmops.schema.json, kind "gateway-csp") in runs/compat/; each model page's 內部測試 tab shows it for that model's
routes (give every route its modelId), and 方法與來源 → 測試方法 explains the cases and the attribution.

Metrics (definitions in data/requirements.json → metricDefinitions, page 方法與來源):
  compatibilityRate      passed / (passed + failed + errors) of the cases that apply to the route (skips excluded)
  requiredPassRate       the same for the required cases (gate G3 wants 100%)
  gatewayInduced         cases that fail through the gateway but pass on the CSP directly
  providerLimited        cases that fail both ways (a limit of the CSP / the model)
  silentDegradationRate  HTTP 200 answers that broke the contract (forced tool_choice became auto, no JSON, no usage)
  errorMappingRate       provoked bad requests answered 4xx with an OpenAI-style error (not 5xx, not 200)
  costTrackingRate       gateway answers carrying x-litellm-response-cost > 0
  fallbackRate           gateway answers with x-litellm-attempted-fallbacks > 0
  overheadMs             gateway latency minus direct latency for the same request (p50 / p95; --samples per side)
  ttftOverheadMs         the same for the first streamed token
  promptTokenDeltaPct    |gateway prompt_tokens - direct prompt_tokens| / direct (cost accounting drift)

Example (routes file: tools/fixtures/gateway-routes.example.yaml):
  export LITELLM_API_KEY=sk-...   AWS_BEARER_TOKEN_BEDROCK=...   AZURE_API_KEY=...   GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token)
  python3 tools/gateway_csp_check.py --gateway https://llm-gateway.example.internal/v1 \\
      --routes-file gateway-routes.yaml --direct --litellm-version v1.104.2 --purpose regression \\
      --out runs/compat/$(date +%F)-gateway-csp.json --fail-on-required

Without --direct only the gateway side runs (attribution "unknown", no overhead). Every case costs model calls:
about (cases + 2 x samples) per route per side.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compat_suite import CASES as BASE_CASES  # noqa: E402  (the same cases as the route suite)
from compat_suite import WEATHER_TOOL, Case, _msg, _tool_calls, ok_if  # noqa: E402

try:
    import httpx
except ImportError:  # pragma: no cover
    sys.exit("pip install httpx")

SURFACES = [
    ("chat", "Chat Completions 基本"), ("streaming", "串流（SSE）"), ("parameters", "參數處理"), ("reasoning", "推理參數"),
    ("tools", "Tool calling"), ("structured-output", "Structured output"), ("vision", "影像輸入"), ("prompt-caching", "Prompt caching"),
    ("responses-api", "Responses API"), ("messages-api", "Anthropic Messages"), ("error-mapping", "錯誤對應"), ("observability", "成本與路由可觀測性"),
]
SURFACE_OF = {
    "chat.basic": "chat", "chat.system": "chat", "chat.stream": "streaming", "chat.stream_usage": "streaming", "stream.finish": "streaming",
    "params.max_tokens": "parameters", "params.max_completion_tokens": "parameters", "params.temperature": "parameters",
    "params.reasoning_effort": "reasoning", "tools.auto": "tools", "tools.forced": "tools", "stream.tools": "tools",
    "structured.json_schema": "structured-output", "vision.image": "vision", "usage.cache": "prompt-caching",
    "responses.basic": "responses-api", "responses.tools": "responses-api", "messages.basic": "messages-api",
    "meta.response_model": "observability", "gw.cost_header": "observability", "gw.no_fallback": "observability",
    "err.invalid_max_tokens": "error-mapping", "err.unknown_tool": "error-mapping", "err.bad_image": "error-mapping",
}
BAD_PNG = "data:image/png;base64,!!this-is-not-base64!!"


def _check_finish(resp: dict) -> tuple[str, str]:
    if not resp.get("_finish"):
        return "fail", "串流沒有 finish_reason（client 無法判斷是否完整）"
    if not resp.get("_done"):
        return "fail", f"finish_reason={resp['_finish']}，但沒有 data: [DONE]"
    return "pass", f"finish_reason={resp['_finish']} · [DONE]"


def _check_stream_tools(resp: dict) -> tuple[str, str]:
    calls = resp.get("_tool_calls") or []
    if not calls:
        return "fail", "串流裡沒有 tool_call delta"
    try:
        args = json.loads(calls[0].get("arguments") or "")
    except json.JSONDecodeError:
        return "fail", f"tool_call arguments 組回來不是 JSON：{calls[0].get('arguments', '')[:80]!r}"
    return ok_if(isinstance(args, dict) and "city" in args, f"{calls[0].get('name')}({json.dumps(args, ensure_ascii=False)})", "arguments 少了 city")


def _check_cost(resp: dict) -> tuple[str, str]:
    raw = (resp.get("_headers") or {}).get("x-litellm-response-cost")
    try:
        cost = float(raw) if raw is not None else None
    except ValueError:
        cost = None
    return ok_if(bool(cost and cost > 0), f"x-litellm-response-cost={raw}", "沒有 x-litellm-response-cost（cost map 缺這個模型或價格為 0，成本追蹤失準）")


def _check_fallback(resp: dict) -> tuple[str, str]:
    raw = (resp.get("_headers") or {}).get("x-litellm-attempted-fallbacks")
    model = resp.get("model")
    if raw not in (None, "", "0"):
        return "fail", f"x-litellm-attempted-fallbacks={raw}，回應的 model={model}：這次其實是 fallback 回答的"
    return "pass", f"沒有 fallback · model={model}"


GATEWAY_CASES: list[Case] = [
    Case("stream.finish", "串流結尾（finish_reason 與 [DONE]）", True, "chat-stream",
         lambda r: {"model": r, "messages": _msg("Count from 1 to 3."), "max_tokens": 256, "stream": True}, _check_finish),
    Case("stream.tools", "串流 tool call（delta 組回完整 JSON）", False, "chat-stream",
         lambda r: {"model": r, "messages": _msg("What's the weather in Taipei right now? Use the tool."), "tools": [WEATHER_TOOL],
                    "max_tokens": 1024, "stream": True}, _check_stream_tools),
    Case("gw.cost_header", "成本追蹤（x-litellm-response-cost）", False, "chat",
         lambda r: {"model": r, "messages": _msg("Say hi."), "max_tokens": 64}, _check_cost),
    Case("gw.no_fallback", "沒有偷偷 fallback（x-litellm-attempted-fallbacks）", False, "chat",
         lambda r: {"model": r, "messages": _msg("Say hi."), "max_tokens": 64}, _check_fallback),
    Case("err.invalid_max_tokens", "錯誤對應：max_tokens = -1 應回 4xx", False, "chat",
         lambda r: {"model": r, "messages": _msg("Say hi."), "max_tokens": -1}, lambda resp: ("fail", "HTTP 200：無效的請求被接受了")),
    Case("err.unknown_tool", "錯誤對應：指定不存在的工具應回 4xx", False, "chat",
         lambda r: {"model": r, "messages": _msg("Hello"), "tools": [WEATHER_TOOL], "max_tokens": 256,
                    "tool_choice": {"type": "function", "function": {"name": "does_not_exist"}}},
         lambda resp: ("fail", "HTTP 200：不存在的工具被接受了（可能被 gateway 改成 auto）")),
    Case("err.bad_image", "錯誤對應：壞掉的影像應回 4xx", False, "chat",
         lambda r: {"model": r, "max_tokens": 128, "messages": [{"role": "user", "content": [
             {"type": "text", "text": "Describe."}, {"type": "image_url", "image_url": {"url": BAD_PNG}}]}]},
         lambda resp: ("fail", "HTTP 200：壞掉的影像被接受了")),
]
ALL_CASES: list[Case] = list(BASE_CASES) + GATEWAY_CASES
EXPECT_ERROR = {c.id for c in GATEWAY_CASES if c.id.startswith("err.")}
GATEWAY_ONLY = {"gw.cost_header", "gw.no_fallback", "meta.response_model"}
LATENCY_CASES = ("chat.basic", "chat.stream")  # sampled --samples times per side for the overhead metrics


# ---------------------------------------------------------------------------------------------- calling
def _sse(r: httpx.Response, anthropic: bool, t0: float) -> dict:
    """Read an SSE stream into one dict: chunks, text, usage, finish, tool calls, time (from the request) to the first content."""
    chunks, text, usage, finish, done, ttft = 0, [], {}, None, False, None
    calls: dict[int, dict] = {}
    for line in r.iter_lines():
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            done = True
            continue
        try:
            c = json.loads(data)
        except json.JSONDecodeError:
            continue
        if anthropic:
            kind = c.get("type")
            if kind == "content_block_start" and (c.get("content_block") or {}).get("type") == "tool_use":
                calls[c.get("index", 0)] = {"name": c["content_block"].get("name"), "arguments": ""}
            elif kind == "content_block_delta":
                d = c.get("delta") or {}
                if d.get("type") == "text_delta" and d.get("text"):
                    chunks += 1
                    text.append(d["text"])
                    ttft = ttft if ttft is not None else (time.perf_counter() - t0) * 1000
                elif d.get("type") == "input_json_delta":
                    calls.setdefault(c.get("index", 0), {"name": None, "arguments": ""})["arguments"] += d.get("partial_json", "")
                    ttft = ttft if ttft is not None else (time.perf_counter() - t0) * 1000
            elif kind == "message_start":
                u = (c.get("message") or {}).get("usage") or {}
                usage["prompt_tokens"] = u.get("input_tokens")
            elif kind == "message_delta":
                finish = (c.get("delta") or {}).get("stop_reason") or finish
                usage["completion_tokens"] = (c.get("usage") or {}).get("output_tokens")
            elif kind == "message_stop":
                done = True
            continue
        if c.get("usage"):
            usage = c["usage"]
        for ch in c.get("choices") or []:
            d = ch.get("delta") or {}
            if d.get("content"):
                chunks += 1
                text.append(d["content"])
                ttft = ttft if ttft is not None else (time.perf_counter() - t0) * 1000
            for tc in d.get("tool_calls") or []:
                slot = calls.setdefault(tc.get("index", 0), {"name": None, "arguments": ""})
                fn = tc.get("function") or {}
                slot["name"] = fn.get("name") or slot["name"]
                slot["arguments"] += fn.get("arguments") or ""
                ttft = ttft if ttft is not None else (time.perf_counter() - t0) * 1000
            finish = ch.get("finish_reason") or finish
    return {"_chunks": chunks, "_text": "".join(text), "_usage": usage, "_finish": finish, "_done": done,
            "_tool_calls": [calls[k] for k in sorted(calls)], "_ttft": ttft}


def _post(client: httpx.Client, url: str, headers: dict, payload: dict, stream: bool, timeout: float, anthropic: bool = False) -> dict:
    t0 = time.perf_counter()
    if stream:
        with client.stream("POST", url, headers=headers, json=payload, timeout=timeout) as r:
            h = {k.lower(): v for k, v in r.headers.items()}
            if r.status_code != 200:
                return {"_status": r.status_code, "_error": r.read().decode("utf-8", "replace")[:400], "_ms": (time.perf_counter() - t0) * 1000, "_headers": h}
            out = _sse(r, anthropic, t0)
        out.update({"_status": 200, "_ms": (time.perf_counter() - t0) * 1000, "_headers": h})
        return out
    r = client.post(url, headers=headers, json=payload, timeout=timeout)
    ms = (time.perf_counter() - t0) * 1000
    h = {k.lower(): v for k, v in r.headers.items()}
    try:
        body = r.json()
    except ValueError:
        body = {"_raw": r.text[:400]}
    if r.status_code != 200:
        return {"_status": r.status_code, "_error": json.dumps(body, ensure_ascii=False)[:400], "_body": body, "_ms": ms, "_headers": h}
    if not isinstance(body, dict):
        body = {"_raw": body}
    body.update({"_status": 200, "_ms": ms, "_headers": h})
    return body


def gateway_call(client, base, key, case: Case, route, timeout) -> dict:
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if case.endpoint == "messages":
        headers.update({"x-api-key": key, "anthropic-version": "2023-06-01"})
    path = {"chat": "/chat/completions", "chat-stream": "/chat/completions", "responses": "/responses", "messages": "/messages"}[case.endpoint]
    return _post(client, base + path, headers, case.build(route), case.endpoint == "chat-stream", timeout)


# --- the baseline: the same request, straight to the CSP --------------------------------------------------------------
def _auth_headers(direct: dict) -> dict:
    auth = direct.get("auth") or {}
    value = os.environ.get(auth.get("env", ""), "") if auth.get("env") else ""
    kind = auth.get("type", "bearer")
    if kind == "bearer":
        return {"Authorization": f"Bearer {value}"}
    if kind == "header":
        return {auth.get("name", "api-key"): value}
    return {}


def to_anthropic(payload: dict, extra: dict) -> dict | None:
    """A Chat Completions request as an Anthropic Messages request (None: no native equivalent - the case is skipped)."""
    if payload.get("response_format") or "reasoning_effort" in payload:
        return None
    out: dict = {k: v for k, v in (extra or {}).items()}
    system = [m["content"] for m in payload.get("messages", []) if m.get("role") == "system" and isinstance(m.get("content"), str)]
    if system:
        text = "\n".join(system)
        # a long prefix is marked for caching: the native API caches only what is marked (LiteLLM adds the marker too)
        out["system"] = [{"type": "text", "text": text, **({"cache_control": {"type": "ephemeral"}} if len(text) > 4000 else {})}]
    msgs = []
    for m in payload.get("messages", []):
        if m.get("role") == "system":
            continue
        c = m.get("content")
        if isinstance(c, list):
            blocks = []
            for p in c:
                if p.get("type") == "text":
                    blocks.append({"type": "text", "text": p.get("text", "")})
                elif p.get("type") == "image_url":
                    url = (p.get("image_url") or {}).get("url", "")
                    media, _, data = url.partition(";base64,")
                    blocks.append({"type": "image", "source": {"type": "base64", "media_type": media.replace("data:", "") or "image/png", "data": data}})
            c = blocks
        msgs.append({"role": m.get("role", "user"), "content": c})
    out["messages"] = msgs
    out["max_tokens"] = payload.get("max_tokens", payload.get("max_completion_tokens", 1024))
    if "temperature" in payload:
        out["temperature"] = payload["temperature"]
    if payload.get("tools"):
        out["tools"] = [{"name": t["function"]["name"], "description": t["function"].get("description", ""), "input_schema": t["function"]["parameters"]}
                        for t in payload["tools"] if t.get("type") == "function"]
        tc = payload.get("tool_choice")
        if isinstance(tc, dict):
            out["tool_choice"] = {"type": "tool", "name": (tc.get("function") or {}).get("name")}
        elif tc == "required":
            out["tool_choice"] = {"type": "any"}
        elif tc == "none":
            out["tool_choice"] = {"type": "none"}
    if payload.get("stream"):
        out["stream"] = True
    return out


def from_anthropic(body: dict) -> dict:
    """An Anthropic Messages answer in the Chat Completions shape the checks read."""
    text = "".join(b.get("text", "") for b in body.get("content", []) if b.get("type") == "text")
    calls = [{"id": b.get("id"), "type": "function", "function": {"name": b.get("name"), "arguments": json.dumps(b.get("input", {}))}}
             for b in body.get("content", []) if b.get("type") == "tool_use"]
    u = body.get("usage") or {}
    cached = u.get("cache_read_input_tokens") or 0
    out = dict(body)
    out["choices"] = [{"index": 0, "message": {"role": "assistant", "content": text or None, **({"tool_calls": calls} if calls else {})},
                       "finish_reason": body.get("stop_reason")}]
    out["usage"] = {"prompt_tokens": (u.get("input_tokens") or 0) + cached + (u.get("cache_creation_input_tokens") or 0),
                    "completion_tokens": u.get("output_tokens"), "prompt_tokens_details": {"cached_tokens": cached}}
    return out


def direct_call(client, direct: dict, case: Case, route: str, timeout: float) -> dict | None:
    """The case against the CSP itself; None when the baseline has no equivalent (the result is 'skip')."""
    protocol = direct.get("protocol")
    headers = {"Content-Type": "application/json", **_auth_headers(direct), **(direct.get("headers") or {})}
    payload = case.build(route)
    stream = case.endpoint == "chat-stream"
    if stream and direct.get("stream") is False:
        return None
    if protocol == "openai-chat":
        if case.endpoint not in ("chat", "chat-stream"):
            return None
        payload = {**payload, **(direct.get("body") or {})}
        if direct.get("model"):
            payload["model"] = direct["model"]
        return _post(client, direct["url"], headers, payload, stream, timeout)
    if protocol == "anthropic-messages":
        headers.setdefault("anthropic-version", "2023-06-01")
        if case.endpoint == "messages":
            body = {**payload, **(direct.get("body") or {})}
        elif case.endpoint in ("chat", "chat-stream"):
            body = to_anthropic(payload, direct.get("body") or {})
            if body is None:
                return None
        else:
            return None
        if direct.get("model"):
            body["model"] = direct["model"]
        else:
            body.pop("model", None)  # Bedrock invoke / Vertex rawPredict: the model is in the URL
        url = direct.get("streamUrl") if stream and direct.get("streamUrl") else direct["url"]
        resp = _post(client, url, headers, body, stream, timeout, anthropic=True)
        if not stream and resp.get("_status") == 200 and case.endpoint != "messages":
            keep = {k: v for k, v in resp.items() if k.startswith("_")}
            resp = {**from_anthropic(resp), **keep}
        return resp
    raise SystemExit(f"route {route}: direct.protocol must be openai-chat or anthropic-messages, not {protocol!r}")


def judge(case: Case, resp: dict) -> tuple[str, str]:
    """(status, detail) of one response, the same way on both sides."""
    status = resp.get("_status")
    if case.id in EXPECT_ERROR:
        if status is not None and 400 <= status < 500:
            body = resp.get("_body") or {}
            shaped = isinstance(body, dict) and isinstance(body.get("error"), (dict, str))
            return "pass", f"HTTP {status}" + ("" if shaped else "（4xx，但 body 不是有 error 欄位的 JSON）")
        if status == 200:
            return case.check(resp)
        return "fail", f"HTTP {status}：應該是 4xx（client 會把它當成可重試的伺服器錯誤）"
    if status != 200:
        return "fail", resp.get("_error", f"HTTP {status}")
    return case.check(resp)


# ---------------------------------------------------------------------------------------------- metrics
def pct(values: list[float], q: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    k = (len(s) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return round(s[lo] + (s[hi] - s[lo]) * (k - lo), 1)


def route_metrics(route: str, results: list[dict], required: set[str], samples: dict) -> dict:
    rs = [r for r in results if r["route"] == route]
    applicable = [r for r in rs if r["status"] != "skip"]
    passed = sum(r["status"] == "pass" for r in applicable)
    req = [r for r in applicable if r["caseId"] in required]
    ok200 = [r for r in rs if r.get("httpStatus") == 200 and r["caseId"] not in EXPECT_ERROR]
    errs = [r for r in rs if r["caseId"] in EXPECT_ERROR and r["status"] != "skip"]
    cost = [r for r in rs if r["caseId"] == "gw.cost_header" and r["status"] != "skip"]
    fb = [r for r in rs if r["caseId"] == "gw.no_fallback" and r["status"] != "skip"]
    s = samples.get(route, {})
    over = [g - d for g, d in zip(s.get("gw", []), s.get("direct", []))]
    tover = [g - d for g, d in zip(s.get("gwTtft", []), s.get("directTtft", []))]
    gp, dp = s.get("gwPrompt"), s.get("directPrompt")

    def rate(n, d):
        return round(n / d, 4) if d else None
    return {
        "route": route,
        "applicable": len(applicable),
        "pass": passed,
        "compatibilityRate": rate(passed, len(applicable)),
        "requiredPassRate": rate(sum(r["status"] == "pass" for r in req), len(req)),
        "gatewayInduced": sum(r.get("attribution") == "gateway" for r in rs),
        "providerLimited": sum(r.get("attribution") == "provider" for r in rs),
        "unattributed": sum(r.get("attribution") == "unknown" for r in rs),
        "silentDegradations": sum(r["status"] == "fail" for r in ok200),
        "silentDegradationRate": rate(sum(r["status"] == "fail" for r in ok200), len(ok200)),
        "errorMappingRate": rate(sum(r["status"] == "pass" for r in errs), len(errs)),
        "costTrackingRate": rate(sum(r["status"] == "pass" for r in cost), len(cost)),
        "fallbackRate": rate(sum(r["status"] == "fail" for r in fb), len(fb)),
        "overheadMs": {"p50": pct(over, 0.5), "p95": pct(over, 0.95), "n": len(over)},
        "ttftOverheadMs": {"p50": pct(tover, 0.5), "p95": pct(tover, 0.95), "n": len(tover)},
        "promptTokenDeltaPct": round(abs(gp - dp) / dp * 100, 2) if gp is not None and dp else None,
    }


def group_metrics(key: str, value: str, per_route: list[dict]) -> dict:
    rows = [m for m in per_route if m.get(key) == value]

    def total(f):
        return sum(m[f] or 0 for m in rows)

    def avg(f):
        vals = [m[f] for m in rows if m[f] is not None]
        return round(statistics.mean(vals), 4) if vals else None
    over = [m["overheadMs"]["p50"] for m in rows if m["overheadMs"]["p50"] is not None]
    return {key: value, "routes": len(rows), "applicable": total("applicable"), "pass": total("pass"),
            "compatibilityRate": round(total("pass") / total("applicable"), 4) if total("applicable") else None,
            "requiredPassRate": avg("requiredPassRate"), "gatewayInduced": total("gatewayInduced"), "providerLimited": total("providerLimited"),
            "silentDegradations": total("silentDegradations"), "errorMappingRate": avg("errorMappingRate"),
            "costTrackingRate": avg("costTrackingRate"), "fallbackRate": avg("fallbackRate"),
            "overheadMsP50": round(statistics.median(over), 1) if over else None}


# ---------------------------------------------------------------------------------------------- routes
def infer_csp(provider_model: str) -> tuple[str, str]:
    """(csp, service) from a LiteLLM model string: bedrock/... -> aws/bedrock, azure_ai/... -> azure/foundry ..."""
    prefix = (provider_model or "").split("/", 1)[0]
    return {
        "bedrock": ("aws", "bedrock"), "sagemaker": ("aws", "sagemaker"),
        "azure": ("azure", "foundry"), "azure_ai": ("azure", "foundry"),
        "vertex_ai": ("gcp", "agent-platform"), "vertex_ai_beta": ("gcp", "agent-platform"), "gemini": ("vendor-direct", "gemini-api"),
        "anthropic": ("vendor-direct", "anthropic-api"), "openai": ("vendor-direct", "openai-api"), "xai": ("vendor-direct", "xai-api"),
    }.get(prefix, ("unknown", prefix or "unknown"))


def load_routes(args, client, base, key) -> list[dict]:
    routes: list[dict] = []
    if args.routes_file:
        with open(args.routes_file, encoding="utf-8") as f:
            text = f.read()
        if args.routes_file.endswith((".yaml", ".yml")):
            import yaml  # pip install pyyaml
            doc = yaml.safe_load(text)
        else:
            doc = json.loads(text)
        routes = [dict(r) for r in doc.get("routes", [])]
    for r in (args.routes or "").split(","):
        if r.strip() and not any(x["route"] == r.strip() for x in routes):
            routes.append({"route": r.strip()})
    if not routes:
        raise SystemExit("no routes: give --routes-file and/or --routes")
    if any("litellmModel" not in r for r in routes):  # fill in what the gateway itself says (GET /model/info)
        try:
            info = client.get(base.rsplit("/v1", 1)[0] + "/model/info", headers={"Authorization": f"Bearer {key}"}, timeout=30).json()
            by = {d.get("model_name"): d for d in info.get("data", [])}
        except (httpx.HTTPError, ValueError):
            by = {}
        for r in routes:
            d = by.get(r["route"])
            if d and "litellmModel" not in r:
                r["litellmModel"] = (d.get("litellm_params") or {}).get("model")
                r.setdefault("region", (d.get("litellm_params") or {}).get("aws_region_name") or (d.get("litellm_params") or {}).get("vertex_location"))
    for r in routes:
        d = r.get("direct")
        if isinstance(d, dict):  # ${VAR} in an address: the resource / project names stay out of the routes file
            for k in ("url", "streamUrl"):
                if d.get(k):
                    d[k] = os.path.expandvars(d[k])
        if "csp" not in r or "service" not in r:
            csp, service = infer_csp(r.get("litellmModel", ""))
            r.setdefault("csp", csp)
            r.setdefault("service", service)
    return routes


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gateway", help="Gateway base URL incl. /v1 (required unless --list)")
    ap.add_argument("--api-key-env", default="LITELLM_API_KEY")
    ap.add_argument("--routes-file", help="YAML/JSON: routes with csp, service, region, modelId and the optional direct baseline")
    ap.add_argument("--routes", help="extra gateway aliases (csp / service read from /model/info)")
    ap.add_argument("--direct", action="store_true", help="also run every case straight against the CSP (routes with a direct: block)")
    ap.add_argument("--cases", default="all", help="comma-separated case ids, or 'all' / 'required'")
    ap.add_argument("--samples", type=int, default=3, help="latency samples per side for chat.basic and chat.stream (overhead metrics)")
    ap.add_argument("--timeout", type=float, default=300.0)
    ap.add_argument("--litellm-version")
    ap.add_argument("--purpose", choices=["pre-release", "regression", "adhoc"])
    ap.add_argument("--out")
    ap.add_argument("--fail-on-required", action="store_true", help="exit 2 when a required case fails through the gateway")
    ap.add_argument("--list", action="store_true", help="list cases and exit")
    args = ap.parse_args()

    if args.list:
        for c in ALL_CASES:
            print(f"{c.id:<26} {SURFACE_OF.get(c.id, '?'):<18} {'required' if c.required else 'optional':<9} {c.title}")
        return
    if not args.gateway:
        ap.error("--gateway is required (unless --list)")
    if args.cases == "all":
        cases = ALL_CASES
    elif args.cases == "required":
        cases = [c for c in ALL_CASES if c.required]
    else:
        wanted = set(args.cases.split(","))
        cases = [c for c in ALL_CASES if c.id in wanted]
        if wanted - {c.id for c in cases}:
            ap.error(f"unknown case ids: {sorted(wanted - {c.id for c in cases})}")

    key = os.environ.get(args.api_key_env, "")
    base = args.gateway.rstrip("/")
    started = datetime.now(timezone.utc)
    results, samples = [], {}
    with httpx.Client() as client:
        routes = load_routes(args, client, base, key)
        for info in routes:
            route = info["route"]
            direct = info.get("direct") if args.direct else None
            s = samples.setdefault(route, {"gw": [], "direct": [], "gwTtft": [], "directTtft": []})
            for case in cases:
                row = {"route": route, "caseId": case.id, "surface": SURFACE_OF.get(case.id, "chat")}
                try:
                    resp = {}
                    for _ in range(case.repeat):
                        resp = gateway_call(client, base, key, case, route, args.timeout)
                        if resp.get("_status") != 200:
                            break
                    status, detail = judge(case, resp)
                    row.update({"status": status, "httpStatus": resp.get("_status"), "latencyMs": round(resp.get("_ms", 0.0), 1), "detail": detail[:500]})
                    if resp.get("_ttft") is not None:
                        row["ttftMs"] = round(resp["_ttft"], 1)
                    hdr = {k: v for k, v in (resp.get("_headers") or {}).items() if k.startswith("x-litellm-") and "key" not in k}
                    if hdr:
                        row["headers"] = hdr
                    u = resp.get("usage") or resp.get("_usage") or {}
                    if u.get("prompt_tokens") is not None:
                        row["usage"] = {"promptTokens": u.get("prompt_tokens"), "completionTokens": u.get("completion_tokens"),
                                        "cachedTokens": (u.get("prompt_tokens_details") or {}).get("cached_tokens")}
                except httpx.HTTPError as e:
                    row.update({"status": "error", "detail": f"{type(e).__name__}: {e}"[:500]})
                # --- the baseline
                d_status = None
                if direct and case.id not in GATEWAY_ONLY:
                    try:
                        dresp = None
                        for _ in range(case.repeat):
                            dresp = direct_call(client, direct, case, route, args.timeout)
                            if dresp is None or dresp.get("_status") != 200:
                                break
                        if dresp is None:
                            row["direct"] = {"status": "skip", "detail": "原生 API 沒有對應的請求（gateway 才有的轉換）"}
                        else:
                            d_status, d_detail = judge(case, dresp)
                            row["direct"] = {"status": d_status, "httpStatus": dresp.get("_status"), "latencyMs": round(dresp.get("_ms", 0.0), 1),
                                             "detail": d_detail[:300]}
                            if dresp.get("_ttft") is not None:
                                row["direct"]["ttftMs"] = round(dresp["_ttft"], 1)
                            du = dresp.get("usage") or dresp.get("_usage") or {}
                            if case.id == "chat.basic" and du.get("prompt_tokens") is not None and (row.get("usage") or {}).get("promptTokens") is not None:
                                s["gwPrompt"], s["directPrompt"] = row["usage"]["promptTokens"], du.get("prompt_tokens")
                    except httpx.HTTPError as e:
                        row["direct"] = {"status": "error", "detail": f"{type(e).__name__}: {e}"[:300]}
                        d_status = "error"
                # --- who is it?
                if row["status"] == "pass":
                    row["attribution"] = "ok"
                elif case.id in GATEWAY_ONLY and row["status"] == "fail":
                    row["attribution"] = "gateway"  # what only the gateway does (cost header, fallbacks, the alias it answers with)
                elif d_status == "pass":
                    row["attribution"] = "gateway"
                elif d_status in ("fail", "error"):
                    row["attribution"] = "provider"
                else:
                    row["attribution"] = "unknown"
                if row.get("httpStatus") == 200 and row["status"] == "fail" and case.id not in EXPECT_ERROR:
                    row["silent"] = True
                results.append(row)
                print(f"{route:<34} {case.id:<24} {row['status']:<5} {row.get('httpStatus', '')!s:<4} {row['attribution']:<8} "
                      f"{('direct=' + row['direct']['status']) if 'direct' in row else '':<13} {row.get('detail', '')[:70]}")
                # --- latency samples (successful requests only, both sides)
                if case.id in LATENCY_CASES and row["status"] == "pass" and direct and (row.get("direct") or {}).get("status") == "pass":
                    for _ in range(max(args.samples, 1)):
                        g = gateway_call(client, base, key, case, route, args.timeout)
                        dd = direct_call(client, direct, case, route, args.timeout)
                        if g.get("_status") == 200 and dd and dd.get("_status") == 200:
                            if case.endpoint == "chat":
                                s["gw"].append(g["_ms"])
                                s["direct"].append(dd["_ms"])
                            elif g.get("_ttft") is not None and dd.get("_ttft") is not None:
                                s["gwTtft"].append(g["_ttft"])
                                s["directTtft"].append(dd["_ttft"])
    finished = datetime.now(timezone.utc)

    required = {c.id for c in cases if c.required}
    summary = []
    for info in routes:
        rs = [r for r in results if r["route"] == info["route"]]
        summary.append({"route": info["route"], "pass": sum(r["status"] == "pass" for r in rs), "fail": sum(r["status"] == "fail" for r in rs),
                        "error": sum(r["status"] == "error" for r in rs), "skip": sum(r["status"] == "skip" for r in rs),
                        "requiredFailures": [r["caseId"] for r in rs if r["caseId"] in required and r["status"] != "pass"]})
    per_route = []
    for info in routes:
        m = route_metrics(info["route"], results, required, samples)
        m.update({"csp": info["csp"], "service": info["service"]})
        per_route.append(m)
    route_info = []
    for info in routes:
        ri = {k: info[k] for k in ("route", "modelId", "csp", "service", "region", "litellmModel") if info.get(k)}
        if args.direct and info.get("direct"):
            ri["direct"] = {"protocol": info["direct"].get("protocol"), "host": urlsplit(info["direct"].get("url", "")).hostname or ""}
        route_info.append(ri)
    run = {
        "schema": "compat-run/v1",
        "kind": "gateway-csp",
        "runId": f"gwcsp-{started.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:6]}",
        "startedAt": started.isoformat().replace("+00:00", "Z"),
        "finishedAt": finished.isoformat().replace("+00:00", "Z"),
        "gateway": args.gateway,
        "baseline": "direct" if args.direct and any(i.get("direct") for i in routes) else "none",
        "routes": [i["route"] for i in routes],
        "routeInfo": route_info,
        "cases": [{"id": c.id, "title": c.title, "required": c.required, "surface": SURFACE_OF.get(c.id, "chat")} for c in cases],
        "results": [{k: v for k, v in r.items() if v is not None} for r in results],
        "summary": summary,
        "metrics": {
            "byRoute": per_route,
            "byCsp": [group_metrics("csp", c, per_route) for c in dict.fromkeys(m["csp"] for m in per_route)],
            "bySurface": [{"surface": sid, "title": title,
                           "applicable": sum(1 for r in results if r["surface"] == sid and r["status"] != "skip"),
                           "pass": sum(1 for r in results if r["surface"] == sid and r["status"] == "pass"),
                           "gatewayInduced": sum(1 for r in results if r["surface"] == sid and r.get("attribution") == "gateway")}
                          for sid, title in SURFACES if any(r["surface"] == sid for r in results)],
        },
    }
    model_ids = sorted({i["modelId"] for i in routes if i.get("modelId")})
    if model_ids:
        run["modelIds"] = model_ids
    if args.litellm_version:
        run["litellmVersion"] = args.litellm_version
    if args.purpose:
        run["purpose"] = args.purpose
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(run, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"wrote {args.out}")
    for m in per_route:
        rate = f"{m['compatibilityRate'] * 100:.0f}%" if m["compatibilityRate"] is not None else "—"
        print(f"{m['route']:<34} {m['csp']:<6} 相容率 {rate:<5} gateway 引入 {m['gatewayInduced']} · provider 限制 {m['providerLimited']} · "
              f"靜默降級 {m['silentDegradations']} · overhead p50 {m['overheadMs']['p50']} ms")
    if args.fail_on_required and any(s["requiredFailures"] for s in summary):
        sys.exit(2)


if __name__ == "__main__":
    main()
