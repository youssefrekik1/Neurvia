from collections import defaultdict
from uuid import UUID

from fastapi import APIRouter, Query, Request
from sqlalchemy import delete, select

from app.ai.tasks import generate_remediation_plan
from app.analytics.classroom import jaccard, suggest
from app.core.auth import Teacher
from app.core.errors import documented_errors, error
from app.db.session import Db
from app.models import (
    Answer, Concept, Group, GroupMember, Intervention, Membership,
    Misconception, MisconceptionConcept, MisconceptionObservation, Question, RetestSchedule, TeacherDecision,
)
from app.models import enums as e
from app.schemas.analytics import (
    BeforeAfter, Dashboard, Graph, GroupUpdate, GroupView, InterventionUpdate, InterventionView,
    RetestCreate, ScheduleResult,
)
from app.schemas.common import Approval
from app.services.access import lesson_access, start_write
from app.services.assessments import choose_variant, personal_quiz
from app.services.class_analytics import dashboard_view, load_classroom
from app.services.difficulty_assistance import DifficultyAssistance, classify, inputs_for_student
from app.services.questions import lesson_concepts

router = APIRouter(tags=["MindMirror et remédiation"], responses=documented_errors(401, 403, 404, 409, 422))
ACTIVE_GROUP = {e.GroupStatus.accepted, e.GroupStatus.modified}


@router.post("/lessons/{id}/members/{member_id}/difficulty-assistance",
             response_model=DifficultyAssistance, responses=documented_errors(429, 503))
def difficulty_assistance(id: UUID, member_id: UUID, request: Request, user: Teacher, db: Db):
    lesson, classroom = lesson_access(db, user, id, teacher=True)
    member = db.get(Membership, member_id)
    if member is None or member.classroom_id != classroom.id:
        raise error(404)
    request.app.state.rate_limiter.check(request, "difficulty_assistance", 12, subject=user.id)
    items = inputs_for_student(db, lesson, member)
    db.rollback()
    return classify(request.app.state.gateway, items)


def group_access(db, user, id):
    group = db.get(Group, id)
    if group is None:
        raise error(404)
    lesson, classroom = lesson_access(db, user, group.lesson_id, teacher=True)
    return group, lesson, classroom


def intervention_access(db, user, id):
    plan = db.get(Intervention, id)
    if plan is None:
        raise error(404)
    group, lesson, classroom = group_access(db, user, plan.group_id)
    return plan, group, lesson, classroom


def plan_for_group(db, group_id):
    return db.scalar(select(Intervention).where(Intervention.group_id == group_id).limit(1))


def plan_view(plan, classroom):
    payload = plan.plan_json
    return InterventionView(
        id=plan.id, group_id=plan.group_id, plan=payload["plan"], status=plan.status,
        source=payload["source"], used_fallback=payload["source"] == "template",
        is_synthetic=classroom.is_synthetic,
    )


def group_views(db, lesson, classroom):
    groups = list(db.scalars(select(Group).where(Group.lesson_id == lesson.id)
                             .order_by(Group.created_at, Group.id)))
    members = defaultdict(list)
    ids = [group.id for group in groups]
    for group_id, membership_id in db.execute(
        select(GroupMember.group_id, Membership.id).join(
            Membership, (Membership.user_id == GroupMember.student_id)
            & (Membership.classroom_id == lesson.classroom_id)
        ).where(GroupMember.group_id.in_(ids)).order_by(Membership.pseudonym, Membership.id)
    ):
        members[group_id].append(membership_id)
    plans = {plan.group_id: plan_view(plan, classroom) for plan in db.scalars(
        select(Intervention).where(Intervention.group_id.in_(ids))
    )}
    codes = dict(db.execute(select(Misconception.id, Misconception.code)).all())
    return [
        GroupView(
            id=group.id, label=group.label, student_ids=members[group.id],
            main_misconception_code=codes[group.main_misconception_id], status=group.status,
            confidence_label=group.confidence_label, avg_similarity=group.avg_similarity,
            evidence_summary=group.explanation_json["summary"], is_synthetic=classroom.is_synthetic,
            intervention=plans.get(group.id),
        )
        for group in groups
    ]


