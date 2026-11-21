"""Offline coverage for the document pipeline: storage, worker, review, retrieval, chat and grounded quizzes.

The object store, embedding/vision models and LLM gateway are deterministic fakes, so these tests need
neither Docker nor a GPU. `tools.check_documents` remains the live end-to-end exercise.
"""

import hashlib
import json
import math
import re
from datetime import timedelta
from functools import cache
from uuid import UUID

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.ai.client import Generation
from app.core.config import Settings
from app.db.base import utcnow
from app.documents.chunking import split_block
from app.documents.citations import CitationDraft, verify_citations
from app.documents.llm import VisionBlock, VisionPage
from app.documents.ranking import content_terms, fused_ranking
from app.documents.retrieval import Evidence
from app.documents.worker import run_one
from app.main import create_app
from app.models import Lesson
from app.models.documents import DocumentJob
from app.models.enums import LessonStatus
from tests.conftest import call, register
from tools.check_documents import INDEX_TEXT, digital_pdf, handwriting_scan

DIM = 1024


class MemoryStore:
    def __init__(self):
        self.objects = {}

    def ensure_bucket(self):
        pass

    def put(self, key, data, media_type):
        self.objects[key] = (bytes(data), media_type)

    def read(self, key, limit):
        data = self.objects[key][0]
        if len(data) > limit:
            raise ValueError("Object exceeds its configured size limit")
        return data

    def fetch(self, key):
        data = self.objects[key][0]
        return {"Body": data, "ContentLength": len(data)}

    @staticmethod
    def stream(result):
        yield result["Body"]


class FakeModels:
    """Hashed bag-of-words embeddings: deterministic, and close for passages sharing vocabulary."""

    def __init__(self):
        self.profile = "fake-embedding@1"
        self.failures = 0
        self.transcription = "Index: 0, 1, 2"

    def revision(self):
        return self.profile

    def embed(self, texts, revision, *, query=False):
        if revision != self.profile:
            raise ValueError("embedding_model_changed")
        if self.failures:
            self.failures -= 1
            raise httpx.ConnectError("embedding service offline")
        vectors = []
        for text in texts:
            vector = [0.0] * DIM
            vector[0] = 0.05
            for word in re.findall(r"[^\W_]{2,}", text.casefold()):
                vector[int(hashlib.sha1(word.encode()).hexdigest(), 16) % (DIM - 1) + 1] += 1.0
            norm = math.sqrt(sum(value * value for value in vector))
            vectors.append([value / norm for value in vector])
        return vectors

    def transcribe(self, image):
        return VisionPage(blocks=[VisionBlock(kind="text", bounds=(0.1, 0.2, 0.9, 0.4), text=self.transcription)])


class FakeGateway:
    """Scripted structured generation that honours the gateway contract, including `check` rejections."""

    def __init__(self):
        self.fabricate = False
        self.verdict = "supported"
        self.calls = []

    def generate(self, task, messages, schema, *, check, fallback, fixture=None, cache=True):
        payload = json.loads(messages[-1]["content"])
        self.calls.append((task, payload))
        value = getattr(self, task)(payload)
        try:
            parsed = schema.model_validate(value)
            check(parsed)
        except ValueError:
            return None
        return Generation(parsed, "llm", "fake")

    def quote(self, payload):
        passage = payload["passages"][0]
        if self.fabricate:
            return {"source": passage["source"], "quote": "an invented sentence absent from every page"}
        return {"source": passage["source"], "quote": " ".join(passage["passage"].split()[:9])}

    def course_chat(self, payload):
        return {"answer": "Le dernier indice valide est len(values) - 1.", "citations": [self.quote(payload)]}

    def course_verify(self, payload):
        return {"verdict": self.verdict}

    def course_brief(self, payload):
        return {**payload["existing"], "focus_topics": ["last valid index", "IndexError"], "question_count": 1}

    def course_question(self, payload):
        codes = sorted(payload["taxonomy"])
        options = [{"text": "len(values) - 1", "is_correct": True, "misconception_code": None}]
        options += [{"text": text, "is_correct": False, "misconception_code": codes[index % len(codes)]}
                    for index, text in enumerate(["len(values)", "1", "values[-0]"])]
        return {
            "question": {"concept_code": payload["concept"]["code"],
                         "stem": "Quel est le dernier indice positif valide de la liste values ?",
                         "options": options, "explanation": "Les indices commencent Ã  zÃ©ro.", "difficulty": 1},
            "objective": "Identifier le dernier indice valide dâ€™une liste.",
            "citations": [self.quote(payload)],
        }


