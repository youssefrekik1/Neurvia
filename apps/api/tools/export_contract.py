"""Exercise the wired OpenAPI operations and export a snapshot with checked JSON examples."""

import json
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from app.core.config import ROOT, Settings
from app.main import create_app
from app.services.demo_seed import CLASSROOM_ID, DEMO_PASSWORD, LESSON_ID

TEACHER_EMAIL = "prof.fahm@example.com"
STUDENT_EMAIL = "eleve1.fahm@example.com"
DOCS = ROOT / "docs"
DEMO_KEY = "temporary-contract-export-secret"


def exercise_contract(client: TestClient) -> dict:
    spec = client.get("/openapi.json").json()
    seen = set()

    def call(method, path, *, ids=None, headers=None, body=None, status=200, prefix=True, query=None):
        key = f"/api/v1{path}" if prefix else path
        url = key.format(**(ids or {}))
        options = {"headers": headers, "params": query}
        if body is not None:
            options["json"] = body
        response = client.request(method, url, **options)
        assert response.status_code == status, f"{method} {url}: {response.status_code} {response.text}"
        data = response.json()
        operation = spec["paths"][key][method.lower()]
        if (method, key) not in seen:
            seen.add((method, key))
            example = {**data, "access_token": "eyJ...example"} if path == "/auth/login" else data
            operation["responses"][str(status)]["content"]["application/json"]["example"] = example
            if body is not None:
                operation["requestBody"]["content"]["application/json"]["example"] = body
            for parameter in operation.get("parameters", []):
                actual = ids if parameter["in"] == "path" else query
                if actual and parameter["name"] in actual:
                    parameter["example"] = str(actual[parameter["name"]]) if parameter["in"] == "path" else actual[parameter["name"]]
        return data

    def auth(email):
        token = call("POST", "/auth/login", body={"email": email, "password": DEMO_PASSWORD})
        return {"Authorization": f"Bearer {token['access_token']}"}

    call("GET", "/health", prefix=False)
    dev = {"X-Demo-Secret": DEMO_KEY}
    call("POST", "/dev/seed", headers=dev)
    call("POST", "/dev/clock/reset", headers=dev)
    call("POST", "/auth/register", status=201, body={
        "email": "exemple.fahm@example.com", "full_name": "Compte Exemple",
        "password": "example-only-2026", "role": "teacher",
    })

    teacher, student = auth(TEACHER_EMAIL), auth(STUDENT_EMAIL)
    call("GET", "/me", headers=teacher)
    call("GET", "/taxonomy", headers=teacher)
    call("GET", "/classrooms", headers=teacher)
    classroom = call("POST", "/classrooms", status=201, headers=teacher, body={
        "name": "TD Python", "subject": "python_intro", "join_ttl_hours": 72,
    })
    class_id = {"id": classroom["id"]}
    call("POST", "/classrooms/join", headers=student, body={
        "code": classroom["join_code"], "pseudonym": "Étudiant 01",
    })
    call("GET", "/classrooms/{id}/members", ids=class_id, headers=teacher)
    created = call("POST", "/classrooms/{id}/lessons", ids=class_id, headers=teacher, status=201, body={
        "title": "Indices Python", "content_text": "Les indices positifs d’une liste commencent à zéro.",
        "concept_codes": ["C_INDEXING"], "focus_brief": {
            "difficulty": 1, "question_count": 4, "pitfalls": ["Dernier indice"],
        },
    })
    call("GET", "/lessons/{id}", ids={"id": created["id"]}, headers=teacher)

    lesson = {"id": LESSON_ID}
    draft = call("POST", "/lessons/{id}/quiz/generate", ids=lesson, headers=teacher, body={"question_count": 2})
    quiz = {"id": draft["id"]}
    call("GET", "/quizzes/{id}", ids=quiz, headers=teacher)
    item = call("POST", "/quizzes/{id}/questions/{qid}/regenerate",
                ids={**quiz, "qid": draft["questions"][0]["id"]}, headers=teacher,
                body={"instructions": "Privilégier une expression courte."})
    draft_input = {
        field: item[field] for field in ("concept_code", "stem", "code", "difficulty", "explanation")
    } | {
        "options": [{key: value for key, value in option.items() if key != "id"} for option in item["options"]],
    }
    edited = call("PATCH", "/quizzes/{id}/questions/{qid}", ids={**quiz, "qid": item["id"]},
                  headers=teacher, body={**draft_input, "stem": "Quel résultat donne cette expression Python ?"})
    assert edited["version"] > item["version"]
    added = call("POST", "/quizzes/{id}/questions", ids=quiz, headers=teacher, status=201,
                 body={**draft_input, "stem": "Quel est le résultat de cet autre exemple Python ?"})
    call("DELETE", "/quizzes/{id}/questions/{qid}", ids={**quiz, "qid": added["id"]}, headers=teacher)
    call("POST", "/quizzes/{id}/publish", ids=quiz, headers=teacher, body={"validated": True})
    call("POST", "/quizzes/{id}/close", ids=quiz, headers=teacher)

    tasks = call("GET", "/me/tasks", headers=student, query={"classroom_id": str(CLASSROOM_ID)})
    initial = next(task for task in tasks if task["kind"] == "initial")
    attempt = call("POST", "/quizzes/{id}/attempts", ids={"id": initial["quiz_id"]}, headers=student)
    attempt_id = {"id": attempt["id"]}

    def answer(item, selected=0):
        return {"question_id": item["id"], "option_id": item["options"][selected]["id"], "confidence": "sure"}

    for index, item in enumerate(attempt["questions"]):
        call("POST", "/attempts/{id}/answers", ids=attempt_id, headers=student,
             body=answer(item, int(index == 0)))
    feedback = call("POST", "/attempts/{id}/submit", ids=attempt_id, headers=student)
    assert feedback["suspected_difficulties"][0]["status"] == "suspected"
    call("GET", "/attempts/{id}/feedback", ids=attempt_id, headers=student)
    confirmation = call("GET", "/attempts/{id}/confirmation", ids=attempt_id, headers=student)["question"]
    result = call("POST", "/attempts/{id}/confirmation", ids=attempt_id, headers=student,
                  body=answer(confirmation, 1))
    assert result["suspected_difficulties"][0]["status"] == "corroborated"

    call("GET", "/lessons/{id}/dashboard", ids=lesson, headers=teacher)
    call("GET", "/lessons/{id}/graph", ids=lesson, headers=teacher, query={"tau": 0.4})
    call("POST", "/lessons/{id}/groups/suggest", ids=lesson, headers=teacher)
    groups = call("GET", "/lessons/{id}/groups", ids=lesson, headers=teacher)
    group = {"id": groups[0]["id"]}
    call("PATCH", "/groups/{id}", ids=group, headers=teacher, body={"action": "accept"})
    intervention = call("POST", "/groups/{id}/remediation", ids=group, headers=teacher)
    plan = {"id": intervention["id"]}
    call("PATCH", "/interventions/{id}", ids=plan, headers=teacher, body={"plan": intervention["plan"]})
    call("POST", "/interventions/{id}/assign", ids=plan, headers=teacher, body={"validated": True})

    schedule = call("POST", "/lessons/{id}/retest", ids=lesson, headers=teacher, body={"intervention_id": plan["id"]})
    quizzes = call("GET", "/me/retests", headers=student)
    immediate = next(item for item in quizzes if item["kind"] == "immediate_retest")
    assert immediate["quiz_id"] == schedule["schedules"][0]["quiz_id"]
    immediate_attempt = call("POST", "/quizzes/{id}/attempts", ids={"id": immediate["quiz_id"]}, headers=student)
    immediate_id = {"id": immediate_attempt["id"]}
    immediate_item = immediate_attempt["questions"][0]
    call("POST", "/attempts/{id}/answers", ids=immediate_id, headers=student, body=answer(immediate_item))
    call("POST", "/attempts/{id}/submit", ids=immediate_id, headers=student)
    call("GET", "/lessons/{id}/before-after", ids=lesson, headers=teacher)
    due = call("POST", "/lessons/{id}/j7/schedule", ids=lesson, headers=teacher)["schedules"]
    assert len(due) == 1 and due[0]["status"] == "pending"
    assert all(task["kind"] != "j7_retest" for task in call("GET", "/me/retests", headers=student))
    call("POST", "/dev/clock/advance", headers=dev, body={"days": 7})
    tasks = call("GET", "/me/retests", headers=student)
    delayed = next(item for item in tasks if item["kind"] == "j7_retest")
    delayed_attempt = call("POST", "/quizzes/{id}/attempts", ids={"id": delayed["quiz_id"]}, headers=student)
    delayed_item = delayed_attempt["questions"][0]
    all_ids = {item["id"] for item in attempt["questions"]} | {
        confirmation["id"], immediate_item["id"], delayed_item["id"],
    }
    assert len(all_ids) == len(attempt["questions"]) + 3
    assert delayed["quiz_id"] == due[0]["quiz_id"]
    available = call("POST", "/lessons/{id}/j7/schedule", ids=lesson, headers=teacher)["schedules"]
    assert available[0]["status"] == "available" and available[0]["id"] == due[0]["id"]
    expected = {(method.upper(), path) for path, operations in spec["paths"].items() for method in operations}
    assert seen == expected, f"Operations missing examples: {expected - seen}"
    return spec


def write_contract():
    with TemporaryDirectory() as tmp:
        path = (Path(tmp) / "contract.db").as_posix()
        settings = Settings(
            _env_file=None, database_url=f"sqlite:///{path}", demo_mode=True,
            demo_admin_secret=DEMO_KEY, llm_enabled=False,
        )
        with TestClient(create_app(settings)) as client:
            spec = exercise_contract(client)
    DOCS.mkdir(exist_ok=True)
    (DOCS / "openapi.json").write_text(
        json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    write_contract()
