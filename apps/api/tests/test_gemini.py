import base64
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from google import genai
from sqlalchemy import select

from app.ai.client import Generation, ModelConfigurationError, ModelRequestFailed
from app.ai.gemini import GeminiClient, GeminiDocumentModels
from app.ai.serving import model_clients, model_http
from app.core.config import Settings
from app.main import create_app
from app.models import Answer, Attempt, Membership, Quiz, User
from app.models.documents import EMBEDDING_DIM
from app.services.difficulty_assistance import Classification, classify
from app.services.demo_seed import CLASSROOM_ID, DEMO_PASSWORD, INITIAL_QUIZ_ID, LESSON_ID, STUDENT_IDS
from conftest import call, login, register


def test_default_provider_requires_explicit_key():
    settings = Settings(_env_file=None, gemini_api_key=None)
    assert settings.model_backend == "gemini" and settings.llm_enabled
    with model_http(settings) as http:
        client, docs = model_clients(http, settings)
        assert isinstance(client, GeminiClient) and isinstance(docs, GeminiDocumentModels)
        with pytest.raises(ModelConfigurationError, match="GEMINI_API_KEY"):
            client.generate_json(settings.llm_model, [{"role": "user", "content": "test"}], {})


@pytest.fixture
def gemini(monkeypatch):
    original = genai.Client
    requests = []
    replies = []

    def respond(request):
        assert request.url.host == "generativelanguage.googleapis.com"
        assert request.headers["x-goog-api-key"] == "test-key"
        assert "test-key" not in str(request.url)
        requests.append(request)
        status, payload = replies.pop(0)
        return httpx.Response(status, json=payload)

    def client(**kwargs):
        options = kwargs["http_options"]
        options.client_args["transport"] = httpx.MockTransport(respond)
        options.retry_options.initial_delay = 0
        return original(**kwargs)

    monkeypatch.setattr(genai, "Client", client)
    provider = GeminiClient(Settings(_env_file=None, gemini_api_key="test-key", llm_max_retries=1))
    yield provider, requests, replies
    provider.close()


def completion(value):
    return {
        "candidates": [{"finishReason": "STOP", "content": {"role": "model",
                        "parts": [{"text": json.dumps(value)}]}}],
        "usageMetadata": {"promptTokenCount": 42, "candidatesTokenCount": 10},
    }


def test_structured_quota_retry_and_invalid_credentials(gemini):
    client, requests, replies = gemini
    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}
    messages = [{"role": "system", "content": "Rules"}, {"role": "user", "content": "Input"}]
    args = (client.settings.llm_model, messages, schema)
    quota = (429, {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "quota"}})
    replies.extend([quota, (200, completion({"ok": True}))])
    assert json.loads(client.generate_json(*args)) == {"ok": True}
    assert len(requests) == 2
    body = json.loads(requests[-1].content)
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert body["generationConfig"]["responseJsonSchema"] == schema
    replies.extend([quota, quota])
    with pytest.raises(ModelRequestFailed, match="429"):
        client.generate_json(*args)
    replies.append((400, {"error": {"code": 400, "status": "INVALID_ARGUMENT",
                                    "details": [{"reason": "API_KEY_INVALID"}], "message": "test-key"}}))
    with pytest.raises(ModelConfigurationError) as failure:
        client.generate_json(*args)
    assert "test-key" not in str(failure.value) and len(requests) == 5


