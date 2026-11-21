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
  Upload,
} from "lucide-react";
import {
  bank,
  levels,
  selectQuestions,
  topics,
  type Level,
  type Question,
} from "./bank";
import {
  blankLesson,
  classrooms,
  dayLabel,
  learningService,
  lessonHref,
  subjects,
  uid,
  type Lesson,
  type LearningData,
} from "./service";
import { Empty, Heading, Prompt, Stepper } from "./ui";

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
      {lesson.status === "published" ? "Publiée" : "Brouillon"}
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
        description={lesson.subject + " · " + lesson.classroom}
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
    </>
  );
}
export function LessonEditor({
  classroom,
  existing,
}: {
  classroom: string;
  existing?: Lesson;
}) {
  const [lesson, setLesson] = useState<Lesson>(
    () => existing || blankLesson(classroom),
  );
  const [concepts, setConcepts] = useState(lesson.concepts.join(", "));
  const [error, setError] = useState("");
  function update(
    key: "title" | "subject" | "classroom" | "content",
    value: string,
  ) {
    setLesson({ ...lesson, [key]: value });
  }
  function save(prepare: boolean) {
    const chosen = [
      ...new Set(
        concepts
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
      ),
    ];
    if (
      !lesson.title.trim() ||
      (prepare && (!chosen.length || !lesson.content.trim()))
    ) {
      setError(
        prepare
          ? "Renseignez le titre, au moins une notion et le contenu de la séance."
          : "Donnez un titre à votre brouillon.",
      );
      return;
    }
    const evaluate = chosen.flatMap((c) => {
      const match = topics.find(
        (t) => t.toLocaleLowerCase("fr") === c.toLocaleLowerCase("fr"),
      );
      if (match) return [match];
      const name = c.toLowerCase();
      return topics.filter((_, i) =>
        [
          /borne|boucle|range|\bfor\b/,
          /indice|liste/,
          /while|conditionnelle/,
          /condition(?!nelle)|bool/,
          /fonction/,
          /variable|type/,
        ][i].test(name),
      );
    });
    const saved = learningService.saveLesson({
      ...lesson,
      title: lesson.title.trim(),
      concepts: chosen,
      evaluate: [...new Set(evaluate)],
      status: "draft",
    });
    rememberClass(saved.classroom);
    window.location.assign(
      prepare ? editorHref(saved.id, "prepare") : lessonHref(saved.id),
    );
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
              {classrooms.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Matière
            <input
              value={lesson.subject}
              list="lr-subjects"
              onChange={(e) => update("subject", e.target.value)}
              required
            />
            <datalist id="lr-subjects">
              {subjects.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </datalist>
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
        <label>
          Notions principales
          <input
            value={concepts}
            onChange={(e) => setConcepts(e.target.value)}
            placeholder="Ex. Bornes des boucles, indices et listes"
          />
          <small>Séparez les notions par des virgules.</small>
        </label>
        <label>
          Contenu du cours
          <textarea
            rows={7}
            value={lesson.content}
            onChange={(e) => update("content", e.target.value)}
            placeholder="Collez le texte de votre cours ici…"
          />
        </label>
        <div className="lr-upload">
          <Upload size={20} />
          <div>
            <b>Importer un PDF ou un document Word</b>
            <small>
              Import indisponible en démonstration. Vous pouvez coller le texte
              ci-dessus.
            </small>
          </div>
        </div>
        {error && (
          <p className="lr-error" role="alert">
            {error}
          </p>
        )}
        <div className="lr-actions">
          <button type="button" className="lr-btn" onClick={() => save(false)}>
            Enregistrer le brouillon
          </button>
          <button className="lr-btn primary">
            Préparer le quiz
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </>
  );
}
function Parameters({ lesson }: { lesson: Lesson }) {
  const [count, setCount] = useState(lesson.count);
  const [level, setLevel] = useState<Level>(lesson.level);
  const [chosen, setChosen] = useState(lesson.evaluate);
  const [error, setError] = useState("");
  const [replace, setReplace] = useState(false);
  const candidates = [
    ...new Set([
      ...lesson.concepts,
      ...lesson.evaluate,
      ...(lesson.subject === subjects[0] ? topics : []),
    ]),
  ];
  function prepare(e: FormEvent) {
    e.preventDefault();
    if (!chosen.length) {
      setError("Sélectionnez au moins une notion à évaluer.");
      return;
    }
    if (lesson.questions.length && !replace) {
      setReplace(true);
      return;
    }
    const questions = selectQuestions(chosen, level, count);
    learningService.saveLesson({
      ...lesson,
      questions,
      count,
      level,
      evaluate: chosen,
    });
    window.location.assign(editorHref(lesson.id));
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
                {Array.from({ length: 12 }, (_, i) => (
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
          {replace && (
            <p className="lr-notice" role="status">
              La préparation remplacera les questions de ce brouillon. Confirmez
              pour continuer.
            </p>
          )}
          <div className="lr-actions">
            <button className="lr-btn primary">
              {replace ? "Confirmer la préparation" : "Préparer le quiz"}
              <ArrowRight size={16} />
            </button>
          </div>
        </form>
        <aside className="lr-panel lr-pad lr-aside">
          <div className="lr-section-title">
            <Layers3 />
            <h2>Banque de démonstration</h2>
          </div>
          <p>
            Les questions proviennent d’une banque pédagogique Python. Pour les
            autres notions, vous pouvez rédiger vos questions à l’étape
            suivante.
          </p>
          <div className="lr-rule" />
          <small>Chaque question peut être modifiée avant publication.</small>
        </aside>
      </div>
    </>
  );
}

function QuestionForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Question;
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
      !q.text.trim() ||
      !q.concept.trim() ||
      !q.explanation.trim() ||
      q.options.some((o) => !o.trim()) ||
      q.misconceptions.some((m, i) => i !== q.correct && !m.trim()) ||
      new Set(q.options.map((o) => o.trim().toLowerCase())).size !== 4
    ) {
      setError(
        "Renseignez la question, quatre réponses distinctes, la notion, l’explication et les trois hypothèses.",
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
        <input
          value={q.concept}
          onChange={(e) => setQ({ ...q, concept: e.target.value })}
          required
        />
      </label>
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
                <input
                  value={q.misconceptions[i]}
                  onChange={(e) =>
                    setQ({
                      ...q,
                      misconceptions: q.misconceptions.map((v, j) =>
                        j === i ? e.target.value : v,
                      ),
                    })
                  }
                  required
                />
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
function Review({ lesson }: { lesson: Lesson }) {
  const [index, setIndex] = useState(0);
  const [editor, setEditor] = useState<"add" | "edit" | null>(null);
  const [publish, setPublish] = useState(false);
  const [approved, setApproved] = useState(false);
  const [message, setMessage] = useState("");
  const q = lesson.questions[index];
  const readOnly = lesson.status === "published";
  function setQuestions(questions: Question[]) {
    learningService.saveLesson({ ...lesson, questions });
    setEditor(null);
    setMessage("");
  }
  function regenerate() {
    const alternate = selectQuestions(
      [q.concept],
      lesson.level,
      1,
      lesson.questions.map((v) => v.id),
    )[0];
    if (!alternate) {
      setMessage(
        "Toutes les variantes disponibles pour cette notion sont utilisées. Vous pouvez modifier la question.",
      );
      return;
    }
    setQuestions(
      lesson.questions.map((item, i) => (i === index ? alternate : item)),
    );
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
              <dd>{lesson.classroom}</dd>
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
            J’ai vérifié les questions, les réponses et les explications.
          </label>
          <div className="lr-actions">
            <button className="lr-btn" onClick={() => setPublish(false)}>
              Retour aux questions
            </button>
            <button
              className="lr-btn primary"
              disabled={!approved}
              onClick={() => {
                learningService.saveLesson({
                  ...lesson,
                  status: "published",
                  date: new Date().toISOString(),
                  release: undefined,
                });
                window.location.assign(lessonHref(lesson.id) + "?published=1");
              }}
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
      <div className="lr-columns">
        <section className="lr-panel lr-pad lr-review">
          {editor ? (
            <QuestionForm
              key={editor + "-" + index}
              initial={
                editor === "edit"
                  ? q
                  : {
                      id: uid(),
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
              onSave={(updated) => {
                if (editor === "add") {
                  setQuestions([...lesson.questions, updated]);
                  setIndex(lesson.questions.length);
                } else
                  setQuestions(
                    lesson.questions.map((v, i) => (i === index ? updated : v)),
                  );
              }}
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
                      {i !== q.correct && <small>{q.misconceptions[i]}</small>}
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
              {!readOnly && (
                <div className="lr-tools">
                  <button onClick={() => setEditor("edit")}>
                    <Pencil />
                    Modifier
                  </button>
                  <button onClick={regenerate}>
                    <RefreshCw />
                    Régénérer
                  </button>
                  <button
                    onClick={() => {
                      setQuestions(
                        lesson.questions.filter((_, i) => i !== index),
                      );
                      setIndex(Math.max(0, index - 1));
                    }}
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
              {lesson.questions.length < lesson.count && (
                <small>
                  Objectif de préparation : {lesson.count} questions. Vous
                  pouvez compléter le quiz manuellement.
                </small>
              )}
              <button
                className="lr-btn"
                disabled={!!editor}
                onClick={() => setEditor("add")}
              >
                <Plus size={16} />
                Ajouter une question
              </button>
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
                href={editorHref(lesson.id, "prepare")}
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
}: {
  lesson?: Lesson;
  step: string | null;
  classroom: string;
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
  return step === "prepare" && lesson.status !== "published" ? (
    <Parameters lesson={lesson} />
  ) : (
    <Review lesson={lesson} />
  );
}
