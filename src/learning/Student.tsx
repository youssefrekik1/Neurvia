"use client";
import { useState } from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  FileText,
  ListChecks,
  Network,
  RotateCcw,
  Sigma,
  Target,
} from "lucide-react";
import {
  confidenceLevels,
  dayLabel,
  feedbackHref,
  isDue,
  learningService,
  modeTitles,
  practiceHref,
  quizHref,
  subjects,
  useLearningSummary,
  type Answer,
  type Attempt,
  type LearningData,
  type Lesson,
  type Practice,
  type Session,
} from "./service";
import { Empty, Heading, ProgressBar, Prompt } from "./ui";

type StudentProps = { classroom: string; data: LearningData };
const courseIds = ["python", "math", "network"];
const courseIcons = [BookOpen, Sigma, Network];
const practiceIcons = {
  confirmation: CircleHelp,
  retest: RotateCcw,
  review: CalendarClock,
};
const advice: Record<
  string,
  { tip: string; example: string; exercise: string }
> = {
  "Bornes des boucles": {
    tip: "Repère la première valeur et la borne exclue avant de compter les passages.",
    example: "range(2, 5) parcourt 2, 3 et 4.",
    exercise: "Écris les valeurs de range(3, 7), puis compte-les.",
  },
  "Indices et listes": {
    tip: "Numérote les positions à partir de zéro. Le dernier indice est la taille de la liste moins un.",
    example: 'Dans ["a", "b", "c"], l’indice 2 correspond à "c".',
    exercise: "Dessine une liste de quatre éléments et indique leurs indices.",
  },
  "Boucles conditionnelles": {
    tip: "Teste la condition avant chaque passage et mets à jour la variable à la fin du bloc.",
    example:
      "Avec n = 1, la boucle « while n < 3 » avec n += 1 passe par 1 puis 2.",
    exercise:
      "Trace une colonne pour la valeur de n et une autre pour le résultat du test.",
  },
  Conditions: {
    tip: "Évalue chaque comparaison avant de combiner les résultats avec and ou or.",
    example: "True and False donne False.",
    exercise: "Trouve un exemple où une seule des deux comparaisons est vraie.",
  },
  Fonctions: {
    tip: "Remplace chaque paramètre par son argument, puis suis les instructions jusqu’à return.",
    example: "Si f(x) renvoie x + 1, f(4) vaut 5.",
    exercise: "Écris les valeurs des paramètres pour deux appels différents.",
  },
  "Variables et types": {
    tip: "Relève le type de chaque valeur avant de prédire le résultat d’une opération.",
    example: '"3" est du texte. int("3") est un entier.',
    exercise: 'Compare le résultat de 3 + 2 avec celui de "3" + "2".',
  },
};
export function Courses({
  classroom,
  data,
  course,
  lessonId,
}: StudentProps & { course: string | null; lessonId: string | null }) {
  const lessons = data.lessons
    .filter(
      (l) =>
        l.classroom === classroom &&
        l.status === "published" &&
        (!l.release || isDue(l.release)),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const availableSubjects = [
    ...new Set([...subjects, ...lessons.map((l) => l.subject)]),
  ];
  const courseId = (s: string) => courseIds[subjects.indexOf(s)] || s;
  const subject = availableSubjects.find((s) => courseId(s) === course);
  const selected = lessons.find((l) => l.id === lessonId);
  if (lessonId && !selected)
    return (
      <Empty
        title="Séance indisponible"
        action={
          <a className="lr-btn" href="/student/courses">
            Mes cours
          </a>
        }
      />
    );
  if (selected) {
    const done = data.attempts.find(
      (a) =>
        a.classroom === classroom &&
        a.lessonId === selected.id &&
        a.mode === "quiz",
    );
    return (
      <>
        <Heading
          title={selected.title}
          description={selected.subject + " · " + dayLabel(selected.date, true)}
          back={[
            "/student/courses?course=" +
              encodeURIComponent(courseId(selected.subject)),
            "Retour au cours",
          ]}
        />
        <div className="lr-columns">
          <section className="lr-panel lr-pad">
            <div className="lr-section-title">
              <FileText />
              <h2>Contenu de la séance</h2>
            </div>
            <div className="lr-bodycopy">{selected.content}</div>
          </section>
          <aside className="lr-panel lr-pad lr-aside">
            <div className="lr-section-title">
              <Target />
              <h2>Notions abordées</h2>
            </div>
            <div className="lr-tags">
              {selected.concepts.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            {selected.questions.length > 0 && (
              <a
                className="lr-btn primary"
                href={done ? feedbackHref(done.id) : quizHref(selected.id)}
              >
                {done ? "Revoir mon résultat" : "Commencer le quiz"}
                <ArrowRight size={15} />
              </a>
            )}
          </aside>
        </div>
      </>
    );
  }
  if (course && !subject)
    return (
      <Empty
        title="Cours introuvable"
        action={
          <a className="lr-btn" href="/student/courses">
            Mes cours
          </a>
        }
      />
    );
  if (subject) {
    const items = lessons.filter((l) => l.subject === subject);
    return (
      <>
        <Heading
          title={subject}
          description={classroom}
          back={["/student/courses", "Mes cours"]}
        />
        {items.length ? (
          <section className="lr-panel">
            <div className="lr-panel-head">
              <h2>Séances du cours</h2>
              <small>
                {items.length} séance{items.length > 1 ? "s" : ""}
              </small>
            </div>
            {items.map((l) => (
              <a
                key={l.id}
                className="lr-item"
                href={"/student/courses?lesson=" + encodeURIComponent(l.id)}
              >
                <span className="lr-symbol">
                  <FileText size={18} />
                </span>
                <div className="lr-grow">
                  <b>{l.title}</b>
                  <small>
                    {dayLabel(l.date, true)} · {l.concepts.join(", ")}
                  </small>
                </div>
                <ChevronRight size={16} />
              </a>
            ))}
          </section>
        ) : (
          <Empty title="Aucune séance disponible">
            Les séances publiées par ton professeur apparaîtront ici.
          </Empty>
        )}
      </>
    );
  }
  return (
    <>
      <Heading
        title="Mes cours"
        description="Retrouve le contenu des séances et les quiz de tes matières."
      />
      <section className="lr-panel">
        <div className="lr-panel-head">
          <h2>Cours de ma classe</h2>
          <small>{classroom}</small>
        </div>
        {availableSubjects.map((s, i) => {
          const items = lessons.filter((l) => l.subject === s);
          const Icon = courseIcons[i] || BookOpen;
          return (
            <a
              key={s}
              className="lr-item"
              href={
                "/student/courses?course=" + encodeURIComponent(courseId(s))
              }
            >
              <span className={"lr-symbol tone-" + i}>
                <Icon size={20} />
              </span>
              <div className="lr-grow">
                <b>{s}</b>
                <small>
                  {items.length
                    ? "Dernière séance · " + items[0].title
                    : "Aucune séance publiée"}
                </small>
              </div>
              <span className="lr-linktext">Ouvrir</span>
              <ChevronRight size={16} />
            </a>
          );
        })}
      </section>
    </>
  );
}
function TaskRow({ task }: { task: Practice }) {
  const [open, setOpen] = useState(false);
  const Icon = practiceIcons[task.mode],
    due = isDue(task.due),
    support = advice[task.concept];
  return (
    <div>
      <div className="lr-item">
        <span
          className={
            "lr-symbol " + (task.mode === "retest" ? "tone-2" : "tone-1")
          }
        >
          <Icon size={19} />
        </span>
        <div className="lr-grow">
          <b>{task.concept}</b>
          <small>
            {modeTitles[task.mode]} ·{" "}
            {due ? "1 question" : "Disponible le " + dayLabel(task.due, true)}
          </small>
        </div>
        {due ? (
          <a className="lr-btn sm" href={practiceHref(task)}>
            {task.mode === "confirmation"
              ? "Vérifier"
              : task.mode === "retest"
                ? "Faire le retest"
                : "Réviser"}
            <ArrowRight size={14} />
          </a>
        ) : (
          <span className="lr-badge">À venir</span>
        )}
      </div>
      {task.mode === "retest" && support && (
        <div className="lr-activity">
          <button
            className="lr-textlink"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <BookOpen size={14} />
            {open ? "Masquer l’exercice" : "Ouvrir l’exercice de révision"}
          </button>
          {open && (
            <div className="lr-explain">
              <b>Exercice guidé</b>
              <p>{support.tip}</p>
              <p>
                <strong>Exemple.</strong> {support.example}
              </p>
              <p>{support.exercise}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
export function Tasks({ classroom, data }: StudentProps) {
  const [filter, setFilter] = useState("À faire");
  const lessons = data.lessons.filter(
    (l) =>
      l.classroom === classroom &&
      l.status === "published" &&
      l.questions.length,
  );
  const done = data.attempts
    .filter((a) => a.classroom === classroom)
    .sort((a, b) => b.date.localeCompare(a.date));
  const quiz = lessons.filter(
    (l) =>
      !done.some((a) => a.lessonId === l.id && a.mode === "quiz") &&
      (!l.release || isDue(l.release)) === (filter === "À faire"),
  );
  const tasks = data.practice.filter(
    (p) =>
      p.classroom === classroom &&
      !p.done &&
      isDue(p.due) === (filter === "À faire"),
  );
  return (
    <>
      <Heading
        title="Mes tâches"
        description="Tes quiz, tes vérifications et tes révisions au même endroit."
      />
      <div className="lr-notice">
        <span>
          {data.simulatedDays
            ? "Simulation · horloge avancée de " + data.simulatedDays + " jours"
            : "Démonstration · suivi différé"}
        </span>
        <button
          className="lr-btn sm"
          onClick={() => learningService.simulateWeek()}
        >
          Simuler J+7
        </button>
        {!!data.simulatedDays && (
          <button
            className="lr-btn sm"
            onClick={() => learningService.resetClock()}
          >
            Réinitialiser l’horloge
          </button>
        )}
      </div>
      <div className="lr-filters" role="group" aria-label="État des tâches">
        {["À faire", "À venir", "Terminées"].map((f) => (
          <button
            aria-pressed={f === filter}
            key={f}
            className={f === filter ? "active" : ""}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>
      {filter === "Terminées" ? (
        <History attempts={done} />
      ) : (
        <div className="lr-stack">
          {quiz.length > 0 && (
            <section className="lr-panel">
              <div className="lr-panel-head">
                <h2>
                  {filter === "À faire" ? "Quiz disponibles" : "Quiz à venir"}
                </h2>
                <small>{quiz.length} quiz</small>
              </div>
              {quiz.map((l) => (
                <div key={l.id} className="lr-item">
                  <span className="lr-symbol">
                    <ClipboardList size={19} />
                  </span>
                  <div className="lr-grow">
                    <b>{l.title}</b>
                    <small>
                      {l.questions.length} questions ·{" "}
                      {l.release && !isDue(l.release)
                        ? "Disponible le " + dayLabel(l.release, true)
                        : l.subject}
                    </small>
                  </div>
                  {filter === "À faire" ? (
                    <a className="lr-btn primary sm" href={quizHref(l.id)}>
                      Commencer
                      <ArrowRight size={14} />
                    </a>
                  ) : (
                    <span className="lr-badge">À venir</span>
                  )}
                </div>
              ))}
            </section>
          )}
          {tasks.length > 0 && (
            <section className="lr-panel">
              <div className="lr-panel-head">
                <h2>Vérifications et révisions</h2>
              </div>
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </section>
          )}
          {quiz.length + tasks.length === 0 && (
            <Empty
              title={
                filter === "À faire"
                  ? "Toutes tes tâches sont à jour"
                  : "Aucune tâche à venir"
              }
            >
              Tes prochaines activités apparaîtront ici.
            </Empty>
          )}
        </div>
      )}
    </>
  );
}
function History({ attempts }: { attempts: Attempt[] }) {
  return attempts.length ? (
    <section className="lr-panel">
      <div className="lr-panel-head">
        <h2>Activités terminées</h2>
      </div>
      {attempts.map((a) => (
        <a href={feedbackHref(a.id)} className="lr-item" key={a.id}>
          <span className="lr-symbol green">
            <CheckCircle2 size={18} />
          </span>
          <div className="lr-grow">
            <b>{a.title}</b>
            <small>
              {modeTitles[a.mode]} · {dayLabel(a.date, true)}
            </small>
          </div>
          <b className="lr-result">
            {a.score} / {a.total}
          </b>
          <ChevronRight size={16} />
        </a>
      ))}
    </section>
  ) : (
    <Empty title="Aucune activité terminée">
      Tes résultats apparaîtront après ton premier quiz.
    </Empty>
  );
}
export function Progress({ classroom, data }: StudentProps) {
  const summary = useLearningSummary(classroom);
  const attempts = data.attempts
    .filter((a) => a.classroom === classroom)
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <Heading
        title="Ma progression"
        description="Suis ton travail de la semaine et retrouve tes résultats."
      />
      <div className="lr-progress-cards">
        <section className="lr-panel lr-pad">
          <div className="lr-section-title">
            <Activity />
            <h2>Cette semaine</h2>
          </div>
          <div className="lr-score">
            {summary.completedThisWeek}
            <small> / {summary.weeklyTarget} quiz</small>
          </div>
          <ProgressBar
            value={(summary.completedThisWeek / summary.weeklyTarget) * 100}
            label="Objectif hebdomadaire"
          />
          <small>
            Objectif hebdomadaire · {summary.weeklyTarget} quiz terminés
          </small>
        </section>
        <section className="lr-panel lr-pad">
          <div className="lr-section-title">
            <Target />
            <h2>À revoir</h2>
          </div>
          {summary.suspected ? (
            <>
              <h3>{summary.reviewTopic}</h3>
              <p>
                Une question de vérification peut t’aider à préciser ce que tu
                as compris.
              </p>
              <a className="lr-textlink" href={summary.verificationHref}>
                Ouvrir l’activité
                <ArrowRight size={15} />
              </a>
            </>
          ) : (
            <p>Aucune révision proposée pour le moment.</p>
          )}
        </section>
      </div>
      <History attempts={attempts} />
    </>
  );
}
function Feedback({ attempt, data }: { attempt: Attempt; data: LearningData }) {
  const [expanded, setExpanded] = useState<number | null>(0);
  const followups = data.practice.filter(
    (p) => p.fromAttempt === attempt.id && !p.done,
  );
  const wrong = attempt.total - attempt.score;
  return (
    <>
      <Heading
        title={
          attempt.mode === "quiz"
            ? "Résultat du quiz"
            : "Résultat de l’activité"
        }
        description={attempt.title}
        back={["/student/tasks", "Mes tâches"]}
      />
      <div className="lr-columns">
        <div className="lr-stack">
          <section className="lr-panel lr-pad">
            <div className="lr-section-title">
              <CheckCircle2 />
              <h2>Activité terminée</h2>
            </div>
            <div className="lr-score">
              {attempt.score}
              <small> / {attempt.total}</small>
            </div>
            <p>
              Bonne{attempt.score > 1 ? "s" : ""} réponse
              {attempt.score > 1 ? "s" : ""} · {dayLabel(attempt.date, true)}
            </p>
            <ProgressBar
              value={(100 * attempt.score) / attempt.total}
              label="Score obtenu"
            />
          </section>
          <section className="lr-panel">
            <div className="lr-panel-head">
              <h2>Correction détaillée</h2>
            </div>
            {attempt.questions.map((q, i) => {
              const answer = attempt.answers[i],
                right = answer.option === q.correct;
              return (
                <div className="lr-correction" key={q.id}>
                  <button
                    aria-expanded={expanded === i}
                    onClick={() => setExpanded(expanded === i ? null : i)}
                  >
                    <span
                      className={
                        "lr-symbol tiny " + (right ? "green" : "amber")
                      }
                    >
                      {right ? <Check size={15} /> : <CircleHelp size={15} />}
                    </span>
                    <span className="lr-grow">
                      <b>Question {i + 1}</b>
                      <small>
                        {q.concept} · {right ? "Réponse correcte" : "À revoir"}
                      </small>
                    </span>
                    <ChevronRight
                      size={16}
                      className={expanded === i ? "turn" : ""}
                    />
                  </button>
                  {expanded === i && (
                    <div className="lr-correction-body">
                      <Prompt question={q} />
                      <dl className="lr-facts">
                        <div>
                          <dt>Ta réponse</dt>
                          <dd>{q.options[answer.option]}</dd>
                        </div>
                        {!right && (
                          <div>
                            <dt>Bonne réponse</dt>
                            <dd>{q.options[q.correct]}</dd>
                          </div>
                        )}
                        <div>
                          <dt>Confiance</dt>
                          <dd>{answer.confidence}</dd>
                        </div>
                      </dl>
                      <p>{q.explanation}</p>
                      {!right && (
                        <div className="lr-explain">
                          <b>Interprétation possible</b>
                          <p>{q.misconceptions[answer.option]}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </div>
        <aside className="lr-panel lr-pad lr-aside">
          <div className="lr-section-title">
            <Target />
            <h2>La suite</h2>
          </div>
          {followups.length ? (
            followups.map((p) => (
              <div className="lr-followup" key={p.id}>
                <h3>{p.concept}</h3>
                <p>
                  {p.mode === "confirmation"
                    ? "Cette réponse suggère une difficulté possible. Vérifie-la avec une autre question."
                    : p.mode === "retest"
                      ? "Deux réponses suggèrent une difficulté sur cette notion. Revois l’exercice guidé, puis essaie une question différente."
                      : "Une nouvelle question t’attend le " +
                        dayLabel(p.due, true) +
                        " pour revoir cette notion à distance."}
                </p>
                {isDue(p.due) && (
                  <a className="lr-btn primary" href={practiceHref(p)}>
                    {p.mode === "confirmation"
                      ? "Faire la vérification"
                      : p.mode === "retest"
                        ? "Faire le retest"
                        : "Réviser"}
                    <ArrowRight size={15} />
                  </a>
                )}
                {p.mode === "retest" && (
                  <a className="lr-textlink" href="/student/tasks">
                    Exercice guidé
                    <ArrowRight size={14} />
                  </a>
                )}
              </div>
            ))
          ) : (
            <p>
              {wrong
                ? "Relis les explications pour comprendre tes réponses."
                : "Tu as répondu correctement à toutes les questions de cette activité."}
            </p>
          )}
          <a className="lr-btn" href="/student/progress">
            Voir ma progression
            <ArrowRight size={15} />
          </a>
        </aside>
      </div>
    </>
  );
}
function Runner({
  classroom,
  lesson,
  task,
  session,
}: {
  classroom: string;
  lesson: Lesson;
  task?: Practice;
  session?: Session;
}) {
  const [error, setError] = useState("");
  const sessionId = classroom + "-" + (task?.id || lesson.id);
  const current: Session = session || {
    questions: task ? [task.question] : lesson.questions,
    index: 0,
    answers: {},
  };
  const { index, questions } = current,
    q = questions[index],
    answer = current.answers[index] || {},
    last = index === questions.length - 1;
  function update(patch: Partial<Answer>) {
    learningService.saveSession(sessionId, {
      ...current,
      answers: { ...current.answers, [index]: { ...answer, ...patch } },
    });
    setError("");
  }
  function navigate(i: number) {
    learningService.saveSession(sessionId, { ...current, index: i });
    setError("");
  }
  function next() {
    if (answer.option === undefined || !answer.confidence) {
      setError(
        "Choisis une réponse et indique ton niveau de confiance pour continuer.",
      );
      return;
    }
    if (!last) {
      navigate(index + 1);
      return;
    }
    try {
      const result = learningService.submit(
        classroom,
        lesson,
        task,
        sessionId,
        current,
      );
      window.location.assign(feedbackHref(result.id));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossible d’enregistrer la réponse.",
      );
    }
  }
  return (
    <>
      <Heading
        title={task ? modeTitles[task.mode] : "Quiz — " + lesson.title}
        description={task ? task.concept : lesson.subject}
        back={["/student/tasks", "Mes tâches"]}
      />
      <div className="lr-test">
        <section className="lr-panel lr-pad">
          <div className="lr-kicker">
            <span>
              Question {index + 1} sur {questions.length}
            </span>
            <span className="lr-duration">
              <Clock3 size={14} />
              {task ? "2" : Math.max(2, Math.round(questions.length * 1.3))} min
            </span>
          </div>
          <ProgressBar
            value={(100 * (index + 1)) / questions.length}
            label="Progression dans le quiz"
          />
          <span className="lr-badge lr-concept">{q.concept}</span>
          <Prompt question={q} />
          <fieldset className="lr-options">
            <legend className="lr-sr">Choisis une réponse</legend>
            {q.options.map((o, i) => (
              <label
                key={i}
                className={
                  "lr-option interactive " +
                  (answer.option === i ? "chosen" : "")
                }
              >
                <input
                  type="radio"
                  name="lr-answer"
                  checked={answer.option === i}
                  onChange={() => update({ option: i })}
                />
                <span className="lr-letter">{String.fromCharCode(65 + i)}</span>
                <span>{o}</span>
                {answer.option === i && <CheckCircle2 size={17} />}
              </label>
            ))}
          </fieldset>
          <fieldset className="lr-confidence">
            <legend>Quel est ton niveau de confiance ?</legend>
            <div>
              {confidenceLevels.map((c) => (
                <label
                  key={c}
                  className={answer.confidence === c ? "chosen" : ""}
                >
                  <input
                    type="radio"
                    name="lr-confidence"
                    checked={answer.confidence === c}
                    onChange={() => update({ confidence: c })}
                  />
                  {c}
                </label>
              ))}
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="lr-error">
              {error}
            </p>
          )}
          <div className="lr-between">
            <button
              className="lr-btn"
              disabled={index === 0}
              onClick={() => navigate(index - 1)}
            >
              <ChevronLeft size={15} />
              Précédent
            </button>
            <button className="lr-btn primary" onClick={next}>
              {last ? "Terminer" : "Suivant"}
              <ArrowRight size={15} />
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
export function StudentQuiz({
  classroom,
  data,
  params,
}: StudentProps & { params: URLSearchParams }) {
  const result = params.get("result"),
    requestedLesson = params.get("lesson") || params.get("id"),
    mode = params.get("mode"),
    taskId = params.get("task");
  const inClass = data.lessons.filter(
    (l) =>
      l.classroom === classroom &&
      l.status === "published" &&
      l.questions.length &&
      (!l.release || isDue(l.release)),
  );
  const attempts = data.attempts.filter((a) => a.classroom === classroom);
  const task = taskId
    ? data.practice.find((p) => p.classroom === classroom && p.id === taskId)
    : mode && mode !== "quiz"
      ? data.practice.find(
          (p) =>
            p.classroom === classroom &&
            p.mode === mode &&
            !p.done &&
            isDue(p.due),
        )
      : undefined;
  const completed = result
    ? attempts.find((a) => a.id === result)
    : task?.done
      ? attempts.find((a) => a.practiceId === task.id)
      : requestedLesson && !task
        ? attempts.find(
            (a) => a.mode === "quiz" && a.lessonId === requestedLesson,
          )
        : undefined;
  if (completed)
    return <Feedback key={completed.id} attempt={completed} data={data} />;
  const lesson = task
    ? inClass.find((l) => l.id === task.lessonId)
    : requestedLesson
      ? inClass.find((l) => l.id === requestedLesson)
      : inClass.find(
          (l) =>
            !attempts.some((a) => a.mode === "quiz" && a.lessonId === l.id),
        );
  if (
    !lesson ||
    result ||
    (taskId && !task) ||
    (mode && mode !== "quiz" && !task) ||
    (task && !isDue(task.due))
  )
    return (
      <>
        <Heading title="Mon activité" back={["/student/tasks", "Mes tâches"]} />
        <Empty
          title={
            task && !isDue(task.due)
              ? "Révision prévue le " + dayLabel(task.due, true)
              : "Aucune activité disponible ici"
          }
          action={
            <a className="lr-btn primary" href="/student/tasks">
              Consulter mes tâches
            </a>
          }
        />
      </>
    );
  return (
    <Runner
      key={task?.id || lesson.id}
      classroom={classroom}
      lesson={lesson}
      task={task}
      session={data.sessions[classroom + "-" + (task?.id || lesson.id)]}
    />
  );
}
