"""Copy a stopped or snapshotted, read-only SQLite installation into an empty migrated PostgreSQL database."""

import argparse
import sqlite3
from pathlib import Path

from sqlalchemy import create_engine, func, inspect, select, text

from app.core.config import Settings
from app.db.base import Base
from app.db.migrate import initialize_schema
from app.db.session import build_database
from app.models import documents

EXT_TABLES = {
    "institutions", "institution_members", "classroom_tenants", "document_resources",
    "document_versions", "document_jobs", "document_pages", "document_blocks", "document_chunks",
    "chunk_embeddings", "course_conversations", "course_messages", "course_generation_briefs",
    "document_citations", "grounded_quizzes", "institution_concepts",
}


def migrate(path: Path, target_url: str):
    source_path = path.resolve(strict=True)
    source = create_engine("sqlite://", creator=lambda: sqlite3.connect(source_path.as_uri() + "?mode=ro", uri=True))
    target, _ = build_database(target_url)
    try:
        if target.dialect.name != "postgresql":
            raise ValueError("The destination must be PostgreSQL.")
        initialize_schema(target)
        with source.connect() as read, target.begin() as write:
            if read.exec_driver_sql("PRAGMA quick_check").scalar_one() != "ok":
                raise ValueError("SQLite failed its integrity check.")
            if read.exec_driver_sql("PRAGMA foreign_key_check").first():
                raise ValueError("SQLite contains invalid foreign keys.")
            source_tables = set(inspect(read).get_table_names())
            if not {"users", "classrooms", "lessons", "questions", "quizzes"}.issubset(source_tables):
                raise ValueError("Source is not a Neurvia SQLite database.")
            for name in source_tables & EXT_TABLES:
                table = Base.metadata.tables[name]
                if read.scalar(select(func.count()).select_from(table)):
                    raise ValueError("Use database and bucket backups for an installation with documents.")
            tables = [table for table in Base.metadata.sorted_tables if table.name not in EXT_TABLES]
            write.execute(text("SELECT pg_advisory_xact_lock(31478010)"))
            if any(write.scalar(select(func.count()).select_from(table)) for table in tables):
                raise ValueError("Destination already contains records. Use a new dedicated database.")
            counts = {}
            for table in tables:
                if table.name not in source_tables:
                    continue
                names = {column["name"] for column in inspect(read).get_columns(table.name)}
                columns = [column for column in table.c if column.name in names]
                order = [table.c.created_at, table.c.id]
                rows = read.execute(select(*columns).order_by(*order)).mappings()
                count = 0
                for batch in rows.partitions(500):
                    write.execute(table.insert(), [dict(row) for row in batch])
                    count += len(batch)
                if write.scalar(select(func.count()).select_from(table)) != count:
                    raise ValueError(f"Row count mismatch in {table.name}")
                counts[table.name] = count
            return counts
    finally:
        target.dispose()
        source.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    for table, count in migrate(args.source, Settings().db_url).items():
        print(f"{table}: {count}")
