from uuid import UUID

from fastapi import APIRouter
from sqlalchemy import select

from app.core.auth import CurrentUser, Teacher
from app.core.errors import documented_errors, error
from app.db.session import Db
from app.models import Concept, Lesson, LessonConcept, Misconception, MisconceptionConcept
from app.models.enums import LessonStatus, Role
from app.routers.identity import get_classroom
from app.schemas.common import ConceptView, MisconceptionView
from app.schemas.learning import LessonCreate, LessonView

router = APIRouter(tags=["Séances et taxonomie"])


@router.get("/taxonomy", response_model=list[ConceptView], responses=documented_errors(401))
def taxonomy(user: CurrentUser, db: Db):
    concepts = {item.id: ConceptView(code=item.code, label_fr=item.label_fr, misconceptions=[])
                for item in db.scalars(select(Concept).order_by(Concept.code))}
    for concept_id, code, label in db.execute(
        select(MisconceptionConcept.concept_id, Misconception.code, Misconception.label_fr)
        .join(Misconception).order_by(Misconception.code)
    ):
        concepts[concept_id].misconceptions.append(MisconceptionView(code=code, label_fr=label))
    return list(concepts.values())


@router.post("/classrooms/{id}/lessons", response_model=LessonView, status_code=201,
             responses=documented_errors(401, 403, 404, 422))
def create_lesson(id: UUID, data: LessonCreate, user: Teacher, db: Db):
    classroom = get_classroom(id, user, db, teacher_only=True)
    concepts = db.scalars(select(Concept).where(
        Concept.code.in_(data.concept_codes), Concept.subject == classroom.subject,
    )).all()
    if len(concepts) != len(data.concept_codes):
        raise error(422, "UNKNOWN_CONCEPT", "Un concept ne correspond pas à la matière.")
    row = Lesson(
        classroom_id=id, title=data.title, content_text=data.content_text,
        focus_brief_json=data.focus_brief.model_dump(), status=LessonStatus.draft,
    )
    db.add(row)
    db.flush()
    db.add_all(LessonConcept(lesson_id=row.id, concept_id=concept.id) for concept in concepts)
    db.commit()
    return lesson_view(row, classroom.is_synthetic, sorted(data.concept_codes), True)


def lesson_view(row: Lesson, synthetic: bool, concept_codes: list[str], teacher: bool):
    return LessonView(
        id=row.id, classroom_id=row.classroom_id, title=row.title, concept_codes=concept_codes,
        status=row.status, is_synthetic=synthetic, content_text=row.content_text if teacher else None,
        focus_brief=row.focus_brief_json if teacher else None,
    )


@router.get("/lessons/{id}", response_model=LessonView,
            responses=documented_errors(401, 404, 422))
def read_lesson(id: UUID, user: CurrentUser, db: Db):
    row = db.get(Lesson, id)
    if row is None:
        raise error(404)
    classroom = get_classroom(row.classroom_id, user, db)
    teacher = user.role == Role.teacher
    if not teacher and row.status == LessonStatus.draft:
        raise error(404)
    concept_codes = list(db.scalars(select(Concept.code).join(LessonConcept).where(
        LessonConcept.lesson_id == id
    ).order_by(Concept.code)))
    return lesson_view(row, classroom.is_synthetic, concept_codes, teacher)
