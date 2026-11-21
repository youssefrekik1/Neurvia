"""Preserve legacy classrooms as private workspaces and add institutional cohorts."""
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.orm import Session
from sqlalchemy.types import Date
from sqlalchemy import Column

from app.models.teaching import TEACHING_TABLES
from app.services.teaching import backfill_teaching

revision = "20261122_06"
down_revision = "20261121_05"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if "taught_on" not in {column["name"] for column in inspect(bind).get_columns("lessons")}:
        op.add_column("lessons", Column("taught_on", Date(), nullable=True))
    for model in TEACHING_TABLES:
        model.__table__.create(bind, checkfirst=True)
    with Session(bind=bind) as db:
        backfill_teaching(db)
        db.flush()


def downgrade():
    raise RuntimeError("Restore a database backup to remove institutional enrollments safely.")
