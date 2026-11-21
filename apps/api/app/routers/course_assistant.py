from types import SimpleNamespace
from uuid import UUID

from fastapi import APIRouter, Request
from sqlalchemy import func, select

from app.core.auth import Teacher
from app.core.errors import documented_errors, error
from app.db.session import Db
from app.documents import generation
from app.documents.access import scope_for
from app.documents.provenance import require_fresh, save_sources, source_views
from app.documents.ranking import terms
from app.documents.retrieval import retrieve
from app.models import Classroom, Lesson, Quiz, QuizQuestion
from app.models.documents import CourseConversation, CourseMessage, GenerationBrief, GroundedQuiz, SourceCitation
from app.models.enums import LessonStatus, QuestionRole, QuizStatus, Source
from app.routers.lessons import current_quiz
from app.routers.quizzes import quiz_view
from app.schemas.documents import (
    Brief, BriefUpdate, ConversationView, GroundedQuizRequest, MessageRequest, MessageView,
    SearchRequest, SearchView,
)
from app.schemas.learning import TeacherQuiz
from app.services.questions import create_question, fingerprint, lesson_concepts, quiz_items, taxonomy_labels

router = APIRouter(prefix="/lessons/{lesson_id}/course-assistant", tags=["Assistant du cours"],
                   responses=documented_errors(401, 403, 404, 409, 422, 429, 503))
STALE_CHAT = "La conversation a changé. Actualisez avant de poursuivre."
# Per-teacher calls per minute. One local GPU serializes model work, so these bound queueing, not quality.
LIMITS = {"search": 60, "chat": 12, "brief": 10, "quiz": 12}


def throttle(request, user, action):
    request.app.state.rate_limiter.check(request, "course_" + action, LIMITS[action], subject=user.id)


def assistant_for(db, scope, conversation_id=None):
    if scope is None:
        return None
    query = select(CourseConversation).where(
        CourseConversation.institution_id == scope.institution_id,
        CourseConversation.classroom_id == scope.classroom_id,
        CourseConversation.lesson_id == scope.lesson_id, CourseConversation.teacher_id == scope.teacher_id,
    )
    if conversation_id is not None:
        query = query.where(CourseConversation.id == conversation_id)
    row = db.scalar(query.order_by(CourseConversation.created_at).limit(1))
    if row is None and conversation_id is not None:
        raise error(404)
    return row


def require_conversation(db, scope, id):
    row = assistant_for(db, scope, id)
    if row is None:
        raise error(404)
    return row


def brief_for(db, conversation_id):
    return db.scalar(select(GenerationBrief).where(GenerationBrief.conversation_id == conversation_id))


def messages_for(db, conversation_id, *, limit=12):
    return list(reversed(list(db.scalars(
        select(CourseMessage).where(CourseMessage.conversation_id == conversation_id)
        .order_by(CourseMessage.position.desc()).limit(limit)
    ))))


def conversation_view(db, row):
    brief = brief_for(db, row.id)
    messages = messages_for(db, row.id, limit=100)
    return ConversationView(id=row.id, brief=Brief.model_validate(brief.values), brief_revision=brief.revision,
                            messages=[MessageView(
                                id=value.id, role=value.role, text=value.text,
                                sources=source_views(db, SourceCitation.message_id == value.id),
                            ) for value in messages])


@router.get("", response_model=ConversationView | None)
def current(lesson_id: UUID, user: Teacher, db: Db):
    row = assistant_for(db, scope_for(db, user, lesson_id))
    return conversation_view(db, row) if row else None


@router.post("", response_model=ConversationView)
def create(lesson_id: UUID, user: Teacher, db: Db):
    scope = scope_for(db, user, lesson_id, create=True)
    row = assistant_for(db, scope)
    if row is None:
        row = CourseConversation(institution_id=scope.institution_id, classroom_id=scope.classroom_id,
                                 lesson_id=scope.lesson_id, teacher_id=user.id)
        db.add(row)
        db.flush()
        db.add(GenerationBrief(conversation_id=row.id, teacher_id=user.id, values=Brief().model_dump()))
        db.commit()
    return conversation_view(db, row)


