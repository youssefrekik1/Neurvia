from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.auth import ISSUER
from app.core.config import Settings
from app.main import create_app
from app.models import Membership, Question, QuestionOption
from app.models.enums import QuestionStatus
from app.services.demo_examples import INITIAL
from app.services.demo_seed import CLASSROOM_ID, LESSON_ID
from conftest import login

API = "/api/v1"


def register(api, name, role):
    payload = {"email": f"{name}@example.com", "password": "example-password-123",
               "full_name": name, "role": role}
    result = api.post(f"{API}/auth/register", json=payload)
    assert result.status_code == 201, result.text
    assert "password_hash" not in result.json()
    return login(api, payload["email"], payload["password"])


def test_health_contract_and_seed(api):
    assert api.get("/health").json() == {"status": "ok"}
    spec = api.get("/openapi.json").json()
    assert spec["paths"][f"{API}/me"]["get"]["security"] == [{"BearerAuth": []}]
    assert spec["paths"][f"{API}/dev/seed"]["post"]["security"] == [{"DemoAdmin": []}]
    assert spec["paths"][f"{API}/attempts/{{id}}/answers"]["post"]["responses"]["422"]["content"][
        "application/json"
    ]["schema"]["$ref"].endswith("/ErrorResponse")
    with api.app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Question)) == 12
        assert all(row.status == QuestionStatus.draft for row in db.scalars(select(Question)))
        assert db.scalar(select(func.count()).select_from(QuestionOption)) == 48


def test_signed_token_guards(api, teacher):
    profile = api.get(f"{API}/me", headers=teacher).json()
    assert profile["role"] == "teacher" and profile["is_synthetic"] is True
    assert api.get(f"{API}/me").status_code == 401
    assert api.get(f"{API}/me", headers={"Authorization": "Bearer invalid"}).status_code == 401
    now = datetime.now(UTC)
    secret = api.app.state.settings.jwt_secret.get_secret_value()
    expired = jwt.encode({"sub": profile["id"], "iss": ISSUER,
                          "iat": now - timedelta(minutes=2), "exp": now - timedelta(minutes=1)},
                         secret, algorithm="HS256")
    assert api.get(f"{API}/me", headers={"Authorization": f"Bearer {expired}"}).status_code == 401


def test_real_classroom_and_lesson_isolation(api):
    owner = register(api, "owner", "teacher")
    outsider = register(api, "outsider", "teacher")
    student = register(api, "learner", "student")
    other_student = register(api, "another", "student")

    data = api.post(f"{API}/classrooms", headers=owner, json={"name": "Python"}).json()
    class_id, code = data["id"], data["join_code"]
    assert data["join_path"] == f"/join/{code}"
    assert api.get(f"{API}/classrooms", headers=outsider).json() == []
    assert api.get(f"{API}/classrooms/{class_id}/members", headers=outsider).status_code == 404
    assert api.get(f"{API}/classrooms/{class_id}/members", headers=student).status_code == 403

    for _ in range(2):
        result = api.post(f"{API}/classrooms/join", headers=student, json={"code": code.lower()})
        assert result.status_code == 200
        assert result.json()["join_code"] is None
    assert api.get(f"{API}/classrooms", headers=other_student).json() == []
    members = api.get(f"{API}/classrooms/{class_id}/members", headers=owner).json()
    assert len(members) == 1 and set(members[0]) == {"id", "pseudonym", "is_synthetic"}
    assert api.post(f"{API}/classrooms/join", headers=student, json={"code": "FAHMDEMO24"}).status_code == 404

    lesson = {"title": "Indices", "content_text": "Indices de listes Python.", "concept_codes": ["C_INDEXING"]}
    path = f"{API}/classrooms/{class_id}/lessons"
    assert api.post(path, headers=outsider, json=lesson).status_code == 404
    assert api.post(path, headers=owner, json={**lesson, "concept_codes": ["C_FAKE"]}).status_code == 422
    result = api.post(path, headers=owner, json=lesson)
    assert result.status_code == 201, result.text
    lesson_id = result.json()["id"]
    assert api.get(f"{API}/lessons/{lesson_id}", headers=owner).json()["content_text"] == lesson["content_text"]
    for unauthorized in (outsider, student, other_student):
        assert api.get(f"{API}/lessons/{lesson_id}", headers=unauthorized).status_code == 404


