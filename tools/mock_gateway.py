#!/usr/bin/env python3
"""Tiny OpenAI/LiteLLM-compatible mock gateway for testing the tools without spending tokens.

  python3 tools/mock_gateway.py --port 4010

Behaviour is picked by substrings in the requested model name:
  reasoning      stream reasoning_content before the answer (tests TTFT vs TTFAT)
  no-temp        HTTP 400 when temperature is sent (like GPT-6 on Bedrock via LiteLLM 1.102.1)
  no-forced      HTTP 400 on forced tool_choice (like Claude Opus 5.5 without drop_params)
  silent-forced  forced tool_choice silently becomes auto and no tool is called (drop_params downgrade)
  no-schema      ignores response_format and answers in prose
  flaky          ~25% HTTP 429
  err500         an invalid request (max_tokens < 0, unknown forced tool, bad image) answers HTTP 500 instead of 400
  drop-tools-stream  streaming with tools: the tool-call deltas never arrive
  no-cost        no x-litellm-response-cost header (cost tracking blind)
  fallback       x-litellm-attempted-fallbacks: 1 and another model answers
  slow-gw        the gateway adds ~60 ms more than the provider
Endpoints: /v1/chat/completions, /v1/responses, /v1/messages, /model/info, /health/readiness

Gateway and provider in one process (tools/gateway_csp_check.py --direct): /v1/... answers as the LiteLLM gateway (with
x-litellm-* headers and a little overhead); /direct/v1/chat/completions answers as an OpenAI-compatible provider endpoint
and /direct/anthropic/v1/messages as an Anthropic Messages endpoint. Flags written "~gw.<flag>" in the model name apply
to the gateway only ("mock-aws-claude~gw.silent-forced": the gateway downgrades forced tool_choice, the provider does not).
"""
from __future__ import annotations

import argparse
import base64
import binascii
import json
import random
import re
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_seen_prefixes: set[str] = set()
_lock = threading.Lock()

MODEL_INFO = {"data": [
    {"model_name": "claude-opus-5-5", "litellm_params": {"model": "bedrock/global.anthropic.claude-opus-5-5", "aws_region_name": "ap-east-2"}, "model_info": {"catalog_id": "claude-opus-5-5"}},
    {"model_name": "claude-sonnet-4", "litellm_params": {"model": "bedrock/apac.anthropic.claude-sonnet-4-20250514-v1:0"}, "model_info": {}},
    {"model_name": "claude-3-haiku", "litellm_params": {"model": "bedrock/anthropic.claude-3-haiku-20240307-v1:0"}, "model_info": {}},
    {"model_name": "gpt-4o-prod", "litellm_params": {"model": "azure/gpt-4o-prod", "api_key": "sk-should-never-be-written"}, "model_info": {"base_model": "azure/gpt-4o", "model_version": "2024-11-20"}},
    {"model_name": "o3-reasoning", "litellm_params": {"model": "azure/o3-team-a"}, "model_info": {"base_model": "azure/o3"}},
    {"model_name": "gemini-2.5-flash", "litellm_params": {"model": "vertex_ai/gemini-2.5-flash", "vertex_location": "global"}, "model_info": {}},
    {"model_name": "gpt-6-astra@bedrock", "litellm_params": {"model": "bedrock/converse/global.openai.gpt-6-astra"}, "model_info": {}},
    {"model_name": "internal-finetune", "litellm_params": {"model": "openai/my-custom-model", "api_base": "http://10.0.0.5"}, "model_info": {}},
]}


def _usage(prompt_tokens, completion_tokens, reasoning=0, cached=0):
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
        "completion_tokens_details": {"reasoning_tokens": reasoning},
        "prompt_tokens_details": {"cached_tokens": cached},
    }


def _prompt_text(messages) -> str:
    out = []
    for m in messages or []:
        c = m.get("content")
        if isinstance(c, str):
            out.append(c)
        elif isinstance(c, list):
            out += [p.get("text", "") for p in c if isinstance(p, dict)]
    return "\n".join(out)


