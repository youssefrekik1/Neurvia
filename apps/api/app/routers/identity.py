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
from app.schemas.common import (
    ClassroomCreate, ClassroomJoin, ClassroomView, InstitutionView, JoinRotate, Login, Member, Profile, Register, Token,
)

router = APIRouter(tags=["Identité et classes"])


@router.post("/auth/register", response_model=Profile, status_code=201,
             responses=documented_errors(409, 422, 429))
def register(data: Register, request: Request, db: Db):
    request.app.state.rate_limiter.check(request, "register", 10)
    user = User(
        email=data.email.casefold(), password_hash=password_hash.hash(data.password.get_secret_value()),
        full_name=data.full_name, role=data.role,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise error(409, "EMAIL_IN_USE", "Cette adresse est déjà utilisée.") from None
    return user


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


def classroom_view(row: Classroom, teacher: bool = False) -> ClassroomView:
    return ClassroomView(
        id=row.id, name=row.name, subject=row.subject, is_synthetic=row.is_synthetic,
        join_code=row.join_code if teacher else None,
        join_path=f"/join/{row.join_code}" if teacher else None,
        join_expires_at=row.join_expires_at if teacher else None,
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
    db.commit()
    return classroom_view(row, teacher=True)


@router.get("/classrooms", response_model=list[ClassroomView], responses=documented_errors(401))
def list_classrooms(user: CurrentUser, db: Db):
    teacher = user.role == Role.teacher
    query = select(Classroom).where(Classroom.is_synthetic == user.is_synthetic)
    if teacher:
        query = query.where(Classroom.teacher_id == user.id)
    else:
        query = query.join(Membership).where(Membership.user_id == user.id)
    return [classroom_view(row, teacher) for row in db.scalars(query.order_by(Classroom.created_at))]


@router.post("/classrooms/join", response_model=ClassroomView,
             responses=documented_errors(401, 403, 404, 422, 429))
def join_classroom(data: ClassroomJoin, request: Request, user: Student, db: Db):
    request.app.state.rate_limiter.check(request, "join", 30)
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
        db.add(Membership(
            classroom_id=row.id, user_id=user.id, pseudonym=data.pseudonym or user.full_name,
        ))
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
        if classroom.teacher_id != user.id:
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
