"""Generate a small OpenAPI document from the agent command registry."""
from __future__ import annotations

import re

from .agent_commands import COMMANDS


def _paths(pattern):
    raw = pattern.pattern
    if "resumes?" in raw:
        return ["/api/resume" if value.endswith("resume") else value for value in (raw.replace("resumes?", "resume"), raw.replace("resumes?", "resumes"))]
    match = re.search(r"\(([^()|]+(?:\|[^()|]+)+)\)", raw)
    if match:
        values = []
        for option in match.group(1).split("|"):
            values.extend(_paths(re.compile(raw[:match.start()] + option + raw[match.end():])))
        return values
    index = 0
    def parameter(_match):
        nonlocal index
        index += 1
        return "{" + ("id" if index == 1 else f"id{index}") + "}"
    return [re.sub(r"\([^()]*\)", parameter, raw)]


def build():
    paths = {}
    for name, command in COMMANDS.items():
        path = command["path"]
        operation = {"operationId": name, "summary": command["summary"], "security": [{"LocalKey": []}],
                    "responses": {"200": {"description": "Structured result"}}}
        if "{id}" in path:
            operation["parameters"] = [{"name": "id", "in": "path", "required": True, "schema": {"type": "string", "format": "uuid"}}]
        query_properties = {key: value for key, value in command["input_schema"]["properties"].items() if key != "id"}
        if command["method"] == "GET" and query_properties:
            operation["parameters"] = operation.get("parameters", []) + [
                {"name": key, "in": "query", "required": key in command["input_schema"].get("required", []), "schema": value}
                for key, value in query_properties.items()]
        elif command["method"] in ("POST", "PATCH"):
            body_schema = {**command["input_schema"],
                           "properties": {key: value for key, value in command["input_schema"]["properties"].items() if key != "id"},
                           "required": [key for key in command["input_schema"].get("required", []) if key != "id"]}
            operation["requestBody"] = {"required": bool(body_schema["required"]), "content": {"application/json": {"schema": body_schema}}}
        paths.setdefault(path, {})[command["method"].lower()] = operation
    from . import config, http_server
    for method, pattern, handler, summary, human_only in http_server.ROUTES:
        # The typed command registry supplies these operations, keeping their MCP and OpenAPI definitions aligned.
        if pattern.pattern.startswith(("/api/agent/", "/api/jobs/", "/api/openapi.json")):
            continue
        for path in _paths(pattern):
            params = re.findall(r"\{([^}]+)\}", path)
            operation_id = handler.__name__ + "_" + method.lower() + "_" + re.sub(r"[^A-Za-z0-9]+", "_", path).strip("_")
            operation = {"operationId": operation_id, "summary": summary, "security": [{"LocalKey": []}],
                         "responses": {"200": {"description": "Structured result"}}}
            if params:
                operation["parameters"] = [{"name": key, "in": "path", "required": True, "schema": {"type": "string"}}
                                            for key in params]
            if method in ("POST", "PATCH", "PUT"):
                operation["requestBody"] = {"required": True, "content": {"application/json": {"schema": {"type": "object"}}}}
            if human_only:
                operation["x-human-only"] = True
            paths.setdefault(path, {})[method.lower()] = operation
    return {"openapi": "3.1.0", "info": {"title": "ApplyDock Agent API", "version": "1.0.0"},
            "servers": [{"url": http_server._public_origin() or f"http://{config.HOST}:{config.PORT}"}], "components": {"securitySchemes": {
                "LocalKey": {"type": "apiKey", "in": "header", "name": "X-Local-Key"}}}, "paths": paths}


def build_agent():
    """OpenAPI document limited to the typed, preparation-only API used by GPT Actions."""
    spec = build()
    allowed = {(command["path"], command["method"].lower()) for command in COMMANDS.values()}
    spec["paths"] = {path: {method: operation for method, operation in methods.items() if (path, method) in allowed}
                      for path, methods in spec["paths"].items() if any((path, method) in allowed for method in methods)}
    return spec
