"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FileText, MessageSquare } from "lucide-react";
import { api, errorMessage, refresh, useGet, type Schema } from "../lib/api";

type Document = Schema["DocumentView"];
type Conversation = Schema["ConversationView"];

const states: Record<Document["state"], string> = {
  queued: "En attente", processing: "Traitement", review: "Extraction à vérifier",
  ready: "Indexé", failed: "Échec",
};

const failures: Record<string, string> = {
  invalid_pdf: "Le fichier n’a pas pu être lu comme un PDF.",
  encrypted_or_page_limit: "Le PDF est protégé par un mot de passe ou dépasse le nombre de pages autorisé.",
  transcription_requires_review: "Des passages restent à relire avant l’indexation.",
  lease_expired: "Le traitement a été interrompu à plusieurs reprises.",
};

function failureText(doc: Document) {
  if (!doc.failure) return "";
  const known = failures[doc.failure];
  if (doc.state === "queued") return (known ?? "Erreur temporaire du service.") + " Nouvelle tentative automatique.";
  return known ?? "Le traitement a échoué (" + doc.failure + "). Vous pouvez le relancer.";
}

export function Sources({ sources }: { sources: Schema["SourceView"][] }) {
  if (!sources.length) return null;
  return <ul className="lr-doc-sources">{sources.map((source, index) =>
    <li key={source.path + index}>
      <a href={"/backend" + source.path} target="_blank" rel="noreferrer">{source.title} · page {source.page}</a>
      {source.objective && <div>Objectif. {source.objective}</div>}
      <blockquote>{source.quote}</blockquote>
    </li>,
  )}</ul>;
}

function PageReview({ root, document, busy, run }: {
  root: string; document: Document; busy: boolean;
  run: (operation: () => Promise<unknown>) => Promise<void>;
}) {
  const [number, setNumber] = useState(1);
  const [confirmed, setConfirmed] = useState(false);
  const path = root + "/" + document.id;
  const page = useGet<Schema["PageView"]>(path + "/pages/" + number);
  return <div className="lr-doc-review">
    <div className="lr-actions">
      <button className="lr-btn" disabled={number <= 1} onClick={() => setNumber(number - 1)}>Page précédente</button>
      <span>Page {number} / {document.page_count}</span>
      <button className="lr-btn" disabled={number >= document.page_count} onClick={() => setNumber(number + 1)}>Page suivante</button>
    </div>
    {page.error && <p role="alert">{page.error}</p>}
    {page.value && <div className="lr-doc-review-grid">
      {/* The browser uses its session cookie to access the private page renderer. */}
      <img src={"/backend" + page.value.image_path} alt={"Page " + number + " du PDF"} />
      <div>
        {page.value.blocks.map((block) => <form className="lr-doc-block" key={block.id + ":" + document.revision}
          onSubmit={(event) => {
            event.preventDefault();
            const text = String(new FormData(event.currentTarget).get("text") ?? "");
            setConfirmed(false);
            void run(() => api(path + "/blocks/" + block.id, "PATCH", { revision: document.revision, text }));
          }}>
          <label>
            {block.kind} · {block.method}{block.review_required ? " · À vérifier" : ""}
            <textarea name="text" rows={3} defaultValue={block.text} maxLength={24000}
              readOnly={document.state !== "review" && document.state !== "ready"} />
          </label>
          {block.has_image && <a href={"/backend" + path + "/blocks/" + block.id + "/image"} target="_blank" rel="noreferrer">
            Afficher le bloc original
          </a>}
          {(document.state === "review" || document.state === "ready") &&
            <button className="lr-btn" disabled={busy}>Enregistrer la transcription</button>}
        </form>)}
      </div>
    </div>}
    {document.state === "review" && <div className="lr-actions">
      <label className="lr-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        J’ai vérifié la transcription par rapport aux pages du PDF.
      </label>
      <button className="lr-btn primary" disabled={!confirmed || busy}
        onClick={() => void run(() => api(path + "/review", "POST", { revision: document.revision, validated: true }))}>
        Valider et indexer
      </button>
    </div>}
  </div>;
}

const fields = [
  ["focus_topics", "Thèmes à évaluer"], ["exclusions", "À exclure"], ["observed_difficulties", "Difficultés observées"],
] as const;

