"""Classes (cohorts), the subjects teachers teach, and the course link on classrooms."""
import sqlalchemy as sa
from alembic import op

from app.models.curriculum import Cohort, CohortMember, TeacherSubject

revision = "20261122_06"
down_revision = "20261121_05"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    for model in (Cohort, CohortMember, TeacherSubject):
        model.__table__.create(bind, checkfirst=True)
    columns = {column["name"] for column in sa.inspect(bind).get_columns("classrooms")}
    for name, target in (("cohort_id", "cohorts.id"), ("subject_id", "teacher_subjects.id")):
        if name not in columns:
            op.add_column("classrooms", sa.Column(name, sa.Uuid(), sa.ForeignKey(target), nullable=True))
            op.create_index(f"ix_classrooms_{name}", "classrooms", [name])
    # Existing classrooms are adopted as courses at application startup (app.services.curriculum).


def downgrade():
    for name in ("subject_id", "cohort_id"):
        op.drop_index(f"ix_classrooms_{name}", "classrooms")
        op.drop_column("classrooms", name)
    for model in (TeacherSubject, CohortMember, Cohort):
        model.__table__.drop(op.get_bind(), checkfirst=True)
