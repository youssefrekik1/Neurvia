from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.auth import ISSUER
from app.core.clock import DemoClock
from app.core.config import Settings
from app.main import create_app
from app.models import Attempt, Membership, MisconceptionObservation, Question, RetestSchedule
from app.services.demo_seed import CLASSROOM_ID, DEMO_PASSWORD, LESSON_ID
from conftest import call, login, register

CONCEPT = "C_INDEXING"
ERROR = "M_OFF_BY_ONE"


def make_question(label, role="initial", target=None, mapped=False):
    return {
        "concept_code": CONCEPT, "stem": f"Énoncé de test pédagogique pour {label} ?",
        "options": [
            {"text": "La première option", "is_correct": True},
            {"text": "La deuxième option", "is_correct": False,
             "misconception_code": ERROR if target or mapped else None},
            {"text": "La troisième option", "is_correct": False},
            {"text": "La quatrième option", "is_correct": False},
        ],
        "explanation": "Le test vérifie que la correction et le distracteur sont persistés.",
        "role": role, "target_misconception_code": target,
    }


def exercise_normal(api):
    teacher = register(api, "instructor", "teacher")
    outsider = register(api, "outsider", "teacher")
    room = call(api, "POST", "/classrooms", teacher, {"name": "Classe Python"}, 201)
    room_id = room["id"]
    rotated = call(api, "POST", f"/classrooms/{room_id}/join-code", teacher, {"join_ttl_hours": 24})
    assert rotated["join_code"] != room["join_code"]
    students = [register(api, f"student{index}", "student") for index in range(4)]
    for index, student in enumerate(students, start=1):
        call(api, "POST", "/classrooms/join", student, {"code": room["join_code"]}, 404)
        joined = call(api, "POST", "/classrooms/join", student,
                      {"code": rotated["join_code"], "pseudonym": f"Profil {index}"})
        assert joined["join_code"] is None
        call(api, "POST", "/classrooms/join", student, {"code": rotated["join_code"]})
    assert len(call(api, "GET", f"/classrooms/{room_id}/members", teacher)) == 4
    call(api, "GET", f"/classrooms/{room_id}/members", outsider, expected=404)
    call(api, "GET", f"/classrooms/{room_id}/members", students[0], expected=403)

    for num in range(4):
        payload = make_question(f"initial {num}", mapped=True)
        row = call(api, "POST", "/bank/questions", teacher, payload, 201)
        call(api, "POST", f"/bank/questions/{row['id']}/approve", outsider, {"validated": True}, 404)
        call(api, "POST", f"/bank/questions/{row['id']}/approve", teacher, {"validated": True})
    for role in ("confirmation", "immediate_retest", "j7_retest"):
        payload = make_question(role, role, ERROR)
        row = call(api, "POST", "/bank/questions", teacher, payload, 201)
        call(api, "POST", f"/bank/questions/{row['id']}/approve", teacher, {"validated": True})

    lesson = call(api, "POST", f"/classrooms/{room_id}/lessons", teacher, {
        "title": "Indices", "content_text": "Les indices commencent à zéro.",
        "concept_codes": [CONCEPT], "focus_brief": {"question_count": 4},
    }, 201)
    lesson_id = lesson["id"]
    call(api, "GET", f"/lessons/{lesson_id}", students[0], expected=404)
    quiz = call(api, "POST", f"/lessons/{lesson_id}/quiz/generate", teacher, {"question_count": 4})
    assert quiz["generation_mode"] == "bank" and len(quiz["questions"]) == 4
    quiz_id = quiz["id"]
    path = "/quizzes/" + quiz_id
    item = quiz["questions"][0]
    patch = make_question("version relue", mapped=True)
    patch.pop("role")
    patch.pop("target_misconception_code")
    changed = call(api, "PATCH", f"{path}/questions/{item['id']}", teacher, patch)
    assert changed["version"] == 2 and changed["id"] != item["id"]
    call(api, "POST", f"{path}/attempts", students[0], expected=404)
    call(api, "POST", f"{path}/publish", teacher, {"validated": False}, 409)
    call(api, "POST", f"{path}/publish", outsider, {"validated": True}, 404)
    call(api, "POST", f"{path}/publish", teacher, {"validated": True})
    call(api, "PATCH", f"{path}/questions/{changed['id']}", teacher, patch, 409)
    call(api, "GET", path, students[0], expected=403)

    attempts = []
    for index, student in enumerate(students):
        attempt = call(api, "POST", f"{path}/attempts", student)
        attempts.append(attempt)
        assert all(set(o) == {"id", "text"} for q in attempt["questions"] for o in q["options"])
        attempt_path = f"/attempts/{attempt['id']}"
        call(api, "GET", attempt_path + "/feedback", student, expected=409)
        wrong_option = attempt["questions"][0]["options"][1]["id"]
        call(api, "POST", attempt_path + "/answers", student, {
            "question_id": attempt["questions"][1]["id"], "option_id": wrong_option, "confidence": "sure",
        }, 422)
        for pos, question in enumerate(attempt["questions"]):
            if index == 3 and pos == 3:
                continue
            record_answer(api, student, attempt["id"], question, int(pos == 0))
        fb = call(api, "POST", attempt_path + "/submit", student)
        assert fb["suspected_difficulties"][0]["status"] == "suspected"
        assert fb == call(api, "POST", attempt_path + "/submit", student)
        confirm = call(api, "GET", attempt_path + "/confirmation", student)
        if index == 3:
            assert fb["diagnosis_quality"] == "insufficient" and confirm is None
            continue
        assert confirm["question"]["id"] not in {q["id"] for q in attempt["questions"]}
        submission = option(confirm["question"], 1)
        verified = call(api, "POST", attempt_path + "/confirmation", student, submission)
        assert verified["suspected_difficulties"][0]["status"] == "corroborated"
        assert verified == call(api, "POST", attempt_path + "/confirmation", student, submission)
    call(api, "GET", f"/attempts/{attempts[0]['id']}/feedback", students[1], expected=404)

    base = f"/lessons/{lesson_id}"
    dashboard = call(api, "GET", base + "/dashboard", teacher)
    assert dashboard["participation"] == {"enrolled_count": 4, "submitted_count": 4, "insufficient_count": 1}
    assert dashboard["priorities"][0]["corroborated_students"] == 3
    assert dashboard["is_synthetic"] is False
    graph = call(api, "GET", base + "/graph", teacher)
    assert len(graph["nodes"]) == 4 and len(graph["edges"]) == 3
    assert all(edge["similarity"] == 1 and not edge["provisional"] for edge in graph["edges"])
    groups = call(api, "POST", base + "/groups/suggest", teacher)
    group = groups[0]
    assert len(groups) == 1 and len(group["student_ids"]) == 3
    assert groups == call(api, "POST", base + "/groups/suggest", teacher)
    gid = group["id"]
    call(api, "POST", f"/groups/{gid}/remediation", teacher, expected=409)
    call(api, "PATCH", f"/groups/{gid}", teacher, {"action": "modify", "student_ids": [str(uuid4())]}, 404)
    call(api, "PATCH", f"/groups/{gid}", teacher, {"action": "reject", "reason": "À revoir"})
    call(api, "PATCH", f"/groups/{gid}", teacher, {"action": "accept"})
    plan = call(api, "POST", f"/groups/{gid}/remediation", teacher)
    plan_id = plan["id"]
    assert plan["source"] == "template"
    call(api, "PATCH", f"/interventions/{plan_id}", teacher, {"plan": plan["plan"]})
    call(api, "POST", f"/interventions/{plan_id}/assign", teacher, {"validated": False}, 409)
    call(api, "POST", base + "/retest", teacher, {"intervention_id": plan_id}, 409)
    call(api, "POST", f"/interventions/{plan_id}/assign", teacher, {"validated": True})
    assert len(call(api, "GET", f"/me/interventions?classroom_id={room_id}", students[0])) == 1
    assert call(api, "GET", f"/me/interventions?classroom_id={room_id}", students[3]) == []
    schedule = call(api, "POST", base + "/retest", teacher, {"intervention_id": plan_id})
    assert len(schedule["schedules"]) == 3
    assert schedule == call(api, "POST", base + "/retest", teacher, {"intervention_id": plan_id})
    personal = call(api, "GET", "/me/retests", students[0])
    assert len(personal) == 1 and personal[0]["kind"] == "immediate_retest"
    call(api, "POST", f"/quizzes/{personal[0]['quiz_id']}/attempts", students[1], expected=404)
    attempt = call(api, "POST", f"/quizzes/{personal[0]['quiz_id']}/attempts", students[0])
    assert attempt["questions"][0]["id"] not in {q["id"] for q in attempts[0]["questions"]}
    record_answer(api, students[0], attempt["id"], attempt["questions"][0], 0)
    call(api, "POST", f"/attempts/{attempt['id']}/submit", students[0])
    call(api, "POST", f"/attempts/{attempt['id']}/submit", students[0])
    j7 = call(api, "POST", base + "/j7/schedule", teacher)["schedules"]
    assert len(j7) == 1 and j7[0]["status"] == "pending"
    call(api, "POST", f"/quizzes/{j7[0]['quiz_id']}/attempts", students[0], expected=404)
    assert [row["kind"] for row in call(api, "GET", "/me/retests", students[0])] == ["immediate_retest"]
    results = call(api, "GET", base + "/before-after", teacher)
    concept = results["concepts"][0]
    assert concept["initial"]["attempts"] == 15 and concept["immediate"]["correct"] == 1
    assert results["error_counts"][0]["immediate"]["correct"] == 0
    return students[0], teacher, room_id, base, attempt, j7[0]


