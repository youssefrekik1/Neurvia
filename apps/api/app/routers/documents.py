from hashlib import sha256
from pathlib import PurePath
from typing import Annotated
from uuid import UUID

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, File, Form, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from app.core.auth import Teacher
from app.core.errors import documented_errors, error
from app.db.session import Db
from app.documents.access import document_for, object_store, scope_for
from app.documents.worker import enqueue
from app.models.documents import DocumentBlock, DocumentJob, DocumentPage, DocumentVersion, Resource
from app.schemas.documents import BlockCorrection, BlockView, DocumentReview, DocumentView, PageView, Usage

router = APIRouter(prefix="/lessons/{lesson_id}/documents", tags=["Documents de cours"],
                   responses=documented_errors(401, 403, 404, 409, 413, 415, 422, 429, 503))


def doc_view(db, version, resource):
    job = db.scalar(select(DocumentJob).where(
        DocumentJob.version_id == version.id, DocumentJob.revision == version.revision
    ).order_by(DocumentJob.created_at.desc(), DocumentJob.id.desc()).limit(1))
    return DocumentView(
        id=version.id, resource_id=resource.id, name=resource.name, number=version.number,
        state=version.state, revision=version.revision, page_count=version.page_count,
        byte_size=version.byte_size, model_revision=version.model_revision, created_at=version.created_at,
        progress=job.progress if job else 0, attempts=job.attempts if job else 0,
        job_kind=job.kind if job else None, failure=version.failure,
    )


@router.get("", response_model=list[DocumentView])
def list_documents(lesson_id: UUID, user: Teacher, db: Db,
                   limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)):
    scope = scope_for(db, user, lesson_id)
    if scope is None:
        return []
    rows = db.execute(select(DocumentVersion, Resource).select_from(DocumentVersion)
                      .join(Resource, Resource.id == DocumentVersion.resource_id)
                      .where(*scope.filters()).order_by(DocumentVersion.created_at.desc(), DocumentVersion.id)
                      .limit(limit).offset(offset))
    return [doc_view(db, version, resource) for version, resource in rows]


@router.post("", response_model=DocumentView, status_code=202)
def upload(lesson_id: UUID, request: Request, user: Teacher, db: Db,
           file: Annotated[UploadFile, File()],
           resource_id: Annotated[UUID | None, Form()] = None):
    request.app.state.rate_limiter.check(request, "document_upload", 30, subject=user.id)
    # Authorize before consulting storage or revealing any parse error. Creating the tenant is committed
    # at once so that the write lock is not held while the PDF is read and stored.
    scope = scope_for(db, user, lesson_id, create=True)
    db.commit()
    count = request.app.state.settings.document_max_upload_mb * 1024 * 1024
    try:
        data = file.file.read(count + 1)
    finally:
        file.file.close()
    if len(data) > count:
        raise error(413)
    if not data.startswith(b"%PDF-"):
        raise error(415)
    digest = sha256(data).hexdigest()
    if resource_id is not None and db.scalar(
        select(Resource.id).where(Resource.id == resource_id, *scope.filters())
    ) is None:
        raise error(404)

    def existing():
        return db.execute(select(DocumentVersion, Resource).select_from(DocumentVersion)
                          .join(Resource, Resource.id == DocumentVersion.resource_id)
                          .where(DocumentVersion.sha256 == digest, *scope.filters())).one_or_none()

    if existing() is None:
        db.rollback()
        # The key depends only on the tenant and the content, so a concurrent duplicate rewrites the same bytes.
        store = object_store(request)
        try:
            store.ensure_bucket()
            store.put(f"{scope.prefix}/originals/{digest}.pdf", data, "application/pdf")
        except (ClientError, BotoCoreError):
            raise error(503, "DOCUMENT_STORAGE_UNAVAILABLE", "Le stockage des documents ne répond pas.") from None
    db.rollback()
    scope = scope_for(db, user, lesson_id, create=True)
    key = f"{scope.prefix}/originals/{digest}.pdf"
    if resource_id is not None:
        resource = db.scalar(select(Resource).where(Resource.id == resource_id, *scope.filters()))
        if resource is None:
            raise error(404)
    else:
        resource = None
    previous = existing()
    if previous is not None:
        old, owner = previous
        if resource is not None and old.resource_id != resource.id:
            raise error(409, "DOCUMENT_ALREADY_PRESENT", "Ce PDF appartient déjà à un autre document de la séance.")
        return doc_view(db, old, owner)
    if resource is None:
        name = PurePath((file.filename or "Document.pdf").replace("\\", "/")).name[:200]
        resource = Resource(institution_id=scope.institution_id, classroom_id=scope.classroom_id,
                            lesson_id=lesson_id, owner_id=user.id, name=name or "Document.pdf")
        db.add(resource)
        db.flush()
    number = db.scalar(select(func.max(DocumentVersion.number)).where(DocumentVersion.resource_id == resource.id)) or 0
    version = DocumentVersion(resource_id=resource.id, lesson_id=lesson_id, number=number + 1,
                              sha256=digest, object_key=key, byte_size=len(data))
    db.add(version)
    db.flush()
    enqueue(db, version, "extract")
    db.commit()
    return doc_view(db, version, resource)


