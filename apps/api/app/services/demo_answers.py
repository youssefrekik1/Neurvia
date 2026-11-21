"""Generate reproducible answers only for the explicitly seeded demo roster."""
from hashlib import sha256
from random import Random

from sqlalchemy import select

from app.models import Attempt, Membership, User
from app.models import enums as e
from app.schemas.learning import AnswerInput
from app.services.assessments import get_or_begin, save_choice, submit_attempt
from app.services.demo_seed import ALGO_TEACHER_ID, CLASSROOM_IDS
from app.services.demo_students import CLASSROOMS, STUDENTS
from app.services.questions import opts, quiz_items


def answer_demo_quiz(db, quiz, classroom, now):
    if (not classroom.is_synthetic or quiz.kind != e.QuestionRole.initial
            or classroom.teacher_id != ALGO_TEACHER_ID or classroom.id not in CLASSROOM_IDS):
        return
    class_name = CLASSROOMS[CLASSROOM_IDS.index(classroom.id)]["nom"]
    roster = {student["identifiant"] for student in STUDENTS if student["classe"] == class_name}
    if not roster:
        return
    users = db.scalars(select(User).join(Membership, Membership.user_id == User.id).where(
        Membership.classroom_id == classroom.id, User.email.in_(roster),
        User.is_synthetic.is_(True), User.role == e.Role.student,
    )).all()
    items = quiz_items(db, quiz.id)
    for user in users:
        if db.scalar(select(Attempt.id).where(Attempt.quiz_id == quiz.id, Attempt.student_id == user.id)):
            continue
        rng = Random(int.from_bytes(sha256(f"{quiz.id}:{user.id}".encode()).digest(), "big"))
        accuracy = rng.uniform(0.45, 0.9)
        attempt = get_or_begin(db, quiz, user.id, now)
        for _, question, _ in items:
            options = [row for row, _ in opts(db, question.id)]
            correct = [row for row in options if row.is_correct]
            incorrect = [row for row in options if not row.is_correct]
            candidates = correct if rng.random() < accuracy or not incorrect else incorrect
            option = rng.choice(candidates)
            save_choice(db, attempt, quiz, AnswerInput(
                question_id=question.id, option_id=option.id,
                confidence=rng.choice(list(e.Confidence)),
            ))
        submit_attempt(db, attempt, quiz, classroom, now)
