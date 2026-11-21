from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StrictBool, model_validator

from app.models import enums as e
from app.schemas.common import Input, View
from app.schemas.documents import SourceView

Code = Annotated[str, Field(pattern=r"^[A-Z][A-Z0-9_]{1,39}$")]
ShortText = Annotated[str, Field(min_length=1, max_length=400)]
QuestionCount = Annotated[int, Field(ge=1, le=10)]
Difficulty = Annotated[int, Field(ge=1, le=3)]
GenerationMode = Literal["bank", "llm", "mixed", "fixture", "teacher", "template"]


class FocusBrief(Input):
    pitfalls: Annotated[list[ShortText], Field(max_length=12)] = []
    difficulty: Difficulty = 1
    question_count: QuestionCount = 6
    instructions: Annotated[str, Field(max_length=2000)] = ""


class LessonCreate(Input):
    title: Annotated[str, Field(min_length=1, max_length=160)]
    content_text: Annotated[str, Field(min_length=1, max_length=30000)]
    concept_codes: Annotated[list[Code], Field(min_length=1, max_length=20)]
    focus_brief: FocusBrief = Field(default_factory=FocusBrief)

    @model_validator(mode="after")
    def distinct_concepts(self):
        if len(set(self.concept_codes)) != len(self.concept_codes):
            raise ValueError("Les concepts doivent être distincts.")
        return self


class ReviewedMisconception(Input):
    label: Annotated[str, Field(min_length=1, max_length=200)]
    remediation_hint: ShortText


class TaxonomyApproval(Input):
    label: Annotated[str, Field(min_length=1, max_length=200)]
    misconceptions: Annotated[list[ReviewedMisconception], Field(min_length=1, max_length=8)]
    validated: StrictBool

    @model_validator(mode="after")
    def distinct_misconceptions(self):
        if len({item.label.casefold() for item in self.misconceptions}) != len(self.misconceptions):
            raise ValueError("Les erreurs diagnostiques doivent être distinctes.")
        return self


class LessonView(View):
    id: UUID
    classroom_id: UUID
    title: str
    concept_codes: list[str]
    status: e.LessonStatus
    is_synthetic: bool
    content_text: str | None = None
    focus_brief: FocusBrief | None = None
    quiz_id: UUID | None = None
    quiz_status: e.QuizStatus | None = None
    created_at: datetime
    submitted_count: int = 0
    question_count: int = 0


class QuizGenerate(Input):
    question_count: QuestionCount | None = None
    use_seed_drafts: bool = False


class QuestionRegenerate(Input):
    instructions: Annotated[str, Field(max_length=2000)] = ""


class OptionDraft(Input):
    text: ShortText
    is_correct: StrictBool
    misconception_code: Code | None = None


class QuestionDraft(Input):
    concept_code: Code
    stem: Annotated[str, Field(min_length=10, max_length=1500)]
    code: Annotated[str, Field(max_length=4000)] | None = None
    difficulty: Difficulty = 1
    options: Annotated[list[OptionDraft], Field(min_length=4, max_length=4)]
    explanation: Annotated[str, Field(min_length=1, max_length=2000)]

    @model_validator(mode="after")
    def validate_options(self):
        if sum(option.is_correct for option in self.options) != 1:
            raise ValueError("Une seule option correcte est requise.")
        if any(option.is_correct and option.misconception_code for option in self.options):
            raise ValueError("Une option correcte ne porte pas de code d'erreur.")
        if len({" ".join(option.text.casefold().split()) for option in self.options}) != 4:
            raise ValueError("Les quatre options doivent être distinctes.")
        return self

    def check_taxonomy(self, concept_code: str, codes: set[str]) -> None:
        if self.concept_code != concept_code:
            raise ValueError("Le concept ne correspond pas à la demande.")
        if any(o.misconception_code not in codes for o in self.options if o.misconception_code):
            raise ValueError("Code d'erreur non autorisé pour ce concept.")


class StudentOption(View):
    id: UUID
    text: str


class StudentQuestion(View):
    id: UUID
    concept_code: str
    stem: str
    code: str | None = None
    options: list[StudentOption]


class TeacherOption(OptionDraft):
    id: UUID


class TeacherQuestion(QuestionDraft):
    id: UUID
    options: Annotated[list[TeacherOption], Field(min_length=4, max_length=4)]
    source: e.Source
    status: e.QuestionStatus
    role: e.QuestionRole
    version: int
    validated_by: UUID | None = None
    validated_at: datetime | None = None
    target_misconception_code: str | None = None
    source_pages: list[SourceView] = []


class BankQuestionCreate(QuestionDraft):
    role: e.QuestionRole = e.QuestionRole.initial
    target_misconception_code: Code | None = None


class VariantResult(View):
    question: TeacherQuestion | None = None
    remaining: int
    attempted: list[str] = []


class TeacherQuiz(View):
    id: UUID
    lesson_id: UUID
    status: e.QuizStatus
    kind: e.QuestionRole
    generation_mode: GenerationMode
    used_fallback: bool
    validated_by: UUID | None = None
    validated_at: datetime | None = None
    questions: list[TeacherQuestion]
    is_synthetic: bool
    is_grounded: bool = False


class AnswerInput(Input):
    question_id: UUID
    option_id: UUID
    confidence: e.Confidence
    justification: str | None = Field(default=None, max_length=600)


class AnswerSaved(View):
    question_id: UUID
    option_id: UUID
    confidence: e.Confidence
    saved: Literal[True] = True


class AttemptView(View):
    id: UUID
    quiz_id: UUID
    status: e.AttemptStatus
    kind: e.QuestionRole
    questions: list[StudentQuestion]
    saved_answers: list[AnswerSaved] = []
    is_synthetic: bool


class Diagnosis(View):
    misconception_code: str
    status: e.DiagnosisStatus
    message: str
    evidence_count: int
    distinct_questions_count: int


class AnswerFeedback(View):
    question_id: UUID
    is_correct: bool
    quadrant: e.Quadrant
    correct_option_id: UUID
    explanation: str
    selected_option_id: UUID
    confidence: e.Confidence


class Feedback(View):
    attempt_id: UUID
    correct_count: int
    answered_count: int
    total_questions: int
    diagnosis_quality: Literal["sufficient", "insufficient"]
    answers: list[AnswerFeedback]
    suspected_difficulties: list[Diagnosis]
    confirmation_available: bool
    is_synthetic: bool
    submitted_at: datetime
    lesson_id: UUID
    classroom_id: UUID
    kind: e.QuestionRole
    questions: list[StudentQuestion]


class Confirmation(View):
    question: StudentQuestion
    misconception_code: str
    is_synthetic: bool


class StudentTask(View):
    id: UUID
    lesson_id: UUID
    classroom_id: UUID
    title: str
    kind: e.QuestionRole
    status: e.ScheduleStatus
    quiz_id: UUID | None = None
    attempt_id: UUID | None = None
    due_at: datetime | None = None
    is_synthetic: bool
