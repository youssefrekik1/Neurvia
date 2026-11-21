from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, model_validator

from app.models import enums as e
from app.schemas.common import Input, View
from app.schemas.learning import ShortText

Ratio = Annotated[float, Field(ge=0, le=1)]


class Priority(View):
    misconception_code: str
    label: str
    affected_students: int
    observed_count: int
    corroborated_students: int
    confident_wrong_share: Ratio
    priority_score: float


class Participation(View):
    enrolled_count: int
    submitted_count: int
    insufficient_count: int


class Insight(View):
    kind: Literal["same_score_different_errors", "different_scores_shared_error"]
    labels: tuple[str, str]
    scores: tuple[int, int]
    misconception_codes: list[str]


class Dashboard(View):
    lesson_id: UUID
    priorities: list[Priority]
    participation: Participation
    insights: list[Insight]
    is_synthetic: bool


class GraphNode(View):
    id: UUID
    label: str
    diagnosis_quality: e.DiagnosisStatus | Literal["no_observed_error"]
    is_synthetic: bool
    percent_correct: Ratio | None = None
    correct_count: int = 0
    answered_count: int = 0
    concept_rates: dict[str, Ratio] = {}
    misconception_codes: list[str] = []


class GraphEdge(View):
    source: UUID
    target: UUID
    similarity: Ratio
    provisional: bool


class GroupView(View):
    id: UUID
    label: str
    student_ids: list[UUID]
    main_misconception_code: str
    status: e.GroupStatus
    confidence_label: e.GroupConfidence
    evidence_summary: str
    avg_similarity: Ratio
    is_synthetic: bool
    intervention: InterventionView | None = None


class Graph(View):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    groups: list[GroupView]
    is_synthetic: bool


class GroupUpdate(Input):
    action: Literal["accept", "modify", "reject"]
    student_ids: Annotated[list[UUID], Field(min_length=1, max_length=100)] | None = None
    reason: Annotated[str, Field(max_length=2000)] | None = None

    @model_validator(mode="after")
    def check_members(self):
        if (self.action == "modify") != (self.student_ids is not None):
            raise ValueError("La modification exige une liste de membres.")
        if self.student_ids and len(self.student_ids) != len(set(self.student_ids)):
            raise ValueError("Les membres doivent être distincts.")
        return self


class PlanStep(Input):
    start_min: Annotated[int, Field(ge=0, lt=10)]
    end_min: Annotated[int, Field(gt=0, le=10)]
    action: ShortText


class RemediationPlan(Input):
    title: ShortText
    objective: ShortText
    duration_min: Literal[10] = 10
    steps: Annotated[list[PlanStep], Field(min_length=1, max_length=10)]
    example: ShortText
    counter_example: ShortText
    explanation: ShortText
    check_question: ShortText

    @model_validator(mode="after")
    def contiguous_steps(self):
        end = 0
        for step in self.steps:
            if step.start_min != end or step.end_min <= end:
                raise ValueError("Les étapes doivent être contiguës et de durée positive.")
            end = step.end_min
        if end != self.duration_min:
            raise ValueError("Le plan doit durer exactement dix minutes.")
        return self


class InterventionUpdate(Input):
    plan: RemediationPlan


class InterventionView(View):
    id: UUID
    group_id: UUID
    plan: RemediationPlan
    status: e.InterventionStatus
    source: Literal["llm", "fixture", "template", "teacher"]
    used_fallback: bool
    is_synthetic: bool


GroupView.model_rebuild()


class AssignedPlan(View):
    id: UUID
    lesson_id: UUID
    lesson_title: str
    plan: RemediationPlan
    assigned_at: datetime
    is_synthetic: bool


class RetestCreate(Input):
    intervention_id: UUID


class ScheduleItem(View):
    id: UUID
    concept_code: str
    kind: e.RetestKind
    status: e.ScheduleStatus
    due_at: datetime
    quiz_id: UUID | None = None


class ScheduleResult(View):
    lesson_id: UUID
    schedules: list[ScheduleItem]
    is_synthetic: bool


class Counts(View):
    correct: int
    attempts: int
    rate: Ratio | None


class ConceptComparison(View):
    concept_code: str
    initial: Counts
    immediate: Counts
    j7: Counts


class ErrorComparison(View):
    group_id: UUID
    misconception_code: str
    initial: Counts
    immediate: Counts
    j7: Counts


class BeforeAfter(View):
    lesson_id: UUID
    concepts: list[ConceptComparison]
    is_synthetic: bool
    error_counts: list[ErrorComparison] = []
