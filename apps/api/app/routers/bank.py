from uuid import UUID

from fastapi import APIRouter
from sqlalchemy import select

from app.core.auth import Teacher
from app.core.clock import SystemClock
from app.core.errors import documented_errors, error
from app.db.session import Db
from app.models import Concept, Question
from app.models.enums import QuestionStatus, Source
from app.schemas.common import Approval
from app.schemas.learning import BankQuestionCreate, TeacherQuestion
from app.services.access import start_write
from app.services.questions import approve_question, bank_items, create_question, question_input, teacher_view

router = APIRouter(prefix="/bank/questions", tags=["Banque pédagogique"],
                   responses=documented_errors(401, 403, 404, 409, 422))


@router.get("", response_model=list[TeacherQuestion])
def list_questions(user: Teacher, db: Db):
    return [teacher_view(db, question, concept.code)
            for question, concept in bank_items(db, user.id, seed_drafts=True)]


@router.post("", response_model=TeacherQuestion, status_code=201)
def add_question(data: BankQuestionCreate, user: Teacher, db: Db):
    start_write(db)
    row = create_question(db, data, owner_id=user.id, role=data.role, target_code=data.target_misconception_code)
    db.commit()
    return teacher_view(db, row, data.concept_code)


@router.post("/{id}/approve", response_model=TeacherQuestion)
def approve(id: UUID, data: Approval, user: Teacher, db: Db):
    if not data.validated:
        raise error(409, "TEACHER_VALIDATION_REQUIRED", "La validation explicite est requise.")
    start_write(db)
    row = db.get(Question, id)
    if row is None or (row.seed_key is None and row.bank_owner_id != user.id):
        raise error(404)
    concept = db.get(Concept, row.concept_id)
    if row.seed_key:
        existing = db.scalar(select(Question).where(
            Question.bank_owner_id == user.id, Question.variant_family_id == f"seed:{row.seed_key}"
        ))
        row = existing or create_question(
            db, question_input(db, row, concept.code), source=Source.bank, owner_id=user.id,
            role=row.role, family=f"seed:{row.seed_key}",
        )
    if row.status == QuestionStatus.draft:
        approve_question(db, row, user.id, SystemClock().now())
    db.commit()
    return teacher_view(db, row, concept.code)
