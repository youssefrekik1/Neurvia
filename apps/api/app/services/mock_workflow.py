from dataclasses import dataclass, field
from datetime import datetime, timedelta
from uuid import UUID, uuid4

from app.core.errors import error
from app.models.enums import AttemptStatus, Confidence, QuestionRole, QuestionStatus, QuizStatus
from app.schemas.analytics import GroupUpdate
from app.schemas.learning import AnswerInput, AnswerSaved, Diagnosis, Feedback, QuestionDraft, TeacherQuestion
from app.services import demo_examples as sample
from app.services.demo_seed import CLASSROOM_ID, LESSON_ID, STUDENT_IDS, TEACHER_ID, fixture_id


@dataclass
class MockQuiz:
    id: UUID
    questions: list[TeacherQuestion]
    kind: QuestionRole = QuestionRole.initial
    status: QuizStatus = QuizStatus.draft
    validated_at: datetime | None = None

    def publish(self, now):
        if not self.questions:
            raise error(409)
        if self.status != QuizStatus.draft:
            raise error(409)
        self.validated_at = now
        self.status = QuizStatus.published
        self.questions = [
            item.model_copy(update={"validated_by": TEACHER_ID, "validated_at": now,
                                    "status": QuestionStatus.validated}) for item in self.questions
        ]

    def view(self):
        return {
            "id": self.id, "lesson_id": LESSON_ID, "kind": self.kind,
            "status": self.status, "generation_mode": "fixture", "used_fallback": False,
            "validated_at": self.validated_at, "validated_by": TEACHER_ID if self.validated_at else None,
            "questions": self.questions, "is_synthetic": True,
        }

    def check_draft(self):
        if self.status != QuizStatus.draft:
            raise error(409, "QUIZ_IMMUTABLE", "Seul un brouillon peut être modifié.")

    def question_index(self, question_id):
        for index, item in enumerate(self.questions):
            if item.id == question_id:
                return index
        raise error(404)


@dataclass
class MockAttempt:
    id: UUID
    user_id: UUID
    quiz: MockQuiz
    answers: dict[UUID, AnswerSaved] = field(default_factory=dict)
    feedback: Feedback | None = None
    confirmation: AnswerSaved | None = None

    def view(self):
        return {
            "id": self.id, "quiz_id": self.quiz.id, "kind": self.quiz.kind,
            "status": AttemptStatus.submitted if self.feedback is not None else AttemptStatus.in_progress,
            "questions": [sample.student_question(item) for item in self.quiz.questions],
            "saved_answers": list(self.answers.values()), "is_synthetic": True,
        }

    def save(self, data: AnswerInput):
        if self.feedback is not None or self.quiz.status != QuizStatus.published:
            raise error(409)
        item = self.quiz.questions[self.quiz.question_index(data.question_id)]
        answer = save_choice(item, data)
        self.answers[item.id] = answer
        return answer

    def submit(self):
        if self.feedback is not None:
            return self.feedback
        if self.quiz.status != QuizStatus.published:
            raise error(409)
        responses = []
        evidence_count = 0
        for item in self.quiz.questions:
            saved = self.answers.get(item.id)
            if saved is None:
                continue
            selected = next(option for option in item.options if option.id == saved.option_id)
            correct = next(option for option in item.options if option.is_correct)
            if selected.misconception_code == sample.ERROR_CODE:
                evidence_count += 1
            responses.append({
                "question_id": item.id, "is_correct": selected.is_correct,
                "quadrant": quadrant(selected.is_correct, saved.confidence),
                "correct_option_id": correct.id, "explanation": item.explanation,
            })
        sufficient = len(responses) >= 4
        eligible = self.quiz.kind == QuestionRole.initial and sufficient and evidence_count == 1
        difficulties = []
        if self.quiz.kind == QuestionRole.initial and evidence_count:
            difficulties.append(diagnosis(evidence_count, "suspected"))
        self.feedback = Feedback(
            attempt_id=self.id, answers=responses, total_questions=len(self.quiz.questions),
            answered_count=len(responses), correct_count=sum(item["is_correct"] for item in responses),
            diagnosis_quality="sufficient" if sufficient else "insufficient",
            suspected_difficulties=difficulties, confirmation_available=eligible, is_synthetic=True,
        )
        return self.feedback

    def get_feedback(self):
        if self.feedback is None:
            raise error(409, "ATTEMPT_NOT_SUBMITTED", "La tentative doit être soumise.")
        return self.feedback

    def confirmation_question(self):
        feedback = self.get_feedback()
        if not feedback.confirmation_available:
            return None
        return {"question": sample.student_question(sample.question("confirmation")),
                "misconception_code": sample.ERROR_CODE, "is_synthetic": True}

    def submit_confirmation(self, data: AnswerInput):
        feedback = self.get_feedback()
        if self.confirmation is not None:
            if self.confirmation.model_dump(exclude={"saved"}) == data.model_dump():
                return feedback
            raise error(409)
        if self.confirmation_question() is None:
            raise error(409)
        item = sample.question("confirmation")
        self.confirmation = save_choice(item, data)
        choice = next(option for option in item.options if option.id == data.option_id)
        if choice.is_correct:
            feedback.suspected_difficulties = [diagnosis(1, "contradicted_or_transient")]
        elif choice.misconception_code == sample.ERROR_CODE:
            feedback.suspected_difficulties = [diagnosis(2, "corroborated")]
        feedback.confirmation_available = False
        return feedback