def option(question, index):
    return {"question_id": question["id"], "option_id": question["options"][index]["id"], "confidence": "sure"}


def record_answer(api, student, attempt_id, question, index):
    saved = call(api, "POST", f"/attempts/{attempt_id}/answers", student, option(question, index))
    assert "is_correct" not in saved


def test_real_workflow_persists_after_restart(settings):
    with TestClient(create_app(settings)) as client:
        learner, teacher, room_id, base, immediate, j7 = exercise_normal(client)
    with TestClient(create_app(settings)) as client:
        assert call(client, "GET", f"/me/feedback?classroom_id={room_id}", learner)
        call(client, "POST", "/dev/clock/advance", expected=404)
        client.app.state.clock = DemoClock()
        client.app.state.clock.advance(8)
        due = call(client, "GET", "/me/retests", learner)
        assert any(task["quiz_id"] == j7["quiz_id"] for task in due)
        attempt = call(client, "POST", f"/quizzes/{j7['quiz_id']}/attempts", learner)
        assert attempt["questions"][0]["id"] != immediate["questions"][0]["id"]
        record_answer(client, learner, attempt["id"], attempt["questions"][0], 1)
        call(client, "POST", f"/attempts/{attempt['id']}/submit", learner)
        results = call(client, "GET", base + "/before-after", teacher)
        assert results["concepts"][0]["j7"]["attempts"] == 1
        assert results["error_counts"][0]["j7"]["correct"] == 1
        with client.app.state.sessions() as db:
            assert db.scalar(select(func.count()).select_from(RetestSchedule)) == 4
            assert db.scalar(select(func.count()).select_from(Attempt)) == 9
            assert db.scalar(select(func.count()).select_from(MisconceptionObservation)) == 8


