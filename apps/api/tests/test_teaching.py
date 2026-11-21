from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import func, select

from app.models import Classroom, Lesson, Membership
from app.models.documents import Institution, InstitutionMember
from app.models.teaching import CohortMembership, TeachingAssignment
from app.services.teaching import backfill_teaching
from conftest import call, login, register
from tools.provision_teaching import provision


def test_assignments_and_atomic_student_enrollment(api):
    alice = register(api, "alice", "teacher")
    bob = register(api, "bob", "teacher")
    teacher_ids = [UUID(call(api, "GET", "/me", actor)["id"]) for actor in (alice, bob)]
    with api.app.state.sessions.begin() as db:
        school = Institution(name="Université Test")
        other = Institution(name="Université Externe")
        db.add_all([school, other])
        db.flush()
        school_id, other_id = school.id, other.id
        db.add_all(InstitutionMember(institution_id=school_id, user_id=uid) for uid in teacher_ids)
        db.flush()
        cohort, python = provision(db, school_id, "2026-2027", "L1-A", policy="open",
                                   teacher_email="alice@example.com", subject_code="python_intro")
        _, maths = provision(db, school_id, "2026-2027", "L1-A",
                             teacher_email="bob@example.com", subject_code="analyse")
        _, data = provision(db, school_id, "2026-2027", "L2-A",
                            teacher_email="alice@example.com", subject_code="bdd")
        closed, _ = provision(db, school_id, "2026-2027", "L1-B", policy="closed")
        inactive, _ = provision(db, school_id, "2026-2027", "L3-A", policy="open", active=False)
        cohort_id, closed_id, inactive_id = str(cohort.id), str(closed.id), str(inactive.id)
        python_id, maths_id, data_id = map(str, (python.classroom_id, maths.classroom_id, data.classroom_id))

    public = call(api, "GET", "/registration/classes")
    assert [row["id"] for row in public] == [cohort_id]
    assert set(public[0]) == {"id", "name", "institution_id", "institution_name", "academic_year"}
    rooms = call(api, "GET", "/me/teaching-assignments", alice)
    assert {room["id"] for room in rooms} == {python_id, data_id}
    assert {room["subject"] for room in rooms} == {"python_intro", "bdd"}
    assert call(api, "GET", "/me/teaching-assignments", bob)[0]["cohort_id"] == cohort_id
    call(api, "GET", f"/classrooms/{maths_id}/members", alice, expected=404)
    call(api, "POST", f"/classrooms/{maths_id}/lessons", alice,
         {"title": "Interdit", "taught_on": "2026-11-22"}, expected=404)
    call(api, "POST", f"/classrooms/{python_id}/lessons", alice, {"title": "Sans date"}, expected=422)
    lesson = call(api, "POST", f"/classrooms/{python_id}/lessons", alice,
                  {"title": "Indices", "taught_on": "2026-11-22"}, expected=201)
    assert lesson["taught_on"] == "2026-11-22" and lesson["status"] == "draft"
    assert lesson["content_text"] == "" and lesson["concept_codes"] == []
    call(api, "GET", f"/lessons/{lesson['id']}", bob, expected=404)
    call(api, "POST", f"/lessons/{lesson['id']}/quiz/generate", alice, expected=409)

    payload = {"email": "enrolled@example.com", "full_name": "Nouvel étudiant",
               "password": "fixture-pass-123", "role": "student"}
    for target, institution in [(cohort_id, other_id), (closed_id, school_id), (inactive_id, school_id),
                                (str(uuid4()), school_id)]:
        call(api, "POST", "/auth/register", data={**payload, "cohort_id": target,
                                                  "institution_id": str(institution)}, expected=422)
    call(api, "POST", "/auth/register", data=payload, expected=422)
    good = payload | {"cohort_id": cohort_id, "institution_id": str(school_id)}
    profile = call(api, "POST", "/auth/register", data=good, expected=201)
    call(api, "POST", "/auth/register", data=good, expected=409)
    headers = login(api, payload["email"])
    assert {entry["subject"] for entry in call(api, "GET", "/classrooms", headers)} == {"python_intro", "analyse"}
    assert [entry["id"] for entry in call(api, "GET", "/me/cohorts", headers)] == [cohort_id]
    assert call(api, "GET", f"/classrooms/{python_id}/lessons", headers) == []
    call(api, "GET", f"/lessons/{lesson['id']}", headers, expected=404)
    call(api, "GET", f"/classrooms/{data_id}/lessons", headers, expected=404)
    with api.app.state.sessions() as db:
        uid = UUID(profile["id"])
        assert db.scalar(select(func.count()).select_from(CohortMembership).where(CohortMembership.user_id == uid)) == 1
        assert db.scalar(select(CohortMembership.is_primary).where(CohortMembership.user_id == uid))
        assert db.scalar(select(func.count()).select_from(Membership).where(Membership.user_id == uid)) == 2


def test_legacy_backfill_preserves_existing_workspace_memberships_and_unknown_dates(api):
    teacher, student = register(api, "legacy-teacher", "teacher"), register(api, "legacy-student", "student")
    owner, learner = [UUID(call(api, "GET", "/me", actor)["id"]) for actor in (teacher, student)]
    with api.app.state.sessions.begin() as db:
        room = Classroom(teacher_id=owner, subject="python_intro", name="Classe historique", join_code="LEGACY24",
                         join_expires_at=datetime.now(UTC) + timedelta(days=1))
        db.add(room)
        db.flush()
        membership = Membership(classroom_id=room.id, user_id=learner, pseudonym="Historique")
        lesson = Lesson(classroom_id=room.id, title="Ancien cours", content_text="Support conservé",
                        focus_brief_json={}, status="published")
        db.add_all([membership, lesson])
        db.flush()
        room_id, member_id, lesson_id = room.id, membership.id, lesson.id
        backfill_teaching(db)
        db.flush()
        backfill_teaching(db)
        assert db.scalar(select(func.count()).select_from(TeachingAssignment).where(
            TeachingAssignment.classroom_id == room_id)) == 1
    rows = call(api, "GET", f"/classrooms/{room_id}/members", teacher)
    assert rows[0]["id"] == str(member_id)
    kept = call(api, "GET", f"/lessons/{lesson_id}", student)
    assert kept["content_text"] == "Support conservé" and kept["taught_on"] is None
