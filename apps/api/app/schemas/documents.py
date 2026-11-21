from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import Input, View

DocumentState = Literal["queued", "processing", "review", "ready", "failed"]


class DocumentView(View):
    id: UUID
    resource_id: UUID
    name: str
    number: int
    revision: int
    state: DocumentState
    page_count: int
    byte_size: int
    model_revision: str | None
    progress: int
    job_kind: str | None
    attempts: int
    failure: str | None
    created_at: datetime


class BlockView(View):
    id: UUID
    kind: str
    bounds: list[float]
    text: str
    extracted_text: str
    method: str
    confidence: float | None
    review_required: bool
    has_image: bool


class PageView(View):
    number: int
    width: float
    height: float
    image_path: str
    blocks: list[BlockView]


class BlockCorrection(Input):
    revision: int = Field(ge=1)
    text: str = Field(max_length=24000)


class DocumentReview(Input):
    revision: int = Field(ge=1)
    validated: bool


class DocumentSelection(Input):
    document_ids: Annotated[list[UUID], Field(min_length=1, max_length=50)]


class SourceView(View):
    document_id: UUID
    title: str
    page: int
    path: str
    quote: str
    objective: str | None = None


class SearchRequest(DocumentSelection):
    query: str = Field(min_length=2, max_length=1200)
    limit: int = Field(ge=1, le=15, default=6)


class SearchHit(View):
    source: SourceView
    score: float


class SearchView(View):
    mode: Literal["hybrid", "lexical"]
    hits: list[SearchHit]


class MessageRequest(DocumentSelection):
    message: str = Field(min_length=2, max_length=4500)


class MessageView(View):
    id: UUID
    role: Literal["teacher", "assistant"]
    text: str
    sources: list[SourceView]


BriefList = Annotated[list[Annotated[str, Field(min_length=1, max_length=240)]], Field(max_length=12)]


class Brief(Input):
    focus_topics: BriefList = []
    exclusions: BriefList = []
    observed_difficulties: BriefList = []
    question_count: int = Field(ge=1, le=10, default=4)
    difficulty: int = Field(ge=1, le=3, default=1)


class BriefUpdate(Brief):
    revision: int = Field(ge=1)


class ConversationView(View):
    id: UUID
    messages: list[MessageView]
    brief: Brief
    brief_revision: int


class VariantRequest(DocumentSelection):
    conversation_id: UUID
    brief_revision: int = Field(ge=1)
    skip: Annotated[list[Annotated[str, Field(max_length=80)]], Field(max_length=300)] = []


class GroundedQuizRequest(DocumentSelection):
    conversation_id: UUID
    brief_revision: int = Field(ge=1)
    question_count: int | None = Field(default=None, ge=1, le=10)


class Usage(View):
    originals_bytes: int
    rendered_bytes: int
    crops_bytes: int
    versions: int
