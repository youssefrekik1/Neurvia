from uuid import UUID

from fastapi import APIRouter, Request
from sqlalchemy import select

from app.ai.tasks import generate_question
from app.core.auth import Teacher
from app.core.errors import documented_errors, error
from app.db.session import Db
from app.documents.access import scope_for
from app.documents.generation import verify_question
from app.documents.provenance import question_references, require_fresh, save_sources, source_views
from app.models.documents import GroundedQuiz, SourceCitation
from app.models import Quiz, QuizQuestion, TeacherDecision
from app.models.enums import LessonStatus, QuestionRole, QuizStatus, Source
from app.routers.lessons import current_quiz
from app.schemas.common import Approval
from app.schemas.learning import FocusBrief, QuestionDraft, QuestionRegenerate, QuizGenerate, TeacherQuestion, TeacherQuiz
from app.services.access import lesson_access, quiz_access, start_write
from app.services.questions import (
    allowed_codes, approve_question, bank_items, create_question, fingerprint, lesson_concepts,
    question_input, quiz_items, teacher_view,
)

router = APIRouter(tags=["Quiz et validation"], responses=documented_errors(401, 403, 404, 409, 422))


def quiz_view(db, quiz, classroom):
    return TeacherQuiz(
        id=quiz.id, lesson_id=quiz.lesson_id, status=quiz.status, kind=quiz.kind,
        generation_mode=quiz.generation_mode, used_fallback=quiz.used_fallback,
        validated_by=quiz.validated_by, validated_at=quiz.validated_at,
        questions=[teacher_view(db, item, concept.code) for _, item, concept in quiz_items(db, quiz.id)],
        is_synthetic=classroom.is_synthetic, is_grounded=is_grounded(db, quiz.id),
    )


def is_grounded(db, quiz_id):
    return db.scalar(select(GroundedQuiz.id).where(GroundedQuiz.quiz_id == quiz_id)) is not None


def require_grounded_generator(db, quiz_id):
    if is_grounded(db, quiz_id):
        raise error(409, "GROUNDED_GENERATOR_REQUIRED", "Ajoutez ou régénérez cet item depuis l’assistant du cours.")


def require_draft(quiz):
    if quiz.kind != QuestionRole.initial or quiz.status != QuizStatus.draft:
        raise error(409, "QUIZ_IMMUTABLE", "Seul un brouillon peut être modifié.")


def require_unique(data, items, *, excluding=None):
    if any(item.id != excluding and fingerprint(item.stem, item.code) == fingerprint(data.stem, data.code)
           for _, item, _ in items):
        raise error(409, "DUPLICATE_QUESTION", "Cette question figure déjà dans le quiz.")


@router.post("/lessons/{id}/quiz/generate", response_model=TeacherQuiz)
def generate_quiz(id: UUID, request: Request, user: Teacher, db: Db, data: QuizGenerate | None = None):
    data = data or QuizGenerate()
    lesson, classroom = lesson_access(db, user, id, teacher=True)
    existing = current_quiz(db, id)
    if existing is not None:
        require_draft(existing)
        return quiz_view(db, existing, classroom)

    teacher_id = user.id
    concepts = lesson_concepts(db, id)
    concept_ids = {c.id for c in concepts}
    codes = [c.code for c in concepts]
    taxonomy = {c.code: set(allowed_codes(db, c.id)) for c in concepts}
    context = lesson.content_text
    revision = lesson.updated_at
    brief = FocusBrief.model_validate(lesson.focus_brief_json)
    count = data.question_count or brief.question_count
    approved = {code: [] for code in codes}
    optional = {code: [] for code in codes}
    for row, concept in bank_items(db, teacher_id, role=QuestionRole.initial,
                                   concept_ids=concept_ids, seed_drafts=data.use_seed_drafts):
        if row.validated_at and row.bank_owner_id == teacher_id:
            approved[concept.code].append(question_input(db, row, concept.code))
        elif data.use_seed_drafts and row.seed_key:
            optional[concept.code].append(question_input(db, row, concept.code))
    db.rollback()

    excluded = set()
    selected = []
    model_exhausted = False
    for index in range(count):
        target = codes[index % len(codes)]
        bank = [item for item in approved[target] + optional[target]
                if fingerprint(item.stem, item.code) not in excluded]
        if bank:
            value, source = bank[0], Source.bank
        elif not model_exhausted:
            result = generate_question(
                request.app.state.gateway, concept_code=target, course_excerpt=context, brief=brief,
                allowed_codes=taxonomy[target], approved_items=approved[target], excluded_stems=excluded,
            )
            if result is None:
                model_exhausted = True
                continue
            value, source = result.value, Source.llm if result.source in {"cache", "llm"} else Source.bank
        else:
            continue
        key = fingerprint(value.stem, value.code)
        if key in excluded:
            continue
        excluded.add(key)
        selected.append((value, source))

    start_write(db)
    lesson, classroom = lesson_access(db, user, id, teacher=True, lock=True)
    existing = current_quiz(db, id)
    if existing is not None:
        require_draft(existing)
        return quiz_view(db, existing, classroom)
    if lesson.updated_at != revision:
        raise error(409, "LESSON_CHANGED", "La séance a changé pendant la génération.")
    sources = {source for _, source in selected}
    mode = "mixed" if len(sources) > 1 else (next(iter(sources)).value if sources else "teacher")
    quiz = Quiz(lesson_id=id, kind=QuestionRole.initial, status=QuizStatus.draft,
                generation_mode=mode, used_fallback=len(selected) < count)
    db.add(quiz)
    db.flush()
    for position, (value, source) in enumerate(selected, start=1):
        row = create_question(db, value, source=source, concept_ids=concept_ids)
        db.add(QuizQuestion(quiz_id=quiz.id, question_id=row.id, position=position))
    db.commit()
    return quiz_view(db, quiz, classroom)


