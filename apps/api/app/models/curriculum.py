"""Classes (student cohorts), the subjects teachers teach, and their membership.

A cohort is a class of students, e.g. "L2 Informatique A". A teacher declares the subjects they teach and, for
each, the cohorts they teach it to. Every (subject, cohort) pair is a course stored as a `Classroom`, so lessons,
quizzes, diagnosis and documents keep their existing classroom-scoped behaviour; a cohort's students are
enrolled in each of its courses automatically.
"""

from uuid import UUID

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Record


def ref(table):
    return mapped_column(ForeignKey(f"{table}.id"), index=True)


class Cohort(Record):
    __tablename__ = "cohorts"

    name: Mapped[str] = mapped_column(String(120))
    created_by: Mapped[UUID] = ref("users")
    is_synthetic: Mapped[bool] = mapped_column(default=False)


class CohortMember(Record):
    __tablename__ = "cohort_members"
    # A student belongs to one class.
    __table_args__ = (UniqueConstraint("user_id"),)

    cohort_id: Mapped[UUID] = ref("cohorts")
    user_id: Mapped[UUID] = ref("users")


class TeacherSubject(Record):
    __tablename__ = "teacher_subjects"
    __table_args__ = (UniqueConstraint("teacher_id", "name"),)

    teacher_id: Mapped[UUID] = ref("users")
    name: Mapped[str] = mapped_column(String(100))
    # Taxonomy key shared with concepts: `python_intro` for the built-in subject, otherwise the name.
    key: Mapped[str] = mapped_column(String(100))
