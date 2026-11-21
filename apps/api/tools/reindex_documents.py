"""Queue re-indexing for documents embedded with another model revision (or all ready documents).

Existing chunks and citations remain available while the worker builds new embeddings.
"""

import argparse

from sqlalchemy import exists, func, or_, select

from app.ai.serving import model_clients, model_http
from app.core.config import Settings
from app.db.migrate import initialize_schema
from app.db.base import utcnow
from app.db.session import build_database
from app.documents.worker import enqueue
from app.models.documents import DocumentJob, DocumentVersion
from app.services.access import start_write


def stale_filter(current, everything):
    ready = DocumentVersion.state == "ready"
    idle = ~exists().where(
        DocumentJob.version_id == DocumentVersion.id, DocumentJob.revision == DocumentVersion.revision,
        DocumentJob.kind == "reindex", DocumentJob.state.in_(["queued", "processing"]),
    )
    if everything:
        return (ready, idle)
    return (ready, idle, or_(DocumentVersion.model_revision.is_(None), DocumentVersion.model_revision != current))


def reindex(sessions, current, *, everything=False, limit=None, dry_run=False):
    with sessions.begin() as db:
        start_write(db)
        filters = stale_filter(current, everything)
        total = db.scalar(select(func.count()).select_from(DocumentVersion).where(*filters))
        query = select(DocumentVersion).where(*filters).order_by(DocumentVersion.created_at, DocumentVersion.id)
        if limit:
            query = query.limit(limit)
        if db.get_bind().dialect.name == "postgresql":
            query = query.with_for_update(skip_locked=True)
        rows = list(db.scalars(query))
        if dry_run:
            db.rollback()
            return total, 0
        for version in rows:
            job = enqueue(db, version, "reindex")
            job.state, job.attempts, job.progress = "queued", 0, 0
            job.available_at, job.locked_until, job.lease_token = utcnow(), None, None
            job.error_code, job.elapsed_ms = None, None
        return total, len(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true", help="Re-index every ready document, not only stale ones")
    parser.add_argument("--limit", type=int, help="Queue at most this many documents")
    parser.add_argument("--dry-run", action="store_true", help="Only count the documents to re-index")
    args = parser.parse_args()
    settings = Settings()
    engine, sessions = build_database(settings.db_url)
    try:
        initialize_schema(engine)
        with model_http(settings) as http:
            current = model_clients(http, settings)[1].revision()
        total, queued = reindex(sessions, current, everything=args.all, limit=args.limit, dry_run=args.dry_run)
        print(f"current embedding revision: {current}")
        print(f"documents to re-index: {total}; queued now: {queued}")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
