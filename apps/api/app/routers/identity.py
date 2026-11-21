from datetime import timedelta
from secrets import token_hex
from uuid import UUID

from fastapi import APIRouter, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.auth import CurrentUser, Student, Teacher, issue_token, password_hash
from app.core.errors import documented_errors, error
from app.db.session import Db
from app.models import Classroom, Membership, User
from app.models.documents import ClassroomTenant, Institution, InstitutionMember, personal_institution_id
from app.models.enums import Role
from app.models.teaching import AcademicYear, Cohort, CohortMembership, Subject, TeachingAssignment
from app.schemas.common import (
    ClassroomCreate, ClassroomJoin, ClassroomView, InstitutionView, JoinRotate, Login, Member, Profile, Register, Token,
    RegistrationClass, SubjectView,
)
from app.services.teaching import enroll, link_legacy_classroom, registration_cohort, registration_cohorts

router = APIRouter(tags=["Identité et classes"])


@router.post("/auth/register", response_model=Profile, status_code=201,
             responses=documented_errors(409, 422, 429))
def register(data: Register, request: Request, db: Db):
    request.app.state.rate_limiter.check(request, "register", 10)
    from app.services.access import start_write

    encoded = password_hash.hash(data.password.get_secret_value())
    start_write(db)
    cohort = None
    if data.role == Role.student:
        if data.cohort_id and data.institution_id and not data.join_code:
            cohort = registration_cohort(db, data.cohort_id, data.institution_id)
        elif data.join_code and not (data.cohort_id or data.institution_id):
            cohort = db.scalar(select(Cohort).join(TeachingAssignment, TeachingAssignment.cohort_id == Cohort.id)
                .join(Classroom, Classroom.id == TeachingAssignment.classroom_id)
                .where(Cohort.legacy.is_(True), Classroom.join_code == data.join_code.upper(),
                       Classroom.is_synthetic.is_(False),
                       Classroom.join_expires_at > request.app.state.system_clock.now()))
            if cohort is None:
                raise error(422, "INVALID_CLASS_CODE", "Le code de classe est invalide ou expiré.")
        elif (data.cohort_id or data.institution_id or db.scalar(
            select(Cohort.id).join(AcademicYear).join(Institution)
            .where(Cohort.legacy.is_(False), Institution.is_synthetic.is_(False)).limit(1)
        )):
            raise error(422, "CLASS_REQUIRED", "Sélectionnez un établissement et une classe.")
    elif data.cohort_id or data.institution_id or data.join_code:
        raise error(422, "STUDENT_ENROLLMENT_ONLY", "La sélection de classe concerne les étudiants.")
    user = User(
        email=data.email.casefold(), password_hash=encoded,
        full_name=data.full_name, role=data.role,
    )
    db.add(user)
    try:
        db.flush()
        if cohort and data.cohort_id:
            enroll(db, cohort, user, primary=True)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise error(409, "EMAIL_IN_USE", "Cette adresse est déjà utilisée.") from None
    return user


@router.get("/registration/classes", response_model=list[RegistrationClass])
def registration_classes(db: Db):
    return [RegistrationClass(id=cohort.id, name=cohort.name, institution_id=institution.id,
                              institution_name=institution.name, academic_year=year.label)
            for cohort, year, institution in db.execute(registration_cohorts()
                .order_by(Institution.name, AcademicYear.label.desc(), Cohort.name, Cohort.id))]


@router.get("/me/cohorts", response_model=list[RegistrationClass], responses=documented_errors(401, 403))
def my_cohorts(user: Student, db: Db):
    rows = db.execute(select(Cohort, AcademicYear, Institution).select_from(Cohort)
        .join(AcademicYear, AcademicYear.id == Cohort.year_id)
        .join(Institution, Institution.id == AcademicYear.institution_id)
        .join(CohortMembership, CohortMembership.cohort_id == Cohort.id)
        .where(CohortMembership.user_id == user.id, Cohort.legacy.is_(False))
        .order_by(CohortMembership.is_primary.desc(), AcademicYear.label.desc(), Cohort.name))
    return [RegistrationClass(id=cohort.id, name=cohort.name, institution_id=institution.id,
                              institution_name=institution.name, academic_year=year.label)
            for cohort, year, institution in rows]