function BriefForm({ conversation, busy, allowQuiz, hasSelection, save, extract, generate }: {
  conversation: Conversation; busy: boolean; allowQuiz: boolean; hasSelection: boolean;
  save: (brief: Schema["BriefUpdate"]) => void; extract: () => void; generate: () => void;
}) {
  const { brief } = conversation;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const lines = (name: string) => String(data.get(name) ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    save({
      revision: conversation.brief_revision,
      focus_topics: lines("focus_topics"), exclusions: lines("exclusions"),
      observed_difficulties: lines("observed_difficulties"),
      question_count: Number(data.get("question_count")), difficulty: Number(data.get("difficulty")),
    });
  }
  return <form onSubmit={submit} className="lr-form lr-doc-brief">
    <h3>Consignes de génération</h3>
    {fields.map(([name, label]) => <label key={name}>{label} (un élément par ligne)
      <textarea name={name} rows={2} defaultValue={brief[name]?.join("\n")} />
    </label>)}
    <div className="lr-actions">
      <label>Nombre de questions
        <input name="question_count" type="number" min={1} max={10} required defaultValue={brief.question_count ?? 4} />
      </label>
      <label>Difficulté
        <select name="difficulty" defaultValue={brief.difficulty ?? 1}>
          <option value={1}>Essentiel</option><option value={2}>Intermédiaire</option><option value={3}>Approfondi</option>
        </select>
      </label>
    </div>
    <div className="lr-actions">
      <button className="lr-btn" disabled={busy}>Enregistrer les consignes</button>
      <button className="lr-btn" type="button" disabled={busy || !conversation.messages.length} onClick={extract}>
        Extraire les consignes de la conversation
      </button>
      {allowQuiz && <button className="lr-btn primary" type="button" disabled={!hasSelection || busy} onClick={generate}>
        Générer le quiz à partir des PDF
      </button>}
    </div>
  </form>;
}

function TaxonomyForm({ path, busy, run }: {
  path: string; busy: boolean; run: (operation: () => Promise<unknown>) => Promise<void>;
}) {
  const [count, setCount] = useState(1);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const misconceptions = Array.from({ length: count }, (_, index) => ({
      label: String(values.get("label-" + index) ?? ""),
      remediation_hint: String(values.get("remediation-" + index) ?? ""),
    }));
    const data: Schema["TaxonomyApproval"] = {
      label: String(values.get("concept") ?? ""), misconceptions, validated: values.has("validated"),
    };
    void run(async () => {
      await api(path, "POST", data);
      form.reset();
      setCount(1);
    });
  }
  return <details>
    <summary>Valider une notion et ses erreurs diagnostiques</summary>
    <form className="lr-form" onSubmit={submit}>
      <label>Notion<input name="concept" required maxLength={200} /></label>
      {Array.from({ length: count }, (_, index) => <fieldset key={index}>
        <legend>Erreur diagnostique {index + 1}</legend>
        <label>Erreur observée<input name={"label-" + index} required maxLength={200} /></label>
        <label>Piste de remédiation<input name={"remediation-" + index} required maxLength={400} /></label>
      </fieldset>)}
      <button className="lr-btn" type="button" disabled={busy || count >= 8} onClick={() => setCount(count + 1)}>
        Ajouter une erreur diagnostique
      </button>
      <label className="lr-check"><input type="checkbox" name="validated" required />
        J’ai vérifié la notion et les erreurs proposées.
      </label>
      <button className="lr-btn" disabled={busy}>Valider et ajouter à la séance</button>
    </form>
  </details>;
}

