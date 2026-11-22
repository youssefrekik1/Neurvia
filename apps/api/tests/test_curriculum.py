"""Classes (cohorts), the subjects a teacher teaches, and automatic enrolment in their courses."""

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from tests.conftest import call, login


def register(client, name, role, cohort_id=None):
    payload = {"email": f"{name}@example.com", "full_name": name, "role": role, "password": "fixture-pass-123"}
    if cohort_id:
        payload["cohort_id"] = cohort_id
    call(client, "POST", "/auth/register", data=payload, expected=201)
    return login(client, payload["email"])


def test_teacher_subjects_classes_and_student_enrolment(api):
    teacher = register(api, "prof-multi", "teacher")
    a = call(api, "POST", "/cohorts", teacher, {"name": "L2 Info A"}, 201)
    b = call(api, "POST", "/cohorts", teacher, {"name": "L2 Info B"}, 201)
    call(api, "POST", "/cohorts", teacher, {"name": "l2 info a"}, 409)
    assert {row["name"] for row in call(api, "GET", "/cohorts")} >= {"L2 Info A", "L2 Info B"}

    student = register(api, "eleve-a", "student", a["id"])
    assert call(api, "GET", "/me/cohort", student)["name"] == "L2 Info A"
    call(api, "POST", "/me/cohort", student, {"cohort_id": b["id"]}, 409)

    algo = call(api, "POST", "/subjects", teacher, {"name": "Algorithmique & Python", "cohort_ids": [a["id"], b["id"]]}, 201)
    assert algo["key"] == "python_intro" and len(algo["courses"]) == 2
    bd = call(api, "POST", "/subjects", teacher, {"name": "Bases de données", "cohort_ids": [a["id"]]}, 201)
    assert bd["key"] == "Bases de données"
    call(api, "POST", "/subjects", teacher, {"name": "Bases de données", "cohort_ids": []}, 409)

    # The student of class A sees both courses taught to A, and none of class B.
    courses = {row["name"]: row for row in call(api, "GET", "/classrooms", student)}
    assert set(courses) == {"Algorithmique & Python · L2 Info A", "Bases de données · L2 Info A"}
    assert courses["Bases de données · L2 Info A"]["cohort_name"] == "L2 Info A"
    assert courses["Bases de données · L2 Info A"]["subject_name"] == "Bases de données"

    # A student who joins later is enrolled in every course already taught to the class.
    late = register(api, "eleve-a2", "student")
    call(api, "POST", "/me/cohort", late, {"cohort_id": a["id"]})
    assert len(call(api, "GET", "/classrooms", late)) == 2
    teacher_rooms = {row["name"]: row["id"] for row in call(api, "GET", "/classrooms", teacher)}
    assert len(call(api, "GET", f"/classrooms/{teacher_rooms['Algorithmique & Python · L2 Info A']}/members", teacher)) == 2

    # A course without lessons can be dropped; one with lessons is kept.
    algo = call(api, "PUT", f"/subjects/{algo['id']}/cohorts", teacher, {"cohort_ids": [a["id"]]})
    assert [course["cohort_name"] for course in algo["courses"]] == ["L2 Info A"]
    call(api, "POST", f"/classrooms/{teacher_rooms['Algorithmique & Python · L2 Info A']}/lessons", teacher, {
        "title": "Indices", "content_text": "Cours", "concept_codes": ["C_INDEXING"]}, 201)
    call(api, "PUT", f"/subjects/{algo['id']}/cohorts", teacher, {"cohort_ids": []}, 409)

    other = register(api, "prof-other", "teacher")
    assert call(api, "GET", "/me/cohorts", other) == []
    assert {row["name"] for row in call(api, "GET", "/me/cohorts", teacher)} == {"L2 Info A", "L2 Info B"}
    call(api, "PUT", f"/subjects/{algo['id']}/cohorts", other, {"cohort_ids": []}, 404)
    call(api, "POST", "/me/cohort", teacher, {"cohort_id": a["id"]}, 403)


def test_classroom_created_the_old_way_becomes_a_class_and_course(api):
    teacher = register(api, "prof-legacy", "teacher")
    room = call(api, "POST", "/classrooms", teacher, {"name": "Groupe du jeudi"}, 201)
    assert room["cohort_name"] == "Groupe du jeudi" and room["subject_name"] == "Algorithmique & Python"
    student = register(api, "eleve-code", "student")
    call(api, "POST", "/classrooms/join", student, {"code": room["join_code"]})
    assert [row["name"] for row in call(api, "GET", "/subjects", teacher)] == ["Algorithmique & Python"]


def test_demo_has_three_classes_and_two_subjects(database_url):
    settings = Settings(_env_file=None, database_url=database_url, demo_mode=True, llm_enabled=False)
    with TestClient(create_app(settings)) as client:
        names = {row["name"] for row in call(client, "GET", "/cohorts")}
        assert {"L1 Informatique A", "L1 Informatique B", "L1 Informatique C"} <= names
        teacher = login(client, "amel.bensalem.prof@neurvia.demo", "Algo-Prof-2026!")
        subjects = {row["name"]: [course["cohort_name"] for course in row["courses"]]
                    for row in call(client, "GET", "/subjects", teacher)}
        assert subjects["Algorithmique & Python"] == ["L1 Informatique A", "L1 Informatique B", "L1 Informatique C"]
        assert subjects["Bases de données"] == ["L1 Informatique B", "L1 Informatique C"]
        student = login(client, "yassine.01.c@neurvia.demo", "Algo-C-01-2026")
        assert call(client, "GET", "/me/cohort", student)["name"] == "L1 Informatique C"
        assert len(call(client, "GET", "/classrooms", student)) == 2
    # Synthetic classes are hidden from sign-up outside the demo.
    with TestClient(create_app(Settings(_env_file=None, database_url=database_url, llm_enabled=False))) as client:
        assert not {"L1 Informatique A"} & {row["name"] for row in call(client, "GET", "/cohorts")}
