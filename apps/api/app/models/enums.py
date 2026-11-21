from enum import StrEnum


class Role(StrEnum):
    teacher = "teacher"
    student = "student"


class QuestionRole(StrEnum):
    initial = "initial"
    confirmation = "confirmation"
    immediate_retest = "immediate_retest"
    j7_retest = "j7_retest"


class QuestionStatus(StrEnum):
    draft = "draft"
    validated = "validated"
    archived = "archived"


class Source(StrEnum):
    bank = "bank"
    llm = "llm"
    teacher = "teacher"


class LessonStatus(StrEnum):
    draft = "draft"
    published = "published"
    closed = "closed"


class QuizStatus(StrEnum):
    draft = "draft"
    published = "published"
    closed = "closed"


class AttemptStatus(StrEnum):
    in_progress = "in_progress"
    submitted = "submitted"


class Confidence(StrEnum):
    sure = "sure"
    medium = "medium"
    unsure = "unsure"


class Quadrant(StrEnum):
    acquired = "acquired"
    fragile = "fragile"
    misconception = "misconception"
    gap = "gap"


class DiagnosisStatus(StrEnum):
    suspected = "suspected"
    corroborated = "corroborated"
    contradicted_or_transient = "contradicted_or_transient"
    insufficient = "insufficient"


class ReviewStatus(StrEnum):
    approved = "approved"
    rejected = "rejected"
    qualified = "qualified"


class GroupConfidence(StrEnum):
    provisional = "provisional"
    corroborated = "corroborated"


class GroupStatus(StrEnum):
    suggested = "suggested"
    accepted = "accepted"
    modified = "modified"
    rejected = "rejected"


class InterventionStatus(StrEnum):
    draft = "draft"
    validated = "validated"
    assigned = "assigned"


class RetestKind(StrEnum):
    immediate = "immediate"
    j7 = "j7"


class ScheduleStatus(StrEnum):
    pending = "pending"
    available = "available"
    done = "done"
    skipped = "skipped"
