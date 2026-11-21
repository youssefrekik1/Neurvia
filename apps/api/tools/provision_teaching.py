"""Provision an academic year, cohort and optional teaching assignment."""
import argparse
from uuid import UUID

from sqlalchemy import select

from app.core.config import Settings
from app.db.migrate import initialize_schema
from app.db.session import build_database
from app.models import User
from app.models.documents import Institution
from app.models.enums import Role
from app.models.teaching import Cohort, CohortMembership, Subject
from app.services.access import start_write
from app.services.teaching import assign_teacher, backfill_teaching, enroll, subject_for, year_for


def provision(db, institution_id, academic_year, name, *, policy=None, active=None, teacher_email=None,
              subject_code=None, subject_label=None, student_email=None):
    institution = db.get(Institution, institution_id)
    if institution is None:
        raise ValueError("Unknown institution.")
    year = year_for(db, institution.id, academic_year)
    key = name.casefold()
    cohort = db.scalar(select(Cohort).where(Cohort.year_id == year.id, Cohort.key == key))
    if not cohort:
        cohort = Cohort(year_id=year.id, key=key, name=name)
        db.add(cohort)
    if policy is not None:
        cohort.enrollment_policy = policy
    if active is not None:
        cohort.active = active
    db.flush()
    if student_email:
        student = db.scalar(select(User).where(User.email == student_email.casefold(), User.role == Role.student,
                                              User.is_synthetic == institution.is_synthetic))
        if student is None:
            raise ValueError("Unknown student account.")
        if not db.scalar(select(CohortMembership.id).where(
            CohortMembership.cohort_id == cohort.id, CohortMembership.user_id == student.id,
        )):
            enroll(db, cohort, student)
    assignment = None
    if teacher_email:
        teacher = db.scalar(select(User).where(User.email == teacher_email.casefold()))
        if teacher is None:
            raise ValueError("Unknown teacher account.")
        subject = subject_for(db, subject_code, subject_label, institution.id) if subject_label else db.scalar(
            select(Subject).where(Subject.key == subject_code))
        if subject is None:
            raise ValueError("Unknown subject code. Supply --subject-label to create a local subject.")
        assignment = assign_teacher(db, cohort, subject, teacher)
        db.flush()
    return cohort, assignment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--institution", required=True, type=UUID)
    parser.add_argument("--year", required=True)
    parser.add_argument("--class", required=True, dest="name")
    parser.add_argument("--enrollment", choices=["open", "closed"])
    parser.add_argument("--active", action=argparse.BooleanOptionalAction, default=None)
    parser.add_argument("--teacher")
    parser.add_argument("--subject")
    parser.add_argument("--subject-label")
    parser.add_argument("--enroll", help="Verified existing student email for a controlled enrollment.")
    args = parser.parse_args()
    if bool(args.teacher) != bool(args.subject) or (args.subject_label and not args.teacher):
        parser.error("--teacher and --subject must be supplied together.")
    args.year, args.name = args.year.strip(), args.name.strip()
    if not 0 < len(args.year) <= 30 or not 0 < len(args.name) <= 120:
        parser.error("Provide an academic year and class name within the allowed lengths.")
    if (args.subject and not 0 < len(args.subject.strip()) <= 100
            or args.subject_label and not 0 < len(args.subject_label.strip()) <= 120):
        parser.error("The subject code and label must be within the allowed lengths.")
    engine, sessions = build_database(Settings().db_url)
    try:
        initialize_schema(engine)
        with sessions.begin() as db:
            start_write(db)
            backfill_teaching(db)
            cohort, assignment = provision(db, args.institution, args.year, args.name, policy=args.enrollment,
                                           active=args.active, teacher_email=args.teacher,
                                           subject_code=args.subject, subject_label=args.subject_label,
                                           student_email=args.enroll)
        print(f"Cohort: {cohort.id}; assignment: {assignment.id if assignment else 'none'}")
    except ValueError as exc:
        parser.error(str(exc))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
