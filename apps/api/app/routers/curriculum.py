from uuid import UUID

from fastapi import APIRouter, Request
from sqlalchemy import func, select

from app.core.auth import Student, Teacher
from app.core.errors import documented_errors, error
from app.db.session import Db
from app.models import Classroom, Lesson, Membership
from app.models.curriculum import Cohort, CohortMember, TeacherSubject
from app.schemas.common import (
    CohortChoice, CohortCreate, CohortView, SubjectCohorts, SubjectCourse, SubjectCreate, SubjectView,
)
from app.services.access import start_write
from app.services.curriculum import join_cohort, open_course, subject_key

router = APIRouter(tags=["Classes et matières"], responses=documented_errors(401, 403, 404, 409, 422))


def visible_cohorts(request):
    """Synthetic demo classes are listed only when the demo is running."""
    query = select(Cohort)
    if not request.app.state.settings.demo_mode:
        query = query.where(Cohort.is_synthetic.is_(False))
    return query


def cohort_or_404(db, request, cohort_id):
    cohort = db.scalar(visible_cohorts(request).where(Cohort.id == cohort_id))
    if cohort is None:
        raise error(404)
    return cohort


@router.get("/cohorts", response_model=list[CohortView])
def list_cohorts(request: Request, db: Db):
    """Class names for the sign-up form: no authentication, names only."""
    return [CohortView(id=row.id, name=row.name) for row in db.scalars(visible_cohorts(request).order_by(Cohort.name))]


@router.get("/me/cohorts", response_model=list[CohortView])
def teacher_cohorts(request: Request, user: Teacher, db: Db):
    """Classes a teacher manages: those they created or already teach."""
    taught = select(Classroom.cohort_id).where(Classroom.teacher_id == user.id)
    rows = db.scalars(visible_cohorts(request).where((Cohort.created_by == user.id) | Cohort.id.in_(taught))
                      .order_by(Cohort.name))
    return [CohortView(id=row.id, name=row.name) for row in rows]


@router.post("/cohorts", response_model=CohortView, status_code=201)
def create_cohort(data: CohortCreate, request: Request, user: Teacher, db: Db):
    start_write(db)
    if db.scalar(visible_cohorts(request).where(func.lower(Cohort.name) == data.name.casefold())):
        raise error(409, "CLASS_EXISTS", "Une classe porte déjà ce nom.")
    row = Cohort(name=data.name, created_by=user.id, is_synthetic=user.is_synthetic)
    db.add(row)
    db.commit()
    return CohortView(id=row.id, name=row.name, student_count=0)


@router.get("/me/cohort", response_model=CohortView | None)
def my_cohort(user: Student, db: Db):
    row = db.scalar(select(Cohort).join(CohortMember).where(CohortMember.user_id == user.id))
    return CohortView(id=row.id, name=row.name) if row else None


@router.post("/me/cohort", response_model=CohortView)
def choose_cohort(data: CohortChoice, request: Request, user: Student, db: Db):
    start_write(db)
    cohort = cohort_or_404(db, request, data.cohort_id)
    join_cohort(db, user, cohort)
    db.commit()
    return CohortView(id=cohort.id, name=cohort.name)


def subject_view(db, subject):
    courses = []
    for room, cohort in db.execute(select(Classroom, Cohort).join(Cohort, Cohort.id == Classroom.cohort_id)
                                   .where(Classroom.subject_id == subject.id).order_by(Cohort.name)):
        courses.append(SubjectCourse(
            cohort_id=cohort.id, cohort_name=cohort.name, classroom_id=room.id,
            student_count=db.scalar(select(func.count()).select_from(Membership)
                                    .where(Membership.classroom_id == room.id)),
            lesson_count=db.scalar(select(func.count()).select_from(Lesson).where(Lesson.classroom_id == room.id)),
        ))
    return SubjectView(id=subject.id, name=subject.name, key=subject.key, courses=courses)


@router.get("/subjects", response_model=list[SubjectView])
def list_subjects(user: Teacher, db: Db):
    rows = db.scalars(select(TeacherSubject).where(TeacherSubject.teacher_id == user.id).order_by(TeacherSubject.name))
    return [subject_view(db, row) for row in rows]


def set_courses(db, request, user, subject, cohort_ids):
    now = request.app.state.system_clock.now()
    wanted = {cohort_or_404(db, request, cohort_id).id: cohort_id for cohort_id in cohort_ids}
    for cohort_id in wanted:
        open_course(db, user, subject, db.get(Cohort, cohort_id), now)
    dropped = select(Classroom).where(Classroom.subject_id == subject.id)
    if wanted:  # NOT IN over an empty list would be NOT IN (NULL), which matches nothing
        dropped = dropped.where(Classroom.cohort_id.not_in(list(wanted)))
    for room in db.scalars(dropped).all():
        if db.scalar(select(Lesson.id).where(Lesson.classroom_id == room.id).limit(1)):
            raise error(409, "COURSE_HAS_LESSONS",
                        f"« {room.name} » contient déjà des séances : elle ne peut pas être retirée.")
        for member in db.scalars(select(Membership).where(Membership.classroom_id == room.id)):
            db.delete(member)
        db.flush()
        db.delete(room)
    db.flush()


@router.post("/subjects", response_model=SubjectView, status_code=201)
def create_subject(data: SubjectCreate, request: Request, user: Teacher, db: Db):
    start_write(db)
    if db.scalar(select(TeacherSubject.id).where(TeacherSubject.teacher_id == user.id,
                                                 TeacherSubject.name == data.name)):
        raise error(409, "SUBJECT_EXISTS", "Vous enseignez déjà cette matière.")
    subject = TeacherSubject(teacher_id=user.id, name=data.name, key=subject_key(data.name))
    db.add(subject)
    db.flush()
    set_courses(db, request, user, subject, data.cohort_ids)
    db.commit()
    return subject_view(db, subject)


@router.put("/subjects/{id}/cohorts", response_model=SubjectView)
def update_subject_cohorts(id: UUID, data: SubjectCohorts, request: Request, user: Teacher, db: Db):
    start_write(db)
    subject = db.scalar(select(TeacherSubject).where(TeacherSubject.id == id, TeacherSubject.teacher_id == user.id))
    if subject is None:
        raise error(404)
    set_courses(db, request, user, subject, data.cohort_ids)
    db.commit()
    return subject_view(db, subject)
