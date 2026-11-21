import json

import httpx
import pytest
from sqlalchemy import select

from app.ai.client import LLMGateway, OllamaClient
from app.ai.tasks import bank_candidates, generate_question, generate_remediation_plan
from app.core.config import Settings
from app.models import Question
from app.models.enums import QuestionStatus
from app.schemas.learning import FocusBrief, QuestionDraft
from app.models import User
from conftest import register

PRIMARY, SECONDARY = "qwen3.5:9b", "qwen3.5:4b"
ALLOWED = {"M_OFF_BY_ONE", "M_TRACE"}


def draft():
    from test_api import make_question

    payload = make_question("la génération", mapped=True)
    return {key: value for key, value in payload.items() if key not in {"role", "target_misconception_code"}}


def make_gateway(api, handler, *, demo=False, enabled=True):
    settings = Settings(_env_file=None, llm_enabled=enabled, demo_mode=demo, model_backend="ollama",
                        llm_fallback_model=SECONDARY, llm_max_retries=1)

    def transport(request):
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": SECONDARY}]})
        return handler(request)

    http = httpx.Client(base_url=settings.llm_base_url, transport=httpx.MockTransport(transport))
    return LLMGateway(OllamaClient(http, settings), settings, api.app.state.sessions), http


def generate(gateway, bank=(), fixture=None):
    return generate_question(
        gateway, concept_code="C_INDEXING", course_excerpt="Les indices commencent à zéro.",
        brief=FocusBrief(), allowed_codes=ALLOWED, approved_items=bank,
        excluded_stems=set(), fixture=fixture,
    )


def test_model_retry_fallback_and_database_cache(api):
    attempts = []

    def respond(request):
        assert request.url.path == "/api/chat"
        body = json.loads(request.content)
        attempts.append(body["model"])
        assert body["stream"] is False and body["think"] is False
        assert body["format"]["title"] == "QuestionDraft"
        content = "invalid JSON" if body["model"] == PRIMARY else json.dumps(draft())
        return httpx.Response(200, json={"message": {"content": content}})

    gateway, http = make_gateway(api, respond)
    with http:
        result = generate(gateway)
        assert (result.source, result.model) == ("llm", SECONDARY)
        assert attempts == [PRIMARY, PRIMARY, SECONDARY]
        cached = generate(gateway)
        assert (cached.source, cached.model) == ("cache", SECONDARY)
        assert attempts.count(SECONDARY) == 1


@pytest.mark.parametrize("failure", ["unavailable", "two_correct", "wrong_taxonomy", "duplicate", "timeout"])
def test_failed_model_uses_only_approved_bank(api, failure):
    def respond(request):
        data = draft()
        if failure == "unavailable":
            return httpx.Response(404)
        if failure == "timeout":
            raise httpx.ReadTimeout("mock timeout")
        if failure == "two_correct":
            data["options"][2]["is_correct"] = True
        if failure == "wrong_taxonomy":
            data["options"][1]["misconception_code"] = "M_SCOPE"
        if failure == "duplicate":
            data["options"][2]["text"] = data["options"][0]["text"]
        return httpx.Response(200, json={"message": {"content": json.dumps(data)}})

    register(api, 'bank-reviewer', 'teacher')
    with api.app.state.sessions.begin() as db:
        teacher_id = db.scalar(select(User.id).where(User.email == 'bank-reviewer@example.com'))
        assert bank_candidates(db, "C_INDEXING", ALLOWED, set()) == []
        row = db.scalar(select(Question).where(Question.seed_key == "Q2"))
        row.status, row.validated_by = QuestionStatus.validated, teacher_id
        row.validated_at = api.app.state.system_clock.now()
    with api.app.state.sessions() as db:
        approved = bank_candidates(db, "C_INDEXING", ALLOWED, set())

    gateway, http = make_gateway(api, respond)
    with http:
        result = generate(gateway, approved)
        assert result.source == "fallback"
        assert result.value == approved[0]
        assert generate(gateway) is None


def test_demo_fixture_and_no_model_template(api):
    def unexpected(request):
        pytest.fail("The network should not be used")

    gateway, http = make_gateway(api, unexpected, demo=True, enabled=False)
    with http:
        sample = generate(gateway, fixture=draft())
        assert sample.source == "fixture"
        assert isinstance(sample.value, QuestionDraft)
        assert generate(gateway, fixture={"invalid": True}) is None
        result = generate_remediation_plan(
            gateway, misconception_label="Indices", hint="Tracer les indices.",
            group_size=3, course_excerpt="Indices de listes.",
        )
        assert result.source == "fallback"
        assert sum(step.end_min - step.start_min for step in result.value.steps) == 10