@pytest.fixture
def env(tmp_path):
    settings = Settings(_env_file=None, database_url=f"sqlite:///{(tmp_path / 'documents.db').as_posix()}",
                        llm_enabled=True, document_tesseract="neurvia-missing-tesseract",
                        document_max_upload_mb=8)
    with TestClient(create_app(settings)) as client:
        state = client.app.state
        state.object_store, state.document_models, state.gateway = MemoryStore(), FakeModels(), FakeGateway()
        yield client


def drain(client):
    state = client.app.state
    while run_one(state.sessions, state.object_store, state.document_models, state.settings):
        pass


def classroom_lesson(client, teacher, name="Indexation", concepts=("C_INDEXING",)):
    room = call(client, "POST", "/classrooms", teacher, {"name": name}, 201)
    lesson = call(client, "POST", f"/classrooms/{room['id']}/lessons", teacher, {
        "title": name, "content_text": "PrÃ©paration", "concept_codes": list(concepts),
    }, 201)
    return room, lesson["id"]


def upload(client, headers, lesson_id, name, data, expected=202):
    response = client.post(f"/api/v1/lessons/{lesson_id}/documents", headers=headers,
                           files={"file": (name, data, "application/pdf")})
    assert response.status_code == expected, response.text
    return response.json()


@cache
def indexing_pdf():
    # PyMuPDF embeds a fresh document ID, so build the fixture once to exercise deduplication.
    return digital_pdf("Python: List indexing", [
        "This lesson introduces Python lists and the difference between item positions and list length.",
        INDEX_TEXT + "\n\nvalues = [10, 20, 30]\nprint(values[0])",
    ])


def search(client, teacher, lesson_id, ids, query, expected=200):
    return call(client, "POST", f"/lessons/{lesson_id}/course-assistant/search", teacher,
                {"document_ids": ids, "query": query}, expected)


# Pure helpers


def test_split_block_respects_limits_and_keeps_structures_whole():
    assert list(split_block("   ", "text")) == []
    table = "| a | b |\n" * 50
    assert list(split_block(table, "table", limit=400)) == [table]
    prose = "\n".join(f"Sentence number {index} about list indexing." for index in range(200))
    pieces = list(split_block(prose, "text", limit=300))
    assert len(pieces) > 1 and all(len(piece.encode()) <= 600 for piece in pieces)
    assert "".join(pieces) == prose
    giant = "x" * 5000
    assert all(len(piece.encode()) <= 600 for piece in split_block(giant, "text", limit=300))


def test_production_rejects_local_compose_credentials():
    production = {"_env_file": None, "app_env": "production", "jwt_secret": "p" * 40,
                  "document_s3_endpoint": "https://s3.example.edu", "document_s3_access_key": "neurvia"}
    with pytest.raises(ValueError, match="local Compose"):
        Settings(**production, document_s3_secret_key="neurvia-local-object-password")
    with pytest.raises(ValueError, match="local Compose"):
        Settings(**production, document_s3_secret_key="s" * 40,
                 database_url="postgresql://neurvia:neurvia-local-db@db:5432/neurvia")
    Settings(**production, document_s3_secret_key="s" * 40, database_url="postgresql://neurvia:x@db/neurvia")


def test_citations_tolerate_wrapping_but_reject_invented_or_unknown_sources():
    hit = Evidence(None, None, None, 1, "Cours", 2, "The last valid index is\n len(values) - 1.", 1.0, None)
    evidence = {"P1": hit}
    checked = verify_citations([CitationDraft(source="P1", quote="last valid index is len(values)")], evidence)
    assert checked == [(hit, "last valid index is\n len(values)")]
    with pytest.raises(ValueError):
        verify_citations([CitationDraft(source="P1", quote="the first valid index is one")], evidence)
    with pytest.raises(ValueError):
        verify_citations([CitationDraft(source="P2", quote="last valid index is len")], evidence)
    with pytest.raises(ValueError):
        verify_citations([], evidence)


def test_lexical_terms_drop_function_words_in_both_languages():
    assert content_terms("What is the last valid index of a list?") == {"last", "valid", "index", "list"}
    assert content_terms("Quelle est la différence entre sort et sorted ?") == {"différence", "entre", "sort", "sorted"}
    assert content_terms("what is it") == {"what", "is", "it"}


def test_reciprocal_rank_fusion_rewards_agreement():
    weights = fused_ranking(["a", "b", "c"], ["b", "d"])
    assert max(weights, key=weights.get) == "b"
    assert set(weights) == {"a", "b", "c", "d"}


# Upload, worker and review


