from datetime import datetime
from uuid import NAMESPACE_URL, UUID, uuid5

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON, BigInteger, CheckConstraint, ForeignKey, ForeignKeyConstraint, Index, String,
    Text, UniqueConstraint, func, literal_column,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Record, UTCDateTime

EMBEDDING_DIM = 1024


def personal_institution_id(user_id: UUID) -> UUID:
    return uuid5(NAMESPACE_URL, f"neurvia.personal.{user_id}")


def ref(table, *, nullable=False, ondelete=None):
    return mapped_column(ForeignKey(f"{table}.id", ondelete=ondelete), index=True, nullable=nullable)


class Institution(Record):
    __tablename__ = "institutions"

    name: Mapped[str] = mapped_column(String(160))
    is_synthetic: Mapped[bool] = mapped_column(default=False)


class InstitutionMember(Record):
    __tablename__ = "institution_members"
    __table_args__ = (UniqueConstraint("institution_id", "user_id"),)

    institution_id: Mapped[UUID] = ref("institutions")
    user_id: Mapped[UUID] = ref("users")


class ClassroomTenant(Record):
    __tablename__ = "classroom_tenants"
    __table_args__ = (UniqueConstraint("classroom_id"), UniqueConstraint("institution_id", "classroom_id"))

    institution_id: Mapped[UUID] = ref("institutions")
    classroom_id: Mapped[UUID] = ref("classrooms")


class InstitutionConcept(Record):
    __tablename__ = "institution_concepts"
    __table_args__ = (UniqueConstraint("concept_id"),)

    institution_id: Mapped[UUID] = ref("institutions")
    concept_id: Mapped[UUID] = ref("concepts")
    validated_by: Mapped[UUID] = ref("users")
    validated_at: Mapped[datetime] = mapped_column(UTCDateTime())


class Resource(Record):
    __tablename__ = "document_resources"
    __table_args__ = (
        ForeignKeyConstraint(
            ["institution_id", "classroom_id"], ["classroom_tenants.institution_id", "classroom_tenants.classroom_id"]
        ),
        Index("ix_resources_lesson_scope", "institution_id", "classroom_id", "lesson_id"),
    )

    institution_id: Mapped[UUID] = ref("institutions")
    classroom_id: Mapped[UUID] = ref("classrooms")
    lesson_id: Mapped[UUID] = ref("lessons")
    owner_id: Mapped[UUID] = ref("users")
    name: Mapped[str] = mapped_column(String(200))


class DocumentVersion(Record):
    __tablename__ = "document_versions"
    __table_args__ = (UniqueConstraint("resource_id", "number"), UniqueConstraint("lesson_id", "sha256"))

    resource_id: Mapped[UUID] = ref("document_resources")
    lesson_id: Mapped[UUID] = ref("lessons")
    number: Mapped[int]
    sha256: Mapped[str] = mapped_column(String(64))
    object_key: Mapped[str] = mapped_column(String(500))
    byte_size: Mapped[int] = mapped_column(BigInteger)
    state: Mapped[str] = mapped_column(String(24), index=True, default="queued")
    page_count: Mapped[int] = mapped_column(default=0)
    revision: Mapped[int] = mapped_column(default=1)
    indexed_revision: Mapped[int | None]
    model_revision: Mapped[str | None] = mapped_column(String(160))
    failure: Mapped[str | None] = mapped_column(String(80))


class DocumentJob(Record):
    __tablename__ = "document_jobs"
    __table_args__ = (
        UniqueConstraint("version_id", "kind", "revision"),
        Index("ix_document_jobs_queue", "state", "available_at", "locked_until"),
    )

    version_id: Mapped[UUID] = ref("document_versions")
    kind: Mapped[str] = mapped_column(String(20))
    revision: Mapped[int]
    state: Mapped[str] = mapped_column(String(24), default="queued")
    attempts: Mapped[int] = mapped_column(default=0)
    progress: Mapped[int] = mapped_column(default=0)
    available_at: Mapped[datetime] = mapped_column(UTCDateTime())
    locked_until: Mapped[datetime | None] = mapped_column(UTCDateTime())
    lease_token: Mapped[UUID | None]
    elapsed_ms: Mapped[int | None]
    error_code: Mapped[str | None] = mapped_column(String(80))