def test_demo_uses_real_analytics_and_protected_clock(tmp_path):
    settings = Settings(_env_file=None, database_url=f"sqlite:///{(tmp_path / 'demo.db').as_posix()}",
                        demo_mode=True, demo_admin_secret="test-advance", llm_enabled=False)
    with TestClient(create_app(settings)) as client:
        teacher = login(client, "prof.fahm@example.com", DEMO_PASSWORD)
        student = login(client, "eleve1.fahm@example.com", DEMO_PASSWORD)
        base = f"/lessons/{LESSON_ID}"
        graph = call(client, "GET", base + "/graph", teacher)
        assert len(graph["nodes"]) == 20 and graph["is_synthetic"]
        groups = call(client, "POST", base + "/groups/suggest", teacher)
        assert len(groups) == 3
        call(client, "POST", "/dev/clock/advance", expected=403)
        call(client, "POST", "/demo/advance", student, expected=403)
        assert call(client, "POST", "/demo/advance", teacher)["is_simulated"]
        assert call(client, "POST", "/dev/seed", {"X-Demo-Secret": "test-advance"})["is_synthetic"]
        assert len(call(client, "GET", f"/classrooms/{CLASSROOM_ID}/members", teacher)) == 20


def test_auth_expiration_seed_and_database_constraints(api):
    teacher = register(api, "owner", "teacher")
    profile = call(api, "GET", "/me", teacher)
    now = datetime.now(UTC)
    secret = api.app.state.settings.jwt_secret.get_secret_value()
    expired = jwt.encode({"sub": profile["id"], "iss": ISSUER, "iat": now - timedelta(minutes=2),
                          "exp": now - timedelta(minutes=1)}, secret, algorithm="HS256")
    call(api, "GET", "/me", expected=401)
    call(api, "GET", "/me", {"Authorization": "Bearer " + expired}, expected=401)
    invalid = call(api, "POST", "/auth/register", data={
        "email": "bad-address", "password": "distinct-secret", "full_name": "X", "role": "teacher",
    }, expected=422)
    assert "distinct-secret" not in str(invalid)
    with api.app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Question)) == 12
        assert all(item.status == "draft" for item in db.scalars(select(Question)))
        db.add(Membership(classroom_id=uuid4(), user_id=uuid4(), pseudonym="orphan"))
        with pytest.raises(IntegrityError):
            db.commit()
