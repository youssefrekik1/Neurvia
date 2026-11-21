from dataclasses import dataclass
from math import isfinite, sqrt
import logging
from time import perf_counter
from uuid import UUID

import httpx
from pgvector.sqlalchemy import Vector
from sqlalchemy import bindparam, func, select, text

from app.core.errors import error
from app.documents.ranking import content_terms, fused_ranking, rerank, terms
from app.models.documents import (
    EMBEDDING_DIM, TS_CONFIG, ChunkEmbedding, DocumentChunk, DocumentPage, DocumentVersion, Resource,
)
from app.schemas.documents import SourceView

logger = logging.getLogger("uvicorn.error").getChild("neurvia.retrieval")
CANDIDATES = 45
# Distinct pages make better citations than several overlapping chunks of one page. Search lists pages, so
# it keeps one passage per page; generation keeps two, e.g. a code block and the paragraph explaining it.
PER_PAGE = 2


@dataclass(frozen=True)
class Evidence:
    chunk_id: UUID
    page_id: UUID
    document_id: UUID
    revision: int
    title: str
    number: int
    content: str
    score: float
    lesson_id: UUID

    @property
    def path(self):
        return (f"/lessons/{self.lesson_id}/documents/{self.document_id}"
                f"/pages/{self.number}/render")

    def source(self, quote: str, objective: str | None = None):
        return SourceView(document_id=self.document_id, title=self.title, page=self.number,
                          path=self.path, quote=quote, objective=objective)


@dataclass
class Retrieval:
    hits: list[Evidence]
    mode: str


def ready_versions(db, scope, document_ids):
    if scope is None:
        raise error(404)
    version_ids = set(document_ids)
    rows = list(db.scalars(select(DocumentVersion).join(Resource)
                           .where(DocumentVersion.id.in_(version_ids), *scope.filters())))
    if len(rows) != len(version_ids):
        raise error(404)
    if any(row.state != "ready" or row.indexed_revision != row.revision for row in rows):
        raise error(409, "DOCUMENT_NOT_INDEXED", "Attendez l’indexation des documents sélectionnés.")
    return rows


def child_scope(scope, document_ids):
    return (
        DocumentChunk.version_id.in_(document_ids),
        DocumentChunk.revision == DocumentVersion.indexed_revision,
        DocumentVersion.indexed_revision == DocumentVersion.revision,
        DocumentVersion.state == "ready",
        DocumentChunk.position > 0,
        *scope.filters(),
    )


def base_query(*columns):
    return (select(*columns).select_from(DocumentChunk).join(
        DocumentVersion, DocumentVersion.id == DocumentChunk.version_id
    ).join(Resource, Resource.id == DocumentVersion.resource_id))


def postgres_lexical(db, filters, query):
    words = sorted(content_terms(query))[:25]
    if not words:
        return []
    vector = func.to_tsvector(TS_CONFIG, DocumentChunk.text)
    needles = func.to_tsquery(TS_CONFIG, " | ".join(words))
    return list(db.scalars(
        base_query(DocumentChunk.id).where(*filters, vector.bool_op("@@")(needles))
        .order_by(func.ts_rank_cd(vector, needles).desc(), DocumentChunk.id).limit(CANDIDATES)
    ))


def postgres_dense(db, filters, vector, profile):
    db.execute(text("SET LOCAL hnsw.iterative_scan = 'strict_order'"))
    query = bindparam("query_embedding", value=vector, type_=Vector(EMBEDDING_DIM))
    distance = ChunkEmbedding.vector.op("<=>")(query)
    return list(db.scalars(
        base_query(DocumentChunk.id).join(ChunkEmbedding, ChunkEmbedding.chunk_id == DocumentChunk.id)
        .where(*filters, DocumentVersion.model_revision == profile, ChunkEmbedding.model_revision == profile)
        .order_by(distance).limit(CANDIDATES)
    ))