class DocumentPage(Record):
    __tablename__ = "document_pages"
    __table_args__ = (UniqueConstraint("version_id", "number"),)

    version_id: Mapped[UUID] = ref("document_versions")
    number: Mapped[int]
    width: Mapped[float]
    height: Mapped[float]
    image_key: Mapped[str] = mapped_column(String(500))
    image_bytes: Mapped[int] = mapped_column(BigInteger)


class DocumentBlock(Record):
    __tablename__ = "document_blocks"
    __table_args__ = (UniqueConstraint("page_id", "position"),)

    page_id: Mapped[UUID] = ref("document_pages")
    position: Mapped[int]
    kind: Mapped[str] = mapped_column(String(24))
    bounds: Mapped[list] = mapped_column(JSON)
    method: Mapped[str] = mapped_column(String(24))
    extracted_text: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float | None]
    review_required: Mapped[bool] = mapped_column(default=False)
    reviewed_by: Mapped[UUID | None] = ref("users", nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    image_key: Mapped[str | None] = mapped_column(String(500))
    image_bytes: Mapped[int] = mapped_column(BigInteger, default=0)


class DocumentChunk(Record):
    __tablename__ = "document_chunks"
    __table_args__ = (
        UniqueConstraint("block_id", "revision", "position"),
        Index("ix_chunks_version_revision", "version_id", "revision", "position"),
    )

    version_id: Mapped[UUID] = ref("document_versions")
    page_id: Mapped[UUID] = ref("document_pages")
    block_id: Mapped[UUID] = ref("document_blocks")
    parent_id: Mapped[UUID | None] = ref("document_chunks", nullable=True)
    revision: Mapped[int]
    position: Mapped[int]
    text: Mapped[str] = mapped_column(Text)


TS_CONFIG = literal_column("'simple'::regconfig")
Index("ix_chunks_full_text", func.to_tsvector(TS_CONFIG, DocumentChunk.text),
      postgresql_using="gin").ddl_if(dialect="postgresql")


class ChunkEmbedding(Record):
    __tablename__ = "chunk_embeddings"
    __table_args__ = (UniqueConstraint("chunk_id", "model_revision"),)

    chunk_id: Mapped[UUID] = ref("document_chunks")
    model_revision: Mapped[str] = mapped_column(String(160), index=True)
    vector: Mapped[list[float]] = mapped_column(JSON().with_variant(Vector(EMBEDDING_DIM), "postgresql"))


Index("ix_embedding_hnsw", ChunkEmbedding.vector, postgresql_using="hnsw",
      postgresql_ops={"vector": "vector_cosine_ops"}).ddl_if(dialect="postgresql")


class CourseConversation(Record):
    __tablename__ = "course_conversations"

    institution_id: Mapped[UUID] = ref("institutions")
    classroom_id: Mapped[UUID] = ref("classrooms")
    lesson_id: Mapped[UUID] = ref("lessons")
    teacher_id: Mapped[UUID] = ref("users")


class CourseMessage(Record):
    __tablename__ = "course_messages"
    __table_args__ = (UniqueConstraint("conversation_id", "position"),)

    conversation_id: Mapped[UUID] = ref("course_conversations")
    position: Mapped[int]
    role: Mapped[str] = mapped_column(String(16))
    text: Mapped[str] = mapped_column(Text)


class GenerationBrief(Record):
    __tablename__ = "course_generation_briefs"
    __table_args__ = (UniqueConstraint("conversation_id"),)

    conversation_id: Mapped[UUID] = ref("course_conversations")
    teacher_id: Mapped[UUID] = ref("users")
    values: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(default=1)


class GroundedQuiz(Record):
    __tablename__ = "grounded_quizzes"
    __table_args__ = (UniqueConstraint("quiz_id"),)

    quiz_id: Mapped[UUID] = ref("quizzes")
    conversation_id: Mapped[UUID] = ref("course_conversations")
    brief_revision: Mapped[int]
    brief_snapshot: Mapped[dict] = mapped_column(JSON)


class SourceCitation(Record):
    __tablename__ = "document_citations"
    __table_args__ = (
        CheckConstraint("(message_id IS NULL) <> (question_id IS NULL)", name="citation_one_subject"),
    )

    message_id: Mapped[UUID | None] = ref("course_messages", nullable=True)
    question_id: Mapped[UUID | None] = ref("questions", nullable=True)
    chunk_id: Mapped[UUID] = ref("document_chunks")
    page_id: Mapped[UUID] = ref("document_pages")
    quote: Mapped[str] = mapped_column(Text)
    objective: Mapped[str | None] = mapped_column(String(500))
