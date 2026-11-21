import argparse
from dataclasses import dataclass
from datetime import timedelta
import logging
from time import perf_counter, sleep
from uuid import UUID, uuid4

import pymupdf as pdf
from sqlalchemy import and_, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.ai.serving import model_clients, model_http
from app.core.config import Settings
from app.db.base import utcnow
from app.db.migrate import initialize_schema
from app.db.session import build_database
from app.documents.chunking import split_block
from app.documents.extract import extract_page
from app.documents.storage import ObjectStore
from app.models.documents import (
    ChunkEmbedding, DocumentBlock, DocumentChunk, DocumentJob, DocumentPage, DocumentVersion,
)
from app.services.access import start_write

logger = logging.getLogger(__name__)
LEASE = timedelta(minutes=5)


@dataclass(frozen=True)
class Claim:
    id: UUID
    version_id: UUID
    revision: int
    token: UUID
    kind: str


class ObsoleteJob(Exception):
    pass


class PermanentError(Exception):
    pass


def enqueue(db, version, kind):
    existing = db.scalar(select(DocumentJob).where(
        DocumentJob.version_id == version.id, DocumentJob.kind == kind, DocumentJob.revision == version.revision
    ))
    if existing is not None:
        return existing
    job = DocumentJob(version_id=version.id, kind=kind, revision=version.revision, available_at=utcnow())
    db.add(job)
    return job


def claim(sessions, attempts):
    now = utcnow()
    with sessions.begin() as db:
        start_write(db)
        query = select(DocumentJob).where(or_(
            and_(DocumentJob.state == "queued", DocumentJob.available_at <= now),
            and_(DocumentJob.state == "processing", DocumentJob.locked_until <= now),
        )).order_by(DocumentJob.available_at, DocumentJob.id).limit(1)
        if db.get_bind().dialect.name == "postgresql":
            query = query.with_for_update(skip_locked=True)
        job = db.scalar(query)
        if job is None:
            return None
        version = db.get(DocumentVersion, job.version_id)
        if version.revision != job.revision:
            job.state = "obsolete"
            return None
        if job.attempts >= attempts:
            job.state, job.error_code = "failed", "lease_expired"
            if job.kind != "reindex":
                version.state, version.failure = "failed", job.error_code
            return None
        token = uuid4()
        job.state, job.lease_token, job.locked_until = "processing", token, now + LEASE
        job.attempts += 1
        job.progress = 0
        if job.kind != "reindex":
            version.state, version.failure = "processing", None
        return Claim(job.id, job.version_id, job.revision, token, job.kind)


def lock_current(db, item):
    start_write(db)
    job = db.scalar(select(DocumentJob).where(DocumentJob.id == item.id).with_for_update())
    version = db.scalar(select(DocumentVersion).where(DocumentVersion.id == item.version_id).with_for_update())
    if job.lease_token != item.token or job.state != "processing":
        raise ObsoleteJob
    if version.revision != item.revision:
        job.state = "obsolete"
        return None, job
    return version, job


def heartbeat(sessions, item, progress):
    with sessions.begin() as db:
        result = db.execute(update(DocumentJob).where(
            DocumentJob.id == item.id, DocumentJob.lease_token == item.token, DocumentJob.state == "processing"
        ).values(progress=progress, locked_until=utcnow() + LEASE))
        if result.rowcount != 1:
            raise ObsoleteJob


def ingest(sessions, item, store, model, settings, start):
    with sessions() as db:
        key = db.get(DocumentVersion, item.version_id).object_key
    data = store.read(key, settings.document_max_upload_mb * 1024 * 1024)
    prefix = f"{key.rsplit('/', 2)[0]}/versions/{item.version_id}/render/{item.token}"
    pages = []
    try:
        doc = pdf.open(stream=data, filetype="pdf")
    except (ValueError, RuntimeError) as exc:
        raise PermanentError("invalid_pdf") from exc
    with doc:
        if doc.needs_pass or not 0 < len(doc) <= settings.document_max_pages:
            raise PermanentError("encrypted_or_page_limit")
        for index, page in enumerate(doc, start=1):
            page.set_rotation(0)
            image, blocks = extract_page(page, settings, model)
            picture = f"{prefix}/{index}.png"
            store.put(picture, image, "image/png")
            record = DocumentPage(version_id=item.version_id, number=index, width=page.rect.width,
                                  height=page.rect.height, image_key=picture, image_bytes=len(image))
            rows = []
            for position, block in enumerate(blocks, start=1):
                img = f"{prefix}/{index}/blocks/{position}.png" if block.image else None
                if img:
                    store.put(img, block.image, "image/png")
                rows.append(DocumentBlock(position=position, kind=block.kind, bounds=block.bounds,
                                          extracted_text=block.text, text=block.text, method=block.method,
                                          confidence=block.confidence, review_required=block.review,
                                          image_key=img, image_bytes=len(block.image) if block.image else 0))
            pages.append((record, rows))
            heartbeat(sessions, item, int(95 * index / len(doc)))
    with sessions.begin() as db:
        version, job = lock_current(db, item)
        if version is None:
            return
        for record, rows in pages:
            db.add(record)
            db.flush()
            for row in rows:
                row.page_id = record.id
            db.add_all(rows)
        version.page_count = len(pages)
        version.state = "review" if any(row.review_required for _, rows in pages for row in rows) else "queued"
        if version.state == "queued":
            enqueue(db, version, "index")
        finish(job, start)


