from uuid import UUID

from fastapi import APIRouter, Request
from sqlalchemy import select

from app.core.auth import Student
from app.core.errors import documented_errors, error
from app.db.session import Db
from app.models import Answer, Attempt, ConfirmationAssignment, DiagnosisSummary, Group, GroupMember, Intervention, Lesson, Membership, Misconception, Quiz
from app.models import enums as e
from app.routers.identity import get_classroom
from app.schemas.learning import AnswerInput, AnswerSaved, AttemptView, Confirmation, Feedback, StudentTask
from app.schemas.analytics import AssignedPlan
from app.services.access import attempt_access, quiz_access, start_write
from app.services.assessments import confirmation_for, get_or_begin, questions_for_student, save_choice, saved_rows, submit_attempt
from app.services.questions import opts

router = APIRouter(tags=["Travail étudiant"], responses=documented_errors(401, 403, 404, 409, 422))

DIAGNOSIS_TEXT = {
    e.DiagnosisStatus.suspected: "Difficulté possible. Une erreur seule ne permet pas de conclure.",
    e.DiagnosisStatus.corroborated: "Des erreurs sur des items indépendants appuient cette hypothèse.",
    e.DiagnosisStatus.contradicted_or_transient: "La réussite à la vérification affaiblit l’hypothèse.",
    e.DiagnosisStatus.insufficient: "Davantage de réponses sont nécessaires.",
}


def confirmation_open(db, attempt, assigned):
    if assigned is None:
        return False
    submitted = db.scalar(select(Attempt.id).where(Attempt.quiz_id == assigned.quiz_id,
                                                   Attempt.student_id == attempt.student_id,
                                                   Attempt.status == e.AttemptStatus.submitted))
    return submitted is None


def feedback_view(db, attempt, quiz, classroom):
    if attempt.status != e.AttemptStatus.submitted:
        raise error(409, "ATTEMPT_NOT_SUBMITTED", "La tentative doit être soumise.")
    items = questions_for_student(db, quiz)
    rows = saved_rows(db, attempt.id)
    feedback = []
    for answer, item, _ in rows:
        correct = next(option.id for option, _ in opts(db, item.id) if option.is_correct)
        feedback.append({
            "question_id": item.id, "is_correct": answer.is_correct, "quadrant": answer.quadrant,
            "correct_option_id": correct, "selected_option_id": answer.option_id,
            "confidence": answer.confidence, "explanation": item.explanation,
        })
    diagnoses = []
    initial_count = len(rows)
    if quiz.kind in (e.QuestionRole.initial, e.QuestionRole.confirmation):
        if quiz.kind == e.QuestionRole.confirmation:
            assignment = db.scalar(select(ConfirmationAssignment).where(ConfirmationAssignment.quiz_id == quiz.id))
            initial_count = len(saved_rows(db, assignment.initial_attempt_id))
        for row, code in db.execute(
            select(DiagnosisSummary, Misconception.code).join(Misconception).where(
                DiagnosisSummary.student_id == attempt.student_id, DiagnosisSummary.lesson_id == quiz.lesson_id
            ).order_by(Misconception.code)
        ):
            diagnoses.append({"misconception_code": code, "status": row.status, "message": DIAGNOSIS_TEXT[row.status],
                              "evidence_count": row.evidence_count, "distinct_questions_count": row.distinct_questions_count})
    else:
        for _, _, selected in rows:
            if selected.misconception_id is not None:
                code = db.get(Misconception, selected.misconception_id).code
                diagnoses.append({"misconception_code": code, "status": e.DiagnosisStatus.suspected,
                                  "message": "Cette réponse correspond à une erreur observée au retest.",
                                  "evidence_count": 1, "distinct_questions_count": 1})
    return Feedback(
        attempt_id=attempt.id, lesson_id=quiz.lesson_id, classroom_id=classroom.id, kind=quiz.kind,
        submitted_at=attempt.submitted_at, questions=items, answers=feedback,
        correct_count=sum(answer.is_correct for answer, _, _ in rows), answered_count=len(rows),
        total_questions=len(items), diagnosis_quality="sufficient" if initial_count >= 4 else "insufficient",
        suspected_difficulties=diagnoses,
        confirmation_available=quiz.kind == e.QuestionRole.initial
        and confirmation_open(db, attempt, confirmation_for(db, attempt.id)), is_synthetic=classroom.is_synthetic,
    )


