from sqlalchemy import select

from app.core.errors import error
from app.documents.retrieval import Evidence
from app.models.documents import DocumentChunk, DocumentPage, DocumentVersion, Resource, SourceCitation


def save_sources(db, references, *, message_id=None, question_id=None, objective=None):
    for hit, quote in references:
        db.add(SourceCitation(message_id=message_id, question_id=question_id, chunk_id=hit.chunk_id,
                              page_id=hit.page_id, quote=quote, objective=objective))


def source_records(db, clause):
    rows = db.execute(
        select(SourceCitation, DocumentChunk, DocumentPage.number, DocumentVersion, Resource)
        .select_from(SourceCitation)
        .join(DocumentChunk, DocumentChunk.id == SourceCitation.chunk_id)
        .join(DocumentPage, DocumentPage.id == SourceCitation.page_id)
        .join(DocumentVersion, DocumentVersion.id == DocumentChunk.version_id)
        .join(Resource, Resource.id == DocumentVersion.resource_id)
        .where(clause).order_by(SourceCitation.created_at, SourceCitation.id)
    )
    return list(rows)


def source_views(db, clause):
    return [
        Evidence(chunk.id, row.page_id, version.id, chunk.revision, resource.name, number,
                 chunk.text, 0, resource.lesson_id).source(row.quote, row.objective)
        for row, chunk, number, version, resource in source_records(db, clause)
    ]


def require_fresh(db, references, scope):
    versions = {version.id: version for version in db.scalars(
        select(DocumentVersion).join(Resource)
        .where(DocumentVersion.id.in_({hit.document_id for hit, _ in references}), *scope.filters())
        .order_by(DocumentVersion.id).with_for_update(of=DocumentVersion)
    )}
    if any(
        (version := versions.get(hit.document_id)) is None or
        version.state != "ready" or version.indexed_revision != hit.revision or version.revision != hit.revision
        for hit, _ in references
    ):
        raise error(409, "COURSE_SOURCES_CHANGED", "Une source a changé. Relancez la génération.")


def question_references(db, question_id):
    rows = source_records(db, SourceCitation.question_id == question_id)
    return [
        (Evidence(chunk.id, row.page_id, version.id, chunk.revision, resource.name, number,
                  chunk.text, 0, resource.lesson_id), row.quote)
        for row, chunk, number, version, resource in rows
    ]
