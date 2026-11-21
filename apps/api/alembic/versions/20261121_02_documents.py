"""Add institutions, versioned course documents, jobs and pgvector indexes."""

from alembic import op

from app.db.base import Base
from app.models import documents

revision = "20261121_02"
down_revision = "20261121_01"
branch_labels = None
depends_on = None

TABLES = (
    "institutions", "institution_members", "classroom_tenants", "document_resources",
    "document_versions", "document_jobs", "document_pages", "document_blocks",
    "document_chunks", "chunk_embeddings", "course_conversations", "course_messages",
    "course_generation_briefs", "document_citations",
)


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    Base.metadata.create_all(bind, tables=[Base.metadata.tables[name] for name in TABLES])


def downgrade():
    raise RuntimeError("Removing the document schema would discard source provenance.")
