from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.db.base import Base
from app.models import documents  # noqa: F401  (registers the document tables)

# Additive upgrade from the existing Phase 0 SQLite schema.
COLUMNS = {
    "answers": {"justification": "TEXT"},
    "questions": {
        "bank_owner_id": "CHAR(32) REFERENCES users(id)",
        "target_misconception_id": "CHAR(32) REFERENCES misconceptions(id)",
    },
    "retest_schedule": {
        "target_misconception_id": "CHAR(32) REFERENCES misconceptions(id)",
    },
    "quizzes": {
        "recipient_id": "CHAR(32) REFERENCES users(id)",
        "generation_mode": "VARCHAR(20) NOT NULL DEFAULT 'teacher'",
        "used_fallback": "BOOLEAN NOT NULL DEFAULT 0",
    },
}


def initialize_schema(engine: Engine) -> None:
    if engine.dialect.name == "postgresql":
        with engine.connect() as connection:
            if not inspect(connection).has_table("alembic_version"):
                raise RuntimeError("Run alembic upgrade head before starting the PostgreSQL application.")
            revisions = set(connection.scalars(text("SELECT version_num FROM alembic_version")))
            if revisions != {"20261121_05"}:
                raise RuntimeError("Run alembic upgrade head before starting the PostgreSQL application.")
        return
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        for table, columns in COLUMNS.items():
            existing = {column["name"] for column in inspect(connection).get_columns(table)}
            for name, definition in columns.items():
                if name not in existing:
                    connection.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
                if name.endswith("_id"):
                    connection.exec_driver_sql(
                        f"CREATE INDEX IF NOT EXISTS ix_{table}_{name} ON {table}({name})"
                    )
