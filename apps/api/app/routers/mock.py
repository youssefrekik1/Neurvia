from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select

from app.ai.tasks import generate_remediation_plan
from app.core.auth import Student, Teacher
from app.core.errors import documented_errors, error
from app.db.session import Db
from app.models import Misconception
from app.models.enums import QuestionRole, QuizStatus
from app.schemas.analytics import (
    BeforeAfter, Dashboard, Graph, GroupUpdate, GroupView, InterventionUpdate,
    InterventionView, RetestCreate, ScheduleResult,
)
from app.schemas.common import Approval
from app.schemas.learning import (
    AnswerInput, AnswerSaved, AttemptView, Confirmation, Feedback, QuestionDraft,
    QuestionRegenerate, QuizGenerate, StudentTask, TeacherQuestion, TeacherQuiz,
)
from app.services import demo_examples as sample
from app.services.demo_seed import CLASSROOM_ID, LESSON_ID, STUDENT_IDS, TEACHER_ID
from app.services.mock_workflow import MockWorkflow, draft_question

MOCK_ERRORS = documented_errors(401, 403, 404, 409, 422, 501)
teacher_router = APIRouter(tags=["Professeur — mock"], responses=MOCK_ERRORS)
student_router = APIRouter(tags=["Étudiant — mock"], responses=MOCK_ERRORS)


def teacher_workflow(user: Teacher, request: Request) -> MockWorkflow:
    if not request.app.state.settings.demo_mode:
        raise error(501)
    if user.id != TEACHER_ID:
        raise error(404)
    return request.app.state.mock


def student_workflow(user: Student, request: Request) -> MockWorkflow:
    if not request.app.state.settings.demo_mode:
        raise error(501)
    if user.id not in STUDENT_IDS:
        raise error(404)
    return request.app.state.mock


TeacherDemo = Annotated[MockWorkflow, Depends(teacher_workflow)]
StudentDemo = Annotated[MockWorkflow, Depends(student_workflow)]


def require_id(actual: UUID, expected: UUID = LESSON_ID):
    if actual != expected:
        raise error(404)


def require_validation(data: Approval):
    if not data.validated:
        raise error(409, "TEACHER_VALIDATION_REQUIRED", "La validation explicite est requise.")


@teacher_router.post("/lessons/{id}/quiz/generate", response_model=TeacherQuiz)
async def generate_quiz(id: UUID, demo: TeacherDemo, data: QuizGenerate | None = None):
    require_id(id)
    return demo.generate_draft(data.question_count if data else None).view()


@teacher_router.get("/quizzes/{id}", response_model=TeacherQuiz)
async def read_quiz(id: UUID, demo: TeacherDemo):
    return demo.quiz(id).view()


@teacher_router.patch("/quizzes/{id}/questions/{qid}", response_model=TeacherQuestion)
async def edit_question(id: UUID, qid: UUID, data: QuestionDraft, demo: TeacherDemo):
    quiz = demo.quiz(id)
    quiz.check_draft()
    index = quiz.question_index(qid)
    item = draft_question(data, qid, quiz.questions[index].version + 1)
    quiz.questions[index] = item
    return item


@teacher_router.post("/quizzes/{id}/questions/{qid}/regenerate", response_model=TeacherQuestion)
async def regenerate_question(
    id: UUID, qid: UUID, demo: TeacherDemo, data: QuestionRegenerate | None = None,
):
    quiz = demo.quiz(id)
    quiz.check_draft()
    index = quiz.question_index(qid)
    used = {(question.stem, question.code) for question in quiz.questions}
    for fixture in sample.initial_questions():
        if (fixture.stem, fixture.code) in used:
            continue
        value = QuestionDraft.model_validate(fixture.model_dump(
            include={"concept_code", "stem", "code", "difficulty", "options", "explanation"},
            exclude={"options": {"__all__": {"id"}}},
        ))
        item = draft_question(value, version=quiz.questions[index].version + 1)
        quiz.questions[index] = item
        return item
    raise error(409, "FIXTURE_LIMIT", "Aucune variante de brouillon fictive disponible.")


@teacher_router.post("/quizzes/{id}/questions", response_model=TeacherQuestion, status_code=201)
async def add_question(id: UUID, data: QuestionDraft, demo: TeacherDemo):
    quiz = demo.quiz(id)
    quiz.check_draft()
    if len(quiz.questions) >= 10:
        raise error(409)
    item = draft_question(data)
    quiz.questions.append(item)
    return item


@teacher_router.delete("/quizzes/{id}/questions/{qid}", response_model=TeacherQuiz)
async def remove_question(id: UUID, qid: UUID, demo: TeacherDemo):
    quiz = demo.quiz(id)
    quiz.check_draft()
    quiz.questions.pop(quiz.question_index(qid))
    return quiz.view()


@teacher_router.post("/quizzes/{id}/publish", response_model=TeacherQuiz)
async def publish(id: UUID, data: Approval, demo: TeacherDemo, request: Request):
    require_validation(data)
    quiz = demo.quiz(id)
    quiz.publish(request.app.state.clock.now())
    return quiz.view()


@teacher_router.post("/quizzes/{id}/close", response_model=TeacherQuiz)
async def close_quiz(id: UUID, demo: TeacherDemo):
    quiz = demo.quiz(id)
    if quiz.status == QuizStatus.draft:
        raise error(409)
    quiz.status = QuizStatus.closed
    return quiz.view()