def test_upload_validation_dedup_and_tenant_isolation(env):
    teacher, outsider = register(env, "doc-teacher", "teacher"), register(env, "doc-outsider", "teacher")
    student = register(env, "doc-student", "student")
    room, lesson_id = classroom_lesson(env, teacher)
    call(env, "POST", "/classrooms/join", student, {"code": room["join_code"]})

    upload(env, teacher, lesson_id, "notes.txt", b"hello", expected=415)
    upload(env, teacher, lesson_id, "big.pdf", b"%PDF-" + b"0" * (8 * 1024 * 1024), expected=413)
    first = upload(env, teacher, lesson_id, "cours.pdf", indexing_pdf())
    assert upload(env, teacher, lesson_id, "copie.pdf", indexing_pdf())["id"] == first["id"]

    root = f"/lessons/{lesson_id}/documents"
    original = env.get(f"/api/v1{root}/{first['id']}/original", headers=teacher)
    assert original.content == indexing_pdf() and original.headers["cache-control"] == "private, no-store"
    call(env, "GET", f"{root}/{first['id']}", outsider, expected=404)
    call(env, "GET", root, student, expected=403)
    _, foreign = classroom_lesson(env, outsider, "Autre classe")
    call(env, "GET", f"/lessons/{foreign}/documents/{first['id']}", outsider, expected=404)
    assert all(key.startswith("institution/") for key in env.app.state.object_store.objects)


def test_digital_pdf_is_indexed_and_retrieved_with_page_citations(env):
    teacher, outsider = register(env, "ret-teacher", "teacher"), register(env, "ret-outsider", "teacher")
    _, lesson_id = classroom_lesson(env, teacher)
    doc = upload(env, teacher, lesson_id, "cours.pdf", indexing_pdf())
    drain(env)
    state = call(env, "GET", f"/lessons/{lesson_id}/documents/{doc['id']}", teacher)
    assert state["state"] == "ready" and state["page_count"] == 2 and state["model_revision"] == "fake-embedding@1"

    result = search(env, teacher, lesson_id, [doc["id"]], "What is the last valid non-negative list index?")
    assert result["mode"] == "hybrid"
    top = result["hits"][0]["source"]
    assert top["page"] == 2 and top["document_id"] == doc["id"]
    pages = [hit["source"]["page"] for hit in result["hits"]]
    assert len(pages) == len(set(pages)), "search lists each page once"
    assert env.get("/api/v1" + top["path"], headers=teacher).content.startswith(b"\x89PNG")
    assert env.get("/api/v1" + top["path"], headers=outsider).status_code == 404

    _, other_lesson = classroom_lesson(env, teacher, "Autre sÃ©ance")
    search(env, teacher, other_lesson, [doc["id"]], "last valid index", expected=404)


def test_assistant_rate_limit_is_per_teacher_not_per_address(env, monkeypatch):
    from app.routers import course_assistant
    monkeypatch.setitem(course_assistant.LIMITS, "search", 2)
    first, second = register(env, "limit-a", "teacher"), register(env, "limit-b", "teacher")
    _, lesson_a = classroom_lesson(env, first)
    _, lesson_b = classroom_lesson(env, second)
    doc = upload(env, first, lesson_a, "cours.pdf", indexing_pdf())
    drain(env)
    for _ in range(2):
        search(env, first, lesson_a, [doc["id"]], "last valid index")
    search(env, first, lesson_a, [doc["id"]], "last valid index", expected=429)
    other = upload(env, second, lesson_b, "cours.pdf", indexing_pdf())
    drain(env)
    search(env, second, lesson_b, [other["id"]], "last valid index")


def test_embedding_upgrade_falls_back_to_lexical_instead_of_mixing_vector_spaces(env):
    teacher = register(env, "upgrade-teacher", "teacher")
    _, lesson_id = classroom_lesson(env, teacher)
    doc = upload(env, teacher, lesson_id, "cours.pdf", indexing_pdf())
    drain(env)
    env.app.state.document_models.profile = "fake-embedding@2"
    result = search(env, teacher, lesson_id, [doc["id"]], "last valid index IndexError")
    assert result["mode"] == "lexical" and result["hits"][0]["source"]["page"] == 2


