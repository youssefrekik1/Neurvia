from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr

from app.models import enums as e


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class View(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ErrorDetail(View):
    code: str
    message: str


class ErrorResponse(View):
    error: ErrorDetail


class Health(View):
    status: Literal["ok"] = "ok"


class Register(Input):
    email: EmailStr
    password: Annotated[SecretStr, Field(min_length=10, max_length=128)]
    full_name: Annotated[str, Field(min_length=1, max_length=100)]
    role: e.Role
    # Students choose their class when they create their account.
    cohort_id: UUID | None = None


class Login(Input):
    email: EmailStr
    password: Annotated[SecretStr, Field(min_length=1, max_length=128)]


class Token(View):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


class Profile(View):
    id: UUID
    email: EmailStr
    full_name: str
    role: e.Role
    is_synthetic: bool


class InstitutionView(View):
    id: UUID
    name: str


class ClassroomCreate(Input):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    subject: Annotated[str, Field(min_length=1, max_length=100)] = "python_intro"
    join_ttl_hours: Annotated[int, Field(ge=1, le=720)] = 72
    institution_id: UUID | None = None


class JoinRotate(Input):
    join_ttl_hours: Annotated[int, Field(ge=1, le=720)] = 72


class ClassroomView(View):
    id: UUID
    name: str
    subject: str
    is_synthetic: bool
    cohort_id: UUID | None = None
    cohort_name: str | None = None
    subject_name: str | None = None
    join_code: str | None = None
    join_path: str | None = None
    join_expires_at: datetime | None = None


class ClassroomJoin(Input):
    code: Annotated[str, Field(min_length=4, max_length=32)]
    pseudonym: Annotated[str, Field(min_length=1, max_length=100)] | None = None


class Member(View):
    id: UUID
    pseudonym: str
    is_synthetic: bool


class MisconceptionView(View):
    code: str
    label_fr: str


class ConceptView(View):
    code: str
    label_fr: str
    subject: str
    misconceptions: list[MisconceptionView]


class Approval(Input):
    validated: bool


class DemoAdvance(Input):
    days: Annotated[int, Field(ge=1, le=30)] = 7


class DemoClockView(View):
    now: datetime
    is_simulated: Literal[True] = True


class DemoSeedView(DemoClockView):
    teacher_id: UUID
    lesson_id: UUID
    classroom_id: UUID
    is_synthetic: Literal[True] = True


ShortName = Annotated[str, Field(min_length=1, max_length=100)]


class CohortView(View):
    id: UUID
    name: str
    student_count: int | None = None


class CohortCreate(Input):
    name: Annotated[str, Field(min_length=1, max_length=120)]


class CohortChoice(Input):
    cohort_id: UUID


class SubjectCourse(View):
    cohort_id: UUID
    cohort_name: str
    classroom_id: UUID
    student_count: int
    lesson_count: int


class SubjectView(View):
    id: UUID
    name: str
    key: str
    courses: list[SubjectCourse]


class SubjectCohorts(Input):
    cohort_ids: Annotated[list[UUID], Field(max_length=50)] = []


class SubjectCreate(SubjectCohorts):
    name: ShortName
