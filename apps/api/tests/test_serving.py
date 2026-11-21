"""The OpenAI-compatible backend (vLLM, llama.cpp server, …) against an in-process fake server."""

import json

import httpx
import pytest

from app.ai.client import OllamaClient
from app.ai.serving import OpenAICompatibleClient, OpenAICompatibleDocumentModels, model_clients, model_http
from app.core.config import Settings
from app.documents.llm import EMBEDDING_QUERY_PREFIX, OllamaDocumentModels

DIM = 1024


def settings(**values):
    return Settings(_env_file=None, model_backend="openai", llm_base_url="http://vllm.internal:8000",
                    model_api_key="serving-token", embedding_model="Qwen/Qwen3-Embedding-0.6B",
                    llm_model="Qwen/Qwen3.5-9B", document_vision_model="Qwen/Qwen3.5-9B", **values)


class FakeServer:
    def __init__(self):
        self.requests = []
        self.finish_reason = "stop"
        self.models = ["Qwen/Qwen3.5-9B", "Qwen/Qwen3-Embedding-0.6B"]

    def __call__(self, request: httpx.Request):
        body = json.loads(request.content) if request.content else None
        self.requests.append((request.method, request.url.path, request.headers.get("authorization"), body))
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": name} for name in self.models]})
        if request.url.path == "/v1/embeddings":
            # Out of order on purpose: clients must sort by index.
            rows = [{"index": index, "embedding": [float(index + 1)] * DIM} for index in range(len(body["input"]))]
            return httpx.Response(200, json={"data": list(reversed(rows))})
        if request.url.path == "/v1/chat/completions":
            content = (json.dumps({"blocks": [{"kind": "text", "bounds": [0.1, 0.1, 0.9, 0.3], "text": "Index: 0"}]})
                       if isinstance(body["messages"][-1]["content"], list) else json.dumps({"answer": "ok"}))
            return httpx.Response(200, json={
                "choices": [{"message": {"content": content}, "finish_reason": self.finish_reason}],
                "usage": {"prompt_tokens": 11, "completion_tokens": 7},
            })
        return httpx.Response(404)


@pytest.fixture
def server():
    return FakeServer()


def http_for(server, config):
    client = model_http(config)
    client._transport = httpx.MockTransport(server)
    return client


def test_backend_selection():
    with httpx.Client() as http:
        llm, docs = model_clients(http, Settings(_env_file=None, model_backend="ollama"))
        assert isinstance(llm, OllamaClient) and isinstance(docs, OllamaDocumentModels)
        llm, docs = model_clients(http, settings())
        assert isinstance(llm, OpenAICompatibleClient) and isinstance(docs, OpenAICompatibleDocumentModels)


def test_structured_chat_uses_json_schema_and_bearer_token(server):
    config = settings()
    with http_for(server, config) as http:
        client = OpenAICompatibleClient(http, config)
        assert client.available("Qwen/Qwen3.5-9B") and not client.available("missing")
        schema = {"type": "object", "properties": {"answer": {"type": "string"}}}
        assert json.loads(client.generate_json("Qwen/Qwen3.5-9B", [{"role": "user", "content": "x"}], schema)) == {
            "answer": "ok"}
        _, path, auth, body = server.requests[-1]
        assert path == "/v1/chat/completions" and auth == "Bearer serving-token"
        assert body["response_format"] == {"type": "json_schema",
                                           "json_schema": {"name": "neurvia_output", "schema": schema}}
        assert body["chat_template_kwargs"] == {"enable_thinking": False}
        server.finish_reason = "length"
        with pytest.raises(ValueError, match="Incomplete"):
            client.generate_json("Qwen/Qwen3.5-9B", [{"role": "user", "content": "x"}], schema)


def test_embeddings_are_ordered_validated_and_versioned(server):
    config = settings(embedding_revision="2026-11-weights")
    with http_for(server, config) as http:
        models = OpenAICompatibleDocumentModels(http, config)
        revision = models.revision()
        assert revision == "openai:Qwen/Qwen3-Embedding-0.6B@2026-11-weights"
        vectors = models.embed(["a", "b"], revision)
        assert [vector[0] for vector in vectors] == [1.0, 2.0]
        models.embed(["question"], revision, query=True)
        assert server.requests[-1][3]["input"] == [EMBEDDING_QUERY_PREFIX + "question"]
        assert server.requests[-1][3]["dimensions"] == DIM
        with pytest.raises(ValueError, match="embedding_model_changed"):
            models.embed(["a"], "openai:other")


def test_missing_embedding_model_is_reported(server):
    server.models = ["Qwen/Qwen3.5-9B"]
    config = settings()
    with http_for(server, config) as http, pytest.raises(LookupError):
        OpenAICompatibleDocumentModels(http, config).revision()


def test_page_transcription_sends_the_image_as_a_data_uri(server):
    config = settings()
    with http_for(server, config) as http:
        page = OpenAICompatibleDocumentModels(http, config).transcribe(b"\x89PNG fake")
    assert page.blocks[0].text == "Index: 0"
    content = server.requests[-1][3]["messages"][-1]["content"]
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")
