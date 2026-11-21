from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core.errors import error
from app.models import (
    Concept, LessonConcept, Misconception, MisconceptionConcept, Question, QuestionOption, QuizQuestion,
)
from app.models import enums as e
from app.schemas.learning import QuestionDraft, StudentQuestion, TeacherQuestion


def lesson_concepts(db: Session, lesson_id) -> list[Concept]:
    return list(db.scalars(select(Concept).join(LessonConcept).where(
        LessonConcept.lesson_id == lesson_id
    ).order_by(Concept.code)))


def allowed_codes(db: Session, concept_id) -> dict[str, UUID]:
    return dict(db.execute(select(Misconception.code, Misconception.id)
                           .join(MisconceptionConcept)
                           .where(MisconceptionConcept.concept_id == concept_id)).all())


def fingerprint(stem: str, code: str | None) -> tuple[str, str]:
    return " ".join(stem.casefold().split()), (code or "").strip()


def quiz_items(db: Session, quiz_id):
    return list(db.execute(select(QuizQuestion, Question, Concept).select_from(QuizQuestion)
                           .join(Question, Question.id == QuizQuestion.question_id)
                           .join(Concept, Concept.id == Question.concept_id)
                           .where(QuizQuestion.quiz_id == quiz_id).order_by(QuizQuestion.position)))


def opts(db: Session, question_id):
    return list(db.execute(select(QuestionOption, Misconception.code)
                           .outerjoin(Misconception, QuestionOption.misconception_id == Misconception.id)
                           .where(QuestionOption.question_id == question_id)
                           .order_by(QuestionOption.position)))


def question_input(db: Session, row: Question, code: str) -> QuestionDraft:
    return QuestionDraft(
        concept_code=code, stem=row.stem, code=row.code, difficulty=row.difficulty,
        explanation=row.explanation,
        options=[{"text": option.text, "is_correct": option.is_correct, "misconception_code": key}
                 for option, key in opts(db, row.id)],
    )


def teacher_view(db: Session, row: Question, concept_code: str):
    target_code = db.scalar(select(Misconception.code).where(Misconception.id == row.target_misconception_id))
    return TeacherQuestion(
        id=row.id, concept_code=concept_code, stem=row.stem, code=row.code, difficulty=row.difficulty,
        explanation=row.explanation, source=row.source, status=row.status, role=row.role,
        version=row.version, validated_at=row.validated_at, validated_by=row.validated_by,
        target_misconception_code=target_code,
        options=[{"id": option.id, "text": option.text, "is_correct": option.is_correct,
                  "misconception_code": key} for option, key in opts(db, row.id)],
    )


def student_view(db: Session, row: Question, concept_code: str):
    return StudentQuestion(
        id=row.id, concept_code=concept_code, stem=row.stem, code=row.code,
        options=[{"id": option.id, "text": option.text} for option, _ in opts(db, row.id)],
    )


def create_question(
    db: Session, data: QuestionDraft, *, source=e.Source.teacher, owner_id=None,
    role=e.QuestionRole.initial, target_code=None, concept_ids=None, version=1,
    family=None,
) -> Question:
    concept = db.scalar(select(Concept).where(Concept.code == data.concept_code))
    if concept is None or (concept_ids is not None and concept.id not in concept_ids):
        raise error(422, "UNKNOWN_CONCEPT", "Ce concept ne fait pas partie des concepts autorisés.")
    allowed = allowed_codes(db, concept.id)
    try:
        data.check_taxonomy(concept.code, set(allowed))
    except ValueError as exc:
        raise error(422, "INVALID_TAXONOMY", str(exc)) from None
    if (role == e.QuestionRole.confirmation and not target_code) or (
        target_code and (
            target_code not in allowed or not any(option.misconception_code == target_code for option in data.options)
        )
    ):
        raise error(422, "INVALID_TARGET", "Un distracteur doit correspondre à l’erreur ciblée.")
    question = Question(
        concept_id=concept.id, stem=data.stem, code=data.code, difficulty=data.difficulty,
        explanation=data.explanation, source=source, bank_owner_id=owner_id,
        role=role, status=e.QuestionStatus.draft, version=version,
        variant_family_id=family, target_misconception_id=allowed.get(target_code),
    )
    db.add(question)
    db.flush()
    db.add_all(QuestionOption(
        question_id=question.id, position=position, text=option.text,
        is_correct=option.is_correct, misconception_id=allowed.get(option.misconception_code),
    ) for position, option in enumerate(data.options, start=1))
    return question


def bank_items(db: Session, owner_id, *, role=None, concept_ids=None, seed_drafts=False):
    filters = [or_(Question.bank_owner_id == owner_id, Question.seed_key.is_not(None))]
    if role is not None:
        filters.append(Question.role == role)
    if concept_ids is not None:
        filters.append(Question.concept_id.in_(concept_ids))
    if not seed_drafts:
        filters.append(and_(Question.bank_owner_id == owner_id, Question.status == e.QuestionStatus.validated))
    return list(db.execute(select(Question, Concept).select_from(Question)
                           .join(Concept, Concept.id == Question.concept_id).where(*filters)
                           .order_by(Concept.code, Question.difficulty, Question.created_at, Question.id)))


def approve_question(db: Session, question: Question, teacher_id, now) -> None:
    concept = db.get(Concept, question.concept_id)
    value = question_input(db, question, concept.code)
    value.check_taxonomy(concept.code, set(allowed_codes(db, concept.id)))
    question.status = e.QuestionStatus.validated
    question.validated_by = teacher_id
    question.validated_at = now
