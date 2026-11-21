"""Baseline the existing educational tables before document intelligence."""

from alembic import op

from app.db.base import Base
from app import models

revision = "20261121_01"
down_revision = None
branch_labels = None
depends_on = None

TABLES = (
    "users", "classrooms", "memberships", "concepts", "misconceptions", "misconception_concepts",
    "lessons", "lesson_concepts", "questions", "question_options", "quizzes", "quiz_questions",
    "attempts", "confirmation_assignments", "answers", "misconception_observations",
    "diagnosis_summaries", "groups", "group_members", "interventions", "retest_schedule",
    "llm_cache", "teacher_decisions",
)


def upgrade():
    Base.metadata.create_all(op.get_bind(), tables=[Base.metadata.tables[name] for name in TABLES])


def downgrade():
    raise RuntimeError("Restore a snapshot or retain the educational tables.")
