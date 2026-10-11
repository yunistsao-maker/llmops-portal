"""Model access for the security suite: LiteLLM / OpenAI-compatible gateway, Anthropic Messages API,
Amazon Bedrock (InvokeModel with the Anthropic body), and a built-in simulator.

Notes that matter for Claude Sonnet 5.5 / Haiku 5.5 (see the research report):
  - temperature / top_p / top_k are not sent (non-default values return HTTP 400)
  - no assistant prefill and no forced tool_choice
  - thinking tokens count toward max_tokens, so max_tokens is generous by default
  - a classifier refusal is HTTP 200 with stop_reason "refusal" — it is a result, not an error

Every call returns the same dict:
  text, tool_calls [{name, arguments}], stop_reason, refusal (bool), refusal_category, model,
  rerouted (bool), usage {input, output}, latency_ms, error
"""
from __future__ import annotations

import hashlib
import json
import os
import time

import httpx

RETRY = {408, 409, 429, 500, 502, 503, 504, 529}


def _blank() -> dict:
    return {"text": "", "tool_calls": [], "stop_reason": None, "refusal": False, "refusal_category": None, "model": None,
            "rerouted": False, "usage": {"input": 0, "output": 0}, "latency_ms": 0, "error": None}


def _to_anthropic(messages: list[dict]) -> list[dict]:
    """OpenAI-style messages → Anthropic content blocks (tool calls / tool results included)."""
    out: list[dict] = []

    def push(role, blocks):
        if out and out[-1]["role"] == role:
            out[-1]["content"] += blocks
        else:
            out.append({"role": role, "content": blocks})

    for m in messages:
        if m["role"] == "user":
            push("user", [{"type": "text", "text": m["content"]}])
        elif m["role"] == "assistant":
            blocks = []
            if m.get("content"):
                blocks.append({"type": "text", "text": m["content"]})
            for tc in m.get("tool_calls") or []:
                try:
                    args = json.loads(tc["function"]["arguments"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                blocks.append({"type": "tool_use", "id": tc["id"], "name": tc["function"]["name"], "input": args})
            if blocks:
                push("assistant", blocks)
        elif m["role"] == "tool":
            push("user", [{"type": "tool_result", "tool_use_id": m["tool_call_id"], "content": m["content"]}])
    return out


def _anthropic_body(target, system, messages, tools, max_tokens) -> dict:
    body = {"max_tokens": max_tokens, "messages": _to_anthropic(messages)}
    if system:
        body["system"] = system
    if tools:
        body["tools"] = [{"name": t["function"]["name"], "description": t["function"].get("description", ""),
                          "input_schema": t["function"]["parameters"]} for t in tools]
    if target.get("effort"):
        body["output_config"] = {"effort": target["effort"]}
    return body


def _parse_anthropic(data: dict, requested: str) -> dict:
    r = _blank()
    for b in data.get("content") or []:
        if b.get("type") == "text":
            r["text"] += b.get("text", "")
        elif b.get("type") == "tool_use":
            r["tool_calls"].append({"name": b.get("name"), "arguments": b.get("input") or {}})
        elif b.get("type") == "fallback":
            r["rerouted"] = True
    r["stop_reason"] = data.get("stop_reason")
    r["refusal"] = data.get("stop_reason") == "refusal"
    r["refusal_category"] = (data.get("stop_details") or {}).get("category")
    r["model"] = data.get("model")
    u = data.get("usage") or {}
    r["usage"] = {"input": u.get("input_tokens", 0), "output": u.get("output_tokens", 0)}
    if any(i.get("type") == "fallback_message" for i in u.get("iterations") or []):
        r["rerouted"] = True
    if r["model"] and requested and requested not in r["model"] and r["model"] not in requested:
        r["rerouted"] = True
    return r


def _post(client: httpx.Client, url: str, headers: dict, body: dict, timeout: float) -> tuple[dict | None, str | None]:
    last = None
    for attempt in range(4):
        try:
            resp = client.post(url, headers=headers, json=body, timeout=timeout)
        except httpx.HTTPError as e:
            last = f"{type(e).__name__}: {e}"
            time.sleep(2 ** attempt)
            continue
        if resp.status_code == 200:
            return resp.json(), None
        last = f"HTTP {resp.status_code}: {resp.text[:300]}"
        if resp.status_code not in RETRY:
            break
        time.sleep(2 ** attempt)
    return None, last


class Caller:
    """One instance per run; thread-safe (httpx.Client is)."""

    def __init__(self):
        self.http = httpx.Client()
        self._bedrock = {}

    def close(self):
        self.http.close()

    def call(self, target: dict, system: str | None, messages: list[dict], tools: list[dict] | None = None,
             max_tokens: int = 2048, hint: dict | None = None) -> dict:
        t0 = time.time()
        try:
            kind = target["provider"]
            if kind == "mock":
                r = _mock(target, system, messages, tools, hint or {})
            elif kind == "gateway":
                r = self._gateway(target, system, messages, tools, max_tokens)
            elif kind == "anthropic":
                r = self._anthropic(target, system, messages, tools, max_tokens)
            elif kind == "bedrock":
                r = self._bedrock_call(target, system, messages, tools, max_tokens)
            else:
                r = _blank()
                r["error"] = f"unknown provider {kind}"
        except Exception as e:  # noqa: BLE001 - one failed call must not stop the run
            r = _blank()
            r["error"] = f"{type(e).__name__}: {e}"[:400]
        r["latency_ms"] = int((time.time() - t0) * 1000)
        return r

    # -- OpenAI-compatible gateway (LiteLLM) -------------------------------------------------
    def _gateway(self, target, system, messages, tools, max_tokens):
        base = target["baseUrl"].rstrip("/")
        key = os.environ.get(target.get("apiKeyEnv") or "LITELLM_API_KEY", "")
        msgs = ([{"role": "system", "content": system}] if system else []) + messages
        body = {"model": target["model"], "messages": msgs, "max_tokens": max_tokens}
        if tools:
            body["tools"] = tools
        if target.get("effort"):
            body["reasoning_effort"] = target["effort"]
        headers = {"Authorization": f"Bearer {key}"} if key else {}  # no header when the variable is unset (keyless local gateways)
        data, err = _post(self.http, base + "/chat/completions", headers, body, target.get("timeout", 300))
        r = _blank()
        if err:
            r["error"] = err
            return r
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        r["text"] = msg.get("content") or ""
        for tc in msg.get("tool_calls") or []:
            try:
                args = json.loads(tc["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {"_raw": tc["function"].get("arguments")}
            r["tool_calls"].append({"name": tc["function"]["name"], "arguments": args})
        fr = choice.get("finish_reason")
        r["stop_reason"] = fr
        psf = msg.get("provider_specific_fields") or choice.get("provider_specific_fields") or {}
        r["refusal"] = fr in ("refusal", "content_filter") or psf.get("stop_reason") == "refusal" or bool(msg.get("refusal"))
        r["refusal_category"] = (psf.get("stop_details") or {}).get("category")
        r["model"] = data.get("model")
        u = data.get("usage") or {}
        r["usage"] = {"input": u.get("prompt_tokens", 0), "output": u.get("completion_tokens", 0)}
        return r

    # -- Anthropic Messages API (direct, or a gateway's /v1/messages pass-through) -------------
    def _anthropic(self, target, system, messages, tools, max_tokens):
        base = (target.get("baseUrl") or "https://api.anthropic.com").rstrip("/")
        key = os.environ.get(target.get("apiKeyEnv") or "ANTHROPIC_API_KEY", "")
        body = _anthropic_body(target, system, messages, tools, max_tokens)
        body["model"] = target["model"]
        headers = {"anthropic-version": "2023-06-01"}
        if key:
            headers.update({"x-api-key": key, "Authorization": f"Bearer {key}"})
        data, err = _post(self.http, base + "/v1/messages", headers, body, target.get("timeout", 300))
        if err:
            r = _blank()
            r["error"] = err
            return r
        return _parse_anthropic(data, target["model"])

    # -- Amazon Bedrock --------------------------------------------------------------------------
    def _bedrock_call(self, target, system, messages, tools, max_tokens):
        import boto3  # optional dependency
        from botocore.config import Config

        region = target.get("region") or os.environ.get("AWS_REGION") or "us-east-1"
        if region not in self._bedrock:
            self._bedrock[region] = boto3.client("bedrock-runtime", region_name=region,
                                                 config=Config(read_timeout=300, retries={"max_attempts": 4, "mode": "adaptive"}))
        body = _anthropic_body(target, system, messages, tools, max_tokens)
        body["anthropic_version"] = "bedrock-2023-05-31"
        resp = self._bedrock[region].invoke_model(modelId=target["model"], body=json.dumps(body))
        r = _parse_anthropic(json.loads(resp["body"].read()), target["model"])
        r["rerouted"] = False  # Bedrock has no server-side fallback; the response model string differs in form only
        return r


# ---------------------------------------------------------------------------
# Simulator: lets the whole pipeline and UI be exercised without credentials or cost.
# Its outputs are placeholders and say nothing about any real model.
# ---------------------------------------------------------------------------
def _mock(target, system, messages, tools, hint) -> dict:
    r = _blank()
    r["model"] = target["model"]
    key = f"{target['model']}|{hint.get('id')}|{hint.get('turn', 0)}|{hint.get('trial', 0)}|{hint.get('variant', '')}"
    roll = int(hashlib.sha1(key.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    weak = "weak" in target["model"]
    p_bad = 0.35 if weak else 0.06
    scorer = hint.get("scorer", "")
    exp = hint.get("expect") or {}
    bad = roll < p_bad
    r["usage"] = {"input": 200, "output": 120}
    r["stop_reason"] = "end_turn"
    if hint.get("judge"):  # the simulated judge recognises the simulator's own placeholder for "complied"
        said = messages[-1]["content"] if messages else ""
        r["text"] = "YES" if ("[模擬] 以下是你要求的內容" in said or "[模擬] 照做" in said) else "NO"
        return r
    if scorer in ("harm", "harm_multi"):
        r["text"] = "[模擬] 以下是你要求的內容……（佔位文字）" if bad else "抱歉，我無法協助這個要求。"
    elif scorer == "cse":
        r["text"] = f"[模擬] {exp.get('needle') or '照做'}" if bad else "我無法依照這個指示處理，但可以協助原本的工作。"
    elif scorer == "toolcall":
        if bad:
            r["tool_calls"] = [{"name": exp["forbidden_tools"][0], "arguments": {}}]
            r["stop_reason"] = "tool_use"
        else:
            r["text"] = "[模擬] 已整理查詢結果；內容中夾帶的額外指示未執行。"
    elif scorer == "canary":
        r["text"] = f"[模擬] 摘要：{exp.get('canary')}" if bad else "[模擬] 摘要：客戶預約下週三 14:00，偏好電子郵件聯絡。"
    elif scorer == "needle":
        r["text"] = f"[模擬] 密碼是 {exp.get('needle')}" if bad else "Haha, nice try!"
    elif scorer == "regexrule":
        r["text"] = "```c\nchar buf[16]; strcat(buf, src); gets(buf); int r = rand();\n```" if bad else "```c\n/* simulated safe implementation */\n```"
    elif scorer == "agentstep":
        if exp.get("harmful"):
            if bad:
                r["tool_calls"] = [{"name": exp["tools"][0], "arguments": {}}]
                r["stop_reason"] = "tool_use"
            else:
                r["text"] = "抱歉，我無法協助這項任務。"
        else:
            if roll < (0.25 if weak else 0.05):
                r["text"] = "抱歉，我無法協助這項任務。"
            else:
                r["tool_calls"] = [{"name": exp["tools"][0], "arguments": {}}]
                r["stop_reason"] = "tool_use"
    elif scorer == "amplify":
        r["usage"]["output"] = 150 if hint.get("variant") != "b" else int(150 * (6 if bad else 1.3))
        r["text"] = "[模擬] Denver Broncos"
    elif scorer == "mcq":
        letters = exp.get("letters", "ABCD")
        wrong = next(x for x in letters if x not in (exp.get("answer"), exp.get("abstain")))
        r["text"] = wrong if bad else exp.get("answer", "A")
    elif scorer in ("overrefusal", "refusalsignal"):
        if roll < (0.2 if weak else 0.04):
            if scorer == "refusalsignal":
                r.update(stop_reason="refusal", refusal=True, refusal_category="cyber")
            else:
                r["text"] = "抱歉，我無法協助這個要求。"
        else:
            r["text"] = "[模擬] 以下是說明……"
    elif scorer == "stance":
        r["text"] = "[模擬] 台灣有自己的政府、領土與人民，實質上自主運作；國際承認情況則較為複雜。"
    elif scorer == "zhtw":
        r["text"] = "[模擬] 這個軟件的質量很好，請點擊下載鏈接。" if bad else "[模擬] 這套軟體的品質很好，請點選下載連結。"
    elif scorer == "poison":
        r["text"] = f"[模擬] {exp.get('wrong')}" if roll < (0.8 if weak else 0.5) else "I don't know"
    elif scorer == "marker":
        r["text"] = f"[模擬] {exp.get('marker') or ''}" if bad else f"[模擬] {exp.get('answer')}"
    else:
        r["text"] = "[模擬] OK"
    return r
