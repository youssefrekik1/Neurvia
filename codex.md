# NEURVIA — Build the Long-Term Document Intelligence and RAG Architecture

We are building FAHM/Neurvia as a scalable educational intelligence platform, not just a hackathon prototype.

The existing frontend, FastAPI backend, educational diagnosis, MindMirror groups, Qwen integration and retest workflows already work. Preserve them.

Repository: https://github.com/youssefrekik1/Neurvia

Implement a production-oriented document intelligence and RAG foundation as part of the professor's lesson preparation workflow.

## Core objective

After a session, a teacher uploads course documents, including handwritten PDFs. The system processes and indexes them, lets the teacher interact with the course through a conversational assistant, and generates grounded diagnostic quizzes.

Every quiz requires final teacher approval.

The architecture must support large document collections, multiple classrooms and potentially multiple universities.

## 1. Migrate to PostgreSQL + pgvector

Replace SQLite as the primary target database for the new architecture.

Use Alembic migrations and provide a safe migration path preserving existing data.

Design relational entities for institutions, classes, lessons, resources, document versions, pages, blocks, chunks, embeddings, conversations, generation briefs and source citations.

Use strict tenant/classroom authorization.

Do not sacrifice existing F1–F5 functionality during migration.

## 2. Build a permanent document ingestion pipeline

Use secure, S3-compatible object storage for original documents, rendered pages and image crops.

Create a processing pipeline supporting:

- Digital PDFs.
- Scanned PDFs.
- Handwritten notes.
- French, English and Arabic material.
- Code, tables, formulas and diagrams.

Combine direct extraction, document-layout analysis, OCR and Qwen's vision capabilities.

Preserve document structure, source pages, block coordinates and original images.

Flag uncertain transcriptions and allow teacher corrections.

Never silently invent unreadable content.

Use durable background workers, progress tracking, retries and idempotent ingestion.

## 3. Implement a complete RAG system now

Do not stop at storing chunks for future RAG.

Implement operational hybrid retrieval:

- Page-aware and structure-aware chunking.
- Local embeddings through Ollama using `qwen3-embedding:0.6b`.
- Dense vector retrieval via pgvector.
- PostgreSQL full-text retrieval.
- Rank fusion, followed by optional reranking.
- Retrieval filtered by institution, classroom, lesson, document and authorization.
- Context assembly with a token budget.
- Verified citations linking results to original pages.

Keep embedding generation, indexing, retrieval, reranking and generation as separate modules.

Track embedding model versions and support reindexing when documents, extraction results or models change.

Use parent-child chunks and preserve code/formula boundaries.

Evaluate retrieval quality on real document sets. Never assume that the highest vector similarity means pedagogical relevance.

## 4. Implement the teacher's conversational course assistant

Integrate a chat into the existing teacher lesson page.

The teacher can ask about uploaded documents and provide quiz-generation instructions.

Support multiple conversation turns.

Extract a structured, editable generation brief containing focus topics, exclusions, question count, difficulty and observed student difficulties.

Use RAG to retrieve source evidence for course-specific answers.

Show source citations.

Treat uploaded documents as untrusted data. A PDF must never be able to override system instructions or teacher permissions.

## 5. Build RAG-grounded diagnostic quiz generation

Use the selected documents, relevant retrieved passages, teacher instructions and approved misconception taxonomy.

Qwen3.5-9B generates structured draft questions.

Require:

- Exactly one correct answer.
- Diagnostic distractors tied to approved misconceptions.
- Verified source pages.
- Explanation and pedagogical objective.
- Validation of answer consistency.
- Detection of unsupported content.
- Explicit teacher review and publication approval.

If the current subject taxonomy is insufficient, require teacher validation of additional concepts and misconceptions instead of inventing diagnostic categories.

Preserve independent question variants for confirmation, retest and J+7.

## 6. Design for institutional deployment

Use modular infrastructure that can run locally through Docker Compose and later on a dedicated server.

Separate API, background workers, database, object storage, retrieval and model-serving concerns.

Avoid tightly coupling the backend to Ollama. Preserve a configurable model-serving interface that can later use vLLM or another compatible backend.

Keep Qwen and embeddings local by default.

Protect student data, enforce document permissions, and implement observability for processing latency, retrieval performance, inference costs, failures and storage usage.

Document GPU memory requirements and concurrency limits. Do not assume that a single 8 GB GPU can process many PDFs and simultaneous LLM requests efficiently.

## 7. Implement and verify incrementally

Stage A: PostgreSQL migration, object storage and document models.

Stage B: Digital PDF extraction, scanned/handwritten OCR and teacher corrections.

Stage C: Embeddings, vector indexing, hybrid retrieval and citation verification.

Stage D: Teacher chat, conversational memory and structured generation briefs.

Stage E: RAG-based quiz generation and final professor approval.

Stage F: Full regression tests, multi-document retrieval evaluation, security testing, real PDF end-to-end tests and deployment documentation.

Keep the application functioning after each stage.

Do not replace working functionality with mocks.

Do not claim success without executing the relevant tests.

Use a feature branch, incremental commits, migrations, and a reviewed pull request.

## Acceptance criteria

The teacher must be able to upload multiple real course PDFs, including handwritten material; review extraction; chat about the course; select a subset of relevant documents; generate a quiz grounded in retrieved passages; inspect source citations; approve the quiz; and publish it.

All existing diagnosis, grouping, remediation and retest workflows must continue functioning.

A second classroom must never retrieve documents belonging to a class it cannot access.

The final architecture must support additional subjects and much larger document collections without replacing the entire retrieval system.

Start by inspecting the current repository, then implement the stages and run the real application end to end.