def test_transient_embedding_failure_is_retried_with_backoff(env):
    teacher = register(env, "retry-teacher", "teacher")
    _, lesson_id = classroom_lesson(env, teacher)
    env.app.state.document_models.failures = 1
    doc = upload(env, teacher, lesson_id, "cours.pdf", indexing_pdf())
    drain(env)
    path = f"/lessons/{lesson_id}/documents/{doc['id']}"
    state = call(env, "GET", path, teacher)
    assert state["state"] == "queued" and state["failure"] == "ConnectError" and state["job_kind"] == "index"
    with env.app.state.sessions.begin() as db:
        job = db.scalar(select(DocumentJob).where(DocumentJob.version_id == UUID(doc["id"]), DocumentJob.kind == "index"))
        assert job.available_at > utcnow()
        job.available_at = utcnow() - timedelta(seconds=1)
    drain(env)
    assert call(env, "GET", path, teacher)["state"] == "ready"


def test_invalid_pdf_fails_permanently_and_can_be_retried(env):
    teacher = register(env, "broken-teacher", "teacher")
    _, lesson_id = classroom_lesson(env, teacher)
    doc = upload(env, teacher, lesson_id, "broken.pdf", b"%PDF-1.7 not really a pdf")
    drain(env)
    path = f"/lessons/{lesson_id}/documents/{doc['id']}"
    state = call(env, "GET", path, teacher)
    assert state["state"] == "failed" and state["failure"] == "invalid_pdf"
    retried = call(env, "POST", path + "/retry", teacher, {"revision": state["revision"], "validated": True})
    assert retried["state"] == "queued" and retried["revision"] == state["revision"] + 1


def test_scanned_page_requires_teacher_review_before_indexing(env):
    teacher = register(env, "scan-teacher", "teacher")
    _, lesson_id = classroom_lesson(env, teacher)
    doc = upload(env, teacher, lesson_id, "ink.pdf", handwriting_scan())
    drain(env)
    path = f"/lessons/{lesson_id}/documents/{doc['id']}"
    state = call(env, "GET", path, teacher)
    assert state["state"] == "review"
    page = call(env, "GET", path + "/pages/1", teacher)
    block = page["blocks"][0]
    assert block["method"] == "vision" and block["review_required"] and block["text"] == "Index: 0, 1, 2"

    call(env, "POST", path + "/review", teacher, {"revision": state["revision"], "validated": True}, 409)
    search(env, teacher, lesson_id, [doc["id"]], "index", expected=409)
    corrected = call(env, "PATCH", f"{path}/blocks/{block['id']}", teacher,
                     {"revision": state["revision"], "text": "Index : 0, 1, 2 (relu)"})
    assert corrected["revision"] == state["revision"] + 1
    call(env, "PATCH", f"{path}/blocks/{block['id']}", teacher,
         {"revision": state["revision"], "text": "stale edit"}, 409)
    call(env, "POST", path + "/review", teacher, {"revision": corrected["revision"], "validated": False}, 409)
    call(env, "POST", path + "/review", teacher, {"revision": corrected["revision"], "validated": True})
    drain(env)
    assert call(env, "GET", path, teacher)["state"] == "ready"
    hits = search(env, teacher, lesson_id, [doc["id"]], "Index relu")["hits"]
    assert "relu" in hits[0]["source"]["quote"]
    reviewed = call(env, "GET", path + "/pages/1", teacher)["blocks"][0]
    assert reviewed["extracted_text"] == "Index: 0, 1, 2" and not reviewed["review_required"]


# Assistant and grounded quiz


def ready_lesson(env, name):
    teacher = register(env, name, "teacher")
    room, lesson_id = classroom_lesson(env, teacher)
    doc = upload(env, teacher, lesson_id, "cours.pdf", indexing_pdf())
    drain(env)
    chat = call(env, "POST", f"/lessons/{lesson_id}/course-assistant", teacher)
    return teacher, room, lesson_id, doc["id"], chat


def test_chat_keeps_only_verified_citations(env):
    teacher, _, lesson_id, doc_id, chat = ready_lesson(env, "chat-teacher")
    url = f"/lessons/{lesson_id}/course-assistant/{chat['id']}/messages"
    message = {"document_ids": [doc_id], "message": "What is the last valid list index? Answer in French."}
    chat = call(env, "POST", url, teacher, message)
    answer = chat["messages"][-1]
    assert answer["role"] == "assistant" and answer["sources"][0]["page"] == 2

    env.app.state.gateway.fabricate = True
    chat = call(env, "POST", url, teacher, message)
    assert chat["messages"][-1]["sources"] == [] and "ne permettent pas" in chat["messages"][-1]["text"]

    env.app.state.gateway.fabricate, env.app.state.gateway.verdict = False, "ambiguous"
    chat = call(env, "POST", url, teacher, message)
    assert chat["messages"][-1]["sources"] == [] and len(chat["messages"]) == 6
    passages = [payload for task, payload in env.app.state.gateway.calls if task == "course_chat"]
    assert all("passages" in payload and payload["passages"] for payload in passages)


