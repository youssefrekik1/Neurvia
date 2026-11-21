import hashlib
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from time import perf_counter
from typing import Generic, Literal, Protocol, TypeVar

import httpx
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert

from app.core.config import Settings
from app.models import LLMCache

T = TypeVar("T", bound=BaseModel)
Task = Literal["generate_questions", "generate_remediation_plan"]
Messages = list[dict[str, str]]
logger = logging.getLogger("uvicorn.error").getChild("fahm.ai")


@dataclass(frozen=True)
class Generation(Generic[T]):
    value: T
    source: Literal["llm", "cache", "fixture", "fallback"]
    model: str | None = None


class LLMClient(Protocol):
    def available(self, model: str) -> bool: ...

    def generate_json(
        self, model: str, messages: Messages, schema: dict,
    ) -> str: ...


class OllamaClient:
    def __init__(self, http: httpx.Client, settings: Settings):
        self.http = http
        self.settings = settings

    def available(self, model: str) -> bool:
        try:
            response = self.http.get("/api/tags", timeout=3.0)
            response.raise_for_status()
            return any(item.get("name") == model for item in response.json().get("models", []))
        except (ValueError, AttributeError, httpx.HTTPError):
            return False

    def generate_json(self, model: str, messages: Messages, schema: dict) -> str:
        settings = self.settings
        response = self.http.post("/api/chat", json={
            "model": model, "messages": messages, "format": schema,
            "think": settings.llm_think, "stream": False,
            "options": {
                "temperature": settings.llm_temperature, "top_p": settings.llm_top_p,
                "top_k": settings.llm_top_k, "num_ctx": settings.llm_num_ctx,
            },
        })
        response.raise_for_status()
        payload = response.json()
        try:
            content = payload["message"]["content"]
            if not isinstance(content, str) or payload.get("done_reason") == "length":
                raise ValueError("Incomplete structured output")
        except (KeyError, TypeError):
            raise ValueError("Malformed Ollama response") from None
        duration = payload.get("total_duration")
        logger.info("ollama model=%s prompt_tokens=%s completion_tokens=%s inference_ms=%s",
                    model, payload.get("prompt_eval_count"), payload.get("eval_count"),
                    round(duration / 1_000_000) if isinstance(duration, int) else None)
        return content


def digest(value) -> str:
    data = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(data.encode()).hexdigest()


class LLMGateway:
    def __init__(self, client: LLMClient, settings: Settings, sessions):
        self.client = client
        self.settings = settings
        self.sessions = sessions

    def generate(
        self, task: Task, messages: Messages, schema: type[T], *,
        check: Callable[[T], None], fallback: Callable[[], T | None],
        fixture: dict | None = None,
    ) -> Generation[T] | None:
        if self.settings.demo_mode and fixture is not None:
            try:
                value = schema.model_validate(fixture)
                check(value)
                return Generation(value, "fixture")
            except ValueError:
                logger.warning("Invalid demo fixture for %s", task)

        if self.settings.llm_enabled:
            models = list(dict.fromkeys(filter(None, [self.settings.llm_model, self.settings.llm_fallback_model])))
            json_schema = schema.model_json_schema()
            for model in models:
                if model != self.settings.llm_model and not self.client.available(model):
                    continue
                key = {
                    "task": task, "model": model,
                    "schema_version": digest(json_schema),
                    "input_hash": digest({
                        "messages": messages, "think": self.settings.llm_think,
                        "temperature": self.settings.llm_temperature, "top_p": self.settings.llm_top_p,
                        "top_k": self.settings.llm_top_k, "num_ctx": self.settings.llm_num_ctx,
                    }),
                }
                cached = self._cached(key, schema, check)
                if cached is not None:
                    return Generation(cached, "cache", model)
                for attempt in range(self.settings.llm_max_retries + 1):
                    start = perf_counter()
                    try:
                        value = schema.model_validate_json(
                            self.client.generate_json(model, messages, json_schema)
                        )
                        check(value)
                    except (ValueError, httpx.HTTPError) as exc:
                        logger.info("llm task=%s model=%s attempt=%d ms=%.0f failure=%s",
                                    task, model, attempt + 1, (perf_counter() - start) * 1000,
                                    type(exc).__name__)
                        if isinstance(exc, httpx.ConnectError) or (
                            isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 404
                        ):
                            break
                        continue
                    self._remember(key, value)
                    logger.info("llm task=%s model=%s ms=%.0f",
                                task, model, (perf_counter() - start) * 1000)
                    return Generation(value, "llm", model)

        value = fallback()
        if value is None:
            return None
        value = schema.model_validate(value.model_dump())
        check(value)
        return Generation(value, "fallback")

    def _cached(self, key, schema: type[T], check: Callable[[T], None]) -> T | None:
        with self.sessions() as session:
            row = session.scalar(select(LLMCache).filter_by(**key))
            if row is None:
                return None
            try:
                value = schema.model_validate(row.output_json)
                check(value)
                return value
            except ValueError:
                session.delete(row)
                session.commit()
                return None

    def _remember(self, key, value: BaseModel) -> None:
        with self.sessions.begin() as session:
            session.execute(insert(LLMCache).values(
                **key, output_json=value.model_dump(mode="json"),
            ).on_conflict_do_nothing(index_elements=list(key)))
