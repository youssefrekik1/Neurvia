from uuid import UUID, uuid4

from fastapi import APIRouter, Request
from sqlalchemy import delete, func, select

from app.core.auth import CurrentUser, Teacher
from app.core.errors import documented_errors, error
from app.db.session import Db
from app.documents.access import classroom_institution, scope_for
from app.documents.taxonomy import visible_concepts
from app.models import Attempt, Concept, Lesson, LessonConcept, Misconception, MisconceptionConcept, Quiz, QuizQuestion
from app.models.documents import InstitutionConcept
from app.models.teaching import AcademicYear, Cohort, TeachingAssignment
from app.models.enums import AttemptStatus, LessonStatus, QuestionRole, Role
from app.routers.identity import get_classroom
from app.schemas.common import ConceptView, MisconceptionView
from app.schemas.learning import LessonCreate, LessonView, TaxonomyApproval
from app.services.access import lesson_access, start_write
from app.services.questions import lesson_concepts

router = APIRouter(tags=["Séances et taxonomie"], responses=documented_errors(401, 403, 404, 409, 422))


@router.get("/taxonomy", response_model=list[ConceptView])
def taxonomy(user: CurrentUser, db: Db):
    concepts = {item.id: ConceptView(code=item.code, label_fr=item.label_fr, subject=item.subject, misconceptions=[])
                for item in db.scalars(select(Concept).where(visible_concepts(user)).order_by(Concept.code))}
    for concept_id, code, label in db.execute(
        select(MisconceptionConcept.concept_id, Misconception.code, Misconception.label_fr)
        .join(Misconception).where(MisconceptionConcept.concept_id.in_(concepts)).order_by(Misconception.code)
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
        submitted_count=submitted, created_at=row.created_at, taught_on=row.taught_on,
        question_count=db.scalar(select(func.count()).select_from(QuizQuestion).where(QuizQuestion.quiz_id == quiz.id))
        if quiz else 0,
    )


def resolve_concepts(db, data, classroom, user):
    concepts = list(db.scalars(select(Concept).where(
        Concept.code.in_(data.concept_codes), Concept.subject == classroom.subject,
        visible_concepts(user, classroom.id),
    )))
    if len(concepts) != len(data.concept_codes):
        raise error(422, "UNKNOWN_CONCEPT", "Un concept ne correspond pas à la matière.")
    return concepts


@router.post("/classrooms/{id}/lessons", response_model=LessonView, status_code=201)
def create_lesson(id: UUID, data: LessonCreate, user: Teacher, db: Db):
    start_write(db)
    classroom = get_classroom(id, user, db, teacher_only=True)
    cohort, year = db.execute(select(Cohort, AcademicYear).join(AcademicYear)
        .join(TeachingAssignment, TeachingAssignment.cohort_id == Cohort.id)
        .where(TeachingAssignment.classroom_id == id)).one()
    if not cohort.active or not year.active:
        raise error(409, "INACTIVE_ASSIGNMENT", "Cette affectation n’accepte plus de nouvelles séances.")
    if data.taught_on is None and (not cohort.legacy or not data.content_text):
        raise error(422, "TEACHING_DATE_REQUIRED", "Choisissez la date de la séance.")
    concepts = resolve_concepts(db, data, classroom, user)
    row = Lesson(classroom_id=id, title=data.title, content_text=data.content_text, taught_on=data.taught_on,
                 focus_brief_json=data.focus_brief.model_dump(), status=LessonStatus.draft)
    db.add(row)
    db.flush()
    db.add_all(LessonConcept(lesson_id=row.id, concept_id=concept.id) for concept in concepts)
    db.commit()
    return lesson_view(db, row, classroom, True)


@router.get("/classrooms/{id}/lessons", response_model=list[LessonView])
def list_lessons(id: UUID, user: CurrentUser, db: Db):
    classroom = get_classroom(id, user, db)
    query = select(Lesson).where(Lesson.classroom_id == id).order_by(
        Lesson.taught_on.desc().nulls_last(), Lesson.created_at.desc())
    teacher = user.role == Role.teacher
    if not teacher:
        query = query.where(Lesson.status != LessonStatus.draft)
    return [lesson_view(db, row, classroom, teacher) for row in db.scalars(query)]


