"""Native Gemini Developer API adapters. Only the backend holds the key."""
from functools import lru_cache
import logging
from math import isfinite
from time import monotonic
from typing import Sequence

import httpx

from app.ai.client import ModelConfigurationError, ModelRequestFailed, Messages
from app.core.config import Settings
from app.documents.llm import VISION_INSTRUCTION, VisionPage
from app.models.documents import EMBEDDING_DIM

logger = logging.getLogger(__name__)


class GeminiClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.sdk = None

    @lru_cache(maxsize=1)
    def _client(self):
        key = self.settings.gemini_api_key
        if key is None or not key.get_secret_value().strip():
            raise ModelConfigurationError("Configurez GEMINI_API_KEY dans l’environnement de l’API.")
        from google import genai
        from google.genai import types

        self.sdk = genai.Client(api_key=key.get_secret_value(), vertexai=False, http_options=types.HttpOptions(
            timeout=int(self.settings.llm_timeout_s * 1000),
            client_args={"trust_env": False},
            retry_options=types.HttpRetryOptions(
                attempts=self.settings.llm_max_retries + 1,
                initial_delay=1, max_delay=8, http_status_codes=[429, 500, 502, 503, 504],
            ),
        ))
        return self.sdk

    def close(self):
        if self.sdk is not None:
            self.sdk.close()
        self._client.cache_clear()
        self._metadata.cache_clear()

    def call(self, method, **kwargs):
        client = self._client()
        from google.genai import errors

        try:
            return getattr(client.models, method)(**kwargs)
        except errors.APIError as exc:
            details = exc.details if isinstance(exc.details, dict) else {}
            details = details.get("error", details)
            rows = details.get("details") if isinstance(details, dict) else None
            reasons = {row.get("reason") for row in rows or [] if isinstance(row, dict)}
            if exc.code in (401, 403) or "API_KEY_INVALID" in reasons:
                raise ModelConfigurationError("Vérifiez la clé Gemini et les autorisations du projet Google.") from None
            if exc.code == 404:
                raise ModelConfigurationError("Le modèle Gemini configuré est indisponible pour ce compte.") from None
            logger.info("gemini request=%s status=%s", method, exc.code)
            raise ModelRequestFailed(f"gemini_http_{exc.code}") from None
        except httpx.HTTPError:
            raise ModelRequestFailed("gemini_transport_error") from None

    @lru_cache(maxsize=16)
    def _metadata(self, model: str, minute: int):
        return self.call("get", model=model)

    def model_info(self, model: str):
        return self._metadata(model, int(monotonic()) // 60)

    def available(self, model: str) -> bool:
        try:
            return bool(self.model_info(model))
        except (ModelConfigurationError, ModelRequestFailed):
            return False

    def cache_revision(self, model: str) -> str:
        info = self.model_info(model)
        return f"{info.name or model}@{info.version or ''}"

    def structured(self, model, contents, schema, *, system, temperature):
        start = monotonic()
        response = self.call("generate_content", model=model, contents=contents, config={
            "system_instruction": system or None,
            "response_mime_type": "application/json",
            "response_json_schema": schema,
            "temperature": temperature,
        })
        usage = response.usage_metadata
        logger.info("gemini model=%s input_tokens=%s output_tokens=%s elapsed_ms=%d", model,
                    getattr(usage, "prompt_token_count", None), getattr(usage, "candidates_token_count", None),
                    (monotonic() - start) * 1000)
        if not response.text or not response.candidates or response.candidates[0].finish_reason != "STOP":
            raise ValueError("gemini_incomplete_output")
        return response.text

    def generate_json(self, model: str, messages: Messages, schema: dict) -> str:
        self._client()
        from google.genai import types

        system = "\n\n".join(message["content"] for message in messages if message["role"] == "system")
        contents = [
            types.Content(role="model" if message["role"] == "assistant" else "user",
                          parts=[types.Part(text=message["content"])])
            for message in messages if message["role"] != "system"
        ]
        return self.structured(model, contents, schema, system=system, temperature=self.settings.llm_temperature)


class GeminiDocumentModels:
    def __init__(self, client: GeminiClient):
        self.client = client
        self.settings = client.settings

    def revision(self) -> str:
        model = self.settings.embedding_model
        version = self.client.cache_revision(model)
        override = self.settings.embedding_revision or ""
        return f"gemini:{version}:{EMBEDDING_DIM}:retrieval-v1:{override}"

    def embed(self, texts: Sequence[str], revision: str, *, query=False) -> list[list[float]]:
        if self.revision() != revision:
            raise ValueError("embedding_model_changed")
        if not texts:
            return []
        from google.genai import types

        prefix = "task: search result | query: " if query else "title: none | text: "
        result = self.client.call("embed_content", model=self.settings.embedding_model,
                                  contents=[types.Content(parts=[types.Part(text=prefix + text)]) for text in texts],
                                  config={"output_dimensionality": EMBEDDING_DIM})
        values = [row.values for row in result.embeddings or []]
        if len(values) != len(texts) or any(
            vector is None or len(vector) != EMBEDDING_DIM or not all(isfinite(x) for x in vector)
            or not any(vector) for vector in values
        ):
            raise ValueError("embedding_response_invalid")
        return values

    def transcribe(self, image: bytes) -> VisionPage:
        self.client._client()
        from google.genai import types

        contents = ["Transcribe the attached page literally.", types.Part.from_bytes(data=image, mime_type="image/png")]
        raw = self.client.structured(self.settings.document_vision_model, contents, VisionPage.model_json_schema(),
                                     system=VISION_INSTRUCTION, temperature=0)
        return VisionPage.model_validate_json(raw)
