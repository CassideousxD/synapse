from __future__ import annotations

import json
import re
from typing import Awaitable, Callable, TypeVar

from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)

# Defensive: some reasoning models wrap their thinking in <think> tags. Braces in there confuse extraction.
_THINK_RE = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)
_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


class JsonExtractError(Exception):
    pass


class LlmOutputError(Exception):
    def __init__(self, schema_name: str, attempts: int, errors: list[str]):
        super().__init__(f"Model output failed {schema_name} validation after {attempts} attempt(s): {'; '.join(errors)}")
        self.schema_name = schema_name
        self.attempts = attempts
        self.errors = errors


def _try_parse_object(s: str) -> dict | None:
    try:
        v = json.loads(s)
    except json.JSONDecodeError:
        return None
    return v if isinstance(v, dict) else None


def _balanced_end(text: str, start: int) -> int:
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        c = text[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i
    return -1


def extract_json_object(raw: str) -> dict:
    """Pull the first JSON object out of a model reply: bare, fenced, or buried in prose."""
    text = _THINK_RE.sub("", raw).strip()

    whole = _try_parse_object(text)
    if whole is not None:
        return whole

    for m in _FENCE_RE.finditer(text):
        fenced = _try_parse_object(m.group(1).strip())
        if fenced is not None:
            return fenced

    i = text.find("{")
    while i != -1:
        end = _balanced_end(text, i)
        if end != -1:
            found = _try_parse_object(text[i : end + 1])
            if found is not None:
                return found
        i = text.find("{", i + 1)
    raise JsonExtractError("No JSON object found in the reply")


def _repair_prompt(name: str, errors: list[str]) -> str:
    lines = [f"Your previous reply was not a valid {name} object. Problems:"]
    lines += [f"- {e}" for e in errors]
    lines.append("Reply again with ONLY one corrected JSON object. No prose, no code fences.")
    return "\n".join(lines)


async def call_json(
    call_llm: Callable[[str, list[dict], float | None, int | None], Awaitable[dict]],
    tier: str,
    messages: list[dict],
    model_cls: type[T],
    max_repairs: int = 1,
    temperature: float = 0,
    max_tokens: int | None = None,
    extra_check: Callable[[T], list[str]] | None = None,
) -> T:
    """Ask the model for a JSON object and return it validated. Mirrors packages/student-ai/src/json.ts."""
    msgs = list(messages)
    last_errors: list[str] = []

    for attempt in range(max_repairs + 1):
        res = await call_llm(tier, msgs, temperature, max_tokens)

        errors: list[str]
        try:
            obj = extract_json_object(res["content"])
            value = model_cls.model_validate(obj)
            extra_errors = extra_check(value) if extra_check else []
            if not extra_errors:
                return value
            errors = extra_errors
        except JsonExtractError as e:
            errors = [str(e)]
        except ValidationError as e:
            errors = [err["msg"] + f" (at {'.'.join(str(p) for p in err['loc'])})" for err in e.errors()]

        last_errors = errors
        msgs = msgs + [
            {"role": "assistant", "content": res["content"]},
            {"role": "user", "content": _repair_prompt(model_cls.__name__, errors)},
        ]

    raise LlmOutputError(model_cls.__name__, max_repairs + 1, last_errors)
