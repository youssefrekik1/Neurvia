from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    JSON, CheckConstraint, ForeignKey, ForeignKeyConstraint, Index, String, Text,
    UniqueConstraint, text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Record, UTCDateTime, enum_column, utcnow
from app.models import enums as e


def fk(table, **kwargs):
    return mapped_column(ForeignKey(f"{table}.id"), index=True, **kwargs)


approval_check = "status != 'validated' OR (validated_by IS NOT NULL AND validated_at IS NOT NULL)"


class User(Record):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    full_name: Mapped[str] = mapped_column(String(100))
    role: Mapped[e.Role] = mapped_column(enum_column(e.Role))
    is_synthetic: Mapped[bool] = mapped_column(default=False)


class Classroom(Record):
    __tablename__ = "classrooms"

    teacher_id: Mapped[UUID] = fk("users")
    name: Mapped[str] = mapped_column(String(120))
    subject: Mapped[str] = mapped_column(String(100))
    join_code: Mapped[str] = mapped_column(String(32), unique=True)
    join_expires_at: Mapped[datetime] = mapped_column(UTCDateTime())
    is_synthetic: Mapped[bool] = mapped_column(default=False)


class Membership(Record):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("classroom_id", "user_id"),)

    classroom_id: Mapped[UUID] = fk("classrooms")
    user_id: Mapped[UUID] = fk("users")
    pseudonym: Mapped[str] = mapped_column(String(100))


class Concept(Record):
    __tablename__ = "concepts"

    subject: Mapped[str] = mapped_column(String(100), index=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    label_fr: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)


class Misconception(Record):
    __tablename__ = "misconceptions"

    code: Mapped[str] = mapped_column(String(40), unique=True)
    label_fr: Mapped[str] = mapped_column(String(200))
    remediation_hint: Mapped[str] = mapped_column(Text)
    is_transversal: Mapped[bool] = mapped_column(default=False)


class MisconceptionConcept(Record):
    __tablename__ = "misconception_concepts"
    __table_args__ = (UniqueConstraint("misconception_id", "concept_id"),)

    misconception_id: Mapped[UUID] = fk("misconceptions")
    concept_id: Mapped[UUID] = fk("concepts")


class Lesson(Record):
    __tablename__ = "lessons"

    classroom_id: Mapped[UUID] = fk("classrooms")
    title: Mapped[str] = mapped_column(String(160))
    content_text: Mapped[str] = mapped_column(Text)
    focus_brief_json: Mapped[dict] = mapped_column(JSON)
    status: Mapped[e.LessonStatus] = mapped_column(enum_column(e.LessonStatus), index=True)
    taught_on: Mapped[date | None]


class LessonConcept(Record):
    __tablename__ = "lesson_concepts"
    __table_args__ = (UniqueConstraint("lesson_id", "concept_id"),)

    lesson_id: Mapped[UUID] = fk("lessons")
    concept_id: Mapped[UUID] = fk("concepts")


class Question(Record):
    __tablename__ = "questions"
    __table_args__ = (
        CheckConstraint(approval_check, name="question_validation_required"),
        CheckConstraint("version > 0 AND difficulty BETWEEN 1 AND 3", name="question_limits"),
    )

    concept_id: Mapped[UUID] = fk("concepts")
    seed_key: Mapped[str | None] = mapped_column(String(60), unique=True)
    bank_owner_id: Mapped[UUID | None] = fk("users")
    target_misconception_id: Mapped[UUID | None] = fk("misconceptions")
    stem: Mapped[str] = mapped_column(Text)
    code: Mapped[str | None] = mapped_column(Text)
    explanation: Mapped[str] = mapped_column(Text)
    source: Mapped[e.Source] = mapped_column(enum_column(e.Source))
    role: Mapped[e.QuestionRole] = mapped_column(enum_column(e.QuestionRole), index=True)
    variant_family_id: Mapped[str | None] = mapped_column(String(80), index=True)
    status: Mapped[e.QuestionStatus] = mapped_column(enum_column(e.QuestionStatus), index=True)
    validated_by: Mapped[UUID | None] = fk("users")
    validated_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    difficulty: Mapped[int]
    version: Mapped[int] = mapped_column(default=1)