@router.get("/quizzes/{id}", response_model=TeacherQuiz)
def read_quiz(id: UUID, user: Teacher, db: Db):
    quiz, _, classroom = quiz_access(db, user, id, teacher=True)
    return quiz_view(db, quiz, classroom)


@router.post("/quizzes/{id}/questions", response_model=TeacherQuestion, status_code=201)
def add_item(id: UUID, data: QuestionDraft, user: Teacher, db: Db):
    start_write(db)
    quiz, lesson, _ = quiz_access(db, user, id, teacher=True, lock=True)
    require_draft(quiz)
    require_grounded_generator(db, id)
    items = quiz_items(db, id)
    if len(items) >= 10:
        raise error(409, "QUIZ_FULL", "Un quiz peut contenir dix questions au maximum.")
    require_unique(data, items)
    row = create_question(db, data, concept_ids={c.id for c in lesson_concepts(db, lesson.id)})
    position = max((link.position for link, _, _ in items), default=0) + 1
    db.add(QuizQuestion(quiz_id=id, question_id=row.id, position=position))
    db.commit()
    return teacher_view(db, row, data.concept_code)


def item_link(items, question_id):
    for link, row, concept in items:
        if row.id == question_id:
            return link, row, concept
    raise error(404)


@router.patch("/quizzes/{id}/questions/{qid}", response_model=TeacherQuestion)
def edit_item(id: UUID, qid: UUID, data: QuestionDraft, user: Teacher, db: Db, request: Request):
    quiz, lesson, _ = quiz_access(db, user, id, teacher=True)
    require_draft(quiz)
    references, objective = [], None
    grounded = is_grounded(db, id)
    if grounded:
        if any(option.misconception_code is None for option in data.options if not option.is_correct):
            raise error(422, "TAXONOMY_REVIEW_REQUIRED", "Chaque distracteur doit porter un code d’erreur approuvé.")
        references = question_references(db, qid)
        if not references or any(hit.lesson_id != lesson.id for hit, _ in references):
            raise error(404)
        sources = source_views(db, SourceCitation.question_id == qid)
        objective = sources[0].objective
        db.rollback()
        if not verify_question(request.app.state.gateway, data, references):
            raise error(409, "COURSE_EVIDENCE_INSUFFICIENT", "Les sources ne permettent pas de valider la modification.")
    start_write(db)
    quiz, lesson, _ = quiz_access(db, user, id, teacher=True, lock=True)
    require_draft(quiz)
    items = quiz_items(db, id)
    link, old, _ = item_link(items, qid)
    require_unique(data, items, excluding=qid)
    row = create_question(db, data, concept_ids={c.id for c in lesson_concepts(db, lesson.id)},
                          version=old.version + 1)
    link.question_id = row.id
    if grounded:
        require_fresh(db, references, scope_for(db, user, lesson.id))
        save_sources(db, references, question_id=row.id, objective=objective)
    db.commit()
    return teacher_view(db, row, data.concept_code)


