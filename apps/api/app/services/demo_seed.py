from datetime import timedelta
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import password_hash
from app.models import Classroom, Concept, Lesson, LessonConcept, Membership, User
from app.models import enums as e


def fixture_id(key: str):
    return uuid5(NAMESPACE_URL, f"fahm:phase-0:{key}")


TEACHER_ID = fixture_id("teacher")
STUDENT_IDS = tuple(fixture_id(f"student-{number}") for number in range(1, 4))
CLASSROOM_ID = fixture_id("classroom")
LESSON_ID = fixture_id("lesson")
DEMO_JOIN_CODE = "FAHMDEMO24"
DEMO_PASSWORD = "FAHM-demo-2026"


def seed_demo(db: Session, now):
    if db.get(Classroom, CLASSROOM_ID) is not None:
        return
    hash_value = password_hash.hash(DEMO_PASSWORD)
    db.add(User(
        id=TEACHER_ID, email="prof.fahm@example.com", password_hash=hash_value,
        full_name="Professeur Démo", role=e.Role.teacher, is_synthetic=True,
    ))
    for number, student_id in enumerate(STUDENT_IDS, start=1):
        db.add(User(
            id=student_id, email=f"eleve{number}.fahm@example.com", password_hash=hash_value,
            full_name=f"Étudiant Démo {number:02}", role=e.Role.student, is_synthetic=True,
        ))
    db.flush()
    db.add(Classroom(
        id=CLASSROOM_ID, teacher_id=TEACHER_ID, name="Algorithmique — classe fictive",
        subject="python_intro", join_code=DEMO_JOIN_CODE,
        join_expires_at=now + timedelta(days=30), is_synthetic=True,
    ))
    db.flush()
    for number, student_id in enumerate(STUDENT_IDS, start=1):
        db.add(Membership(
            id=fixture_id(f"membership-{number}"), classroom_id=CLASSROOM_ID,
            user_id=student_id, pseudonym=f"Étudiant {number:02}",
        ))
    db.add(Lesson(
        id=LESSON_ID, classroom_id=CLASSROOM_ID, title="Boucles et indices Python",
        content_text="Observer les bornes de range et les indices valides d'une liste.",
        focus_brief_json={"difficulty": 1, "question_count": 4},
        status=e.LessonStatus.published,
    ))
    db.flush()
    for concept in db.scalars(select(Concept).where(Concept.code.in_(["C_LOOPS", "C_INDEXING"]))):
        db.add(LessonConcept(lesson_id=LESSON_ID, concept_id=concept.id))