@router.get("/subjects", response_model=list[SubjectView])
def subjects(user: CurrentUser, db: Db):
    if user.role == Role.teacher:
        tenant_ids = select(InstitutionMember.institution_id).where(InstitutionMember.user_id == user.id)
    else:
        tenant_ids = select(AcademicYear.institution_id).join(Cohort).join(CohortMembership).where(
            CohortMembership.user_id == user.id)
    return list(db.scalars(select(Subject).where(Subject.active.is_(True),
        Subject.institution_id.is_(None) | Subject.institution_id.in_(tenant_ids)).order_by(Subject.label, Subject.id)))


@router.post("/auth/login", response_model=Token, responses=documented_errors(401, 422, 429))
def login(data: Login, request: Request, db: Db):
    request.app.state.rate_limiter.check(request, "login", 20)
    user = db.scalar(select(User).where(User.email == data.email.casefold()))
    encoded = user.password_hash if user is not None else request.app.state.dummy_hash
    valid = password_hash.verify(data.password.get_secret_value(), encoded)
    if not valid or user is None or (user.is_synthetic and not request.app.state.settings.demo_mode):
        raise error(401, "INVALID_CREDENTIALS", "Identifiants invalides.")
    return issue_token(user, request)


@router.get("/me", response_model=Profile, responses=documented_errors(401))
def me(user: CurrentUser):
    return user


def classroom_view(row: Classroom, teacher: bool = False, assignment=None, cohort=None, subject=None,
                   year=None) -> ClassroomView:
    invite = teacher and (cohort is None or cohort.legacy)
    return ClassroomView(
        id=row.id, name=row.name, subject=row.subject, is_synthetic=row.is_synthetic,
        join_code=row.join_code if invite else None,
        join_path=f"/join/{row.join_code}" if invite else None,
        join_expires_at=row.join_expires_at if invite else None,
        assignment_id=assignment.id if assignment else None,
        cohort_id=cohort.id if cohort else None,
        subject_id=subject.id if subject else None,
        subject_label=subject.label if subject else None,
        academic_year=year.label if year and cohort and not cohort.legacy else None,
        institution_id=year.institution_id if year else None,
    )


@router.get("/institutions", response_model=list[InstitutionView], responses=documented_errors(401, 403))
def institutions(user: Teacher, db: Db):
    return list(db.scalars(select(Institution).join(InstitutionMember).where(
        InstitutionMember.user_id == user.id, Institution.is_synthetic == user.is_synthetic,
        Institution.id != personal_institution_id(user.id),
    ).order_by(Institution.name, Institution.id)))


@router.post("/classrooms", response_model=ClassroomView, status_code=201,
             responses=documented_errors(401, 403, 404, 422))
def create_classroom(data: ClassroomCreate, request: Request, user: Teacher, db: Db):
    from app.services.access import start_write

    start_write(db)
    if data.institution_id is not None:
        allowed = db.scalar(select(Institution.id).join(InstitutionMember).where(
            Institution.id == data.institution_id, InstitutionMember.user_id == user.id,
            Institution.is_synthetic == user.is_synthetic,
        ))
        if allowed is None:
            raise error(404)
    row = Classroom(
        teacher_id=user.id, name=data.name, subject=data.subject,
        join_code=token_hex(10).upper(),
        join_expires_at=request.app.state.system_clock.now() + timedelta(hours=data.join_ttl_hours),
        is_synthetic=user.is_synthetic,
    )
    db.add(row)
    if data.institution_id is not None:
        db.flush()
        db.add(ClassroomTenant(institution_id=data.institution_id, classroom_id=row.id))
    db.flush()
    link_legacy_classroom(db, row)
    db.commit()
    return classroom_view(row, teacher=True)


@router.get("/classrooms", response_model=list[ClassroomView], responses=documented_errors(401))
def list_classrooms(user: CurrentUser, db: Db):
    teacher = user.role == Role.teacher
    query = (select(Classroom, TeachingAssignment, Cohort, Subject, AcademicYear)
             .join(TeachingAssignment, TeachingAssignment.classroom_id == Classroom.id)
             .join(Cohort, Cohort.id == TeachingAssignment.cohort_id)
             .join(Subject, Subject.id == TeachingAssignment.subject_id)
             .join(AcademicYear, AcademicYear.id == Cohort.year_id)
             .where(Classroom.is_synthetic == user.is_synthetic))
    if teacher:
        query = query.where(TeachingAssignment.teacher_id == user.id, Classroom.teacher_id == user.id)
    else:
        query = query.join(Membership, Membership.classroom_id == Classroom.id).where(Membership.user_id == user.id)
    return [classroom_view(row, teacher, assignment, cohort, subject, year)
            for row, assignment, cohort, subject, year in db.execute(query.order_by(Classroom.created_at, Classroom.id))]