@router.get("/lessons/{id}/dashboard", response_model=Dashboard)
def dashboard(id: UUID, user: Teacher, db: Db, request: Request):
    lesson, classroom = lesson_access(db, user, id, teacher=True)
    data = load_classroom(db, lesson, request.app.state.settings.confident_wrong_weight)
    return dashboard_view(data, lesson, classroom)


@router.get("/lessons/{id}/graph", response_model=Graph)
def graph(id: UUID, user: Teacher, db: Db, request: Request, tau: float = Query(0.4, ge=0, le=1)):
    lesson, classroom = lesson_access(db, user, id, teacher=True)
    data = load_classroom(db, lesson, request.app.state.settings.confident_wrong_weight)
    nodes, edges = data.graph(tau, classroom.is_synthetic)
    return {"nodes": nodes, "edges": edges, "groups": group_views(db, lesson, classroom),
            "is_synthetic": classroom.is_synthetic}


@router.get("/lessons/{id}/groups", response_model=list[GroupView])
def list_groups(id: UUID, user: Teacher, db: Db):
    lesson, classroom = lesson_access(db, user, id, teacher=True)
    return group_views(db, lesson, classroom)


@router.post("/lessons/{id}/groups/suggest", response_model=list[GroupView])
def suggest_groups(id: UUID, user: Teacher, db: Db, request: Request):
    start_write(db)
    lesson, classroom = lesson_access(db, user, id, teacher=True)
    settings = request.app.state.settings
    data = load_classroom(db, lesson, settings.confident_wrong_weight)
    current = group_views(db, lesson, classroom)
    occupied = {str(member) for group in current if group.status in ACTIVE_GROUP for member in group.student_ids}
    proposed = suggest([p for p in data.profiles if p.key not in occupied],
                       threshold=settings.group_similarity, min_size=settings.group_min_size)
    by_code = {row.code: row for row in db.scalars(select(Misconception))}
    existing = {(frozenset(map(str, group.student_ids)), group.main_misconception_code): group for group in current}
    retained = {(frozenset(members), code) for members, code, _, _ in proposed}
    for key, group in existing.items():
        if group.status == e.GroupStatus.suggested and key not in retained:
            db.execute(delete(GroupMember).where(GroupMember.group_id == group.id))
            db.delete(db.get(Group, group.id))
    for members, code, score, confidence in proposed:
        existing_group = existing.get((frozenset(members), code))
        if existing_group is not None and existing_group.status != e.GroupStatus.suggested:
            continue
        row = db.get(Group, existing_group.id) if existing_group else Group(lesson_id=id, status=e.GroupStatus.suggested)
        error_type = by_code[code]
        corroborated = sum(code in p.strong for p in data.profiles if p.key in members)
        row.label = error_type.label_fr
        row.main_misconception_id = error_type.id
        row.confidence_label = e.GroupConfidence(confidence)
        row.avg_similarity = score
        row.explanation_json = {"summary": f"{len(members)} profils partagent cette erreur, "
                                f"dont {corroborated} corroborés. Similarité moyenne {score:.0%}."}
        if not existing_group:
            db.add(row)
            db.flush()
            db.add_all(GroupMember(group_id=row.id, student_id=data.memberships[key].user_id) for key in members)
    db.commit()
    return group_views(db, lesson, classroom)


