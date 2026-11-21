"""Select the configured backend for structured generation and document models."""

from base64 import b64encode
from functools import lru_cache
import logging
from math import isfinite
from time import monotonic
from typing import Sequence

import httpx

from app.ai.client import LLMClient, Messages, OllamaClient
from app.core.config import Settings
from app.documents.llm import (
    EMBEDDING_QUERY_PREFIX, VISION_INSTRUCTION, DocumentModels, OllamaDocumentModels, VisionPage,
)
from app.models.documents import EMBEDDING_DIM

logger = logging.getLogger("uvicorn.error").getChild("neurvia.serving")


def model_http(settings: Settings, *, connect: float = 3) -> httpx.Client:
    headers = {}
    if settings.model_api_key:
        headers["Authorization"] = "Bearer " + settings.model_api_key.get_secret_value()
    return httpx.Client(
        base_url=settings.llm_base_url, trust_env=False, headers=headers,
        timeout=httpx.Timeout(settings.llm_timeout_s, connect=min(connect, settings.llm_timeout_s)),
    )


def model_clients(http: httpx.Client, settings: Settings) -> tuple[LLMClient, DocumentModels]:
    if settings.model_backend == "gemini":
        from app.ai.gemini import GeminiClient, GeminiDocumentModels

        gemini = GeminiClient(settings)
        return gemini, GeminiDocumentModels(gemini)
    if settings.model_backend == "openai":
        return OpenAICompatibleClient(http, settings), OpenAICompatibleDocumentModels(http, settings)
    return OllamaClient(http, settings), OllamaDocumentModels(http, settings)


def served_models(http: httpx.Client) -> set[str]:
    return {item["id"] for item in http.get("/v1/models", timeout=8).raise_for_status().json()["data"]}


def completion(http, payload) -> tuple[str, dict]:
    response = http.post("/v1/chat/completions", json=payload).raise_for_status().json()
    try:
        choice = response["choices"][0]
        content = choice["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise ValueError("Malformed chat completion") from None
    if not isinstance(content, str) or choice.get("finish_reason") == "length":
        raise ValueError("Incomplete structured output")
    return content, response.get("usage") or {}


def json_format(schema: dict) -> dict:
    return {"type": "json_schema", "json_schema": {"name": "neurvia_output", "schema": schema}}


class OpenAICompatibleClient:
    def __init__(self, http: httpx.Client, settings: Settings):
        self.http = http
        self.settings = settings

    def available(self, model: str) -> bool:
        try:
            return model in served_models(self.http)
        except (ValueError, KeyError, TypeError, httpx.HTTPError):
            return False

    def generate_json(self, model: str, messages: Messages, schema: dict) -> str:
        settings = self.settings
        start = monotonic()
        content, usage = completion(self.http, {
            "model": model, "messages": messages, "response_format": json_format(schema),
            "temperature": settings.llm_temperature, "top_p": settings.llm_top_p, "top_k": settings.llm_top_k,
            # Qwen chat templates read this flag; other servers ignore unknown template arguments.
            "chat_template_kwargs": {"enable_thinking": settings.llm_think},
        })
        logger.info("openai model=%s prompt_tokens=%s completion_tokens=%s inference_ms=%d", model,
                    usage.get("prompt_tokens"), usage.get("completion_tokens"), (monotonic() - start) * 1000)
        return content


class OpenAICompatibleDocumentModels:
    """Embeddings and page transcription over the OpenAI-compatible API.

    These servers expose no weight digest, so the index revision is `openai:<model>` plus the operator's
    `EMBEDDING_REVISION`. Change that value whenever the served weights change, then reindex.
    """

    def __init__(self, http: httpx.Client, settings: Settings):
        self.http = http
        self.settings = settings

    @lru_cache(maxsize=2)
    def _revision(self, minute: int) -> str:
        del minute
        model = self.settings.embedding_model
        if model not in served_models(self.http):
            raise LookupError("embedding_model_unavailable")
        suffix = f"@{self.settings.embedding_revision}" if self.settings.embedding_revision else ""
        return f"openai:{model}{suffix}"

    def revision(self) -> str:
        return self._revision(int(monotonic()) // 30)

    def embed(self, texts: Sequence[str], revision: str, *, query=False) -> list[list[float]]:
        if self.revision() != revision:
            raise ValueError("embedding_model_changed")
        if not texts:
            return []
        prompts = [EMBEDDING_QUERY_PREFIX + text if query else text for text in texts]
        response = self.http.post("/v1/embeddings", json={
            "model": self.settings.embedding_model, "input": prompts, "dimensions": EMBEDDING_DIM,
        }).raise_for_status().json()
        rows = sorted(response["data"], key=lambda row: row["index"])
        values = [row["embedding"] for row in rows]
        if len(values) != len(prompts) or any(
            len(vector) != EMBEDDING_DIM or not all(isfinite(value) for value in vector) or not any(vector)
            for vector in values
        ):
            raise ValueError("embedding_response_invalid")
        return values

    def transcribe(self, image: bytes) -> VisionPage:
        model = self.settings.document_vision_model
        start = monotonic()
        content, usage = completion(self.http, {
            "model": model, "temperature": 0, "max_tokens": 2400,
            "response_format": json_format(VisionPage.model_json_schema()),
            "chat_template_kwargs": {"enable_thinking": False},
            "messages": [
                {"role": "system", "content": VISION_INSTRUCTION},
                {"role": "user", "content": [
                    {"type": "text", "text": "Transcribe the attached page literally."},
                    {"type": "image_url", "image_url": {
                        "url": "data:image/png;base64," + b64encode(image).decode("ascii")}},
                ]},
            ],
        })
        logger.info("document_vision model=%s input_tokens=%s output_tokens=%s elapsed_ms=%d", model,
                    usage.get("prompt_tokens"), usage.get("completion_tokens"), (monotonic() - start) * 1000)
        return VisionPage.model_validate_json(content)