@router.get("/me/teaching-assignments", response_model=list[ClassroomView])
def teaching_assignments(user: Teacher, db: Db):
    return list_classrooms(user, db)


@router.post("/classrooms/join", response_model=ClassroomView,
             responses=documented_errors(401, 403, 404, 422, 429))
def join_classroom(data: ClassroomJoin, request: Request, user: Student, db: Db):
    request.app.state.rate_limiter.check(request, "join", 30)
    from app.services.access import start_write

    start_write(db)
    row = db.scalar(select(Classroom).where(
        Classroom.join_code == data.code.upper(), Classroom.is_synthetic == user.is_synthetic,
    ))
    if row is None:
        raise error(404)
    member_query = select(Membership.id).where(
        Membership.classroom_id == row.id, Membership.user_id == user.id
    )
    if db.scalar(member_query) is None:
        if row.join_expires_at <= request.app.state.system_clock.now():
            raise error(404)
        cohort = db.scalar(select(Cohort).join(TeachingAssignment).where(TeachingAssignment.classroom_id == row.id))
        if cohort is None or not cohort.legacy:
            raise error(403, "INSTITUTIONAL_ENROLLMENT_REQUIRED", "Inscrivez-vous par le parcours de votre établissement.")
        if db.scalar(select(CohortMembership.id).where(
            CohortMembership.cohort_id == cohort.id, CohortMembership.user_id == user.id,
        )):
            db.add(Membership(classroom_id=row.id, user_id=user.id, pseudonym=data.pseudonym or user.full_name))
        else:
            enroll(db, cohort, user, data.pseudonym)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            if db.scalar(member_query) is None:
                raise
    return classroom_view(row)


def get_classroom(id: UUID, user: User, db: Db, *, teacher_only: bool = False) -> Classroom:
    classroom = db.get(Classroom, id)
    if classroom is None or classroom.is_synthetic != user.is_synthetic:
        raise error(404)
    if user.role == Role.teacher:
        assigned = db.scalar(select(TeachingAssignment.id).where(
            TeachingAssignment.classroom_id == id, TeachingAssignment.teacher_id == user.id))
        if classroom.teacher_id != user.id or assigned is None:
            raise error(404)
    elif teacher_only or db.scalar(select(Membership.id).where(
        Membership.classroom_id == id, Membership.user_id == user.id,
    )) is None:
        raise error(404)
    return classroom


@router.post("/classrooms/{id}/join-code", response_model=ClassroomView,
             responses=documented_errors(401, 403, 404, 422))
def rotate_join_code(id: UUID, data: JoinRotate, request: Request, user: Teacher, db: Db):
    row = get_classroom(id, user, db, teacher_only=True)
    cohort = db.scalar(select(Cohort).join(TeachingAssignment).where(TeachingAssignment.classroom_id == id))
    if cohort and not cohort.legacy:
        raise error(422, "INSTITUTIONAL_ENROLLMENT_REQUIRED", "Les inscriptions sont gérées par l’établissement.")
    row.join_code = token_hex(10).upper()
    row.join_expires_at = request.app.state.system_clock.now() + timedelta(hours=data.join_ttl_hours)
    db.commit()
    return classroom_view(row, teacher=True)


@router.get("/classrooms/{id}/members", response_model=list[Member],
            responses=documented_errors(401, 403, 404, 422))
def list_members(id: UUID, user: Teacher, db: Db):
    get_classroom(id, user, db, teacher_only=True)
    query = select(Membership, User.is_synthetic).join(User, Membership.user_id == User.id).where(
        Membership.classroom_id == id
    ).order_by(Membership.pseudonym, Membership.id)
    return [Member(id=row.id, pseudonym=row.pseudonym, is_synthetic=synthetic)
            for row, synthetic in db.execute(query)]