def _has_image(messages) -> bool:
    return any(isinstance(m.get("content"), list) and any(p.get("type") in ("image_url", "image") for p in m["content"]) for m in messages or [])


def _bad_image(messages) -> bool:
    """An image whose data is not base64 (the gateway-check's error case sends one)."""
    for m in messages or []:
        for p in m.get("content") if isinstance(m.get("content"), list) else []:
            data = ""
            if p.get("type") == "image_url":
                url = (p.get("image_url") or {}).get("url", "")
                data = url.split(",", 1)[1] if url.startswith("data:") and "," in url else "x"
            elif p.get("type") == "image":
                data = (p.get("source") or {}).get("data", "")
            else:
                continue
            try:
                base64.b64decode(data, validate=True)
            except (binascii.Error, ValueError):
                return True
    return False


def effective(model: str, direct: bool) -> str:
    """The behaviour flags that apply: "~gw.<flag>" only on the gateway side."""
    return re.sub(r"~gw\.[^~]+", "", model) if direct else model.replace("~gw.", "~")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # quiet
        pass

    # ------------------------------------------------------------------ helpers
    direct = False  # set per request: True on /direct/... (the provider), False on /v1/... (the gateway)
    model = ""

    def _gateway_headers(self, ok: bool):
        if self.direct:
            return
        m = self.model
        self.send_header("x-litellm-attempted-fallbacks", "1" if "fallback" in m else "0")
        self.send_header("x-litellm-model-api-base", "https://provider.mock.invalid")
        self.send_header("x-litellm-version", "1.104.2-mock")
        if ok and "no-cost" not in m:
            self.send_header("x-litellm-response-cost", "0.000123")

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._gateway_headers(code == 200)
        self.end_headers()
        self.wfile.write(body)

    def _err(self, code, msg):
        if self.direct and self.path.endswith("/messages"):  # the provider's own error shape
            return self._json(code, {"type": "error", "error": {"type": "invalid_request_error", "message": msg}})
        self._json(code, {"error": {"message": msg, "type": "invalid_request_error", "code": str(code)}})

    def _invalid(self, msg):
        """A request the provider refuses: 400 - or, behind a gateway that maps errors badly (err500), 500."""
        if not self.direct and "err500" in self.model:
            return self._json(500, {"error": {"message": "Internal Server Error", "type": "internal_server_error", "code": "500"}})
        return self._err(400, msg)

    def _overhead(self):
        if not self.direct:
            time.sleep(0.02 + (0.06 if "slow-gw" in self.model else 0))

    def _read(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    # ------------------------------------------------------------------ routes
    def do_GET(self):
        if self.path.startswith("/model/info"):
            return self._json(200, MODEL_INFO)
        if self.path.startswith("/health/readiness"):
            return self._json(200, {"status": "healthy", "litellm_version": "1.102.1-mock"})
        self._err(404, "not found")

    def do_POST(self):
        body = self._read()
        self.direct = self.path.startswith("/direct/")
        model = effective(body.get("model", ""), self.direct)
        self.model = model
        self._overhead()
        if "flaky" in model and random.random() < 0.25:
            return self._err(429, "rate limited (mock)")
        if self.path.endswith("/messages") and self.path.startswith("/direct/anthropic/"):
            return self._anthropic(body, model)
        if self.path.endswith("/chat/completions"):
            return self._chat(body, model)
        if self.path.endswith("/responses"):
            return self._responses(body, model)
        if self.path.endswith("/messages"):
            return self._messages(body, model)
        self._err(404, "not found")

    def _chat(self, body, model):
        if "no-temp" in model and "temperature" in body:
            return self._err(400, "Unsupported parameter: 'temperature'")
        mt = body.get("max_tokens", body.get("max_completion_tokens"))
        if isinstance(mt, int) and mt < 1:
            return self._invalid("max_tokens must be at least 1")
        if _bad_image(body.get("messages")):
            return self._invalid("Could not process image")
        tc = body.get("tool_choice")
        names = [t.get("function", {}).get("name") for t in body.get("tools") or []]
        if isinstance(tc, dict) and (tc.get("function") or {}).get("name") not in names:
            return self._invalid("tool_choice names a function that is not in tools")
        forced = isinstance(tc, dict) or tc in ("required", "any")
        if "no-forced" in model and forced:
            return self._err(400, 'tool_choice: type "tool" and "any" are not supported for this model.')
        tools = body.get("tools") or []
        want_tool = bool(tools) and tc != "none" and not ("silent-forced" in model and forced)
        if "silent-forced" in model and forced:
            want_tool = False
        messages = body.get("messages", [])
        prompt = _prompt_text(messages)
        prompt_tokens = max(len(prompt) // 4, 1)
        cached = 0
        system = next((m.get("content") for m in messages if m.get("role") == "system" and isinstance(m.get("content"), str)), "")
        if len(system) > 4000:
            with _lock:
                if system in _seen_prefixes:
                    cached = len(system) // 4
                _seen_prefixes.add(system)
        rf = body.get("response_format") or {}
        if rf.get("type") == "json_schema" and "no-schema" not in model:
            answer = '{"country": "Japan", "capital": "Tokyo"}'
        elif _has_image(messages):
            answer = "Red"
        else:
            answer = "pong. This is a mock answer that streams a few words so that latency can be measured."
        reasoning = "Let me think about this carefully step by step." if "reasoning" in model else ""
        tool_calls = [{"id": "call_" + uuid.uuid4().hex[:8], "type": "function",
                       "function": {"name": tools[0]["function"]["name"], "arguments": json.dumps({"city": "Taipei"})}}] if want_tool else None
        completion_tokens = len(answer.split()) + (len(reasoning.split()) if reasoning else 0)
        usage = _usage(prompt_tokens, completion_tokens, len(reasoning.split()) if reasoning else 0, cached)
        cid = "chatcmpl-" + uuid.uuid4().hex[:12]
        if "fallback" in model and not self.direct:
            model = model + "-fallback"
        if not body.get("stream"):
            msg = {"role": "assistant", "content": None if tool_calls else answer}
            if tool_calls:
                msg["tool_calls"] = tool_calls
            time.sleep(0.05)
            return self._json(200, {"id": cid, "object": "chat.completion", "model": model, "created": int(time.time()),
                                    "choices": [{"index": 0, "message": msg, "finish_reason": "tool_calls" if tool_calls else "stop"}], "usage": usage})
        # ---- streaming
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self._gateway_headers(True)
        self.end_headers()

        def send(obj):
            self.wfile.write(f"data: {json.dumps(obj)}\n\n".encode())
            self.wfile.flush()

        base = {"id": cid, "object": "chat.completion.chunk", "model": model, "created": int(time.time())}
        time.sleep(0.05)
        for w in reasoning.split():
            send({**base, "choices": [{"index": 0, "delta": {"reasoning_content": w + " "}, "finish_reason": None}]})
            time.sleep(0.06)
        if tool_calls and "drop-tools-stream" in model and not self.direct:
            tool_calls = None  # the gateway loses the tool-call deltas
        if tool_calls:
            first = {"index": 0, "id": tool_calls[0]["id"], "type": "function", "function": {"name": tool_calls[0]["function"]["name"], "arguments": ""}}
            send({**base, "choices": [{"index": 0, "delta": {"tool_calls": [first]}, "finish_reason": None}]})
            args = tool_calls[0]["function"]["arguments"]
            for i in range(0, len(args), 6):  # arguments arrive in pieces, as providers send them
                send({**base, "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"arguments": args[i:i + 6]}}]}, "finish_reason": None}]})
        else:
            for w in answer.split():
                send({**base, "choices": [{"index": 0, "delta": {"content": w + " "}, "finish_reason": None}]})
                time.sleep(0.015)
        send({**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls" if tool_calls else "stop"}]})
        if (body.get("stream_options") or {}).get("include_usage"):
            send({**base, "choices": [], "usage": usage})
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()
        self.close_connection = True

    def _responses(self, body, model):
        if "no-temp" in model and "temperature" in body:
            return self._err(400, "Unsupported parameter: 'temperature'")
        tools = body.get("tools") or []
        rid = "resp_" + uuid.uuid4().hex[:12]
        if tools:
            output = [{"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": tools[0]["name"], "arguments": json.dumps({"city": "Taipei"})}]
        else:
            output = [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "pong"}]}]
        self._json(200, {"id": rid, "object": "response", "model": model, "status": "completed", "output": output,
                         "usage": {"input_tokens": 10, "output_tokens": 2, "total_tokens": 12}})

    def _anthropic(self, body, model):
        """An Anthropic Messages endpoint (the provider side of /v1/messages)."""
        mt = body.get("max_tokens")
        if not isinstance(mt, int) or mt < 1:
            return self._err(400, "max_tokens: must be at least 1")
        if "no-temp" in model and "temperature" in body:
            return self._err(400, "temperature is not supported for this model")
        messages = body.get("messages", [])
        if _bad_image(messages):
            return self._err(400, "Could not process image")
        tools = body.get("tools") or []
        tc = body.get("tool_choice") or {}
        forced = tc.get("type") in ("tool", "any")
        if tc.get("type") == "tool" and tc.get("name") not in [t.get("name") for t in tools]:
            return self._err(400, "tool_choice.name is not one of the tools")
        if "no-forced" in model and forced:
            return self._err(400, 'tool_choice: type "tool" and "any" are not supported for this model.')
        system = body.get("system") or ""
        sys_text = system if isinstance(system, str) else "".join(b.get("text", "") for b in system if isinstance(b, dict))
        cached = 0
        if len(sys_text) > 4000 and not isinstance(system, str) and any(isinstance(b, dict) and b.get("cache_control") for b in system):
            with _lock:
                if ("A:" + sys_text) in _seen_prefixes:
                    cached = len(sys_text) // 4
                _seen_prefixes.add("A:" + sys_text)
        prompt = sys_text + _prompt_text(messages)
        use_tool = bool(tools) and tc.get("type") != "none"
        answer = "Red" if _has_image(messages) else "pong. This is a mock answer from the provider."
        content = ([{"type": "tool_use", "id": "toolu_" + uuid.uuid4().hex[:8], "name": tools[0]["name"], "input": {"city": "Taipei"}}]
                   if use_tool else [{"type": "text", "text": answer}])
        usage = {"input_tokens": max(len(prompt) // 4, 1) - cached, "output_tokens": len(answer.split()), "cache_read_input_tokens": cached,
                 "cache_creation_input_tokens": 0}
        mid = "msg_" + uuid.uuid4().hex[:12]
        stop = "tool_use" if use_tool else "end_turn"
        if not body.get("stream"):
            time.sleep(0.05)
            return self._json(200, {"id": mid, "type": "message", "role": "assistant", "model": body.get("model", model), "content": content,
                                    "stop_reason": stop, "usage": usage})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "close")
        self.end_headers()

        def ev(name, obj):
            self.wfile.write(f"event: {name}\ndata: {json.dumps(obj)}\n\n".encode())
            self.wfile.flush()
        ev("message_start", {"type": "message_start", "message": {"id": mid, "type": "message", "role": "assistant", "content": [],
                                                                   "usage": {"input_tokens": usage["input_tokens"], "output_tokens": 0}}})
        if use_tool:
            ev("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {**content[0], "input": {}}})
            ev("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": json.dumps(content[0]["input"])}})
        else:
            ev("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})
            for w in answer.split():
                ev("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": w + " "}})
                time.sleep(0.01)
        ev("content_block_stop", {"type": "content_block_stop", "index": 0})
        ev("message_delta", {"type": "message_delta", "delta": {"stop_reason": stop}, "usage": {"output_tokens": usage["output_tokens"]}})
        ev("message_stop", {"type": "message_stop"})
        self.close_connection = True

    def _messages(self, body, model):
        self._json(200, {"id": "msg_" + uuid.uuid4().hex[:12], "type": "message", "role": "assistant", "model": model,
                         "content": [{"type": "text", "text": "pong"}], "stop_reason": "end_turn",
                         "usage": {"input_tokens": 10, "output_tokens": 2}})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4010)
    args = ap.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"mock gateway on http://127.0.0.1:{args.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