@router.get("/usage", response_model=Usage)
def usage(lesson_id: UUID, user: Teacher, db: Db):
    scope = scope_for(db, user, lesson_id)
    if scope is None:
        return Usage(originals_bytes=0, rendered_bytes=0, crops_bytes=0, versions=0)
    ids = select(DocumentVersion.id).join(Resource).where(*scope.filters())
    pages = select(DocumentPage.id).where(DocumentPage.version_id.in_(ids))
    return Usage(
        originals_bytes=db.scalar(select(func.coalesce(func.sum(DocumentVersion.byte_size), 0))
                                  .where(DocumentVersion.id.in_(ids))),
        rendered_bytes=db.scalar(select(func.coalesce(func.sum(DocumentPage.image_bytes), 0))
                                 .where(DocumentPage.id.in_(pages))),
        crops_bytes=db.scalar(select(func.coalesce(func.sum(DocumentBlock.image_bytes), 0))
                              .where(DocumentBlock.page_id.in_(pages))),
        versions=db.scalar(select(func.count()).select_from(DocumentVersion).where(DocumentVersion.id.in_(ids))),
    )


@router.get("/{version_id}", response_model=DocumentView)
def document_status(lesson_id: UUID, version_id: UUID, user: Teacher, db: Db):
    version, resource = document_for(db, scope_for(db, user, lesson_id), version_id)
    return doc_view(db, version, resource)


def page_for(db, version, number):
    page = db.scalar(select(DocumentPage).where(DocumentPage.version_id == version.id, DocumentPage.number == number))
    if page is None:
        raise error(404)
    return page


def page_path(lesson_id, version_id, number):
    return f"/lessons/{lesson_id}/documents/{version_id}/pages/{number}/render"


@router.get("/{version_id}/pages/{number}", response_model=PageView)
def document_page(lesson_id: UUID, version_id: UUID, number: int, user: Teacher, db: Db):
    version, _ = document_for(db, scope_for(db, user, lesson_id), version_id)
    page = page_for(db, version, number)
    rows = db.scalars(select(DocumentBlock).where(DocumentBlock.page_id == page.id).order_by(DocumentBlock.position))
    return PageView(
        number=page.number, width=page.width, height=page.height, image_path=page_path(lesson_id, version_id, number),
        blocks=[BlockView(id=row.id, kind=row.kind, bounds=row.bounds, text=row.text,
                          extracted_text=row.extracted_text, method=row.method, confidence=row.confidence,
                          review_required=row.review_required, has_image=bool(row.image_key)) for row in rows],
    )


def serve_object(request, key, content_type, attachment=False):
    store = object_store(request)
    try:
        result = store.fetch(key)
    except (ClientError, BotoCoreError):
        raise error(503, "DOCUMENT_STORAGE_UNAVAILABLE", "Le document ne peut pas être lu.") from None
    headers = {"Content-Length": str(result["ContentLength"]), "Cache-Control": "private, no-store",
               "X-Content-Type-Options": "nosniff"}
    if attachment:
        headers["Content-Disposition"] = 'attachment; filename="cours.pdf"'
    return StreamingResponse(store.stream(result), media_type=content_type, headers=headers)