@router.post("/quizzes/{id}/questions/{qid}/regenerate", response_model=TeacherQuestion)
def regenerate_item(id: UUID, qid: UUID, request: Request, user: Teacher, db: Db,
                    data: QuestionRegenerate | None = None):
    quiz, lesson, _ = quiz_access(db, user, id, teacher=True)
    require_draft(quiz)
    require_grounded_generator(db, id)
    items = quiz_items(db, id)
    _, old, concept = item_link(items, qid)
    concept_code, concept_id = concept.code, concept.id
    approved = [question_input(db, row, code.code) for row, code in bank_items(
        db, user.id, role=QuestionRole.initial, concept_ids={concept_id}
    )]
    taxonomy = set(allowed_codes(db, concept_id))
    revision = lesson.updated_at
    context = lesson.content_text
    brief = FocusBrief.model_validate(lesson.focus_brief_json)
    if data and data.instructions:
        brief.instructions = data.instructions
    excluded = {fingerprint(item.stem, item.code) for _, item, _ in items}
    db.rollback()
    result = generate_question(request.app.state.gateway, concept_code=concept_code, course_excerpt=context,
                               brief=brief, allowed_codes=taxonomy, approved_items=approved,
                               excluded_stems=excluded)
    if result is None:
        raise error(409, "NO_QUESTION_AVAILABLE", "Aucune nouvelle question disponible. Ajoutez un item manuellement.")
    start_write(db)
    quiz, lesson, _ = quiz_access(db, user, id, teacher=True, lock=True)
    require_draft(quiz)
    if lesson.updated_at != revision:
        raise error(409, "LESSON_CHANGED", "La séance a changé pendant la génération.")
    items = quiz_items(db, id)
    link, old, _ = item_link(items, qid)
    require_unique(result.value, items)
    source = Source.llm if result.source in {"llm", "cache"} else Source.bank
    new = create_question(db, result.value, source=source, version=old.version + 1,
                          concept_ids={concept_id})
    link.question_id = new.id
    db.commit()
    return teacher_view(db, new, concept_code)


@router.delete("/quizzes/{id}/questions/{qid}", response_model=TeacherQuiz)
def remove_item(id: UUID, qid: UUID, user: Teacher, db: Db):
    start_write(db)
    quiz, _, classroom = quiz_access(db, user, id, teacher=True, lock=True)
    require_draft(quiz)
    link, _, _ = item_link(quiz_items(db, id), qid)
    db.delete(link)
    db.commit()
    return quiz_view(db, quiz, classroom)


@router.post("/quizzes/{id}/publish", response_model=TeacherQuiz)
def publish(id: UUID, data: Approval, request: Request, user: Teacher, db: Db):
    if not data.validated:
        raise error(409, "TEACHER_VALIDATION_REQUIRED", "La validation explicite est requise.")
    start_write(db)
    quiz, lesson, classroom = quiz_access(db, user, id, teacher=True, lock=True)
    if quiz.kind == QuestionRole.initial and quiz.status == QuizStatus.published:
        return quiz_view(db, quiz, classroom)
    require_draft(quiz)
    items = quiz_items(db, id)
    if not items:
        raise error(409, "EMPTY_QUIZ", "Ajoutez une question avant publication.")
    if is_grounded(db, id):
        scoped = scope_for(db, user, lesson.id)
        references = [question_references(db, row.id) for _, row, _ in items]
        if scoped is None or any(not group for group in references):
            raise error(409, "QUIZ_EVIDENCE_REQUIRED", "Chaque question doit conserver une source vérifiée.")
        require_fresh(db, [reference for group in references for reference in group], scoped)
    now = request.app.state.clock.now()
    for _, question, _ in items:
        approve_question(db, question, user.id, now)
    quiz.status, quiz.validated_by, quiz.validated_at = QuizStatus.published, user.id, now
    lesson.status = LessonStatus.published
    db.add(TeacherDecision(teacher_id=user.id, entity_type="quiz", entity_id=id, action="publish",
                           before_json={"status": "draft"}, after_json={"status": "published"}))
    db.commit()
    return quiz_view(db, quiz, classroom)


@router.post("/quizzes/{id}/close", response_model=TeacherQuiz)
def close_quiz(id: UUID, user: Teacher, db: Db):
    start_write(db)
    quiz, lesson, classroom = quiz_access(db, user, id, teacher=True, lock=True)
    if quiz.kind != QuestionRole.initial or quiz.status == QuizStatus.draft:
        raise error(409)
    quiz.status = QuizStatus.closed
    lesson.status = LessonStatus.closed
    db.commit()
    return quiz_view(db, quiz, classroom)
