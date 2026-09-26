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


def _clean_trailing_commas(s: str) -> str:
    """Removes trailing commas before closing braces/brackets outside string literals."""
    res = []
    in_str = False
    esc = False
    last_comma_idx = -1
    for c in s:
        if in_str:
            res.append(c)
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
                last_comma_idx = -1
                res.append(c)
            elif c == ",":
                last_comma_idx = len(res)
                res.append(c)
            elif c in ("}", "]"):
                if last_comma_idx != -1 and all(ch.isspace() for ch in res[last_comma_idx + 1 :]):
                    res.pop(last_comma_idx)
                last_comma_idx = -1
                res.append(c)
            else:
                if not c.isspace():
                    last_comma_idx = -1
                res.append(c)
    return "".join(res)


def _try_parse_object(s: str) -> dict | None:
    try:
        v = json.loads(s)
        if isinstance(v, dict):
            return v
    except json.JSONDecodeError:
        pass

    try:
        cleaned = _clean_trailing_commas(s)
        v = json.loads(cleaned)
        if isinstance(v, dict):
            return v
    except json.JSONDecodeError:
        pass

    return None


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


def extract_json_candidates(raw: str, target_keys: set[str] | None = None) -> list[dict]:
    """
    Extracts all candidate JSON objects from model reply: bare, fenced, or buried in prose.
    Prioritizes outer objects over nested sub-objects and sorts by target key relevance.
    """
    text = _THINK_RE.sub("", raw).strip()
    candidates: list[dict] = []
    seen: set[str] = set()

    def _add_candidate(cand: Any) -> None:
        if isinstance(cand, dict):
            key_repr = json.dumps(cand, sort_keys=True, default=str)
            if key_repr not in seen:
                seen.add(key_repr)
                candidates.append(cand)
        elif isinstance(cand, list):
            for item in cand:
                if isinstance(item, dict):
                    key_repr = json.dumps(item, sort_keys=True, default=str)
                    if key_repr not in seen:
                        seen.add(key_repr)
                        candidates.append(item)

    # 1. Whole text parse
    whole = _try_parse_object(text)
    if whole is not None:
        _add_candidate(whole)
    else:
        # Check if whole text is a list
        try:
            parsed_list = json.loads(text)
            _add_candidate(parsed_list)
        except Exception:
            try:
                parsed_list = json.loads(_clean_trailing_commas(text))
                _add_candidate(parsed_list)
            except Exception:
                pass

    # 2. Markdown code fences
    for m in _FENCE_RE.finditer(text):
        fenced_str = m.group(1).strip()
        fenced = _try_parse_object(fenced_str)
        if fenced is not None:
            _add_candidate(fenced)
        else:
            try:
                parsed_list = json.loads(fenced_str)
                _add_candidate(parsed_list)
            except Exception:
                try:
                    parsed_list = json.loads(_clean_trailing_commas(fenced_str))
                    _add_candidate(parsed_list)
                except Exception:
                    pass

    # 3. Scan for balanced { ... } blocks
    i = text.find("{")
    while i != -1:
        end = _balanced_end(text, i)
        if end != -1:
            found = _try_parse_object(text[i : end + 1])
            if found is not None:
                _add_candidate(found)
                # When an outer object successfully parses, skip past its end to avoid
                # treating its nested children (like options) as separate top-level objects.
                i = text.find("{", end + 1)
                continue
        i = text.find("{", i + 1)

    if not candidates:
        return []

    # Sort candidates by relevance: target_keys match count (descending), then total key count (descending)
    def _rank(c: dict) -> tuple[int, int]:
        matches = sum(1 for k in target_keys if k in c) if target_keys else 0
        return (matches, len(c))

    return sorted(candidates, key=_rank, reverse=True)


def extract_json_object(raw: str, target_keys: set[str] | None = None) -> dict:
    """Pull the best JSON object out of a model reply: bare, fenced, or buried in prose."""
    candidates = extract_json_candidates(raw, target_keys=target_keys)
    if candidates:
        return candidates[0]
    raise JsonExtractError("No JSON object found in the reply")


def _repair_prompt(name: str, errors: list[str], target_keys: set[str] | None = None) -> str:
    lines = [f"Your previous reply was not a valid {name} object. Problems:"]
    lines += [f"- {e}" for e in errors]
    if target_keys:
        lines.append(f"Required fields for {name}: {', '.join(sorted(target_keys))}")
    lines.append("Reply again with ONLY one corrected JSON object. No prose, no code fences, no trailing commas.")
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
    target_keys = set(model_cls.model_fields.keys())

    for attempt in range(max_repairs + 1):
        res = await call_llm(tier, msgs, temperature, max_tokens)

        errors: list[str] = []
        candidates = extract_json_candidates(res["content"], target_keys=target_keys)

        if not candidates:
            errors = ["No JSON object found in the reply"]
        else:
            # Try each extracted candidate in priority order
            for cand in candidates:
                try:
                    value = model_cls.model_validate(cand)
                    extra_errors = extra_check(value) if extra_check else []
                    if not extra_errors:
                        return value
                    errors = extra_errors
                except ValidationError as e:
                    errors = [err["msg"] + f" (at {'.'.join(str(p) for p in err['loc'])})" for err in e.errors()]

        last_errors = errors
        msgs = msgs + [
            {"role": "assistant", "content": res["content"]},
            {"role": "user", "content": _repair_prompt(model_cls.__name__, errors, target_keys=target_keys)},
        ]

    raise LlmOutputError(model_cls.__name__, max_repairs + 1, last_errors)