@router.patch("/groups/{id}", response_model=GroupView)
def update_group(id: UUID, data: GroupUpdate, user: Teacher, db: Db, request: Request):
    start_write(db)
    group, lesson, classroom = group_access(db, user, id)
    plan = plan_for_group(db, id)
    if plan and plan.status == e.InterventionStatus.assigned:
        raise error(409, "GROUP_ALREADY_ASSIGNED", "Ce groupe a déjà reçu une remédiation.")
    before = next(row for row in group_views(db, lesson, classroom) if row.id == id)
    if data.student_ids is not None:
        members = list(db.scalars(select(Membership).where(
            Membership.id.in_(data.student_ids), Membership.classroom_id == classroom.id
        )))
        if len(members) != len(data.student_ids):
            raise error(404)
        db.execute(delete(GroupMember).where(GroupMember.group_id == id))
        db.add_all(GroupMember(group_id=id, student_id=row.user_id) for row in members)
        group.confidence_label = e.GroupConfidence.provisional
        room = load_classroom(db, lesson, request.app.state.settings.confident_wrong_weight)
        keys = {str(member.id) for member in members}
        profiles = [p for p in room.profiles if p.key in keys]
        links = [jaccard(p.errors, other.errors) or 0 for index, p in enumerate(profiles)
                 for other in profiles[index + 1:]]
        group.avg_similarity = float(sum(links) / len(links)) if links else 0
        group.explanation_json = {"summary": "Composition choisie par le professeur. "
                                  f"Similarité moyenne {group.avg_similarity:.0%}.",
                                  "reason": data.reason}
    group.status = {"accept": e.GroupStatus.accepted, "modify": e.GroupStatus.modified,
                    "reject": e.GroupStatus.rejected}[data.action]
    db.add(TeacherDecision(teacher_id=user.id, entity_type="group", entity_id=id, action=data.action,
                           before_json={"status": before.status, "members": [str(key) for key in before.student_ids]},
                           after_json={"status": group.status, "reason": data.reason,
                                       "members": [str(key) for key in (data.student_ids or before.student_ids)]}))
    db.commit()
    return next(row for row in group_views(db, lesson, classroom) if row.id == id)


def approved_group(group):
    if group.status not in ACTIVE_GROUP:
        raise error(409, "GROUP_APPROVAL_REQUIRED", "Le groupe doit être approuvé.")


@router.post("/groups/{id}/remediation", response_model=InterventionView)
def generate_plan(id: UUID, user: Teacher, db: Db, request: Request):
    group, lesson, classroom = group_access(db, user, id)
    approved_group(group)
    plan = plan_for_group(db, id)
    if plan:
        return plan_view(plan, classroom)
    mistake = db.get(Misconception, group.main_misconception_id)
    student_ids = list(db.scalars(select(GroupMember.student_id).where(GroupMember.group_id == id)))
    course = lesson.content_text
    label, hint = mistake.label_fr, mistake.remediation_hint
    db.rollback()
    result = generate_remediation_plan(
        request.app.state.gateway, misconception_label=label, hint=hint,
        group_size=len(student_ids), course_excerpt=course,
    )
    start_write(db)
    group, _, classroom = group_access(db, user, id)
    approved_group(group)
    plan = plan_for_group(db, id)
    if plan is None:
        plan = Intervention(group_id=id, status=e.InterventionStatus.draft, plan_json={
            "plan": result.value.model_dump(mode="json"),
            "source": "llm" if result.source in {"llm", "cache"} else "template",
        })
        db.add(plan)
    db.commit()
    return plan_view(plan, classroom)


@router.patch("/interventions/{id}", response_model=InterventionView)
def edit_plan(id: UUID, data: InterventionUpdate, user: Teacher, db: Db):
    start_write(db)
    plan, group, _, classroom = intervention_access(db, user, id)
    approved_group(group)
    if plan.status != e.InterventionStatus.draft:
        raise error(409, "PLAN_IMMUTABLE", "Ce plan est déjà affecté.")
    plan.plan_json = {"plan": data.plan.model_dump(mode="json"), "source": "teacher"}
    db.commit()
    return plan_view(plan, classroom)


