from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import error
from app.models import Attempt, Lesson, Quiz
from app.models.enums import LessonStatus, Role
from app.routers.identity import get_classroom


# Arbitrary constant naming the application's write lock in PostgreSQL's advisory-lock space.
WRITE_LOCK = 31478011


def start_write(db: Session) -> None:
    """Serialize read-check-write transactions, as the handlers that call this expect.

    SQLite gets this from BEGIN IMMEDIATE. PostgreSQL takes a transaction-scoped advisory lock with the
    same single-writer meaning, released at commit or rollback; without it, concurrent requests such as
    a double-started attempt both pass their existence checks and one fails on a unique constraint.
    Callers keep model inference outside these transactions, so the lock is held briefly.
    """
    connection = db.connection()
    if connection.dialect.name == "sqlite" and not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    elif connection.dialect.name == "postgresql":
        connection.exec_driver_sql(f"SELECT pg_advisory_xact_lock({WRITE_LOCK})")


def lesson_access(db, user, lesson_id, *, teacher=False, lock=False):
    lesson = db.get(Lesson, lesson_id)
    if lesson is None:
        raise error(404)
    classroom = get_classroom(lesson.classroom_id, user, db, teacher_only=teacher)
    if lock and db.get_bind().dialect.name == "postgresql":
        db.refresh(lesson, with_for_update=True)
    if user.role == Role.student and lesson.status == LessonStatus.draft:
        raise error(404)
    return lesson, classroom


def quiz_access(db, user, quiz_id, *, teacher=False, lock=False):
    quiz = db.get(Quiz, quiz_id)
    if quiz is None:
        raise error(404)
    lesson, classroom = lesson_access(db, user, quiz.lesson_id, teacher=teacher, lock=lock)
    if lock and db.get_bind().dialect.name == "postgresql":
        db.refresh(quiz, with_for_update=True)
    if user.role == Role.student and quiz.recipient_id not in (None, user.id):
        raise error(404)
    return quiz, lesson, classroom


def attempt_access(db, user, attempt_id):
    attempt = db.scalar(select(Attempt).where(Attempt.id == attempt_id, Attempt.student_id == user.id))
    if attempt is None:
        raise error(404)
    quiz, lesson, classroom = quiz_access(db, user, attempt.quiz_id)
    return attempt, quiz, lesson, classroom