def sqlite_candidates(db, filters, q, vector, profile):
    # SQLite is retained for the standalone legacy demo. Institutional deployments use indexed SQL.
    rows = db.execute(
        base_query(DocumentChunk.id, DocumentChunk.text, ChunkEmbedding.vector)
        .outerjoin(ChunkEmbedding, (ChunkEmbedding.chunk_id == DocumentChunk.id)
                   & (ChunkEmbedding.model_revision == profile))
        .where(*filters).limit(10000)
    )
    keywords = content_terms(q)
    lexical, dense = {}, {}
    for key, value, stored in rows:
        score = len(keywords & terms(value))
        if score:
            lexical[key] = score
        if vector is not None and stored is not None:
            norm = sqrt(sum(a * a for a in vector) * sum(b * b for b in stored))
            if norm:
                dense[key] = sum(a * b for a, b in zip(vector, stored, strict=True)) / norm

    def ranked(scores):
        return sorted(scores, key=lambda key: (-scores[key], str(key)))[:CANDIDATES]

    return ranked(lexical), ranked(dense)


def retrieve(db, models, settings, scope, document_ids, query, *, limit=6, per_page=None):
    per_page = per_page or PER_PAGE
    start = perf_counter()
    versions = ready_versions(db, scope, document_ids)
    profile, vector = None, None
    try:
        profile = models.revision()
        if any(version.model_revision == profile for version in versions):
            vector = models.embed([query], profile, query=True)[0]
    except (httpx.HTTPError, LookupError, ValueError, KeyError):
        logger.info("retrieval_embedding_unavailable")
    filters = child_scope(scope, document_ids)
    if db.get_bind().dialect.name == "postgresql":
        lexical = postgres_lexical(db, filters, query)
        dense = postgres_dense(db, filters, vector, profile) if vector is not None else []
    else:
        lexical, dense = sqlite_candidates(db, filters, query, vector, profile)
    weights = fused_ranking(dense, lexical)
    rows = {chunk.id: (chunk, title, number) for chunk, title, number in db.execute(
        base_query(DocumentChunk, Resource.name, DocumentPage.number)
        .join(DocumentPage, DocumentPage.id == DocumentChunk.page_id)
        .where(*filters, DocumentChunk.id.in_(weights))
    )}
    weights = {key: score for key, score in weights.items() if key in rows}
    if settings.rag_rerank:
        weights = rerank(weights, {key: row[0].text for key, row in rows.items()}, query)
    hits = []
    remaining = min(settings.rag_context_budget, max(0, settings.llm_num_ctx - 2400))
    seen, per_page_count = set(), {}
    parents = {row.id: row for row in db.scalars(select(DocumentChunk).where(
        DocumentChunk.id.in_({chunk.parent_id for chunk, _, _ in rows.values()})
    ))}
    for key in sorted(weights, key=lambda value: (-weights[value], str(value))):
        chunk, title, number = rows[key]
        if chunk.block_id in seen or per_page_count.get(chunk.page_id, 0) >= per_page:
            continue
        candidate = parents.get(chunk.parent_id)
        if (candidate and candidate.version_id == chunk.version_id and candidate.revision == chunk.revision
                and len(candidate.text.encode()) <= min(remaining - 180, 2700)):
            chunk = candidate
        cost = len(chunk.text.encode()) + 180
        if cost > remaining or not isfinite(weights[key]):
            continue
        remaining -= cost
        seen.add(chunk.block_id)
        per_page_count[chunk.page_id] = per_page_count.get(chunk.page_id, 0) + 1
        hits.append(Evidence(chunk.id, chunk.page_id, chunk.version_id, chunk.revision,
                             title, number, chunk.text, weights[key], scope.lesson_id))
        if len(hits) >= limit:
            break
    mode = "hybrid" if dense else "lexical"
    logger.info("course_retrieval mode=%s selected_documents=%d hits=%d elapsed_ms=%d",
                mode, len(versions), len(hits), round((perf_counter() - start) * 1000))
    return Retrieval(hits, mode)