class QuestionOption(Record):
    __tablename__ = "question_options"
    __table_args__ = (
        UniqueConstraint("question_id", "position"),
        UniqueConstraint("question_id", "id"),
        CheckConstraint("position BETWEEN 1 AND 4 AND (NOT is_correct OR misconception_id IS NULL)"),
        Index("uq_question_correct_option", "question_id", unique=True,
              sqlite_where=text("is_correct = 1"), postgresql_where=text("is_correct")),
    )

    question_id: Mapped[UUID] = fk("questions")
    position: Mapped[int]
    text: Mapped[str] = mapped_column(Text)
    is_correct: Mapped[bool]
    misconception_id: Mapped[UUID | None] = fk("misconceptions")


class Quiz(Record):
    __tablename__ = "quizzes"
    __table_args__ = (
        CheckConstraint(
            "status = 'draft' OR (validated_by IS NOT NULL AND validated_at IS NOT NULL)",
            name="quiz_validation_required",
        ),
    )

    lesson_id: Mapped[UUID] = fk("lessons")
    parent_quiz_id: Mapped[UUID | None] = fk("quizzes")
    recipient_id: Mapped[UUID | None] = fk("users")
    generation_mode: Mapped[str] = mapped_column(String(20), default="teacher")
    used_fallback: Mapped[bool] = mapped_column(default=False)
    kind: Mapped[e.QuestionRole] = mapped_column(enum_column(e.QuestionRole))
    status: Mapped[e.QuizStatus] = mapped_column(enum_column(e.QuizStatus), index=True)
    validated_by: Mapped[UUID | None] = fk("users")
    validated_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    scheduled_for: Mapped[datetime | None] = mapped_column(UTCDateTime(), index=True)


class QuizQuestion(Record):
    __tablename__ = "quiz_questions"
    __table_args__ = (
        UniqueConstraint("quiz_id", "question_id"),
        UniqueConstraint("quiz_id", "position"),
    )

    quiz_id: Mapped[UUID] = fk("quizzes")
    question_id: Mapped[UUID] = fk("questions")
    position: Mapped[int]


class Attempt(Record):
    __tablename__ = "attempts"
    __table_args__ = (UniqueConstraint("quiz_id", "student_id"),)

    quiz_id: Mapped[UUID] = fk("quizzes")
    student_id: Mapped[UUID] = fk("users")
    status: Mapped[e.AttemptStatus] = mapped_column(enum_column(e.AttemptStatus), index=True)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    submitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class ConfirmationAssignment(Record):
    __tablename__ = "confirmation_assignments"
    __table_args__ = (UniqueConstraint("initial_attempt_id"), UniqueConstraint("quiz_id"))

    initial_attempt_id: Mapped[UUID] = fk("attempts")
    quiz_id: Mapped[UUID] = fk("quizzes")
    misconception_id: Mapped[UUID] = fk("misconceptions")


class Answer(Record):
    __tablename__ = "answers"
    __table_args__ = (
        UniqueConstraint("attempt_id", "question_id"),
        ForeignKeyConstraint(
            ["question_id", "option_id"], ["question_options.question_id", "question_options.id"]
        ),
    )

    attempt_id: Mapped[UUID] = fk("attempts")
    question_id: Mapped[UUID] = fk("questions")
    option_id: Mapped[UUID] = mapped_column(index=True)
    confidence: Mapped[e.Confidence] = mapped_column(enum_column(e.Confidence))
    is_correct: Mapped[bool]
    quadrant: Mapped[e.Quadrant] = mapped_column(enum_column(e.Quadrant))