@router.post("/interventions/{id}/assign", response_model=InterventionView)
def assign_plan(id: UUID, data: Approval, request: Request, user: Teacher, db: Db):
    if not data.validated:
        raise error(409, "TEACHER_VALIDATION_REQUIRED", "La validation explicite est requise.")
    start_write(db)
    plan, group, _, classroom = intervention_access(db, user, id)
    approved_group(group)
    if plan.status != e.InterventionStatus.assigned:
        plan.status = e.InterventionStatus.assigned
        plan.validated_by, plan.validated_at = user.id, request.app.state.clock.now()
        db.add(TeacherDecision(teacher_id=user.id, entity_type="intervention", entity_id=id, action="assign",
                               before_json={"status": "draft"}, after_json={"status": "assigned"}))
    db.commit()
    return plan_view(plan, classroom)


def schedule_view(db, lesson_id, classroom, kind, now):
    rows = db.execute(select(RetestSchedule, Concept.code).join(Concept).where(
        RetestSchedule.lesson_id == lesson_id, RetestSchedule.kind == kind
    ).order_by(RetestSchedule.due_at, RetestSchedule.id))
    return {"lesson_id": lesson_id, "is_synthetic": classroom.is_synthetic, "schedules": [
        {"id": row.id, "concept_code": code, "kind": row.kind, "due_at": row.due_at,
         "quiz_id": row.quiz_id, "status": e.ScheduleStatus.available
         if row.status == e.ScheduleStatus.pending and row.due_at <= now else row.status}
        for row, code in rows
    ]}


@router.post("/lessons/{id}/retest", response_model=ScheduleResult)
def retest(id: UUID, data: RetestCreate, request: Request, user: Teacher, db: Db):
    start_write(db)
    plan, group, lesson, classroom = intervention_access(db, user, data.intervention_id)
    if lesson.id != id:
        raise error(404)
    approved_group(group)
    if plan.status != e.InterventionStatus.assigned:
        raise error(409, "PLAN_APPROVAL_REQUIRED", "Validez et affectez d’abord le plan.")
    now = request.app.state.clock.now()
    concept_ids = {concept.id for concept in lesson_concepts(db, id)}
    targets = concept_ids & set(db.scalars(select(MisconceptionConcept.concept_id).where(
        MisconceptionConcept.misconception_id == group.main_misconception_id
    )))
    for student in db.scalars(select(GroupMember.student_id).where(GroupMember.group_id == group.id)):
        candidates = set(db.scalars(
            select(Question.concept_id).join(Answer, Answer.question_id == Question.id)
            .join(MisconceptionObservation, MisconceptionObservation.answer_id == Answer.id)
            .where(MisconceptionObservation.lesson_id == id, MisconceptionObservation.student_id == student,
                   MisconceptionObservation.misconception_id == group.main_misconception_id,
                   MisconceptionObservation.evidence_stage == e.QuestionRole.initial)
        )) & targets
        eligible = candidates or targets
        if not eligible:
            continue
        bank = choose_variant(db, lesson_id=id, student_id=student, teacher_id=user.id,
                              roles=[e.QuestionRole.immediate_retest], concept_ids=eligible,
                              target_id=group.main_misconception_id)
        existing_rows = list(db.scalars(select(RetestSchedule).where(
            RetestSchedule.student_id == student, RetestSchedule.lesson_id == id,
            RetestSchedule.kind == e.RetestKind.immediate, RetestSchedule.concept_id.in_(eligible)
        )))
        if any(row.status != e.ScheduleStatus.skipped for row in existing_rows):
            continue
        target_id = bank.concept_id if bank else sorted(eligible)[0]
        record = next((row for row in existing_rows if row.concept_id == target_id), None)
        if record is None:
            record = RetestSchedule(student_id=student, lesson_id=id, concept_id=target_id,
                                    kind=e.RetestKind.immediate, due_at=now, status=e.ScheduleStatus.skipped,
                                    target_misconception_id=group.main_misconception_id)
            db.add(record)
        record.target_misconception_id = group.main_misconception_id
        if bank:
            quiz = personal_quiz(db, lesson_id=id, student_id=student, item=bank, now=now)
            record.quiz_id, record.status = quiz.id, e.ScheduleStatus.available
    db.commit()
    return schedule_view(db, id, classroom, e.RetestKind.immediate, now)