@router.get("/{version_id}/original", response_class=StreamingResponse)
def original(lesson_id: UUID, version_id: UUID, user: Teacher, db: Db, request: Request):
    version, _ = document_for(db, scope_for(db, user, lesson_id), version_id)
    return serve_object(request, version.object_key, "application/pdf", attachment=True)


@router.get("/{version_id}/pages/{number}/render", response_class=StreamingResponse)
def render_page(lesson_id: UUID, version_id: UUID, number: int, user: Teacher, db: Db, request: Request):
    version, _ = document_for(db, scope_for(db, user, lesson_id), version_id)
    return serve_object(request, page_for(db, version, number).image_key, "image/png")


@router.get("/{version_id}/blocks/{block_id}/image", response_class=StreamingResponse)
def block_image(lesson_id: UUID, version_id: UUID, block_id: UUID, user: Teacher, db: Db, request: Request):
    version, _ = document_for(db, scope_for(db, user, lesson_id), version_id)
    block = block_for(db, version, block_id)
    if not block.image_key:
        raise error(404)
    return serve_object(request, block.image_key, "image/png")


def block_for(db, version, block_id):
    row = db.scalar(select(DocumentBlock).join(DocumentPage).where(
        DocumentBlock.id == block_id, DocumentPage.version_id == version.id
    ))
    if row is None:
        raise error(404)
    return row


def editable_version(db, user, lesson_id, version_id, revision):
    version, resource = document_for(db, scope_for(db, user, lesson_id, create=True), version_id)
    db.refresh(version, with_for_update=True)
    if version.revision != revision or version.state == "processing":
        raise error(409, "DOCUMENT_CHANGED", "Le document a changé. Actualisez avant de poursuivre.")
    return version, resource


@router.patch("/{version_id}/blocks/{block_id}", response_model=DocumentView)
def correct(lesson_id: UUID, version_id: UUID, block_id: UUID, body: BlockCorrection,
            user: Teacher, db: Db, request: Request):
    version, resource = editable_version(db, user, lesson_id, version_id, body.revision)
    block = block_for(db, version, block_id)
    block.text, block.review_required = body.text, False
    block.reviewed_by, block.reviewed_at = user.id, request.app.state.system_clock.now()
    version.revision += 1
    version.state, version.failure = "review", None
    db.commit()
    return doc_view(db, version, resource)


@router.post("/{version_id}/review", response_model=DocumentView)
def approve_extraction(lesson_id: UUID, version_id: UUID, body: DocumentReview, user: Teacher, db: Db):
    version, resource = editable_version(db, user, lesson_id, version_id, body.revision)
    if not body.validated:
        raise error(409, "TEACHER_VALIDATION_REQUIRED", "Confirmez la relecture du document.")
    remaining = db.scalar(select(DocumentBlock.id).join(DocumentPage)
                          .where(DocumentPage.version_id == version.id, DocumentBlock.review_required).limit(1))
    if remaining or not version.page_count:
        raise error(409, "TRANSCRIPTION_REVIEW_REQUIRED", "Relisez chaque passage incertain avant l’indexation.")
    if version.state == "ready":
        version.revision += 1
    if version.state == "failed":
        version.revision += 1
    version.state, version.failure = "queued", None
    enqueue(db, version, "index")
    db.commit()
    return doc_view(db, version, resource)


@router.post("/{version_id}/retry", response_model=DocumentView)
def retry(lesson_id: UUID, version_id: UUID, body: DocumentReview, user: Teacher, db: Db):
    version, resource = editable_version(db, user, lesson_id, version_id, body.revision)
    if not body.validated or version.state != "failed":
        raise error(409, "DOCUMENT_NOT_FAILED", "Ce document n’est pas en échec.")
    version.revision += 1
    version.state, version.failure = "queued", None
    enqueue(db, version, "index" if version.page_count else "extract")
    db.commit()
    return doc_view(db, version, resource)