class MisconceptionObservation(Record):
    __tablename__ = "misconception_observations"
    __table_args__ = (UniqueConstraint("answer_id", "misconception_id"),)

    answer_id: Mapped[UUID] = fk("answers")
    student_id: Mapped[UUID] = fk("users")
    lesson_id: Mapped[UUID] = fk("lessons")
    misconception_id: Mapped[UUID] = fk("misconceptions")
    source: Mapped[str] = mapped_column(String(40), default="observed_wrong_option")
    evidence_stage: Mapped[e.QuestionRole] = mapped_column(enum_column(e.QuestionRole))


class DiagnosisSummary(Record):
    __tablename__ = "diagnosis_summaries"
    __table_args__ = (UniqueConstraint("student_id", "lesson_id", "misconception_id"),)

    student_id: Mapped[UUID] = fk("users")
    lesson_id: Mapped[UUID] = fk("lessons")
    misconception_id: Mapped[UUID] = fk("misconceptions")
    status: Mapped[e.DiagnosisStatus] = mapped_column(enum_column(e.DiagnosisStatus))
    evidence_count: Mapped[int]
    distinct_questions_count: Mapped[int]
    teacher_review_status: Mapped[e.ReviewStatus | None] = mapped_column(enum_column(e.ReviewStatus))


class Group(Record):
    __tablename__ = "groups"

    lesson_id: Mapped[UUID] = fk("lessons")
    label: Mapped[str] = mapped_column(String(160))
    main_misconception_id: Mapped[UUID] = fk("misconceptions")
    confidence_label: Mapped[e.GroupConfidence] = mapped_column(enum_column(e.GroupConfidence))
    avg_similarity: Mapped[float]
    explanation_json: Mapped[dict] = mapped_column(JSON)
    status: Mapped[e.GroupStatus] = mapped_column(enum_column(e.GroupStatus), index=True)


class GroupMember(Record):
    __tablename__ = "group_members"
    __table_args__ = (UniqueConstraint("group_id", "student_id"),)

    group_id: Mapped[UUID] = fk("groups")
    student_id: Mapped[UUID] = fk("users")


class Intervention(Record):
    __tablename__ = "interventions"
    __table_args__ = (
        CheckConstraint(
            "status = 'draft' OR (validated_by IS NOT NULL AND validated_at IS NOT NULL)",
            name="intervention_validation_required",
        ),
    )

    group_id: Mapped[UUID] = fk("groups")
    plan_json: Mapped[dict] = mapped_column(JSON)
    status: Mapped[e.InterventionStatus] = mapped_column(enum_column(e.InterventionStatus), index=True)
    validated_by: Mapped[UUID | None] = fk("users")
    validated_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class RetestSchedule(Record):
    __tablename__ = "retest_schedule"
    __table_args__ = (UniqueConstraint("student_id", "lesson_id", "concept_id", "kind"),)

    student_id: Mapped[UUID] = fk("users")
    lesson_id: Mapped[UUID] = fk("lessons")
    concept_id: Mapped[UUID] = fk("concepts")
    kind: Mapped[e.RetestKind] = mapped_column(enum_column(e.RetestKind))
    target_misconception_id: Mapped[UUID | None] = fk("misconceptions")
    due_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)
    quiz_id: Mapped[UUID | None] = fk("quizzes")
    status: Mapped[e.ScheduleStatus] = mapped_column(enum_column(e.ScheduleStatus), index=True)


class LLMCache(Record):
    __tablename__ = "llm_cache"
    __table_args__ = (UniqueConstraint("task", "model", "input_hash", "schema_version"),)

    task: Mapped[str] = mapped_column(String(60))
    model: Mapped[str] = mapped_column(String(160))
    input_hash: Mapped[str] = mapped_column(String(64))
    output_json: Mapped[dict] = mapped_column(JSON)
    schema_version: Mapped[str] = mapped_column(String(64))


class TeacherDecision(Record):
    __tablename__ = "teacher_decisions"
    __table_args__ = (Index("ix_decisions_entity", "entity_type", "entity_id"),)

    teacher_id: Mapped[UUID] = fk("users")
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[UUID]
    action: Mapped[str] = mapped_column(String(40))
    before_json: Mapped[dict | None] = mapped_column(JSON)
    after_json: Mapped[dict | None] = mapped_column(JSON)
    at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
