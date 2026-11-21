from datetime import timedelta
from secrets import token_hex

from sqlalchemy import select

from app.core.errors import error
from app.db.base import utcnow
from app.models import Classroom, Membership, User
from app.models.documents import ClassroomTenant, Institution, InstitutionMember, personal_institution_id
from app.models.enums import Role
from app.models.teaching import AcademicYear, Cohort, CohortMembership, Subject, TeachingAssignment

DEFAULT_SUBJECTS = {
    "python_intro": "Algorithmique et Python", "c": "Programmation C", "java": "Java",
    "analyse": "Analyse", "algebre": "Algèbre", "statistiques": "Probabilités et statistiques",
    "structures": "Structures de données", "architecture": "Architecture des ordinateurs",
    "systemes": "Systèmes d’exploitation", "reseaux": "Réseaux informatiques", "bdd": "Bases de données",
    "web": "Développement web", "genie_logiciel": "Génie logiciel", "ia": "Intelligence artificielle",
    "cybersecurite": "Cybersécurité", "anglais": "Anglais technique",
}


def subject_for(db, code, label=None, institution_id=None):
    key = f"{institution_id}:{code}" if institution_id else code
    subject = db.scalar(select(Subject).where(Subject.key == key))
    if subject is None:
        subject = Subject(key=key, code=code, label=label or DEFAULT_SUBJECTS.get(code, code),
                          institution_id=institution_id)
        db.add(subject)
        db.flush()
    return subject


def year_for(db, institution_id, label):
    year = db.scalar(select(AcademicYear).where(AcademicYear.institution_id == institution_id,
                                              AcademicYear.label == label))
    if year is None:
        year = AcademicYear(institution_id=institution_id, label=label)
        db.add(year)
        db.flush()
    return year


def link_legacy_classroom(db, classroom):
    tenant = db.scalar(select(ClassroomTenant).where(ClassroomTenant.classroom_id == classroom.id))
    if tenant is None:
        institution_id = personal_institution_id(classroom.teacher_id)
        if db.get(Institution, institution_id) is None:
            db.add(Institution(id=institution_id, name="Espace enseignant", is_synthetic=classroom.is_synthetic))
            db.flush()
            db.add(InstitutionMember(institution_id=institution_id, user_id=classroom.teacher_id))
        tenant = ClassroomTenant(institution_id=institution_id, classroom_id=classroom.id)
        db.add(tenant)
    year = year_for(db, tenant.institution_id, "Non renseignée")
    cohort = Cohort(year_id=year.id, key=f"legacy:{classroom.id}", name=classroom.name, legacy=True)
    db.add(cohort)
    subject = subject_for(db, classroom.subject, institution_id=(
        None if classroom.subject in DEFAULT_SUBJECTS else tenant.institution_id
    ))
    db.flush()
    db.add(TeachingAssignment(cohort_id=cohort.id, subject_id=subject.id, teacher_id=classroom.teacher_id,
                              classroom_id=classroom.id))
    db.add_all(CohortMembership(cohort_id=cohort.id, user_id=user_id) for user_id in db.scalars(
        select(Membership.user_id).where(Membership.classroom_id == classroom.id)
    ))


def backfill_teaching(db):
    for code, label in DEFAULT_SUBJECTS.items():
        subject_for(db, code, label)
    missing = select(Classroom).outerjoin(TeachingAssignment, TeachingAssignment.classroom_id == Classroom.id)
    for classroom in list(db.scalars(missing.where(TeachingAssignment.id.is_(None)))):
        link_legacy_classroom(db, classroom)


def enroll(db, cohort, user, pseudonym=None, *, primary=False):
    db.add(CohortMembership(cohort_id=cohort.id, user_id=user.id, is_primary=primary))
    for classroom_id in db.scalars(select(TeachingAssignment.classroom_id).where(
        TeachingAssignment.cohort_id == cohort.id,
    )):
        db.add(Membership(classroom_id=classroom_id, user_id=user.id, pseudonym=pseudonym or user.full_name))


def registration_cohorts():
    return (select(Cohort, AcademicYear, Institution).join(AcademicYear, AcademicYear.id == Cohort.year_id)
            .join(Institution, Institution.id == AcademicYear.institution_id)
            .where(Cohort.active.is_(True), AcademicYear.active.is_(True), Cohort.legacy.is_(False),
                   Cohort.enrollment_policy == "open", Institution.is_synthetic.is_(False)))


def registration_cohort(db, cohort_id, institution_id):
    selection = db.execute(registration_cohorts().where(
        Cohort.id == cohort_id, Institution.id == institution_id,
    )).one_or_none()
    if selection is None:
        raise error(422, "CLASS_NOT_OPEN", "Choisissez une classe ouverte aux inscriptions dans cet établissement.")
    return selection[0]


def assign_teacher(db, cohort, subject, teacher):
    year = db.get(AcademicYear, cohort.year_id)
    institution = db.get(Institution, year.institution_id)
    if (teacher.role != Role.teacher or teacher.is_synthetic != institution.is_synthetic
            or not subject.active or subject.institution_id not in (None, institution.id)):
        raise ValueError("Invalid teacher or subject for the institution.")
    if not db.scalar(select(InstitutionMember.id).where(
        InstitutionMember.institution_id == institution.id, InstitutionMember.user_id == teacher.id,
    )):
        raise ValueError("The teacher must be provisioned in this institution first.")
    assignment = db.scalar(select(TeachingAssignment).where(
        TeachingAssignment.cohort_id == cohort.id, TeachingAssignment.subject_id == subject.id,
        TeachingAssignment.teacher_id == teacher.id,
    ))
    if assignment:
        return assignment
    classroom = Classroom(name=cohort.name, subject=subject.code, teacher_id=teacher.id,
                          is_synthetic=institution.is_synthetic, join_code=token_hex(10).upper(),
                          join_expires_at=utcnow() + timedelta(days=3))
    db.add(classroom)
    db.flush()
    db.add(ClassroomTenant(institution_id=institution.id, classroom_id=classroom.id))
    assignment = TeachingAssignment(cohort_id=cohort.id, subject_id=subject.id, teacher_id=teacher.id,
                                    classroom_id=classroom.id)
    db.add(assignment)
    db.add_all(Membership(classroom_id=classroom.id, user_id=user.id, pseudonym=user.full_name)
               for user in db.scalars(select(User).join(CohortMembership, CohortMembership.user_id == User.id)
                                      .where(CohortMembership.cohort_id == cohort.id)))
    return assignment