def test_grounded_quiz_requires_brief_revision_sources_and_explicit_approval(env):
    teacher, room, lesson_id, doc_id, chat = ready_lesson(env, "quiz-teacher")
    base = f"/lessons/{lesson_id}/course-assistant"
    call(env, "POST", f"{base}/{chat['id']}/brief/extract", teacher, expected=409)
    call(env, "POST", f"{base}/{chat['id']}/messages", teacher,
         {"document_ids": [doc_id], "message": "Je veux travailler les indices de liste."})
    chat = call(env, "POST", f"{base}/{chat['id']}/brief/extract", teacher)
    assert chat["brief"]["focus_topics"] == ["last valid index", "IndexError"]

    request = {"document_ids": [doc_id], "conversation_id": chat["id"], "brief_revision": chat["brief_revision"]}
    call(env, "POST", f"{base}/quiz", teacher, {**request, "brief_revision": chat["brief_revision"] + 5}, 409)
    quiz = call(env, "POST", f"{base}/quiz", teacher, request)
    assert quiz["is_grounded"] and len(quiz["questions"]) == 1
    item = quiz["questions"][0]
    assert item["source_pages"][0]["page"] == 2 and item["source_pages"][0]["objective"]
    assert all(option["misconception_code"] for option in item["options"] if not option["is_correct"])

    draft = {key: item[key] for key in ("concept_code", "stem", "code", "difficulty", "explanation")}
    manual = {**draft, "stem": "Une question ajoutÃ©e sans source vÃ©rifiÃ©e ?",
              "options": [{key: option[key] for key in ("text", "is_correct", "misconception_code")}
                          for option in item["options"]]}
    call(env, "POST", f"/quizzes/{quiz['id']}/questions", teacher, manual, 409)

    call(env, "POST", f"/quizzes/{quiz['id']}/publish", teacher, {"validated": False}, 409)
    published = call(env, "POST", f"/quizzes/{quiz['id']}/publish", teacher, {"validated": True})
    assert published["status"] == "published"


def test_grounded_quiz_refuses_items_the_checker_rejects(env):
    teacher, _, lesson_id, doc_id, chat = ready_lesson(env, "reject-teacher")
    env.app.state.gateway.verdict = "unsupported"
    call(env, "POST", f"/lessons/{lesson_id}/course-assistant/quiz", teacher, {
        "document_ids": [doc_id], "conversation_id": chat["id"], "brief_revision": chat["brief_revision"],
    }, 409)


# Taxonomy boundaries


def test_teacher_taxonomy_is_private_to_its_institution_and_published_lessons(env):
    teacher, outsider = register(env, "tax-teacher", "teacher"), register(env, "tax-outsider", "teacher")
    student = register(env, "tax-student", "student")
    joined, joined_lesson = classroom_lesson(env, teacher, "Classe suivie")
    call(env, "POST", "/classrooms/join", student, {"code": joined["join_code"]})
    _, other_lesson = classroom_lesson(env, teacher, "Autre classe")
    custom = {"label": "Bornes dâ€™une liste", "validated": True, "misconceptions": [
        {"label": "Utilise la longueur comme indice", "remediation_hint": "Compter les positions depuis zÃ©ro."},
    ]}
    call(env, "POST", f"/lessons/{other_lesson}/taxonomy", teacher, {**custom, "validated": False}, 409)
    call(env, "POST", f"/lessons/{other_lesson}/taxonomy", outsider, custom, 404)
    hidden = call(env, "POST", f"/lessons/{other_lesson}/taxonomy", teacher, custom, 201)["code"]
    shared = call(env, "POST", f"/lessons/{joined_lesson}/taxonomy", teacher,
                  {**custom, "label": "Bornes partagÃ©es"}, 201)["code"]

    def codes(headers):
        return {entry["code"] for entry in call(env, "GET", "/taxonomy", headers)}

    assert {hidden, shared} <= codes(teacher)
    assert not {hidden, shared} & codes(outsider)
    assert not {hidden, shared} & codes(student)
    assert "C_INDEXING" in codes(student) and "C_INDEXING" in codes(outsider)

    with env.app.state.sessions.begin() as db:
        db.get(Lesson, UUID(joined_lesson)).status = LessonStatus.published
    visible = codes(student)
    assert shared in visible and hidden not in visible
    _, outsider_lesson = classroom_lesson(env, outsider, "Classe externe")
    call(env, "PATCH", f"/lessons/{outsider_lesson}", outsider, {
        "title": "Classe externe", "content_text": "PrÃ©paration", "concept_codes": [hidden],
    }, 422)