@router.post("/quizzes/{id}/attempts", response_model=AttemptView)
def start_attempt(id: UUID, user: Student, db: Db, request: Request):
    start_write(db)
    quiz, _, classroom = quiz_access(db, user, id)
    if quiz.kind == e.QuestionRole.confirmation:
        raise error(404)
    attempt = get_or_begin(db, quiz, user.id, request.app.state.clock.now())
    db.commit()
    return AttemptView(
        id=attempt.id, quiz_id=id, status=attempt.status, kind=quiz.kind,
        questions=questions_for_student(db, quiz),
        saved_answers=[AnswerSaved(question_id=row.question_id, option_id=row.option_id, confidence=row.confidence)
                       for row, _, _ in saved_rows(db, attempt.id)],
        is_synthetic=classroom.is_synthetic,
    )


@router.post("/attempts/{id}/answers", response_model=AnswerSaved)
def record_answer(id: UUID, data: AnswerInput, user: Student, db: Db):
    start_write(db)
    attempt, quiz, _, _ = attempt_access(db, user, id)
    if quiz.kind == e.QuestionRole.confirmation:
        raise error(404)
    answer = save_choice(db, attempt, quiz, data)
    db.commit()
    return AnswerSaved(question_id=answer.question_id, option_id=answer.option_id, confidence=answer.confidence)


@router.post("/attempts/{id}/submit", response_model=Feedback)
def submit(id: UUID, user: Student, db: Db, request: Request):
    start_write(db)
    attempt, quiz, _, classroom = attempt_access(db, user, id)
    if quiz.kind == e.QuestionRole.confirmation:
        raise error(404)
    submit_attempt(db, attempt, quiz, classroom, request.app.state.clock.now())
    db.commit()
    return feedback_view(db, attempt, quiz, classroom)


@router.get("/attempts/{id}/feedback", response_model=Feedback)
def feedback(id: UUID, user: Student, db: Db):
    attempt, quiz, _, classroom = attempt_access(db, user, id)
    return feedback_view(db, attempt, quiz, classroom)


@router.get("/attempts/{id}/confirmation", response_model=Confirmation | None)
def get_confirmation(id: UUID, user: Student, db: Db):
    attempt, quiz, _, classroom = attempt_access(db, user, id)
    if quiz.kind != e.QuestionRole.initial or attempt.status != e.AttemptStatus.submitted:
        raise error(409, "ATTEMPT_NOT_SUBMITTED", "Soumettez d’abord le quiz initial.")
    assigned = confirmation_for(db, id)
    if not confirmation_open(db, attempt, assigned):
        return None
    private = db.get(Quiz, assigned.quiz_id)
    return Confirmation(question=questions_for_student(db, private)[0],
                        misconception_code=db.get(Misconception, assigned.misconception_id).code,
                        is_synthetic=classroom.is_synthetic)


@router.post("/attempts/{id}/confirmation", response_model=Feedback)
def answer_confirmation(id: UUID, data: AnswerInput, user: Student, db: Db, request: Request):
    start_write(db)
    initial, quiz, _, classroom = attempt_access(db, user, id)
    assignment = confirmation_for(db, initial.id)
    if assignment is None:
        raise error(409, "CONFIRMATION_UNAVAILABLE", "Aucune vérification n’a été attribuée.")
    private = db.get(Quiz, assignment.quiz_id)
    now = request.app.state.clock.now()
    attempt = get_or_begin(db, private, user.id, now)
    if attempt.status == e.AttemptStatus.submitted:
        previous = db.scalar(select(Answer).where(Answer.attempt_id == attempt.id))
        if (previous.question_id, previous.option_id, previous.confidence) != (
            data.question_id, data.option_id, data.confidence
        ):
            raise error(409, "ATTEMPT_CLOSED", "Cette réponse a déjà été soumise.")
    else:
        save_choice(db, attempt, private, data)
        submit_attempt(db, attempt, private, classroom, now, assignment)
    db.commit()
    return feedback_view(db, attempt, private, classroom)


