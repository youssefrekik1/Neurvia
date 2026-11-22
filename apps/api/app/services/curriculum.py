"""Classes, subjects and the courses linking them (see app.models.curriculum)."""

from datetime import timedelta
from secrets import token_hex

from sqlalchemy import select

from app.core.errors import error
from app.models import Classroom, Membership, User
from app.models.curriculum import Cohort, CohortMember, TeacherSubject

# Subjects whose reference taxonomy ships with Neurvia, by display name.
BUILTIN_SUBJECTS = {"Algorithmique & Python": "python_intro"}
BUILTIN_LABELS = {key: name for name, key in BUILTIN_SUBJECTS.items()}
COURSE_CODE_TTL = timedelta(days=3650)


def subject_key(name: str) -> str:
    return BUILTIN_SUBJECTS.get(name, name)


def course_name(subject: TeacherSubject, cohort: Cohort) -> str:
    return f"{subject.name} · {cohort.name}"[:120]


def enroll_in_courses(db, cohort_id, user: User):
    """Add a cohort member to every course taught to the cohort."""
    rooms = db.scalars(select(Classroom).where(Classroom.cohort_id == cohort_id))
    for room in rooms:
        if db.scalar(select(Membership.id).where(Membership.classroom_id == room.id,
                                                 Membership.user_id == user.id)) is None:
            db.add(Membership(classroom_id=room.id, user_id=user.id, pseudonym=user.full_name))


def join_cohort(db, user: User, cohort: Cohort):
    current = db.scalar(select(CohortMember).where(CohortMember.user_id == user.id))
    if current is not None and current.cohort_id != cohort.id:
        raise error(409, "CLASS_ALREADY_CHOSEN", "Vous appartenez déjà à une autre classe.")
    if current is None:
        db.add(CohortMember(cohort_id=cohort.id, user_id=user.id))
        db.flush()
    enroll_in_courses(db, cohort.id, user)


def open_course(db, teacher: User, subject: TeacherSubject, cohort: Cohort, now) -> Classroom:
    """The course for (subject, cohort), created with every cohort member enrolled."""
    room = db.scalar(select(Classroom).where(Classroom.subject_id == subject.id, Classroom.cohort_id == cohort.id))
    if room is None:
        room = Classroom(teacher_id=teacher.id, name=course_name(subject, cohort), subject=subject.key,
                         join_code=token_hex(10).upper(), join_expires_at=now + COURSE_CODE_TTL,
                         is_synthetic=teacher.is_synthetic, cohort_id=cohort.id, subject_id=subject.id)
        db.add(room)
        db.flush()
    members = db.scalars(select(User).join(CohortMember, CohortMember.user_id == User.id)
                         .where(CohortMember.cohort_id == cohort.id))
    for user in members:
        if db.scalar(select(Membership.id).where(Membership.classroom_id == room.id,
                                                 Membership.user_id == user.id)) is None:
            db.add(Membership(classroom_id=room.id, user_id=user.id, pseudonym=user.full_name))
    return room


def teacher_subject(db, teacher: User, name: str) -> TeacherSubject:
    subject = db.scalar(select(TeacherSubject).where(TeacherSubject.teacher_id == teacher.id,
                                                     TeacherSubject.name == name))
    if subject is None:
        subject = TeacherSubject(teacher_id=teacher.id, name=name, key=subject_key(name))
        db.add(subject)
        db.flush()
    return subject


def adopt_legacy_classrooms(db) -> int:
    """Give every classroom created before cohorts existed its own class and subject. Idempotent."""
    adopted = 0
    for room in db.scalars(select(Classroom).where(Classroom.cohort_id.is_(None))).all():
        teacher = db.get(User, room.teacher_id)
        cohort = Cohort(name=room.name, created_by=teacher.id, is_synthetic=room.is_synthetic)
        db.add(cohort)
        db.flush()
        subject = teacher_subject(db, teacher, BUILTIN_LABELS.get(room.subject, room.subject))
        room.cohort_id, room.subject_id = cohort.id, subject.id
        for user_id in db.scalars(select(Membership.user_id).where(Membership.classroom_id == room.id)):
            if db.scalar(select(CohortMember.id).where(CohortMember.user_id == user_id)) is None:
                db.add(CohortMember(cohort_id=cohort.id, user_id=user_id))
        db.flush()
        adopted += 1
    return adopted