export function CourseDocuments({ lessonId, allowQuiz, hasGroundedQuiz, allowTaxonomy }: {
  lessonId: string; allowQuiz: boolean; hasGroundedQuiz?: boolean; allowTaxonomy: boolean;
}) {
  const base = "/lessons/" + lessonId;
  const root = base + "/documents";
  const assistant = base + "/course-assistant";
  const docs = useGet<Document[]>(root);
  const stored = useGet<Conversation | null>(assistant);
  const [conversation, setConversation] = useState<Conversation>();
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState("");
  const [replacement, setReplacement] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState(false);
  const current = conversation ?? stored.value;
  const pending = !!docs.value?.some((doc) => doc.state === "processing" || doc.state === "queued");
  const documentIds = selected.filter((id) => docs.value?.some((doc) => doc.id === id && doc.state === "ready"));
  const selection = { document_ids: documentIds };
  const ready = documentIds.length > 0;
  const resources = [...new Map((docs.value ?? []).map((doc) => [doc.resource_id, doc.name]))];

  useEffect(() => {
    if (!pending) return;
    const id = setInterval(refresh, 3500);
    return () => clearInterval(id);
  }, [pending]);

  async function run(operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setStatus("");
    try { await operation(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { refresh(); setBusy(false); }
  }

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const files = new FormData(form).getAll("files").filter((file): file is File => file instanceof File && file.size > 0);
    void run(async () => {
      if (replacement && files.length !== 1) throw new Error("Choisissez un seul PDF pour cette nouvelle version.");
      for (const file of files) {
        const data = new FormData();
        data.set("file", file);
        if (replacement) data.set("resource_id", replacement);
        await api(root, "POST", data);
      }
      form.reset();
      setReplacement("");
      setStatus("PDF transmis au traitement.");
    });
  }

  function update(path: string, method: string, data?: unknown) {
    return run(async () => setConversation(await api<Conversation>(assistant + path, method, data)));
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = String(new FormData(form).get("message") ?? "").trim();
    void run(async () => {
      const chat = current ?? await api<Conversation>(assistant, "POST");
      setConversation(chat);
      setConversation(await api<Conversation>(assistant + "/" + chat.id + "/messages", "POST", { ...selection, message }));
      form.reset();
    });
  }

  function generate() {
    if (!current) return;
    void run(async () => {
      const count = current.brief.question_count ?? 4;
      for (let index = 0; index < count; index++) {
        const quiz = await api<Schema["TeacherQuiz"]>(assistant + "/quiz", "POST", {
          ...selection, conversation_id: current.id, brief_revision: current.brief_revision, question_count: 1,
        });
        setGenerated(quiz.questions.length > 0);
        setStatus("Questions générées · " + (index + 1) + " / " + count);
        if (quiz.questions.length >= 10) break;
      }
      setStatus("Brouillon disponible pour la relecture.");
    });
  }

  return <section id="documents" className="lr-panel lr-pad lr-docs">
    <div className="lr-section-title"><FileText /><h2>Documents de cours</h2></div>
    <form className="lr-form" onSubmit={upload}>
      <label>Ajouter des PDF<input name="files" type="file" accept=".pdf,application/pdf" multiple={!replacement} required /></label>
      {!!resources.length && <label>Version du document
        <select value={replacement} onChange={(event) => setReplacement(event.target.value)}>
          <option value="">Nouveau document</option>
          {resources.map(([id, name]) => <option key={id} value={id}>Nouvelle version de {name}</option>)}
        </select>
      </label>}
      <button className="lr-btn" disabled={busy}>Importer les PDF</button>
    </form>
    {docs.error && <p role="alert" className="lr-error">{docs.error}</p>}
    {!!docs.value?.length && <fieldset className="lr-doc-list">
      <legend>Sources sélectionnées pour l’assistant et le quiz</legend>
      {docs.value.map((doc) => <div key={doc.id} className="lr-doc-entry">
        <div className="lr-actions">
          <label className="lr-check">
            <input type="checkbox" disabled={doc.state !== "ready" || busy} checked={documentIds.includes(doc.id)}
              onChange={(event) => setSelected(event.target.checked ? [...selected, doc.id] : selected.filter((id) => id !== doc.id))} />
            {doc.name} · v{doc.number}
          </label>
          <span className="lr-doc-state" data-state={doc.state}>
            {states[doc.state]}{doc.state === "processing" && " · " + doc.progress + " %"}
          </span>
          <a href={"/backend" + root + "/" + doc.id + "/original"}>PDF original</a>
          {doc.page_count > 0 && <button className="lr-btn" aria-expanded={open === doc.id} onClick={() => setOpen(open === doc.id ? "" : doc.id)}>
            {open === doc.id ? "Fermer les pages" : "Voir les pages"}
          </button>}
          {doc.state === "ready" && <button className="lr-btn" disabled={busy}
            onClick={() => void run(() => api(root + "/" + doc.id + "/review", "POST", { revision: doc.revision, validated: true }))}>
            Réindexer
          </button>}
          {doc.state === "failed" && <button className="lr-btn" disabled={busy}
            onClick={() => void run(() => api(root + "/" + doc.id + "/retry", "POST", { revision: doc.revision, validated: true }))}>
            Relancer
          </button>}
        </div>
        {doc.failure && <p role="status">{failureText(doc)}</p>}
        {open === doc.id && <PageReview key={doc.id} root={root} document={doc} busy={busy} run={run} />}
      </div>)}
    </fieldset>}
    <div className="lr-section-title"><MessageSquare /><h2>Assistant de cours</h2></div>
    {stored.error && <p role="alert" className="lr-error">{stored.error}</p>}
    <ol className="lr-doc-chat" aria-live="polite">
      {current?.messages.map((message) => <li key={message.id}>
        <b>{message.role === "teacher" ? "Vous" : "Assistant"}</b>
        <p>{message.text}</p><Sources sources={message.sources} />
      </li>)}
    </ol>
    <form className="lr-form" onSubmit={send}>
      <label>Question ou consigne sur les PDF sélectionnés<textarea name="message" minLength={2} maxLength={4500} rows={3} required /></label>
      <div className="lr-actions">
        <button className="lr-btn primary" disabled={!ready || busy}>Envoyer</button>
        {!current && <button className="lr-btn" type="button" disabled={busy} onClick={() => void update("", "POST")}>Ouvrir les consignes</button>}
      </div>
    </form>
    {allowTaxonomy && <TaxonomyForm path={base + "/taxonomy"} busy={busy} run={run} />}
    {current && <BriefForm key={current.id + ":" + current.brief_revision} conversation={current}
      busy={busy} allowQuiz={allowQuiz} hasSelection={ready} generate={generate}
      save={(brief) => void update("/" + current.id + "/brief", "PATCH", brief)}
      extract={() => void update("/" + current.id + "/brief/extract", "POST")} />}
    {(generated || hasGroundedQuiz) && <a className="lr-btn" href={"/teacher/quiz?lesson=" + lessonId + "&step=review"}>
      Relire le quiz et ses sources
    </a>}
    {busy && <p role="status">Opération en cours…</p>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert" className="lr-error">{error}</p>}
  </section>;
}