@student_router.get("/me/tasks", response_model=list[StudentTask])
async def tasks(
    user: Student, demo: StudentDemo, request: Request, classroom_id: UUID | None = None,
):
    if classroom_id is not None:
        require_id(classroom_id, CLASSROOM_ID)
    return demo.tasks(user.id, request.app.state.clock.now(), classroom_id=classroom_id)


@student_router.post("/quizzes/{id}/attempts", response_model=AttemptView)
async def start_attempt(id: UUID, user: Student, demo: StudentDemo, request: Request):
    return demo.start_attempt(id, user.id, request.app.state.clock.now()).view()


@student_router.post("/attempts/{id}/answers", response_model=AnswerSaved)
async def save_answer(id: UUID, data: AnswerInput, user: Student, demo: StudentDemo):
    return demo.attempt(id, user.id).save(data)


@student_router.post("/attempts/{id}/submit", response_model=Feedback)
async def submit_attempt(id: UUID, user: Student, demo: StudentDemo, request: Request):
    attempt = demo.attempt(id, user.id)
    first_submission = attempt.feedback is None
    feedback = attempt.submit()
    if first_submission and attempt.quiz.kind == QuestionRole.immediate_retest and feedback.answered_count:
        demo.schedule_j7(user.id, request.app.state.clock.now())
    return feedback


@student_router.get("/attempts/{id}/feedback", response_model=Feedback)
async def feedback(id: UUID, user: Student, demo: StudentDemo):
    return demo.attempt(id, user.id).get_feedback()


@student_router.get("/attempts/{id}/confirmation", response_model=Confirmation | None)
async def confirmation(id: UUID, user: Student, demo: StudentDemo):
    return demo.attempt(id, user.id).confirmation_question()


@student_router.post("/attempts/{id}/confirmation", response_model=Feedback)
async def answer_confirmation(id: UUID, data: AnswerInput, user: Student, demo: StudentDemo):
    return demo.attempt(id, user.id).submit_confirmation(data)


@teacher_router.get("/lessons/{id}/dashboard", response_model=Dashboard)
async def dashboard(id: UUID, demo: TeacherDemo):
    require_id(id)
    return sample.sample_dashboard()


@teacher_router.get("/lessons/{id}/graph", response_model=Graph)
async def graph(id: UUID, demo: TeacherDemo, tau: Annotated[float, Query(ge=0, le=1)] = 0.4):
    require_id(id)
    return {**sample.sample_graph(tau), "groups": [demo.group]}


@teacher_router.post("/lessons/{id}/groups/suggest", response_model=list[GroupView])
async def suggest_groups(id: UUID, demo: TeacherDemo):
    require_id(id)
    return [demo.group]


@teacher_router.get("/lessons/{id}/groups", response_model=list[GroupView])
async def groups(id: UUID, demo: TeacherDemo):
    require_id(id)
    return [demo.group]


@teacher_router.patch("/groups/{id}", response_model=GroupView)
async def update_group(id: UUID, data: GroupUpdate, demo: TeacherDemo):
    require_id(id, sample.GROUP_ID)
    return demo.update_group(data)


@teacher_router.post("/groups/{id}/remediation", response_model=InterventionView)
async def generate_plan(id: UUID, demo: TeacherDemo, request: Request, db: Db):
    require_id(id, sample.GROUP_ID)
    plan = demo.generate_plan()
    # Fixtures validate through the same gateway. A failed fixture still has a deterministic plan.
    if plan["status"] == "draft" and plan["source"] == "fixture":
        taxonomy = db.scalar(select(Misconception).where(Misconception.code == sample.ERROR_CODE))
        result = generate_remediation_plan(
            request.app.state.gateway, misconception_label=taxonomy.label_fr,
            hint=taxonomy.remediation_hint, group_size=len(demo.group["student_ids"]),
            course_excerpt="Indices des listes Python.",
            fixture=sample.sample_plan().model_dump(),
        )
        plan["plan"] = result.value
        plan["source"] = {"fixture": "fixture", "fallback": "template",
                          "llm": "llm", "cache": "llm"}[result.source]
        plan["used_fallback"] = result.source == "fallback"
    return plan


@teacher_router.patch("/interventions/{id}", response_model=InterventionView)
async def edit_plan(id: UUID, data: InterventionUpdate, demo: TeacherDemo):
    plan = demo.read_plan(id, draft=True)
    plan.update(plan=data.plan, source="teacher", used_fallback=False)
    return plan


@teacher_router.post("/interventions/{id}/assign", response_model=InterventionView)
async def assign_plan(id: UUID, data: Approval, demo: TeacherDemo):
    require_validation(data)
    demo.require_accepted_group()
    plan = demo.read_plan(id)
    plan["status"] = "assigned"
    return plan


@teacher_router.post("/lessons/{id}/retest", response_model=ScheduleResult)
async def retest(id: UUID, data: RetestCreate, demo: TeacherDemo, request: Request):
    require_id(id)
    return demo.start_retest(data.intervention_id, request.app.state.clock.now())


@teacher_router.get("/lessons/{id}/before-after", response_model=BeforeAfter)
async def before_after(id: UUID, demo: TeacherDemo):
    require_id(id)
    return sample.sample_before_after()


@student_router.get("/me/retests", response_model=list[StudentTask])
async def retests(user: Student, demo: StudentDemo, request: Request):
    return demo.tasks(user.id, request.app.state.clock.now(), retests_only=True)


@teacher_router.post("/lessons/{id}/j7/schedule", response_model=ScheduleResult)
async def j7(id: UUID, demo: TeacherDemo, request: Request):
    require_id(id)
    return demo.schedule_view(request.app.state.clock.now(), j7=True)
