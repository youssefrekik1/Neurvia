"""Persist document-backed quiz generation metadata."""

from alembic import op

from app.models.documents import GroundedQuiz

revision = "20261121_03"
down_revision = "20261121_02"
branch_labels = None
depends_on = None


def upgrade():
    GroundedQuiz.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError("Removing grounded quiz metadata would discard provenance.")
