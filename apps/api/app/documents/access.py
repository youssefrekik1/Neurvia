from dataclasses import dataclass
from uuid import UUID

from fastapi import Request
from sqlalchemy import select

from app.core.errors import error
from app.models import Lesson
from app.models.documents import (
    ClassroomTenant, DocumentVersion, Institution, InstitutionMember, Resource, personal_institution_id,
)
from app.services.access import lesson_access, start_write


@dataclass(frozen=True)
class Scope:
    institution_id: UUID
    classroom_id: UUID
    lesson_id: UUID
    teacher_id: UUID

    def filters(self):
        return (Resource.institution_id == self.institution_id, Resource.classroom_id == self.classroom_id,
                Resource.lesson_id == self.lesson_id)

    @property
    def prefix(self):
        return f"institution/{self.institution_id}/classroom/{self.classroom_id}/lesson/{self.lesson_id}"


def personal_tenant(db, user):
    tenant_id = personal_institution_id(user.id)
    institution = db.get(Institution, tenant_id)
    if institution is None:
        db.add(Institution(id=tenant_id, name="Espace enseignant", is_synthetic=user.is_synthetic))
        db.flush()
        db.add(InstitutionMember(institution_id=tenant_id, user_id=user.id))
        db.flush()
    return tenant_id


def scope_for(db, user, lesson_id, *, create=False):
    if create:
        start_write(db)
    lesson, classroom = lesson_access(db, user, lesson_id, teacher=True)
    if create and db.get_bind().dialect.name == "postgresql":
        # Serialize enrollment in a tenant even when a teacher uploads to distinct new lessons.
        from app.models import User
        db.execute(select(User.id).where(User.id == user.id).with_for_update())
        db.execute(select(Lesson.id).where(Lesson.id == lesson.id).with_for_update())
    tenant = db.scalar(select(ClassroomTenant).where(ClassroomTenant.classroom_id == classroom.id))
    if tenant is None:
        if not create:
            return None
        tenant = ClassroomTenant(institution_id=personal_tenant(db, user), classroom_id=classroom.id)
        db.add(tenant)
        db.flush()
    allowed = db.scalar(select(InstitutionMember.id).where(
        InstitutionMember.institution_id == tenant.institution_id, InstitutionMember.user_id == user.id
    ))
    if allowed is None:
        raise error(404)
    return Scope(tenant.institution_id, classroom.id, lesson.id, user.id)


def document_for(db, scope, version_id):
    if scope is None:
        raise error(404)
    row = db.execute(
        select(DocumentVersion, Resource).select_from(DocumentVersion)
        .join(Resource, Resource.id == DocumentVersion.resource_id)
        .where(DocumentVersion.id == version_id, *scope.filters())
    ).one_or_none()
    if row is None:
        raise error(404)
    return row


def object_store(request: Request):
    store = request.app.state.object_store
    if store is None:
        raise error(503, "DOCUMENT_STORAGE_UNAVAILABLE", "Le stockage des documents n’est pas configuré.")
    return store
