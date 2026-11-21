from sqlalchemy import func, or_, select

from app.models import Concept, Lesson, LessonConcept, Membership
from app.models.documents import ClassroomTenant, InstitutionConcept, InstitutionMember, personal_institution_id
from app.models.enums import LessonStatus, Role


def visible_concepts(user, classroom_id=None):
    """Filter for concepts a user may see.

    Seeded concepts carry no institution link and stay global. A teacher-approved concept belongs to one
    institution: teachers of that institution see it, while students see it only through a published
    lesson of a classroom they joined. A student's membership in one class of a tenant does not reveal
    concepts the teacher approved for another class.
    """
    private = select(InstitutionConcept.concept_id).where(InstitutionConcept.concept_id == Concept.id)
    if user.role == Role.teacher:
        institutions = select(InstitutionMember.institution_id).where(InstitutionMember.user_id == user.id)
        authorized = private.where(InstitutionConcept.institution_id.in_(institutions))
    else:
        published = (
            select(LessonConcept.concept_id)
            .join(Lesson, Lesson.id == LessonConcept.lesson_id)
            .join(Membership, Membership.classroom_id == Lesson.classroom_id)
            .join(ClassroomTenant, ClassroomTenant.classroom_id == Lesson.classroom_id)
            .where(Membership.user_id == user.id, Lesson.status != LessonStatus.draft,
                   ClassroomTenant.institution_id == InstitutionConcept.institution_id)
        )
        authorized = private.where(InstitutionConcept.concept_id.in_(published))
    if classroom_id is not None:
        assigned = select(ClassroomTenant.institution_id).where(ClassroomTenant.classroom_id == classroom_id)
        authorized = authorized.where(InstitutionConcept.institution_id == func.coalesce(
            assigned.scalar_subquery(), personal_institution_id(user.id),
        ))
    return or_(~private.exists(), authorized.exists())