def diagnosis(count: int, status: str):
    messages = {
        "suspected": "Difficulté possible sur les indices.",
        "corroborated": "Deux réponses sur des questions différentes appuient cette hypothèse.",
        "contradicted_or_transient": "La réponse de vérification affaiblit l’hypothèse initiale.",
    }
    return Diagnosis(
        misconception_code=sample.ERROR_CODE, status=status, evidence_count=count,
        distinct_questions_count=count, message=messages[status],
    )


def quadrant(correct: bool, confidence: Confidence) -> str:
    if correct:
        return "acquired" if confidence == Confidence.sure else "fragile"
    return "misconception" if confidence == Confidence.sure else "gap"


def save_choice(item: TeacherQuestion, data: AnswerInput):
    if item.id != data.question_id or data.option_id not in {option.id for option in item.options}:
        raise error(422, "INVALID_OPTION", "Cette option ne correspond pas à la question.")
    return AnswerSaved(**data.model_dump())


class MockWorkflow:
    """Transient, isolated fixtures for UI integration during Phase 0."""

    def __init__(self, now):
        initial = MockQuiz(sample.INITIAL, sample.initial_questions())
        initial.publish(now)
        self.quizzes = {initial.id: initial}
        self.attempts: dict[UUID, MockAttempt] = {}
        self.group = sample.sample_group()
        self.plan = None
        self.immediate_due = None
        self.follow_up = {}

    def quiz(self, id: UUID) -> MockQuiz:
        quiz = self.quizzes.get(id)
        if quiz is None:
            raise error(404)
        return quiz

    def generate_draft(self, question_count):
        if question_count and question_count > 4:
            raise error(409, "FIXTURE_LIMIT", "Le jeu fictif contient quatre questions initiales.")
        existing = self.quizzes.get(sample.DRAFT)
        if existing is not None and existing.status == QuizStatus.draft:
            return existing
        draft_id = sample.DRAFT if existing is None else uuid4()
        questions = [
            item.model_copy(update={"id": uuid4(), "options": [
                option.model_copy(update={"id": uuid4()}) for option in item.options
            ]}) for item in sample.initial_questions()[:question_count]
        ]
        quiz = MockQuiz(draft_id, questions)
        self.quizzes[quiz.id] = quiz
        return quiz

    def start_attempt(self, quiz_id, user_id, now):
        quiz = self.quiz(quiz_id)
        attempt_id = fixture_id(f"attempt-{quiz_id}-{user_id}")
        attempt = self.attempts.get(attempt_id)
        if attempt is not None:
            return attempt
        if quiz.status != QuizStatus.published:
            raise error(409)
        if quiz_id in {sample.IMMEDIATE, sample.J7}:
            if quiz_id == sample.J7 and self.follow_up.get(user_id, now + timedelta(days=1)) > now:
                raise error(404)
            if quiz_id == sample.IMMEDIATE and not self._assigned_to(user_id):
                raise error(404)
        attempt = MockAttempt(attempt_id, user_id, quiz)
        self.attempts[attempt_id] = attempt
        return attempt

    def attempt(self, id, user_id):
        attempt = self.attempts.get(id)
        if attempt is None or attempt.user_id != user_id:
            raise error(404)
        return attempt

    def _assigned_to(self, user_id):
        membership = sample.MEMBERS[STUDENT_IDS.index(user_id)]
        return membership in self.group["student_ids"]

    def update_group(self, data: GroupUpdate):
        if self.plan is not None and self.plan["status"] == "assigned":
            raise error(409)
        if data.student_ids is not None:
            if not set(data.student_ids).issubset(sample.MEMBERS):
                raise error(404)
            self.group["student_ids"] = data.student_ids
        self.group["status"] = {"accept": "accepted", "modify": "modified", "reject": "rejected"}[data.action]
        return self.group

    def require_accepted_group(self):
        if self.group["status"] not in {"accepted", "modified"}:
            raise error(409, "GROUP_APPROVAL_REQUIRED", "Le groupe doit être approuvé.")

    def generate_plan(self):
        self.require_accepted_group()
        if self.plan is None:
            self.plan = {
                "id": sample.PLAN_ID, "group_id": sample.GROUP_ID, "plan": sample.sample_plan(),
                "status": "draft", "source": "fixture", "used_fallback": False, "is_synthetic": True,
            }
        return self.plan

    def read_plan(self, id, *, draft=False):
        if self.plan is None or id != sample.PLAN_ID:
            raise error(404)
        if draft and self.plan["status"] != "draft":
            raise error(409)
        return self.plan

    def start_retest(self, id, now):
        plan = self.read_plan(id)
        if plan["status"] != "assigned":
            raise error(409)
        if sample.IMMEDIATE not in self.quizzes:
            self.immediate_due = now
            quiz = MockQuiz(sample.IMMEDIATE, [sample.question("immediate")], QuestionRole.immediate_retest)
            quiz.publish(now)
            self.quizzes[quiz.id] = quiz
        return self.schedule_view(now)

    def schedule_j7(self, user_id, now):
        self.follow_up.setdefault(user_id, now + timedelta(days=7))
        if sample.J7 not in self.quizzes:
            quiz = MockQuiz(sample.J7, [sample.question("j7")], QuestionRole.j7_retest)
            quiz.publish(now)
            self.quizzes[quiz.id] = quiz

    def schedule_view(self, now, *, j7=False):
        kind = "j7" if j7 else "immediate"
        quiz_id = sample.J7 if j7 else sample.IMMEDIATE
        if j7:
            dates = sorted(self.follow_up.items())
        else:
            dates = [(user_id, self.immediate_due) for user_id in STUDENT_IDS if self._assigned_to(user_id)]
        schedules = []
        for user_id, due in dates:
            attempt = self.attempts.get(fixture_id(f"attempt-{quiz_id}-{user_id}"))
            status = "pending" if due > now else "available"
            if attempt is not None and attempt.feedback is not None:
                status = "done"
            schedules.append({
                "id": fixture_id(f"schedule-{kind}-{user_id}"), "concept_code": sample.CONCEPT,
                "kind": kind, "due_at": due, "status": status, "quiz_id": quiz_id,
            })
        return {"lesson_id": LESSON_ID, "is_synthetic": True, "schedules": schedules}

    def tasks(self, user_id, now, *, classroom_id=None, retests_only=False):
        if classroom_id is not None and classroom_id != CLASSROOM_ID:
            return []
        results = []
        for quiz in self.quizzes.values():
            if quiz.status != QuizStatus.published:
                continue
            if retests_only and quiz.kind == QuestionRole.initial:
                continue
            due_at = None
            if quiz.id == sample.IMMEDIATE:
                if not self._assigned_to(user_id):
                    continue
                due_at = self.immediate_due
            if quiz.id == sample.J7:
                due_at = self.follow_up.get(user_id)
                if due_at is None or now < due_at:
                    continue
            attempt = self.attempts.get(fixture_id(f"attempt-{quiz.id}-{user_id}"))
            done = attempt is not None and attempt.feedback is not None
            results.append(sample.task_for(
                quiz.id, quiz.kind, "done" if done else "available",
                attempt_id=attempt.id if attempt else None, due_at=due_at,
            ))
            if done and attempt.feedback.confirmation_available:
                results.append({
                    **sample.task_for(quiz.id, QuestionRole.confirmation, attempt_id=attempt.id),
                    "id": fixture_id(f"task-confirmation-{attempt.id}"), "quiz_id": None,
                })
        return results


def draft_question(data: QuestionDraft, id: UUID | None = None, version: int = 1):
    if data.concept_code not in {"C_INDEXING", "C_LOOPS"}:
        raise error(422, "UNKNOWN_CONCEPT", "Le concept doit appartenir à la séance.")
    allowed = {"M_OFF_BY_ONE", "M_TRACE"}
    if data.concept_code == "C_LOOPS":
        allowed.add("M_LOOP_STOP")
    try:
        data.check_taxonomy(data.concept_code, allowed)
    except ValueError:
        raise error(422, "INVALID_TAXONOMY", "Code d'erreur non autorisé pour ce concept.") from None
    return TeacherQuestion(
        **data.model_dump(exclude={"options"}), id=id or uuid4(), version=version,
        role="initial", status="draft", source="teacher",
        options=[{**option.model_dump(), "id": uuid4()} for option in data.options],
    )
