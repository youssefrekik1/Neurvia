"use client";
import { useEffect, useState } from "react";
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
  answerPayload,
  useSession,
  type Session,
} from "./service";
import { Empty, Heading, ProgressBar, Prompt } from "./ui";
import { api, errorMessage, type Schema } from "../lib/api";

type StudentProps = { classroom: string; data: LearningData };
const courseIds = ["python", "math", "network"];
const courseIcons = [BookOpen, Sigma, Network];
const practiceIcons = {
  confirmation: CircleHelp,
  retest: RotateCcw,
  review: CalendarClock,
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
            {selected.quizId && selected.status === "published" && (
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
          description={lessons[0]?.classroomName ?? ""}
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
          <small>{lessons[0]?.classroomName}</small>
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
  const Icon = practiceIcons[task.mode];
  return (
    <div className="lr-item">
      <span className="lr-symbol"><Icon size={19} /></span>
      <div className="lr-grow"><b>{task.concept}</b><small>{modeTitles[task.mode]} · {task.pending ? dayLabel(task.due, true) : "1 question"}</small></div>
      {!task.pending && <a className="lr-btn sm" href={practiceHref(task)}>
        {task.mode === "confirmation" ? "Vérifier" : task.mode === "retest" ? "Faire le retest" : "Réviser"}
        <ArrowRight size={14} />
      </a>}
    </div>
  );
}
export function Tasks({ data }: StudentProps) {
  const [filter, setFilter] = useState("À faire");
  const done = data.attempts;
  const quiz = filter === "À faire" ? data.lessons.filter((lesson) => data.tasks.some(
    (task) => task.kind === "initial" && task.status === "available" && task.lesson_id === lesson.id,
  )) : [];
  const tasks = data.practice.filter((task) => !task.done && (filter === "À faire" ? !task.pending : task.pending));
  return (
    <>
      <Heading
        title="Mes tâches"
        description="Tes quiz, tes vérifications et tes révisions au même endroit."
      />
      {data.interventions.length > 0 && <section className="lr-panel lr-pad">
        <h2>Remédiations affectées</h2>
        {data.interventions.map(({ id, lesson_title, plan }) => <details key={id}>
          <summary>{plan.title} · {lesson_title}</summary>
          <p>{plan.objective}</p>
          <p>{plan.example}</p><p>{plan.counter_example}</p><p>{plan.explanation}</p>
          <ol>{plan.steps.map((step) => <li key={step.start_min}>{step.start_min}–{step.end_min} min · {step.action}</li>)}</ol>
          <p>{plan.check_question}</p>
        </details>)}
      </section>}
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
                      {l.count} questions ·{" "}
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
            value={summary.weeklyTarget ? (summary.completedThisWeek / summary.weeklyTarget) * 100 : 0}
            label="Quiz disponibles"
          />
          <small>
            Quiz disponibles · {summary.weeklyTarget} quiz terminés
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
function verdict(score: number, total: number) {
  const ratio = total ? score / total : 0;
  if (ratio === 1) return "Parfait ! Tu maîtrises les notions de cette séance.";
  if (ratio >= 0.7) return "Très bien ! Il reste quelques points à consolider.";
  if (ratio >= 0.4) return "Bon début. Relis les corrections ci-dessous, puis fais les activités proposées.";
  return "Pas de panique : les corrections et les activités proposées vont t’aider à progresser.";
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
            <p className="lr-verdict">{verdict(attempt.score, attempt.total)}</p>
            <p>
              <span className="lr-pill green">{attempt.score} correcte{attempt.score > 1 ? "s" : ""}</span>{" "}
              {wrong > 0 && <span className="lr-pill amber">{wrong} à revoir</span>}{" "}
              · {dayLabel(attempt.date, true)}
            </p>
            <ProgressBar
              value={(100 * attempt.score) / attempt.total}
              label="Score obtenu"
            />
          </section>
          <section className="lr-panel">
            <div className="lr-panel-head">
              <h2>Correction détaillée</h2>
              <button className="lr-textlink" onClick={() => setExpanded(expanded === -1 ? 0 : -1)}>
                {expanded === -1 ? "Tout replier" : "Tout déplier"}
              </button>
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
                  {(expanded === i || expanded === -1) && (
                    <div className="lr-correction-body">
                      <Prompt question={q} />
                      <div className="lr-options">
                        {q.options.map((option, k) => (
                          <div key={k} className={"lr-option " + (k === q.correct ? "correct" : k === answer.option ? "wrong" : "")}>
                            <span className="lr-letter">{String.fromCharCode(65 + k)}</span>
                            <span>{option}</span>
                            {k === answer.option && <small className="lr-mine">Ta réponse</small>}
                          </div>
                        ))}
                      </div>
                      <dl className="lr-facts">
                        <div>
                          <dt>Confiance</dt>
                          <dd>{answer.confidence}</dd>
                        </div>
                      </dl>
                      {!right && answer.confidence === "Sûr" && (
                        <p className="lr-hint">Tu étais sûr(e) de cette réponse : c’est souvent le signe d’une idée à corriger, pas d’une étourderie.</p>
                      )}
                      {q.explanation && <p className="lr-explain"><b>Explication · </b>{q.explanation}</p>}

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
                {!p.done && (
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
          {attempt.mode === "quiz" && attempt.quality === "insufficient" && <p>Il faut davantage de réponses pour interpréter ce résultat.</p>}
          {attempt.diagnoses.map((diagnosis) => <p key={diagnosis.misconception_code}>
            <strong>{data.taxonomy.flatMap((concept) => concept.misconceptions).find((error) => error.code === diagnosis.misconception_code)?.label_fr ?? diagnosis.misconception_code}</strong><br />{diagnosis.message}
          </p>)}
          <a className="lr-btn" href="/student/progress">
            Voir ma progression
            <ArrowRight size={15} />
          </a>
        </aside>
      </div>
    </>
  );
}
const confidenceHints: Record<string, string> = {
  "Sûr": "Je connais la réponse",
  "Moyennement sûr": "J’hésite un peu",
  "Incertain": "Je devine",
};
const isAnswered = (answer?: Partial<Answer>) => answer?.option !== undefined && Boolean(answer?.confidence);
function QuizIntro({ lesson, count, minutes, onStart }: { lesson: Lesson; count: number; minutes: number; onStart: () => void }) {
  return (
    <section className="lr-panel lr-pad lr-intro">
      <span className="lr-badge">{lesson.subject}</span>
      <h2>{lesson.title}</h2>
      <p className="lr-intro-meta">
        <ListChecks size={15} /> {count} question{count > 1 ? "s" : ""} · <Clock3 size={15} /> environ {minutes} min
      </p>
      <ol className="lr-intro-steps">
        <li><b>Choisis une réponse</b><small>Clique sur une option ou tape A, B, C, D.</small></li>
        <li><b>Dis si tu es sûr(e)</b><small>Ta confiance n’est pas notée : elle aide à distinguer une étourderie d’une notion mal comprise.</small></li>
        <li><b>Découvre ton résultat</b><small>Correction détaillée, explications et, si besoin, une courte activité pour consolider.</small></li>
      </ol>
      <button className="lr-btn primary" onClick={onStart} autoFocus>
        Commencer le quiz <ArrowRight size={15} />
      </button>
    </section>
  );
}
function Runner({ lesson, task, session }: { lesson: Lesson; task?: Practice; session: Session }) {
  const [current, setCurrent] = useState(session);
  const [started, setStarted] = useState(Boolean(task) || Object.keys(session.answers).length > 0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { index, questions } = current;
  const q = questions[index];
  const answer = current.answers[index] || {};
  const last = index === questions.length - 1;
  const answered = questions.filter((_, i) => isAnswered(current.answers[i])).length;
  // Answers are saved one at a time, so any question up to the first unanswered one can be revisited.
  const reachable = questions.findIndex((_, i) => !isAnswered(current.answers[i]));
  const minutes = task ? 2 : Math.max(2, Math.round(questions.length * 1.3));
  function update(patch: Partial<Answer>) {
    setCurrent((state) => ({
      ...state,
      answers: { ...state.answers, [state.index]: { ...state.answers[state.index], ...patch } },
    }));
    setError("");
  }
  function navigate(index: number) {
    setCurrent((state) => ({ ...state, index }));
    setError("");
  }
  async function next() {
    if (busy) return;
    if (answer.option === undefined || !answer.confidence) {
      setError(answer.option === undefined ? "Choisis d’abord une réponse." : "Indique ton niveau de confiance pour continuer.");
      return;
    }
    setBusy(true);
    try {
      const body = answerPayload(q, { option: answer.option, confidence: answer.confidence });
      if (task?.mode === "confirmation") {
        const result = await api<Schema["Feedback"]>("/attempts/" + task.fromAttempt + "/confirmation", "POST", body);
        window.location.assign(feedbackHref(result.attempt_id));
      } else {
        const path = "/attempts/" + session.attemptId;
        await api(path + "/answers", "POST", body);
        if (!last) navigate(index + 1);
        else {
          const result = await api<Schema["Feedback"]>(path + "/submit", "POST");
          window.location.assign(feedbackHref(result.attempt_id));
        }
      }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!started) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.ctrlKey || event.metaKey || event.altKey || target.closest("textarea, input[type=text], select")) return;
      const key = event.key.toUpperCase();
      const letter = key.length === 1 ? key.charCodeAt(0) - 65 : -1;
      const digit = key.length === 1 ? Number(key) - 1 : -1;
      if (letter >= 0 && letter < q.options.length) update({ option: letter });
      else if (digit >= 0 && digit < q.options.length) update({ option: digit });
      else if (event.key === "Enter" && !target.closest("button, a")) void next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const heading = (
    <Heading
      title={task ? modeTitles[task.mode] : "Quiz — " + lesson.title}
      description={task ? task.concept : lesson.subject}
      back={["/student/tasks", "Mes tâches"]}
    />
  );
  if (!started)
    return (
      <>
        {heading}
        <div className="lr-test">
          <QuizIntro lesson={lesson} count={questions.length} minutes={minutes} onStart={() => setStarted(true)} />
        </div>
      </>
    );
  return (
    <>
      {heading}
      <div className="lr-test">
        <section className="lr-panel lr-pad">
          <div className="lr-kicker">
            <span>
              Question {index + 1} sur {questions.length}
            </span>
            <span className="lr-duration">
              <Clock3 size={14} />
              environ {minutes} min
            </span>
          </div>
          <ProgressBar value={(100 * answered) / questions.length} label="Questions répondues" />
          {questions.length > 1 && (
            <nav className="lr-qnav" aria-label="Questions du quiz">
              {questions.map((item, i) => {
                const done = isAnswered(current.answers[i]);
                const open = reachable === -1 || i <= reachable;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!open || busy}
                    aria-current={i === index ? "step" : undefined}
                    className={(i === index ? "current " : "") + (done ? "done" : "")}
                    title={"Question " + (i + 1) + (done ? " · répondue" : "")}
                    onClick={() => navigate(i)}
                  >
                    {done && i !== index ? <Check size={13} /> : i + 1}
                  </button>
                );
              })}
            </nav>
          )}
          <span className="lr-badge lr-concept">{q.concept}</span>
          <Prompt question={q} />
          <fieldset className="lr-options">
            <legend className="lr-sr">Choisis une réponse</legend>
            {q.options.map((o, i) => (
              <label key={i} className={"lr-option interactive " + (answer.option === i ? "chosen" : "")}>
                <input type="radio" name="lr-answer" checked={answer.option === i} onChange={() => update({ option: i })} />
                <span className="lr-letter">{String.fromCharCode(65 + i)}</span>
                <span>{o}</span>
                {answer.option === i && <CheckCircle2 size={17} />}
              </label>
            ))}
          </fieldset>
          <fieldset className={"lr-confidence" + (answer.option === undefined ? " dim" : "")}>
            <legend>À quel point es-tu sûr(e) de ta réponse ?</legend>
            <div>
              {confidenceLevels.map((c) => (
                <label key={c} className={answer.confidence === c ? "chosen" : ""}>
                  <input type="radio" name="lr-confidence" checked={answer.confidence === c} onChange={() => update({ confidence: c })} />
                  <b>{c}</b>
                  <small>{confidenceHints[c]}</small>
                </label>
              ))}
            </div>
            <small className="lr-hint">Ta confiance n’est pas notée : elle aide à repérer les idées fausses plutôt que les étourderies.</small>
          </fieldset>
          {error && (
            <p role="alert" className="lr-error">
              {error}
            </p>
          )}
          <div className="lr-between">
            <button className="lr-btn" disabled={index === 0 || busy} onClick={() => navigate(index - 1)}>
              <ChevronLeft size={15} />
              Précédent
            </button>
            <span className="lr-hint lr-keys">A–D pour répondre · Entrée pour valider</span>
            <button className="lr-btn primary" onClick={() => void next()} disabled={busy}>
              {busy ? "Enregistrement…" : last ? (task ? "Valider ma réponse" : "Terminer et voir mon résultat") : "Valider et continuer"}
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
      l.count &&
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
            !p.done && !p.pending,
        )
      : undefined;
  const completed = result
    ? attempts.find((a) => a.id === result)
    : requestedLesson && !task ? attempts.find((a) => a.mode === "quiz" && a.lessonId === requestedLesson) : undefined;
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
    (mode && mode !== "quiz" && !task) || task?.done || task?.pending
  )
    return (
      <>
        <Heading title="Mon activité" back={["/student/tasks", "Mes tâches"]} />
        <Empty
          title="Aucune activité disponible ici"
          action={
            <a className="lr-btn primary" href="/student/tasks">
              Consulter mes tâches
            </a>
          }
        />
      </>
    );
  return (
    <LiveRunner key={task?.id || lesson.id} lesson={lesson} task={task} taxonomy={data.taxonomy} />
  );
}

function LiveRunner({ lesson, task, taxonomy }: { lesson: Lesson; task?: Practice; taxonomy: Schema["ConceptView"][] }) {
  const session = useSession(lesson, task, taxonomy);
  if (session.error) return <p className="lr-error" role="alert">{session.error}</p>;
  if (!session.value) return <p role="status">Chargement des questions…</p>;
  return <Runner lesson={lesson} task={task} session={session.value} />;
}
