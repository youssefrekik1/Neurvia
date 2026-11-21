from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import error
from app.models import Attempt, Lesson, Quiz
from app.models.enums import LessonStatus, Role
from app.routers.identity import get_classroom


def start_write(db: Session) -> None:
    connection = db.connection()
    if connection.dialect.name == "sqlite" and not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")


def lesson_access(db, user, lesson_id, *, teacher=False):
    lesson = db.get(Lesson, lesson_id)
    if lesson is None:
        raise error(404)
    classroom = get_classroom(lesson.classroom_id, user, db, teacher_only=teacher)
    if user.role == Role.student and lesson.status == LessonStatus.draft:
        raise error(404)
    return lesson, classroom


def quiz_access(db, user, quiz_id, *, teacher=False):
    quiz = db.get(Quiz, quiz_id)
    if quiz is None:
        raise error(404)
    lesson, classroom = lesson_access(db, user, quiz.lesson_id, teacher=teacher)
    if user.role == Role.student and quiz.recipient_id not in (None, user.id):
        raise error(404)
    return quiz, lesson, classroom


def attempt_access(db, user, attempt_id):
    attempt = db.scalar(select(Attempt).where(Attempt.id == attempt_id, Attempt.student_id == user.id))
    if attempt is None:
        raise error(404)
    quiz, lesson, classroom = quiz_access(db, user, attempt.quiz_id)
    return attempt, quiz, lesson, classroom