@router.post("/search", response_model=SearchView)
def search(lesson_id: UUID, body: SearchRequest, user: Teacher, db: Db, request: Request):
    throttle(request, user, "search")
    scope = scope_for(db, user, lesson_id)
    result = retrieve(db, request.app.state.document_models, request.app.state.settings,
                      scope, body.document_ids, body.query, limit=body.limit, per_page=1)
    return {"mode": result.mode, "hits": [
        {"source": hit.source(hit.content[:500]), "score": hit.score} for hit in result.hits
    ]}


@router.post("/{id}/messages", response_model=ConversationView)
def send(lesson_id: UUID, id: UUID, body: MessageRequest, user: Teacher, db: Db, request: Request):
    throttle(request, user, "chat")
    scope = scope_for(db, user, lesson_id)
    row = require_conversation(db, scope, id)
    history_rows = messages_for(db, row.id, limit=8)
    latest = history_rows[-1].position if history_rows else 0
    history = [{"role": item.role, "text": item.text[:600]} for item in history_rows]
    previous = next((item.text[:280] for item in reversed(history_rows) if item.role == "teacher"), "")
    query = body.message[:1000] + (" " + previous if previous else "")
    result = retrieve(db, request.app.state.document_models, request.app.state.settings,
                      scope, body.document_ids, query)
    db.rollback()
    if not request.app.state.settings.llm_enabled:
        raise error(503, "COURSE_MODEL_DISABLED", "Activez le modèle local pour utiliser l’assistant.")
    answer, sources = generation.answer(request.app.state.gateway, body.message, history, result.hits)
    scope = scope_for(db, user, lesson_id, create=True)
    row = require_conversation(db, scope, id)
    current_position = db.scalar(select(func.max(CourseMessage.position))
                                 .where(CourseMessage.conversation_id == id)) or 0
    if latest != current_position:
        raise error(409, "CONVERSATION_CHANGED", STALE_CHAT)
    require_fresh(db, sources, scope)
    teacher = CourseMessage(conversation_id=id, position=latest + 1, role="teacher", text=body.message)
    ai = CourseMessage(conversation_id=id, position=latest + 2, role="assistant", text=answer)
    db.add_all([teacher, ai])
    db.flush()
    save_sources(db, sources, message_id=ai.id)
    db.commit()
    return conversation_view(db, row)


@router.patch("/{id}/brief", response_model=ConversationView)
def update_brief(lesson_id: UUID, id: UUID, body: BriefUpdate, user: Teacher, db: Db):
    row = require_conversation(db, scope_for(db, user, lesson_id, create=True), id)
    brief = brief_for(db, row.id)
    if brief.revision != body.revision:
        raise error(409, "BRIEF_CHANGED", "Le brief a changé.")
    brief.values, brief.revision = body.model_dump(exclude={"revision"}), brief.revision + 1
    db.commit()
    return conversation_view(db, row)


@router.post("/{id}/brief/extract", response_model=ConversationView)
def infer_brief(lesson_id: UUID, id: UUID, user: Teacher, db: Db, request: Request):
    throttle(request, user, "brief")
    row = require_conversation(db, scope_for(db, user, lesson_id), id)
    brief = brief_for(db, row.id)
    revision = brief.revision
    teacher_turns = [message.text[:1200] for message in messages_for(db, id, limit=12)
                     if message.role == "teacher"]
    if not teacher_turns:
        raise error(409, "NO_TEACHER_INSTRUCTIONS", "Ajoutez d’abord une consigne dans la conversation.")
    old = Brief.model_validate(brief.values)
    db.rollback()
    inferred = generation.extract_brief(request.app.state.gateway, old, teacher_turns)
    if inferred is None:
        raise error(503, "BRIEF_MODEL_UNAVAILABLE", "Le brief peut être saisi manuellement.")
    return update_brief(lesson_id, id, BriefUpdate(revision=revision, **inferred.model_dump()), user, db)


