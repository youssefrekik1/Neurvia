"""Associate teacher-reviewed concepts with their institution."""

from alembic import op

from app.models.documents import InstitutionConcept

revision = "20261121_04"
down_revision = "20261121_03"
branch_labels = None
depends_on = None


def upgrade():
    InstitutionConcept.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError("Removing the institutional taxonomy boundary would expose private concepts.")
