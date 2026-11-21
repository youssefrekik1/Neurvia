# Neurvia document intelligence handoff

## Project and current checkout

The project is checked out at `C:\Users\user\Desktop\Projects\Neurvia-documents`, on branch `codex/document-intelligence`. It starts from GitHub `main` at commit `6f99cf6`.

The original project checkout is `C:\Users\user\Desktop\Projects\Neurvia-integration`. The running demo from that checkout was left alone. All uncommitted work described here belongs to the separate feature checkout.

The requirements were pasted in `C:\Users\user\.codex\attachments\d46ff20a-1e63-488f-90b6-81216584d2ec\Texte collé.txt`. The request is to add a deployable, tenant-secure document pipeline and RAG assistant to Neurvia lesson preparation, including OCR review and teacher-approved grounded quizzes, while preserving the existing F1–F5 functionality and confirmation/retest/J+7 flows.

## Where work stopped

The implementation is partway through the full request, and has **not** been committed, pushed, or submitted as a pull request. Current changes are unstaged. Do not describe the feature branch or a pull request as finished.

A local API end-to-end exercise did pass on the running services. It uploaded PDF fixtures, processed digital PDFs, a scanned printed PDF, and an image-only synthetic pen-stroke handwriting PDF. It allowed teacher review and correction before indexing, retrieved the expected page, verified source links and selected-document filtering, denied cross-class and student access, exercised two grounded chat turns and a PDF prompt-injection check, extracted and edited the generation brief, generated a grounded question with misconception-coded distractors, rejected publication without teacher approval, and published after approval.

The full live run caught and fixed an S3 streaming error and generation/citation formatting problems. The latest passing end-to-end run used Qwen3.5-9B. The work stopped while building additional retrieval-evaluation coverage and after making newer unverified edits to institutional taxonomy approval, authorization filters, context budgeting, model result caching, concurrency locks, prompt-injection fixture checks, and Compose services.

## Implemented so far

- PostgreSQL/pgvector models, Alembic migrations, and PostgreSQL startup enforcement.
- A SQLite-to-PostgreSQL copy utility that treats the SQLite input as read-only, checks integrity and foreign keys, requires an empty migrated target, copies in a transaction, and verifies row counts. A populated local fixture was copied to a disposable PostgreSQL database.
- Private S3-compatible storage for original PDFs, rendered pages, and image crops. Local Compose uses SeaweedFS.
- Durable worker jobs with leases, retries, progress reporting, stale-revision checks, and idempotency.
- Digital text/layout extraction, code/table/figure detection, OCR, literal Qwen vision transcription, teacher review/correction, and revision-aware indexing.
- Qwen embeddings, pgvector vector search, PostgreSQL full-text search, rank fusion, optional reranking, bounded context, document/class authorization filters, source verification, and page citations.
- Persistent teacher chat, editable structured generation briefs, quiz drafting, source/objective citations, and an explicit teacher approval and publish gate.
- Institution provisioning, institution selection during class creation, and teacher-approved institution-specific concepts and misconceptions.
- Docker Compose for API, worker, PostgreSQL, and S3-compatible storage, plus an optional frontend profile.
- Next.js document, chat, extraction-review and grounded-quiz UI on the teacher lesson page. The backend proxy handles multipart uploads and private binary streaming.

Main code locations include `apps/api/app/documents/`, `apps/api/app/routers/documents.py`, `apps/api/app/routers/course_assistant.py`, `apps/api/app/models/documents.py`, `apps/api/alembic/`, `src/learning/CourseDocuments.tsx`, `src/learning/Teacher.tsx`, and `compose.documents.yml`.

## Verification that completed

- Existing backend regression suite: **17 passed**.
- Docker API and worker image build and Alembic migration completed.
- A populated SQLite fixture migrated successfully to the disposable PostgreSQL test database `neurvia_migration_test`.
- Live PDF upload through the Next.js proxy, original download byte integrity, deduplication, private object access, OCR, Qwen vision, manual teacher review, correction, and indexing were exercised.
- Live hybrid retrieval ranked the known source page first. Document subsets, student access, a second classroom, and citation links were tested.
- Live Qwen chat, brief extraction, one grounded diagnostic item, source citations, publication rejection without approval, and teacher-approved publication passed in the integration harness.

