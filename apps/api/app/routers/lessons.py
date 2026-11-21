from uuid import UUID

from fastapi import APIRouter
from sqlalchemy import delete, func, select

from app.core.auth import CurrentUser, Teacher
from app.core.errors import documented_errors, error
from app.db.session import Db
from app.models import Attempt, Concept, Lesson, LessonConcept, Misconception, MisconceptionConcept, Quiz, QuizQuestion
from app.models.enums import AttemptStatus, LessonStatus, QuestionRole, Role
from app.routers.identity import get_classroom
from app.schemas.common import ConceptView, MisconceptionView
from app.schemas.learning import LessonCreate, LessonView
from app.services.access import lesson_access, start_write
from app.services.questions import lesson_concepts

router = APIRouter(tags=["Séances et taxonomie"], responses=documented_errors(401, 403, 404, 409, 422))


@router.get("/taxonomy", response_model=list[ConceptView])
def taxonomy(user: CurrentUser, db: Db):
    concepts = {item.id: ConceptView(code=item.code, label_fr=item.label_fr, misconceptions=[])
                for item in db.scalars(select(Concept).order_by(Concept.code))}
    for concept_id, code, label in db.execute(
        select(MisconceptionConcept.concept_id, Misconception.code, Misconception.label_fr)
        .join(Misconception).order_by(Misconception.code)
    ):
        concepts[concept_id].misconceptions.append(MisconceptionView(code=code, label_fr=label))
    return list(concepts.values())


def current_quiz(db, lesson_id):
    return db.scalar(select(Quiz).where(
        Quiz.lesson_id == lesson_id, Quiz.kind == QuestionRole.initial
    ).order_by(Quiz.created_at.desc()).limit(1))


def lesson_view(db, row, classroom, teacher):
    quiz = current_quiz(db, row.id)
    submitted = 0
    if quiz and teacher:
        submitted = db.scalar(select(func.count()).select_from(Attempt).where(
            Attempt.quiz_id == quiz.id, Attempt.status == AttemptStatus.submitted,
        ))
    return LessonView(
        id=row.id, classroom_id=row.classroom_id, title=row.title,
        concept_codes=[c.code for c in lesson_concepts(db, row.id)], status=row.status,
        is_synthetic=classroom.is_synthetic,
        content_text=row.content_text if teacher or row.status != LessonStatus.draft else None,
        focus_brief=row.focus_brief_json if teacher else None,
        quiz_id=quiz.id if quiz else None, quiz_status=quiz.status if quiz else None,
        submitted_count=submitted, created_at=row.created_at,
        question_count=db.scalar(select(func.count()).select_from(QuizQuestion).where(QuizQuestion.quiz_id == quiz.id))
        if quiz else 0,
    )


def resolve_concepts(db, data, classroom):
    concepts = list(db.scalars(select(Concept).where(
        Concept.code.in_(data.concept_codes), Concept.subject == classroom.subject,
    )))
    if len(concepts) != len(data.concept_codes):
        raise error(422, "UNKNOWN_CONCEPT", "Un concept ne correspond pas à la matière.")
    return concepts


@router.post("/classrooms/{id}/lessons", response_model=LessonView, status_code=201)
def create_lesson(id: UUID, data: LessonCreate, user: Teacher, db: Db):
    classroom = get_classroom(id, user, db, teacher_only=True)
    concepts = resolve_concepts(db, data, classroom)
    row = Lesson(classroom_id=id, title=data.title, content_text=data.content_text,
                 focus_brief_json=data.focus_brief.model_dump(), status=LessonStatus.draft)
    db.add(row)
    db.flush()
    db.add_all(LessonConcept(lesson_id=row.id, concept_id=concept.id) for concept in concepts)
    db.commit()
    return lesson_view(db, row, classroom, True)


@router.get("/classrooms/{id}/lessons", response_model=list[LessonView])
def list_lessons(id: UUID, user: CurrentUser, db: Db):
    classroom = get_classroom(id, user, db)
    query = select(Lesson).where(Lesson.classroom_id == id).order_by(Lesson.created_at.desc())
    teacher = user.role == Role.teacher
    if not teacher:
        query = query.where(Lesson.status != LessonStatus.draft)
    return [lesson_view(db, row, classroom, teacher) for row in db.scalars(query)]


@router.get("/lessons/{id}", response_model=LessonView)
def read_lesson(id: UUID, user: CurrentUser, db: Db):
    row, classroom = lesson_access(db, user, id)
    return lesson_view(db, row, classroom, user.role == Role.teacher)


@router.patch("/lessons/{id}", response_model=LessonView)
def edit_lesson(id: UUID, data: LessonCreate, user: Teacher, db: Db):
    start_write(db)
    row, classroom = lesson_access(db, user, id, teacher=True)
    if row.status != LessonStatus.draft:
        raise error(409, "LESSON_IMMUTABLE", "Cette séance est déjà publiée.")
    concepts = resolve_concepts(db, data, classroom)
    quiz = current_quiz(db, row.id)
    if quiz and set(data.concept_codes) != {c.code for c in lesson_concepts(db, row.id)}:
        raise error(409, "QUIZ_EXISTS", "Conservez les concepts du quiz déjà préparé.")
    row.title = data.title
    row.content_text = data.content_text
    row.focus_brief_json = data.focus_brief.model_dump()
    db.execute(delete(LessonConcept).where(LessonConcept.lesson_id == id))
    db.add_all(LessonConcept(lesson_id=id, concept_id=concept.id) for concept in concepts)
    db.commit()
    return lesson_view(db, row, classroom, True)