def require_validation(data):
    if not data.validated:
        raise error(409, "TEACHER_VALIDATION_REQUIRED", "Confirmez la validation de la taxonomie.")


def add_concept(db, request, user, institution_id, classroom, data):
    """Persist a teacher-validated concept and its misconceptions for the classroom's subject."""
    concept = Concept(code=f"C_{uuid4().hex.upper()}", subject=classroom.subject, label_fr=data.label)
    db.add(concept)
    db.flush()
    db.add(InstitutionConcept(institution_id=institution_id, concept_id=concept.id,
                              validated_by=user.id, validated_at=request.app.state.system_clock.now()))
    values = []
    for item in data.misconceptions:
        misconception = Misconception(code=f"M_{uuid4().hex.upper()}", label_fr=item.label,
                                      remediation_hint=item.remediation_hint)
        db.add(misconception)
        db.flush()
        db.add(MisconceptionConcept(concept_id=concept.id, misconception_id=misconception.id))
        values.append(MisconceptionView(code=misconception.code, label_fr=misconception.label_fr))
    return concept, ConceptView(code=concept.code, label_fr=concept.label_fr, subject=concept.subject,
                                misconceptions=values)


@router.post("/classrooms/{id}/taxonomy", response_model=ConceptView, status_code=201)
def approve_classroom_taxonomy(id: UUID, data: TaxonomyApproval, request: Request, user: Teacher, db: Db):
    """Validate a concept for the classroom's subject before any lesson exists, e.g. for a new subject."""
    require_validation(data)
    start_write(db)
    classroom = get_classroom(id, user, db, teacher_only=True)
    institution = classroom_institution(db, user, classroom, create=True)
    _, view = add_concept(db, request, user, institution, classroom, data)
    db.commit()
    return view


@router.post("/lessons/{id}/taxonomy", response_model=ConceptView, status_code=201)
def approve_taxonomy(id: UUID, data: TaxonomyApproval, request: Request, user: Teacher, db: Db):
    require_validation(data)
    scope = scope_for(db, user, id, create=True)
    row, classroom = lesson_access(db, user, id, teacher=True)
    if row.status != LessonStatus.draft or current_quiz(db, id):
        raise error(409, "LESSON_IMMUTABLE", "Validez les notions avant de créer le brouillon de quiz.")
    if len(lesson_concepts(db, id)) >= 20:
        raise error(409, "LESSON_CONCEPT_LIMIT", "Une séance peut contenir vingt notions.")
    concept, view = add_concept(db, request, user, scope.institution_id, classroom, data)
    db.add(LessonConcept(lesson_id=id, concept_id=concept.id))
    db.commit()
    return view


@router.get("/lessons/{id}", response_model=LessonView)
def read_lesson(id: UUID, user: CurrentUser, db: Db):
    row, classroom = lesson_access(db, user, id)
    return lesson_view(db, row, classroom, user.role == Role.teacher)


@router.patch("/lessons/{id}", response_model=LessonView)
def edit_lesson(id: UUID, data: LessonCreate, user: Teacher, db: Db):
    start_write(db)
    row, classroom = lesson_access(db, user, id, teacher=True, lock=True)
    if row.status != LessonStatus.draft:
        raise error(409, "LESSON_IMMUTABLE", "Cette séance est déjà publiée.")
    concepts = resolve_concepts(db, data, classroom, user)
    quiz = current_quiz(db, row.id)
    if quiz and set(data.concept_codes) != {c.code for c in lesson_concepts(db, row.id)}:
        raise error(409, "QUIZ_EXISTS", "Conservez les concepts du quiz déjà préparé.")
    row.title = data.title
    if "taught_on" in data.model_fields_set:
        if data.taught_on is None and row.taught_on is not None:
            raise error(422, "TEACHING_DATE_REQUIRED", "Choisissez la date de la séance.")
        row.taught_on = data.taught_on
    row.content_text = data.content_text
    row.focus_brief_json = data.focus_brief.model_dump()
    db.execute(delete(LessonConcept).where(LessonConcept.lesson_id == id))
    db.add_all(LessonConcept(lesson_id=id, concept_id=concept.id) for concept in concepts)
    db.commit()
    return lesson_view(db, row, classroom, True)