## Remaining work

1. Re-run full checks after the newest changes. Rebuild Docker and run `alembic upgrade head`, `python -m pytest -q`, TypeScript generation, `npm run typecheck`, `npm run lint`, and `npm run build`. Rerun the full live exercise: `python -m tools.check_documents --web http://localhost:3151`, from `apps/api`. Confirm the running API and worker have the latest rebuilt code.

2. Verify the browser workflow visually end to end. Check teacher login, class creation, institution selection, lesson document upload, polling, source-page preview, scanned-text editing, manual review and re-indexing, chat and citations, brief editing, grounded quiz review, and the approval/publish action. Test the new teacher-approved taxonomy form.

3. Complete the real document retrieval evaluation. Three MIT OpenCourseWare PDFs are in the projectless work folder `C:\Users\user\Documents\Codex\2026-11-21\wor\work\document-corpus`: `mit-lists.pdf`, `mit-while.pdf`, and `mit-break.pdf`. Add an `expectations.json` file with queries and expected page numbers, then extend and run the integration harness for Recall@5 and MRR@5. Preliminary PDF inspection identified likely target pages 6, 3, and 1. Confirm retrieved pages using actual ingested page numbering.

4. Verify institutional and taxonomy boundaries. Exercise `python -m tools.provision_institution`, teacher membership, institution assignment on classroom creation, student class membership, approved custom taxonomy visibility, and unauthorized teachers. Check SQLite migration on both accepted and rejected source/target states. Review whether seeded global taxonomy visibility is appropriate for institutional deployment.

5. Write `docs/DOCUMENTS.md`. It should cover environment variables, local Compose and optional frontend, secrets, backups for PostgreSQL and object storage, SQLite import, OCR languages, worker retries, re-indexing and embedding-model revisions, institution provisioning, access controls, operations/observability, troubleshooting, and model/GPU capacity limits. Describe local development credentials as unsuitable for production. The available GPU is an 8 GB GeForce RTX 4060 Laptop GPU, so do not imply untested high concurrency.

6. Inspect the final diff. Run `git diff --check`; compare generated OpenAPI and TypeScript contracts; remove incidental Next.js changes to `next-env.d.ts` if they are build-generated; inspect all new code and generated files; ensure no local database, corpus PDFs, secrets, or credentials are staged.

7. Commit in incremental steps, push `codex/document-intelligence`, and open a pull request for review. The requested work does not authorize merging it. No commits or remote pull request exist yet.

8. Preserve the existing demo in `C:\Users\user\Desktop\Projects\Neurvia-integration`. Its files were not used as the working checkout for this feature.

## Current local services

The Docker services are running from this feature checkout. The API is on `http://127.0.0.1:8010`, PostgreSQL on port `55432`, and the S3-compatible endpoint on port `59000`. The local Ollama instance contains `qwen3-embedding:0.6b` and `qwen3.5:9b`.

The standalone Next development server was started on port 3151 and pointed to the API earlier in testing. Confirm it is still alive before using it. The existing demo is separate.

From the feature checkout:

```powershell
docker compose -f compose.documents.yml up -d --build
```

For the containerized web frontend:

```powershell
docker compose -f compose.documents.yml --profile web up -d --build
```

The frontend Dockerfile expects `public` assets. Check the directory exists before relying on the profile.

Backend regression test:

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest -q
```

End-to-end test:

```powershell
.\.venv\Scripts\python.exe -m tools.check_documents --web http://localhost:3151
```

Generate local PDF fixtures:

```powershell
.\.venv\Scripts\python.exe -m tools.check_documents --fixtures ..\..\work\document-fixtures --skip-generation
```

The pen-stroke fixture is synthetically drawn. It verifies the vision-processing and teacher-review route, but it does not establish transcription quality for arbitrary real handwriting. The evaluation corpus PDFs are local only and must not be staged.