def index(sessions, item, model, start):
    with sessions() as db:
        blocks = list(db.scalars(select(DocumentBlock).join(DocumentPage)
                                 .where(DocumentPage.version_id == item.version_id)
                                 .order_by(DocumentPage.number, DocumentBlock.position)))
    if any(row.review_required for row in blocks):
        raise PermanentError("transcription_requires_review")
    profile = model.revision()
    records = []
    for block in blocks:
        texts = list(split_block(block.text, block.kind))
        if not texts:
            continue
        parent = DocumentChunk(id=uuid4(), version_id=item.version_id, page_id=block.page_id,
                               block_id=block.id, position=0, revision=item.revision, text=block.text)
        children = [DocumentChunk(id=uuid4(), version_id=item.version_id, page_id=block.page_id,
                                  block_id=block.id, parent_id=parent.id, position=position,
                                  revision=item.revision, text=value)
                    for position, value in enumerate(texts, start=1)]
        records.append((parent, children))
    children = [child for _, batch in records for child in batch]
    embeddings = []
    for offset in range(0, len(children), 24):
        batch = children[offset:offset + 24]
        vectors = model.embed([row.text for row in batch], profile)
        embeddings.extend(ChunkEmbedding(chunk_id=row.id, model_revision=profile, vector=vector)
                          for row, vector in zip(batch, vectors, strict=True))
        heartbeat(sessions, item, int(95 * (offset + len(batch)) / len(children)))
    if model.revision() != profile:
        raise ValueError("embedding_model_changed")
    with sessions.begin() as db:
        version, job = lock_current(db, item)
        if version is None:
            return
        db.add_all(parent for parent, _ in records)
        db.flush()
        db.add_all(children)
        db.flush()
        db.add_all(embeddings)
        version.model_revision, version.indexed_revision, version.state = profile, item.revision, "ready"
        finish(job, start)


def finish(job, start):
    job.state, job.progress, job.locked_until = "done", 100, None
    job.elapsed_ms = round((perf_counter() - start) * 1000)
    logger.info("document_job_finished kind=%s elapsed_ms=%d", job.kind, job.elapsed_ms)


def reembed(sessions, item, model, start):
    with sessions() as db:
        chunks = db.execute(select(DocumentChunk.id, DocumentChunk.text).where(
            DocumentChunk.version_id == item.version_id, DocumentChunk.revision == item.revision,
            DocumentChunk.position > 0,
        ).order_by(DocumentChunk.id)).all()
    profile = model.revision()
    values = []
    for offset in range(0, len(chunks), 24):
        batch = chunks[offset:offset + 24]
        vectors = model.embed([row.text for row in batch], profile)
        values.extend({"chunk_id": row.id, "model_revision": profile, "vector": vector}
                      for row, vector in zip(batch, vectors, strict=True))
        heartbeat(sessions, item, int(95 * (offset + len(batch)) / len(chunks)))
    if model.revision() != profile:
        raise ValueError("embedding_model_changed")
    with sessions.begin() as db:
        version, job = lock_current(db, item)
        if version is None:
            return
        if version.state != "ready" or version.indexed_revision != item.revision:
            job.state = "obsolete"
            return
        insert = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
        for offset in range(0, len(values), 24):
            statement = insert(ChunkEmbedding).values(values[offset:offset + 24])
            db.execute(statement.on_conflict_do_update(
                index_elements=["chunk_id", "model_revision"], set_={"vector": statement.excluded.vector},
            ))
        version.model_revision = profile
        finish(job, start)


def fail(sessions, item, settings, exc, start):
    with sessions.begin() as db:
        version, job = lock_current(db, item)
        if version is None:
            return
        code = str(exc) if isinstance(exc, PermanentError) else type(exc).__name__
        job.error_code, job.locked_until = code, None
        job.elapsed_ms = round((perf_counter() - start) * 1000)
        if isinstance(exc, PermanentError) or job.attempts >= settings.document_job_retries:
            job.state = "failed"
            if item.kind != "reindex":
                version.state, version.failure = "failed", code
        else:
            job.available_at = utcnow() + timedelta(seconds=min(300, 4 ** job.attempts))
            job.state = "queued"
            if item.kind != "reindex":
                version.state, version.failure = "queued", code
        logger.warning("document_job_failed kind=%s state=%s reason=%s attempt=%d", job.kind, job.state, code, job.attempts)


def run_one(sessions, store, model, settings):
    item = claim(sessions, settings.document_job_retries)
    if item is None:
        return False
    start = perf_counter()
    try:
        if item.kind == "extract":
            ingest(sessions, item, store, model, settings, start)
        elif item.kind == "index":
            index(sessions, item, model, start)
        elif item.kind == "reindex":
            reembed(sessions, item, model, start)
        else:
            raise PermanentError("unknown_job_type")
    except ObsoleteJob:
        pass
    except Exception as exc:
        try:
            fail(sessions, item, settings, exc, start)
        except ObsoleteJob:
            pass
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = Settings()
    if not settings.document_s3_endpoint:
        raise SystemExit("Configure the private document bucket before starting a worker.")
    engine, sessions = build_database(settings.db_url)
    initialize_schema(engine)
    store = ObjectStore(settings)
    with model_http(settings, connect=4) as http:
        _, model = model_clients(http, settings)
        while True:
            worked = run_one(sessions, store, model, settings)
            if args.once:
                break
            if not worked:
                sleep(1.5)


if __name__ == "__main__":
    main()
