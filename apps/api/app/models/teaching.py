"""Institutional cohorts and assignments. A classroom is an assignment's private workspace."""
from sqlalchemy import CheckConstraint, Index, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column
from uuid import UUID

from app.db.base import Record
from app.models.documents import ref


class Subject(Record):
    __tablename__ = "subjects"

    key: Mapped[str] = mapped_column(String(160), unique=True)
    code: Mapped[str] = mapped_column(String(100))
    label: Mapped[str] = mapped_column(String(120))
    active: Mapped[bool] = mapped_column(default=True)
    institution_id: Mapped[UUID | None] = ref("institutions", nullable=True)


class AcademicYear(Record):
    __tablename__ = "academic_years"
    __table_args__ = (UniqueConstraint("institution_id", "label"),)

    institution_id: Mapped[UUID] = ref("institutions")
    label: Mapped[str] = mapped_column(String(30))
    active: Mapped[bool] = mapped_column(default=True)


class Cohort(Record):
    __tablename__ = "student_cohorts"
    __table_args__ = (UniqueConstraint("year_id", "key"),
                      CheckConstraint("enrollment_policy IN ('closed', 'open')"))

    year_id: Mapped[UUID] = ref("academic_years")
    name: Mapped[str] = mapped_column(String(120))
    key: Mapped[str] = mapped_column(String(130))
    active: Mapped[bool] = mapped_column(default=True)
    enrollment_policy: Mapped[str] = mapped_column(String(12), default="closed")
    legacy: Mapped[bool] = mapped_column(default=False)


class CohortMembership(Record):
    __tablename__ = "cohort_memberships"
    __table_args__ = (
        UniqueConstraint("cohort_id", "user_id"),
        Index("uq_primary_cohort_per_student", "user_id", unique=True,
              sqlite_where=text("is_primary = 1"), postgresql_where=text("is_primary")),
    )

    cohort_id: Mapped[UUID] = ref("student_cohorts")
    user_id: Mapped[UUID] = ref("users")
    is_primary: Mapped[bool] = mapped_column(default=False)


class TeachingAssignment(Record):
    __tablename__ = "teaching_assignments"
    __table_args__ = (UniqueConstraint("cohort_id", "subject_id", "teacher_id"), UniqueConstraint("classroom_id"))

    cohort_id: Mapped[UUID] = ref("student_cohorts")
    subject_id: Mapped[UUID] = ref("subjects")
    teacher_id: Mapped[UUID] = ref("users")
    classroom_id: Mapped[UUID] = ref("classrooms")


TEACHING_TABLES = (Subject, AcademicYear, Cohort, CohortMembership, TeachingAssignment)
