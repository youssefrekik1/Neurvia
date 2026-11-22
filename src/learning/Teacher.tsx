"use client";
import { useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FileText,
  Layers3,
  ListChecks,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import { levels, type Level, type Question } from "./bank";
import { blankLesson, dayLabel, defaultSubject, lessonHref, prepareQuiz, saveLesson, saveQuestion,
  subjectLabel, type Lesson, type LearningData } from "./service";
import { api, errorMessage, refresh, type Schema, useGet } from "../lib/api";
import { Empty, Heading, Prompt, Stepper } from "./ui";
import { CourseDocuments, Sources, TaxonomyForm } from "./CourseDocuments";

const editorHref = (id: string, step = "review") =>
  "/teacher/quiz?lesson=" + encodeURIComponent(id) + "&step=" + step;
function rememberClass(value: string) {
  try {
    localStorage.setItem("neurvia.classroom", value);
  } catch {
    /* Current session still works. */
  }
}
function Tags({ items }: { items: string[] }) {
  return (
    <div className="lr-tags">
      {items.map((t) => (
        <span key={t}>{t}</span>
      ))}
    </div>
  );
}
function Status({ lesson }: { lesson: Lesson }) {
  return (
    <span
      className={
        "lr-status " + (lesson.status === "published" ? "green" : "amber")
      }
    >
      <i />
      {lesson.status === "published" ? "Publiée" : lesson.status === "closed" ? "Fermée" : "Brouillon"}
    </span>
  );
}

export function TeacherLessons({
  classroom,
  data,
}: {
  classroom: string;
  data: LearningData;
}) {
  const [filter, setFilter] = useState("Toutes");
  const lessons = data.lessons
    .filter(
      (l) =>
        l.classroom === classroom &&
        (filter === "Toutes" ||
          (filter === "Brouillons"
            ? l.status === "draft"
            : l.status === "published")),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <Heading
        title="Séances & quiz"
        description="Préparez vos séances, relisez les questions et publiez vos quiz."
        action={
          <a className="lr-btn primary" href="/teacher/lessons/new">
            <Plus size={17} />
            Nouvelle séance
          </a>
        }
      />
      <div className="lr-filters" role="group" aria-label="Filtrer les séances">
        {["Toutes", "Publiées", "Brouillons"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={filter === f ? "active" : ""}
          >
            {f}
          </button>
        ))}
      </div>
      {lessons.length ? (
        <div className="lr-panel">
          <div className="lr-panel-head">
            <h2>Mes séances</h2>
            <small>
              {lessons.length} séance{lessons.length > 1 ? "s" : ""}
            </small>
          </div>
          <div className="lr-list">
            {lessons.map((l) => (
              <a className="lr-item" key={l.id} href={lessonHref(l.id)}>
                <span className="lr-symbol">
                  <BookOpen size={19} />
                </span>
                <div className="lr-grow">
                  <b>{l.title}</b>
                  <small>
                    {l.subject} · {dayLabel(l.date, true)}
                  </small>
                </div>
                <Status lesson={l} />
                <ChevronRight size={16} />
              </a>
            ))}
          </div>
        </div>
      ) : (
        <Empty title="Aucune séance dans cette vue">
          Créez une séance pour préparer votre premier quiz.
        </Empty>
      )}
    </>
  );
}
export function LessonDetail({
  lesson,
  published,
}: {
  lesson?: Lesson;
  published: boolean;
}) {
  if (!lesson)
    return (
      <Empty
        title="Séance introuvable"
        action={
          <a href="/teacher/lessons" className="lr-btn">
            Retour aux séances
          </a>
        }
      />
    );
  return (
    <>
      <Heading
        title={lesson.title}
        description={lesson.subject + " · " + lesson.classroomName}
        back={["/teacher/lessons", "Séances & quiz"]}
        action={<Status lesson={lesson} />}
      />
      {published && (
        <div className="lr-notice positive" role="status">
          <CheckCircle2 size={19} />
          Le quiz est publié. Les étudiants de cette classe peuvent le
          commencer.
        </div>
      )}
      <div className="lr-columns">
        <section className="lr-panel lr-pad">
          <div className="lr-section-title">
            <FileText />
            <h2>Contenu de la séance</h2>
          </div>
          <div className="lr-bodycopy">{lesson.content}</div>
          <h3>Notions abordées</h3>
          <Tags items={lesson.concepts} />
        </section>
        <aside className="lr-panel lr-pad lr-aside">
          <div className="lr-section-title">
            <ListChecks />
            <h2>Quiz de la séance</h2>
          </div>
          <dl className="lr-facts">
            <div>
              <dt>Questions</dt>
              <dd>{lesson.questions.length}</dd>
            </div>
            <div>
              <dt>Niveau</dt>
              <dd>{lesson.level}</dd>
            </div>
            <div>
              <dt>Réponses reçues</dt>
              <dd>{lesson.responses}</dd>
            </div>
          </dl>
          {lesson.status === "draft" ? (
            <>
              <a
                className="lr-btn primary"
                href={editorHref(
                  lesson.id,
                  lesson.questions.length ? "review" : "prepare",
                )}
              >
                Préparer le quiz
                <ArrowRight size={16} />
              </a>
              <a
                className="lr-btn"
                href={"/teacher/lessons/new?edit=" + lesson.id}
              >
                <Pencil size={15} />
                Modifier la séance
              </a>
            </>
          ) : (
            lesson.questions.length > 0 && (
              <a className="lr-btn" href={editorHref(lesson.id)}>
                Consulter les questions
                <ArrowRight size={15} />
              </a>
            )
          )}
        </aside>
      </div>
      <CourseDocuments key={lesson.id} lessonId={lesson.id} allowQuiz={lesson.status === "draft"}
        hasGroundedQuiz={lesson.isGrounded} allowTaxonomy={lesson.status === "draft" && !lesson.quizId} />
    </>
  );
}
export function LessonEditor({
  classroom,
  existing,
  taxonomy,
}: {
  classroom: string;
  existing?: Lesson;
  taxonomy: Schema["ConceptView"][];
}) {
  const [lesson, setLesson] = useState<Lesson>(
    () => existing || blankLesson(classroom),
  );
  const [concepts, setConcepts] = useState(lesson.concepts);
  const rooms = useGet<Schema["ClassroomView"][]>("/classrooms").value ?? [];
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Concepts belong to the classroom's subject; a new subject starts by validating its first concept.
  const subject = rooms.find((room) => room.id === lesson.classroom)?.subject ?? defaultSubject;
  const available = taxonomy.filter((item) => item.subject === subject);
  async function approveConcept(operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try { await operation(); refresh(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  function update(key: "title" | "subject" | "classroom" | "content", value: string) {
    setLesson({ ...lesson, [key]: value });
  }
  async function save(prepare: boolean) {
    if (!lesson.classroom || !lesson.title.trim() || !concepts.length || !lesson.content.trim()) {
      setError("Renseignez la classe, le titre, le contenu et au moins une notion.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await saveLesson({ ...lesson, evaluate: concepts }, taxonomy);
      rememberClass(saved.classroom_id);
      window.location.assign(prepare ? editorHref(saved.id, "prepare") : lessonHref(saved.id));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title={existing ? "Modifier la séance" : "Nouvelle séance"}
        description="Rassemblez le contenu et les notions à évaluer."
        back={["/teacher/lessons", "Séances & quiz"]}
      />
      <Stepper step={0} />
      <form
        className="lr-panel lr-pad lr-form lr-editor"
        onSubmit={(e) => {
          e.preventDefault();
          save(true);
        }}
      >
        <div className="lr-section-title">
          <BookOpen />
          <h2>Informations sur la séance</h2>
        </div>
        <div className="lr-pair">
          <label>
            Classe
            <select
              value={lesson.classroom}
              onChange={(e) => update("classroom", e.target.value)}
            >
              {!rooms.length && <option value="">Aucune classe</option>}
              {rooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>
            Matière
            <input value={subjectLabel(subject)} readOnly aria-describedby="lr-subject-hint" />
            <small id="lr-subject-hint">La matière est celle de la classe.</small>
          </label>
        </div>
        <label>
          Titre de la séance
          <input
            value={lesson.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder="Ex. Parcourir une liste en Python"
            required
          />
        </label>
        <fieldset>
          <legend>Notions principales</legend>
          {!available.length && <p>Aucune notion validée pour cette matière. Validez-en une sous ce formulaire.</p>}
          <div className="lr-checks">{available.map(({ code, label_fr }) =>
            <label className="lr-check" key={code}>
              <input type="checkbox" checked={concepts.includes(label_fr)}
                disabled={!!existing?.quizId}
                onChange={(event) => setConcepts(event.target.checked ? [...concepts, label_fr] :
                  concepts.filter((label) => label !== label_fr))} />{label_fr}
            </label>)}</div>
        </fieldset>
        <label>
          Contenu du cours
          <textarea
            rows={7}
            value={lesson.content}
            onChange={(e) => update("content", e.target.value)}
            placeholder="Collez le texte de votre cours ici…"
          />
        </label>
        {error && (
          <p className="lr-error" role="alert">
            {error}
          </p>
        )}
        <div className="lr-actions">
          <button type="button" className="lr-btn" disabled={busy} onClick={() => save(false)}>
            Enregistrer le brouillon
          </button>
          <button className="lr-btn primary" disabled={busy}>
            Préparer le quiz
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
      {lesson.classroom && <section className="lr-panel lr-pad lr-docs">
        <TaxonomyForm path={"/classrooms/" + lesson.classroom + "/taxonomy"} busy={busy} run={approveConcept}
          open={!available.length} submitLabel="Valider la notion pour cette classe" />
      </section>}
    </>
  );
}
function Parameters({ lesson, taxonomy }: { lesson: Lesson; taxonomy: Schema["ConceptView"][] }) {
  const [count, setCount] = useState(lesson.count);
  const [level, setLevel] = useState<Level>(lesson.level);
  const [chosen, setChosen] = useState(lesson.evaluate);
  const [pitfalls, setPitfalls] = useState(lesson.pitfalls);
  const [instructions, setInstructions] = useState(lesson.instructions);
  const [useSeed, setUseSeed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const candidates = taxonomy.map((item) => item.label_fr);
  async function prepare(e: FormEvent) {
    e.preventDefault();
    if (!chosen.length) {
      setError("Sélectionnez au moins une notion à évaluer.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await prepareQuiz({ ...lesson, count, level, evaluate: chosen, pitfalls, instructions }, taxonomy, useSeed);
      window.location.assign(editorHref(lesson.id));
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Préparer le quiz"
        description={lesson.title}
        back={[lessonHref(lesson.id), "Détail de la séance"]}
      />
      <Stepper step={1} />
      <div className="lr-columns">
        <form onSubmit={prepare} className="lr-panel lr-pad lr-form">
          <div className="lr-section-title">
            <ListChecks />
            <h2>Paramètres du quiz</h2>
          </div>
          <div className="lr-pair">
            <label>
              Nombre de questions
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              >
                {Array.from({ length: 10 }, (_, i) => (
                  <option key={i + 1}>{i + 1}</option>
                ))}
              </select>
            </label>
            <label>
              Difficulté
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as Level)}
              >
                {levels.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
          </div>
          <fieldset>
            <legend>Notions à évaluer</legend>
            <div className="lr-checks">
              {candidates.map((c) => (
                <label className="lr-check" key={c}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(c)}
                    onChange={(e) =>
                      setChosen(
                        e.target.checked
                          ? [...chosen, c]
                          : chosen.filter((v) => v !== c),
                      )
                    }
                  />
                  {c}
                </label>
              ))}
            </div>
          </fieldset>
          {error && (
            <p className="lr-error" role="alert">
              {error}
            </p>
          )}
          <label>Pièges observés<input value={pitfalls} onChange={(event) => setPitfalls(event.target.value)} /></label>
          <label>Consigne de génération<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
          <label className="lr-check">
            <input type="checkbox" checked={useSeed} onChange={(event) => setUseSeed(event.target.checked)} />
            Inclure les brouillons de la banque pédagogique à relire
          </label>
          <div className="lr-actions">
            <button className="lr-btn primary" disabled={busy}>
              {busy ? "Préparation en cours…" : lesson.quizId ? "Ouvrir le brouillon" : "Préparer le quiz"}
              <ArrowRight size={16} />
            </button>
          </div>
        </form>
        <aside className="lr-panel lr-pad lr-aside">
          <div className="lr-section-title">
            <Layers3 />
            <h2>Banque pédagogique</h2>
          </div>
          <p>
            Les questions approuvées sont sélectionnées en priorité. Gemini peut compléter le brouillon à partir de vos supports.
          </p>
          <div className="lr-rule" />
          <small>Chaque question peut être modifiée avant publication.</small>
        </aside>
      </div>
    </>
  );
}

export function QuestionForm({
  initial,
  taxonomy,
  onSave,
  onCancel,
}: {
  initial: Question;
  taxonomy: Schema["ConceptView"][];
  onSave: (q: Question) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState({
    ...initial,
    options: [...initial.options],
    misconceptions: [...initial.misconceptions],
  });
  const [error, setError] = useState("");
  function save(e: FormEvent) {
    e.preventDefault();
    if (
      q.text.trim().length < 10 ||
      !q.concept.trim() ||
      !q.explanation.trim() ||
      q.options.some((o) => !o.trim()) ||
      new Set(q.options.map((o) => o.trim().toLowerCase())).size !== 4
    ) {
      setError(
        "Renseignez un énoncé d’au moins dix caractères, quatre réponses distinctes et une explication.",
      );
      return;
    }
    onSave({ ...q, source: "Professeur" });
  }
  return (
    <form className="lr-form" onSubmit={save}>
      <h2>Rédiger la question</h2>
      <label>
        Énoncé
        <textarea
          value={q.text}
          rows={3}
          onChange={(e) => setQ({ ...q, text: e.target.value })}
          required
        />
      </label>
      <label>
        Notion évaluée
        <select value={q.concept} onChange={(e) => setQ({ ...q, concept: e.target.value, misconceptions: ["", "", "", ""] })}>
          {taxonomy.map((item) => <option key={item.code}>{item.label_fr}</option>)}
        </select>
      </label>
      <label>Code Python (facultatif)<textarea value={q.code ?? ""} onChange={(e) => setQ({ ...q, code: e.target.value })} /></label>
      <fieldset>
        <legend>Réponses proposées</legend>
        {q.options.map((o, i) => (
          <div className="lr-edit-option" key={i}>
            <label>
              Réponse {String.fromCharCode(65 + i)}
              <input
                value={o}
                onChange={(e) =>
                  setQ({
                    ...q,
                    options: q.options.map((v, j) =>
                      j === i ? e.target.value : v,
                    ),
                  })
                }
                required
              />
            </label>
            <label className="lr-check">
              <input
                type="radio"
                name="correct"
                checked={q.correct === i}
                onChange={() => setQ({ ...q, correct: i })}
              />
              Bonne réponse
            </label>
            {q.correct !== i && (
              <label>
                Hypothèse si cette réponse est choisie
                <select value={q.misconceptions[i]}
                  onChange={(e) => setQ({ ...q, misconceptions: q.misconceptions.map((value, index) =>
                    index === i ? e.target.value : value) })}>
                  <option value="">Aucune association</option>
                  {taxonomy.find((item) => item.label_fr === q.concept)?.misconceptions.map((error) =>
                    <option key={error.code} value={error.code}>{error.label_fr}</option>)}
                </select>
              </label>
            )}
          </div>
        ))}
      </fieldset>
      <label>
        Explication
        <textarea
          rows={2}
          value={q.explanation}
          onChange={(e) => setQ({ ...q, explanation: e.target.value })}
          required
        />
      </label>
      {error && (
        <p role="alert" className="lr-error">
          {error}
        </p>
      )}
      <div className="lr-actions">
        <button type="button" className="lr-btn" onClick={onCancel}>
          Annuler
        </button>
        <button className="lr-btn primary">
          <Check size={16} />
          Enregistrer la question
        </button>
      </div>
    </form>
  );
}
function Review({ lesson, taxonomy }: { lesson: Lesson; taxonomy: Schema["ConceptView"][] }) {
  const [index, setIndex] = useState(0);
  const [editor, setEditor] = useState<"add" | "edit" | null>(null);
  const [publish, setPublish] = useState(false);
  const [approved, setApproved] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const q = lesson.questions[index];
  // Teacher-approved misconceptions carry generated codes; show their reviewed label instead.
  const misconceptionLabels = new Map(taxonomy.flatMap((item) =>
    item.misconceptions.map((error) => [error.code, error.label_fr] as const)));
  const readOnly = lesson.status !== "draft";
  const root = "/quizzes/" + lesson.quizId;
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try { await action(); refresh(); }
    catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  function regenerate() {
    return run(() => api(root + "/questions/" + q.id + "/regenerate", "POST", {}));
  }
  if (publish)
    return (
      <>
        <Heading
          title="Publier le quiz"
          description={lesson.title}
          back={[editorHref(lesson.id), "Questions du quiz"]}
        />
        <Stepper step={3} />
        <section className="lr-panel lr-pad lr-editor">
          <div className="lr-section-title">
            <Send />
            <h2>Validation du professeur</h2>
          </div>
          <dl className="lr-facts">
            <div>
              <dt>Classe</dt>
              <dd>{lesson.classroomName}</dd>
            </div>
            <div>
              <dt>Questions relues</dt>
              <dd>{lesson.questions.length}</dd>
            </div>
            <div>
              <dt>Notions évaluées</dt>
              <dd>
                {[...new Set(lesson.questions.map((v) => v.concept))].join(
                  ", ",
                )}
              </dd>
            </div>
          </dl>
          <label className="lr-check lr-approval">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            {lesson.isGrounded ? "J’ai vérifié les questions, les réponses, les explications et les sources." :
              "J’ai vérifié les questions, les réponses et les explications."}
          </label>
          {message && <p className="lr-error" role="alert">{message}</p>}
          <div className="lr-actions">
            <button className="lr-btn" onClick={() => setPublish(false)}>
              Retour aux questions
            </button>
            <button
              className="lr-btn primary"
              disabled={!approved || busy}
              onClick={() => void run(async () => {
                await api(root + "/publish", "POST", { validated: true });
                window.location.assign(lessonHref(lesson.id) + "?published=1");
              })}
            >
              <Send size={16} />
              Valider et publier
            </button>
          </div>
        </section>
      </>
    );
  return (
    <>
      <Heading
        title={readOnly ? "Questions du quiz" : "Relire les questions"}
        description={lesson.title}
        back={[lessonHref(lesson.id), "Détail de la séance"]}
      />
      {!readOnly && <Stepper step={2} />}
      {lesson.usedFallback && <p className="lr-notice">{lesson.isGrounded ?
        "Les sources ont permis de valider une partie des questions demandées." :
        "Le stock de la banque et du modèle a produit un brouillon partiel. Complétez-le manuellement."}</p>}
      {busy && <p role="status">Enregistrement en cours…</p>}
      {message && editor && <p className="lr-error" role="alert">{message}</p>}
      {lesson.status === "published" && <button className="lr-btn" disabled={busy} onClick={() => void run(() => api(root + "/close", "POST"))}>Fermer le quiz</button>}
      <div className="lr-columns">
        <section className="lr-panel lr-pad lr-review">
          {editor ? (
            <QuestionForm
              key={editor + "-" + index}
              initial={
                editor === "edit"
                  ? q
                  : {
                      id: "",
                      text: "",
                      options: ["", "", "", ""],
                      correct: 0,
                      concept: lesson.evaluate[0] || lesson.concepts[0] || "",
                      explanation: "",
                      misconceptions: ["", "", "", ""],
                      source: "Professeur",
                      level: lesson.level,
                    }
              }
              onCancel={() => setEditor(null)}
              taxonomy={taxonomy.filter((item) => lesson.concepts.includes(item.label_fr))}
              onSave={(updated) => void run(async () => {
                await saveQuestion(lesson.quizId!, updated, taxonomy, editor === "edit" ? q.id : undefined);
                if (editor === "add") setIndex(lesson.questions.length);
                setEditor(null);
              })}
            />
          ) : q ? (
            <>
              <div className="lr-kicker">
                <span>
                  Question {index + 1} sur {lesson.questions.length}
                </span>
                <span className="lr-badge">{q.level}</span>
              </div>
              <Prompt question={q} />
              <div className="lr-options">
                {q.options.map((o, i) => (
                  <div
                    key={i}
                    className={
                      "lr-option " + (i === q.correct ? "correct" : "")
                    }
                  >
                    <span className="lr-letter">
                      {String.fromCharCode(65 + i)}
                    </span>
                    <div>
                      {o}
                      {i !== q.correct && q.misconceptions[i] && <small title={q.misconceptions[i]}>
                        {misconceptionLabels.get(q.misconceptions[i]) ?? q.misconceptions[i]}
                      </small>}
                    </div>
                    {i === q.correct && (
                      <CheckCircle2 size={18} aria-label="Réponse correcte" />
                    )}
                  </div>
                ))}
              </div>
              <div className="lr-explain">
                <b>Explication</b>
                <p>{q.explanation}</p>
              </div>
              <div className="lr-source">
                <span>{q.concept}</span>
                <span>Source · {q.source}</span>
              </div>
              <Sources sources={q.sourcePages ?? []} />
              {!readOnly && (
                <div className="lr-tools">
                  <button onClick={() => setEditor("edit")}>
                    <Pencil />
                    Modifier
                  </button>
                  {!lesson.isGrounded && <button onClick={regenerate} disabled={busy}>
                    <RefreshCw />
                    Régénérer
                  </button>}
                  <button
                    disabled={busy}
                    onClick={() => void run(async () => {
                      await api(root + "/questions/" + q.id, "DELETE");
                      setIndex(Math.max(0, index - 1));
                    })}
                  >
                    <Trash2 />
                    Retirer
                  </button>
                </div>
              )}
              {message && (
                <p className="lr-notice" role="status">
                  {message}
                </p>
              )}
              <div className="lr-between">
                <button
                  className="lr-btn"
                  disabled={!index}
                  onClick={() => setIndex(index - 1)}
                >
                  <ChevronLeft size={15} />
                  Précédente
                </button>
                <button
                  className="lr-btn"
                  disabled={index >= lesson.questions.length - 1}
                  onClick={() => setIndex(index + 1)}
                >
                  Suivante
                  <ChevronRight size={15} />
                </button>
              </div>
            </>
          ) : (
            <div className="lr-empty">
              <CircleHelp size={30} />
              <h2>Aucune question préparée</h2>
              <p>Rédigez une question correspondant au contenu de la séance.</p>
            </div>
          )}
        </section>
        <aside className="lr-panel lr-pad lr-aside">
          <div className="lr-section-title">
            <ListChecks />
            <h2>Composition du quiz</h2>
          </div>
          <small>
            {lesson.questions.length} question
            {lesson.questions.length > 1 ? "s" : ""} · {lesson.level}
          </small>
          {lesson.questions.length > 0 && (
            <div className="lr-numbers">
              {lesson.questions.map((v, i) => (
                <button
                  key={v.id}
                  disabled={!!editor}
                  className={i === index ? "selected" : ""}
                  onClick={() => {
                    setIndex(i);
                    setMessage("");
                  }}
                  aria-label={"Question " + (i + 1)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
          {!readOnly && (
            <>
              {!lesson.isGrounded && lesson.questions.length < lesson.count && (
                <small>
                  Objectif de préparation : {lesson.count} questions. Vous
                  pouvez compléter le quiz manuellement.
                </small>
              )}
              {lesson.isGrounded ? <a className="lr-btn" href={lessonHref(lesson.id) + "#documents"}>
                Ajouter des questions à partir des PDF
              </a> : <button className="lr-btn" disabled={!!editor} onClick={() => setEditor("add")}>
                <Plus size={16} />
                Ajouter une question
              </button>}
              <div className="lr-rule" />
              <button
                className="lr-btn primary"
                disabled={!lesson.questions.length || !!editor}
                onClick={() => setPublish(true)}
              >
                Valider et publier
                <ArrowRight size={16} />
              </button>
              <a
                href={lesson.isGrounded ? lessonHref(lesson.id) + "#documents" : editorHref(lesson.id, "prepare")}
                className="lr-textlink"
              >
                <ArrowLeft size={14} />
                Paramètres du quiz
              </a>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
export function TeacherQuiz({
  lesson,
  step,
  classroom,
  taxonomy,
}: {
  lesson?: Lesson;
  step: string | null;
  classroom: string;
  taxonomy: Schema["ConceptView"][];
}) {
  if (!lesson)
    return (
      <>
        <Heading title="Préparer le quiz" description={classroom} />
        <Empty
          title="Aucun quiz à préparer"
          action={
            <a className="lr-btn primary" href="/teacher/lessons/new">
              <Plus size={16} />
              Créer une séance
            </a>
          }
        />
      </>
    );
  return (step === "prepare" || !lesson.quizId) && lesson.status === "draft" ? (
    <Parameters lesson={lesson} taxonomy={taxonomy} />
  ) : (
    <Review lesson={lesson} taxonomy={taxonomy} />
  );
}
