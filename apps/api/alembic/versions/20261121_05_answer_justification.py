"""Store the optional reasoning supplied with a student answer."""
import sqlalchemy as sa
from alembic import op

revision = "20261121_05"
down_revision = "20261121_04"
branch_labels = None
depends_on = None


def upgrade():
    # The original baseline creates its tables from current model metadata.
    columns = sa.inspect(op.get_bind()).get_columns("answers")
    if not any(column["name"] == "justification" for column in columns):
        op.add_column("answers", sa.Column("justification", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("answers", "justification")
