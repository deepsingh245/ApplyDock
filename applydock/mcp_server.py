"""MCP stdio bridge for an already-running local ApplyDock helper."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

from .agent_commands import COMMANDS


def _tool_list():
    tools = []
    for name, item in COMMANDS.items():
        tools.append({"name": name, "description": item["summary"], "inputSchema": item["input_schema"]})
    tools.extend([
        {"name": "describe_applydock", "description": "Describe the local ApplyDock agent API", "inputSchema": {"type": "object", "properties": {}}},
        {"name": "get_api_spec", "description": "Get the ApplyDock OpenAPI document", "inputSchema": {"type": "object", "properties": {}}},
    ])
    return tools


def _call(name, args):
    if name == "describe_applydock":
        return {"name": "ApplyDock", "base_url": os.environ.get("APPLYDOCK_URL", "http://127.0.0.1:8765"),
                "human_only": ["approve", "Gmail draft or schedule", "send", "settings", "delete resumes"]}
    if name == "get_api_spec":
        name, args = "__spec__", {}
    if name != "__spec__" and name not in COMMANDS:
        raise ValueError(f"Unknown tool: {name}")
    base = os.environ.get("APPLYDOCK_URL", "http://127.0.0.1:8765").rstrip("/")
    key = os.environ.get("APPLYDOCK_KEY", "")
    if not key: raise ValueError("APPLYDOCK_KEY is required.")
    if name == "__spec__":
        method, path, body = "GET", "/api/agent/openapi.json", None
    else:
        command = COMMANDS[name]
        path = command["path"]
        if "{id}" in path:
            path = path.replace("{id}", urllib.parse.quote(str(args.get("id", "")), safe=""))
        method = command["method"]
        if method == "GET":
            query = {k: v for k, v in args.items() if k != "id" and v != ""}
            if query: path += "?" + urllib.parse.urlencode(query)
            body = None
        else:
            body = {k: v for k, v in args.items() if k != "id"}
    request = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                                    headers={"X-Local-Key": key, "Content-Type": "application/json"}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise ValueError(f"ApplyDock returned {error.code}: {detail}") from None


def handle(message):
    method, params = message.get("method"), message.get("params", {})
    if method == "notifications/initialized": return None
    if method == "initialize":
        return {"protocolVersion": params.get("protocolVersion", "2024-11-05"), "capabilities": {"tools": {}},
                "serverInfo": {"name": "applydock", "version": "1.0.0"}}
    if method == "ping": return {}
    if method == "tools/list": return {"tools": _tool_list()}
    if method == "tools/call":
        name = params.get("name", "")
        if name not in {tool["name"] for tool in _tool_list()}:
            raise ValueError(f"Unknown tool: {name}")
        try:
            value = _call(name, params.get("arguments", {}))
            return {"content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}]}
        except Exception as error:
            return {"isError": True, "content": [{"type": "text", "text": str(error)}]}
    raise ValueError(f"Method not found: {method}")


def main():
    for line in sys.stdin:
        try:
            message = json.loads(line)
            try:
                result = handle(message)
                if result is None or "id" not in message: continue
                output = {"jsonrpc": "2.0", "id": message["id"], "result": result}
            except Exception as error:
                code = -32601 if str(error).startswith("Method not found") else -32602 if str(error).startswith("Unknown tool") else -32603
                output = {"jsonrpc": "2.0", "id": message.get("id"), "error": {"code": code,
                                                                                 "message": str(error)}}
            sys.stdout.write(json.dumps(output, ensure_ascii=False) + "\n"); sys.stdout.flush()
        except Exception:
            continue


if __name__ == "__main__":
    main()