@router.post("/lessons/{id}/j7/schedule", response_model=ScheduleResult)
def schedule_j7(id: UUID, user: Teacher, db: Db, request: Request):
    start_write(db)
    _, classroom = lesson_access(db, user, id, teacher=True)
    now = request.app.state.clock.now()
    for row in db.scalars(select(RetestSchedule).where(
        RetestSchedule.lesson_id == id, RetestSchedule.kind == e.RetestKind.j7,
        RetestSchedule.status == e.ScheduleStatus.skipped,
    )):
        item = choose_variant(db, lesson_id=id, student_id=row.student_id, teacher_id=user.id,
                              roles=[e.QuestionRole.j7_retest], concept_ids={row.concept_id},
                              target_id=row.target_misconception_id)
        if item:
            quiz = personal_quiz(db, lesson_id=id, student_id=row.student_id, item=item, now=now, due=row.due_at)
            row.quiz_id, row.status = quiz.id, e.ScheduleStatus.pending
    db.commit()
    return schedule_view(db, id, classroom, e.RetestKind.j7, now)


@router.get("/lessons/{id}/before-after", response_model=BeforeAfter)
def before_after(id: UUID, user: Teacher, db: Db, request: Request):
    lesson, classroom = lesson_access(db, user, id, teacher=True)
    data = load_classroom(db, lesson, request.app.state.settings.confident_wrong_weight)
    stages = {"initial": e.QuestionRole.initial, "immediate": e.QuestionRole.immediate_retest,
              "j7": e.QuestionRole.j7_retest}
    concept_cells = defaultdict(list)
    student_cells = defaultdict(set)
    for answer, attempt, kind, code in data.rows:
        concept_cells[code, kind].append(answer.is_correct)
        student_cells[code, kind].add(attempt.student_id)
    errors = defaultdict(set)
    for student_id, misconception_id, kind in db.execute(select(
        MisconceptionObservation.student_id, MisconceptionObservation.misconception_id,
        MisconceptionObservation.evidence_stage,
    ).where(MisconceptionObservation.lesson_id == id)):
        errors[misconception_id, kind].add(student_id)
    concepts = lesson_concepts(db, id)

    def counts(correct, attempts):
        return {"correct": correct, "attempts": attempts, "rate": correct / attempts if attempts else None}

    concept_results = [{"concept_code": concept.code, **{
        stage: counts(sum(concept_cells[concept.code, kind]), len(concept_cells[concept.code, kind]))
        for stage, kind in stages.items()
    }} for concept in concepts]
    error_results = []
    for group in db.scalars(select(Group).where(Group.lesson_id == id, Group.status.in_(ACTIVE_GROUP))):
        group_students = set(db.scalars(select(GroupMember.student_id).where(GroupMember.group_id == group.id)))
        mistake = db.get(Misconception, group.main_misconception_id)
        allowed = set(db.scalars(select(MisconceptionConcept.concept_id).where(
            MisconceptionConcept.misconception_id == mistake.id
        )))
        results = {}
        for stage, kind in stages.items():
            assessed = group_students & set().union(
                *(student_cells[concept.code, kind] for concept in concepts if concept.id in allowed)
            )
            results[stage] = counts(len(errors[mistake.id, kind] & assessed), len(assessed))
        error_results.append({"group_id": group.id, "misconception_code": mistake.code, **results})
    return {"lesson_id": id, "is_synthetic": classroom.is_synthetic, "concepts": concept_results,
            "error_counts": error_results}