def test_sqlite_foreign_keys(api):
    with api.app.state.sessions() as db:
        db.add(Membership(classroom_id=CLASSROOM_ID, user_id=uuid4(), pseudonym="invalid"))
        with pytest.raises(IntegrityError):
            db.commit()


def test_draft_requires_review(api, teacher, student):
    draft = api.post(f"{API}/lessons/{LESSON_ID}/quiz/generate", headers=teacher, json={})
    assert draft.status_code == 200, draft.text
    quiz = draft.json()
    path = f"{API}/quizzes/{quiz['id']}"
    assert quiz["status"] == "draft" and quiz["generation_mode"] == "fixture"
    assert api.get(path, headers=student).status_code == 403
    assert api.post(f"{path}/attempts", headers=student).status_code == 409
    assert api.post(f"{path}/publish", headers=teacher, json={"validated": False}).status_code == 409
    published = api.post(f"{path}/publish", headers=teacher, json={"validated": True}).json()
    assert published["status"] == "published" and published["validated_by"]
    assert api.delete(f"{path}/questions/{quiz['questions'][0]['id']}", headers=teacher).status_code == 409


def test_answer_privacy_and_confirmation(api, student):
    path = f"{API}/quizzes/{INITIAL}/attempts"
    result = api.post(path, headers=student)
    assert result.status_code == 200, result.text
    attempt = result.json()
    assert all(set(item) == {"id", "concept_code", "stem", "code", "options"}
               for item in attempt["questions"])
    assert all(set(option) == {"id", "text"} for item in attempt["questions"] for option in item["options"])
    path = f"{API}/attempts/{attempt['id']}"
    other = login(api, "eleve2.fahm@example.com")
    assert api.get(f"{path}/feedback", headers=other).status_code == 404
    assert api.get(f"{path}/confirmation", headers=other).status_code == 404
    assert api.get(f"{path}/feedback", headers=student).status_code == 409
    for index, item in enumerate(attempt["questions"]):
        answer = {"question_id": item["id"], "option_id": item["options"][index == 0]["id"], "confidence": "sure"}
        saved = api.post(f"{path}/answers", headers=student, json=answer)
        assert saved.status_code == 200 and "is_correct" not in saved.json()
    feedback = api.post(f"{path}/submit", headers=student).json()
    assert feedback["suspected_difficulties"][0]["status"] == "suspected"
    assert feedback == api.post(f"{path}/submit", headers=student).json()
    confirmation = api.get(f"{path}/confirmation", headers=student).json()["question"]
    assert confirmation["id"] not in {item["id"] for item in attempt["questions"]}
    assert "is_correct" not in confirmation["options"][0]
    answer = {"question_id": confirmation["id"], "option_id": confirmation["options"][0]["id"],
              "confidence": "medium"}
    result = api.post(f"{path}/confirmation", headers=student, json=answer).json()
    assert result["suspected_difficulties"][0]["status"] == "contradicted_or_transient"
    assert result == api.post(f"{path}/confirmation", headers=student, json=answer).json()


def test_dev_secret_and_default_mode(api):
    assert api.post(f"{API}/dev/clock/advance").status_code == 403
    key = {"X-Demo-Secret": "test-admin-secret"}
    reset = api.post(f"{API}/dev/clock/reset", headers=key).json()
    future = api.post(f"{API}/dev/clock/advance", headers=key).json()
    assert datetime.fromisoformat(future["now"]) - datetime.fromisoformat(reset["now"]) == timedelta(days=7)
    assert future["is_simulated"] is True
    settings = Settings(_env_file=None, database_url="sqlite://", demo_mode=False, llm_enabled=False)
    with TestClient(create_app(settings)) as client:
        assert client.post(f"{API}/dev/clock/advance", headers=key).status_code == 404
        owner = register(client, "owner", "teacher")
        assert client.get(f"{API}/lessons/{LESSON_ID}/dashboard", headers=owner).status_code == 501
        assert client.post(f"{API}/auth/login", json={
            "email": "prof.fahm@example.com", "password": "FAHM-demo-2026"
        }).status_code == 401


def test_validation_error_omits_credentials(api):
    result = api.post(f"{API}/auth/register", json={
        "email": "bad-address", "password": "distinct-secret", "full_name": "X", "role": "teacher"
    })
    assert result.status_code == 422 and "distinct-secret" not in result.text
    assert result.json()["error"]["code"] == "INVALID_INPUT"