def student_tasks(db, user, now, classroom_id=None, retests_only=False, include_upcoming=False):
    if classroom_id is not None:
        get_classroom(classroom_id, user, db)
    query = (
        select(Quiz, Lesson, Attempt)
        .join(Lesson, Lesson.id == Quiz.lesson_id)
        .join(Membership, (Membership.classroom_id == Lesson.classroom_id) & (Membership.user_id == user.id))
        .outerjoin(Attempt, (Attempt.quiz_id == Quiz.id) & (Attempt.student_id == user.id))
        .where((Quiz.recipient_id == user.id) | (Quiz.kind == e.QuestionRole.initial),
               (Quiz.status == e.QuizStatus.published) | (Attempt.status == e.AttemptStatus.submitted))
        .order_by(Lesson.created_at.desc(), Quiz.created_at, Quiz.id)
    )
    if classroom_id is not None:
        query = query.where(Lesson.classroom_id == classroom_id)
    if not include_upcoming:
        query = query.where((Quiz.scheduled_for.is_(None)) | (Quiz.scheduled_for <= now))
    if retests_only:
        query = query.where(Quiz.kind.in_([e.QuestionRole.immediate_retest, e.QuestionRole.j7_retest]))
    tasks = []
    for quiz, lesson, attempt in db.execute(query):
        done = attempt is not None and attempt.status == e.AttemptStatus.submitted
        pending = not done and quiz.scheduled_for is not None and quiz.scheduled_for > now
        if quiz.kind == e.QuestionRole.confirmation:
            assignment = db.scalar(select(ConfirmationAssignment).where(ConfirmationAssignment.quiz_id == quiz.id))
            parent = assignment.initial_attempt_id
            task_id, task_quiz = assignment.id, None
        else:
            parent = attempt.id if attempt else None
            task_id, task_quiz = quiz.id, quiz.id
        tasks.append(StudentTask(
            id=task_id, quiz_id=task_quiz if not pending else None, attempt_id=parent,
            lesson_id=lesson.id, classroom_id=lesson.classroom_id, title=lesson.title, kind=quiz.kind,
            status=e.ScheduleStatus.done if done else e.ScheduleStatus.pending if pending else e.ScheduleStatus.available,
            due_at=quiz.scheduled_for, is_synthetic=user.is_synthetic,
        ))
    return tasks


@router.get("/me/tasks", response_model=list[StudentTask])
def tasks(user: Student, db: Db, request: Request, classroom_id: UUID | None = None,
          include_upcoming: bool = False):
    return student_tasks(db, user, request.app.state.clock.now(), classroom_id, include_upcoming=include_upcoming)


@router.get("/me/retests", response_model=list[StudentTask])
def retests(user: Student, db: Db, request: Request):
    return student_tasks(db, user, request.app.state.clock.now(), retests_only=True)


@router.get("/me/feedback", response_model=list[Feedback])
def history(user: Student, db: Db, classroom_id: UUID):
    classroom = get_classroom(classroom_id, user, db)
    rows = db.execute(select(Attempt, Quiz).select_from(Attempt)
                      .join(Quiz, Quiz.id == Attempt.quiz_id).join(Lesson, Lesson.id == Quiz.lesson_id).where(
        Lesson.classroom_id == classroom_id, Attempt.student_id == user.id,
        Attempt.status == e.AttemptStatus.submitted,
    ).order_by(Attempt.submitted_at.desc()))
    return [feedback_view(db, attempt, quiz, classroom) for attempt, quiz in rows]


@router.get("/me/interventions", response_model=list[AssignedPlan])
def assigned_interventions(user: Student, db: Db, classroom_id: UUID):
    classroom = get_classroom(classroom_id, user, db)
    rows = db.execute(
        select(Intervention, Lesson).select_from(Intervention)
        .join(Group, Group.id == Intervention.group_id)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .join(Lesson, Lesson.id == Group.lesson_id)
        .where(Lesson.classroom_id == classroom_id, GroupMember.student_id == user.id,
               Intervention.status == e.InterventionStatus.assigned)
        .order_by(Intervention.validated_at.desc())
    )
    return [
        AssignedPlan(id=plan.id, lesson_id=lesson.id, lesson_title=lesson.title,
                     plan=plan.plan_json["plan"], assigned_at=plan.validated_at,
                     is_synthetic=classroom.is_synthetic)
        for plan, lesson in rows
    ]