@router.post("/quiz", response_model=TeacherQuiz)
def grounded_quiz(lesson_id: UUID, body: GroundedQuizRequest, user: Teacher, db: Db, request: Request):
    throttle(request, user, "quiz")
    scope = scope_for(db, user, lesson_id)
    conversation = require_conversation(db, scope, body.conversation_id)
    brief_row = brief_for(db, conversation.id)
    if brief_row.revision != body.brief_revision:
        raise error(409, "BRIEF_CHANGED", "Le brief de génération a changé.")
    brief = Brief.model_validate(brief_row.values)
    lesson = db.get(Lesson, lesson_id)
    if lesson.status != LessonStatus.draft:
        raise error(409, "LESSON_IMMUTABLE", "La séance est déjà publiée.")
    quiz = current_quiz(db, lesson_id)
    prior_id = quiz.id if quiz else None
    if quiz and not db.scalar(select(GroundedQuiz.id).where(GroundedQuiz.quiz_id == quiz.id)):
        raise error(409, "REGULAR_DRAFT_EXISTS", "Cette séance possède déjà un brouillon hors documents.")
    items = quiz_items(db, quiz.id) if quiz else []
    prior_items = [item.id for _, item, _ in items]
    excluded = {fingerprint(item.stem, item.code) for _, item, _ in items}
    requested = min(body.question_count or brief.question_count, 10 - len(items))
    if requested < 1:
        raise error(409, "QUIZ_FULL", "Un quiz peut contenir dix questions.")
    taxonomy = [
        (SimpleNamespace(id=concept.id, code=concept.code, label_fr=concept.label_fr), taxonomy_labels(db, concept.id))
        for concept in lesson_concepts(db, lesson_id)
    ]
    taxonomy = [(concept, allowed) for concept, allowed in taxonomy if allowed]
    if not taxonomy:
        raise error(409, "TAXONOMY_REVIEW_REQUIRED", "Ajoutez et validez des notions et des erreurs diagnostiques.")
    focused = terms(" ".join(brief.focus_topics))
    taxonomy.sort(key=lambda pair: (-len(focused & terms(pair[0].label_fr)), pair[0].code))
    settings = request.app.state.settings
    if not settings.llm_enabled:
        raise error(503, "COURSE_MODEL_DISABLED", "Activez le modèle local pour générer des questions.")
    picks = []
    for position in range(requested):
        concept, approved = taxonomy[(len(items) + position) % len(taxonomy)]
        query = " ".join([concept.label_fr, *brief.focus_topics, *brief.observed_difficulties])[:1200]
        found = retrieve(db, request.app.state.document_models, settings, scope, body.document_ids, query)
        db.rollback()
        created = generation.generate_item(request.app.state.gateway, brief, concept, approved, found.hits,
                                           excluded, fingerprint)
        if created is None:
            continue
        value, sources = created
        excluded.add(fingerprint(value.question.stem, value.question.code))
        picks.append((value, sources))
    if not picks:
        raise error(409, "COURSE_EVIDENCE_INSUFFICIENT", "Aucune question soutenue par les documents n’a été validée.")
    scope = scope_for(db, user, lesson_id, create=True)
    conversation = require_conversation(db, scope, body.conversation_id)
    if brief_for(db, conversation.id).revision != body.brief_revision:
        raise error(409, "BRIEF_CHANGED", "Le brief de génération a changé.")
    classroom = db.get(Classroom, scope.classroom_id)
    quiz = current_quiz(db, lesson_id)
    if (quiz.id if quiz else None) != prior_id or (
        quiz and (quiz.status != QuizStatus.draft or [item.id for _, item, _ in quiz_items(db, quiz.id)] != prior_items)
    ) or db.get(Lesson, lesson_id).status != LessonStatus.draft:
        raise error(409, "QUIZ_CHANGED", "Le brouillon a changé. Actualisez avant de poursuivre.")
    require_fresh(db, [reference for _, group in picks for reference in group], scope)
    positions = [link.position for link, _, _ in quiz_items(db, quiz.id)] if quiz else []
    if quiz is None:
        quiz = Quiz(lesson_id=lesson_id, kind=QuestionRole.initial, status=QuizStatus.draft, generation_mode="llm")
        db.add(quiz)
        db.flush()
        db.add(GroundedQuiz(quiz_id=quiz.id, conversation_id=conversation.id,
                            brief_revision=body.brief_revision, brief_snapshot=brief.model_dump()))
    quiz.used_fallback = len(picks) < requested
    allowed_concepts = {row.id for row in lesson_concepts(db, lesson_id)}
    for position, (candidate, sources) in enumerate(picks, start=max(positions, default=0) + 1):
        item = create_question(db, candidate.question, source=Source.llm, concept_ids=allowed_concepts)
        db.add(QuizQuestion(quiz_id=quiz.id, question_id=item.id, position=position))
        save_sources(db, sources, question_id=item.id, objective=candidate.objective)
    db.commit()
    return quiz_view(db, quiz, classroom)
