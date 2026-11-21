from sqlalchemy import inspect
from sqlalchemy.engine import Engine

from app.db.base import Base

# Additive upgrade from the existing Phase 0 SQLite schema.
COLUMNS = {
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
    Base.metadata.create_all(engine)
    if engine.dialect.name != "sqlite":
        return
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