def test_transcription_and_separate_dimension_checked_embeddings(gemini):
    client, requests, replies = gemini
    docs = GeminiDocumentModels(client)
    replies.extend([
        (200, completion({"blocks": [{"kind": "text", "bounds": [0, 0, 1, 1], "text": "[illisible]"}]})),
        (200, {"name": "models/gemini-embedding-2", "version": "2"}),
        (200, {"embeddings": [{"values": [1.0] * EMBEDDING_DIM}, {"values": [2.0] * EMBEDDING_DIM}]}),
        (200, {"embeddings": [{"values": [1.0]}]}),
    ])
    assert docs.transcribe(b"test-page").blocks[0].text == "[illisible]"
    parts = json.loads(requests[0].content)["contents"][0]["parts"]
    assert parts[1]["inlineData"]["mime_type"] == "image/png"
    assert base64.b64decode(parts[1]["inlineData"]["data"]) == b"test-page"
    revision = docs.revision()
    assert revision.startswith("gemini:models/gemini-embedding-2@2:1024:")
    assert [vector[0] for vector in docs.embed(["first", "second"], revision)] == [1.0, 2.0]
    body = json.loads(requests[-1].content)
    assert len(body["requests"]) == 2
    assert all(item["outputDimensionality"] == EMBEDDING_DIM for item in body["requests"])
    with pytest.raises(ValueError, match="embedding_model_changed"):
        docs.embed(["first"], "qwen@old")
    with pytest.raises(ValueError, match="embedding_response_invalid"):
        docs.embed(["first"], revision)


def test_teacher_assistance_abstains_and_validates_taxonomy():
    class Gateway:
        settings = Settings(_env_file=None)

        def generate(self, task, messages, schema, *, check, fallback, model_override):
            assert task == "classify_difficulty" and model_override == "gemini-3.5-flash-lite"
            assert "confirmée" in messages[0]["content"]
            unsupported = schema.model_validate({
                "hypotheses": [{"item": 1, "misconception_code": "invented", "rationale": "Donnée invalide"}],
            })
            with pytest.raises(ValueError, match="invalid_difficulty_hypothesis"):
                check(unsupported)
            result = Classification.model_validate({
                "hypotheses": [{"item": 1, "misconception_code": None, "rationale": None}],
            })
            check(result)
            return Generation(result, "llm", model_override)

    result = classify(Gateway(), [{
        "item": 1, "question": "Quel indice ?", "selected_option": "1", "objective": "Indices",
        "confidence": "medium", "taxonomy": {"M_OFF_BY_ONE": "Décalage"},
    }])
    assert result.model and result.evidence[0].misconception_label is None
    assert result.evidence[0].selected_option == "1"


def test_teacher_assistance_respects_classroom_and_redacts_account_data(database_url):
    settings = Settings(_env_file=None, database_url=database_url, demo_mode=True, gemini_api_key=None)
    with TestClient(create_app(settings)) as api:
        teacher = login(api, "prof.fahm@example.com", DEMO_PASSWORD)
        outsider = register(api, "other-teacher", "teacher")
        with api.app.state.sessions.begin() as db:
            user = db.get(User, STUDENT_IDS[2])
            attempt = db.scalar(select(Attempt).join(Quiz).where(
                Attempt.student_id == user.id, Quiz.id == INITIAL_QUIZ_ID,
            ))
            answer = db.scalar(select(Answer).where(
                Answer.attempt_id == attempt.id, Answer.is_correct.is_(False),
            ).limit(1))
            answer.justification = f"{user.full_name} {user.email} : j’ai compté depuis un."
            member_id = db.scalar(select(Membership.id).where(
                Membership.user_id == user.id, Membership.classroom_id == CLASSROOM_ID,
            ))
            account_name, account_email = user.full_name, user.email
        route = f"/lessons/{LESSON_ID}/members/{member_id}/difficulty-assistance"
        call(api, "POST", route, outsider, expected=404)
        failure = call(api, "POST", route, teacher, expected=503)
        assert failure["error"]["code"] == "MODEL_CONFIGURATION_ERROR"

        class Gateway:
            def generate(self, task, messages, schema, *, check, fallback, model_override):
                payload = messages[-1]["content"]
                assert account_name not in payload and account_email not in payload
                assert "j’ai compté depuis un." in payload
                return Generation(schema(hypotheses=[]), "llm", model_override)

        gateway = Gateway()
        gateway.settings = settings
        api.app.state.gateway = gateway
        result = call(api, "POST", route, teacher)
        assert result["evidence"] and all(not row["misconception_label"] for row in result["evidence"])
