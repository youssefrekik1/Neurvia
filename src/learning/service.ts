"use client";
import { useSyncExternalStore } from "react";
import { followupBank } from "./practice";
import {
  bank,
  initialQuestions,
  selectQuestions,
  topics,
  type Question,
  type Level,
  levels,
} from "./bank";

export const classrooms = ["L1 Python · Groupe A", "L1 Python · Groupe B"];
export const subjects = ["Algorithmique & Python", "Mathématiques", "Réseaux"];
export const confidenceLevels = [
  "Sûr",
  "Moyennement sûr",
  "Incertain",
] as const;
export type Confidence = (typeof confidenceLevels)[number];
export type Mode = "quiz" | "confirmation" | "retest" | "review";
export type Lesson = {
  id: string;
  classroom: string;
  title: string;
  subject: string;
  concepts: string[];
  content: string;
  date: string;
  questions: Question[];
  status: "draft" | "published";
  count: number;
  level: Level;
  evaluate: string[];
  responses: number;
  difficulty: string;
  trend: string;
  release?: string;
};
export type Answer = { option: number; confidence: Confidence };
export type Attempt = {
  id: string;
  classroom: string;
  lessonId: string;
  title: string;
  date: string;
  mode: Mode;
  questions: Question[];
  answers: Answer[];
  score: number;
  total: number;
  practiceId?: string;
};
export type Practice = {
  id: string;
  classroom: string;
  lessonId: string;
  concept: string;
  mode: Exclude<Mode, "quiz">;
  due: string;
  used: string[];
  fromAttempt?: string;
  question: Question;
  done: boolean;
};
export type Session = {
  questions: Question[];
  answers: Partial<Record<number, Partial<Answer>>>;
  index: number;
};
export type LearningData = {
  lessons: Lesson[];
  attempts: Attempt[];
  practice: Practice[];
  sessions: Record<string, Session>;
  simulatedDays?: number;
};
const key = "neurvia.learning.v1";
const listeners = new Set<() => void>();
export const uid = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
function relativeDate(offset: number) {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  day.setHours(9, 0, 0, 0);
  return day.toISOString();
}
export function dayLabel(date: string, long = false) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: long ? "long" : "short",
  }).format(new Date(date));
}
export function isDue(date: string) {
  const end = new Date();
  if (typeof window !== "undefined")
    end.setDate(end.getDate() + (snapshot().simulatedDays || 0));
  end.setHours(23, 59, 59, 999);
  return new Date(date) <= end;
}
export const lessonHref = (id: string) =>
  "/teacher/lessons/" + encodeURIComponent(id);
export const quizHref = (lessonId: string) =>
  "/student/quiz?lesson=" + encodeURIComponent(lessonId);
export const practiceHref = (p: Practice) =>
  "/student/quiz?mode=" + p.mode + "&task=" + encodeURIComponent(p.id);
export const feedbackHref = (id: string) =>
  "/student/quiz?result=" + encodeURIComponent(id);
export const modeTitles: Record<Mode, string> = {
  quiz: "Quiz",
  confirmation: "Vérification",
  retest: "Retest immédiat",
  review: "Révision J+7",
};
export function blankLesson(classroom: string): Lesson {
  return {
    id: "",
    classroom,
    title: "",
    subject: subjects[0],
    concepts: [],
    content: "",
    date: relativeDate(0),
    questions: [],
    status: "draft",
    count: 6,
    level: levels[0],
    evaluate: [],
    responses: 0,
    difficulty: "À observer",
    trend: "À observer",
  };
}
function makeSeed(): LearningData {
  const classroom = classrooms[0];
  const lesson = (
    id: string,
    title: string,
    content: string,
    concepts: string[],
    days: number,
    responses: number,
    trend: string,
    extra: Partial<Lesson> = {},
  ): Lesson => ({
    ...blankLesson(classroom),
    id,
    title,
    content,
    date: relativeDate(days),
    responses,
    concepts,
    evaluate: concepts,
    difficulty: concepts[0],
    trend,
    status: "published",
    questions: selectQuestions(concepts, "Essentiel", 6),
    ...extra,
  });
  const lessons = [
    lesson(
      "boucles-indices",
      "Boucles et indices Python",
      "Une boucle for parcourt les éléments d’une séquence. Avec range(début, fin), le parcours commence à début et s’arrête avant fin.\n\nPour une liste de taille n, les indices vont de 0 à n − 1. Pour lire le dernier élément, on peut utiliser la position −1.\n\nUne boucle while réévalue sa condition avant chaque passage. Une mise à jour de la variable de contrôle permet de progresser vers la sortie.",
      [topics[0], topics[1], topics[2]],
      -1,
      18,
      "En progression",
      { questions: initialQuestions },
    ),
    lesson(
      "conditions",
      "Conditions et expressions booléennes",
      "Les expressions de comparaison renvoient True ou False. Le bloc if est exécuté si le test est vrai. elif introduit une condition alternative et else traite les autres cas.",
      [topics[3], topics[5]],
      -3,
      20,
      "Stable",
    ),
    lesson(
      "listes",
      "Manipuler les listes",
      "Les listes sont des séquences ordonnées. On accède à un élément par son indice. Le premier indice est 0. Les tranches permettent d’extraire une partie de la liste.",
      [topics[1], topics[0]],
      -5,
      21,
      "En progression",
    ),
    lesson(
      "variables",
      "Variables et types",
      "Une variable associe un nom à une valeur. Les types usuels sont int, float, str et bool. Une conversion explicite permet de passer d’un type à l’autre lorsque la valeur est compatible.",
      [topics[5]],
      -9,
      22,
      "En progression",
    ),
    lesson(
      "prochaine-seance",
      "Approfondir les boucles",
      "Retracer les valeurs successives d’une variable dans une boucle while et expliquer sa condition d’arrêt. Comparer avec un parcours for à bornes fixées.",
      [topics[2], topics[0]],
      0,
      0,
      "À observer",
      { status: "draft" },
    ),
    lesson(
      "fonctions",
      "Découvrir les fonctions",
      "Une fonction regroupe des instructions réutilisables. Ses paramètres reçoivent les arguments de l’appel. return transmet le résultat à l’appelant.",
      [topics[4]],
      1,
      0,
      "À observer",
      { release: relativeDate(1) },
    ),
    lesson(
      "suites",
      "Suites arithmétiques",
      "Une suite arithmétique évolue par addition d’une raison constante. Pour calculer un terme, ajoutez la raison au terme précédent.\n\nExemple : avec un premier terme égal à 2 et une raison égale à 3, les premiers termes sont 2, 5, 8 et 11.",
      ["Suites arithmétiques"],
      -2,
      0,
      "À observer",
      { subject: subjects[1], questions: [] },
    ),
    lesson(
      "reseaux",
      "Les couches du modèle OSI",
      "Le modèle OSI décrit sept couches de communication. La couche réseau s’occupe notamment de l’adressage et du routage. La couche transport assure le transfert de données entre applications.",
      ["Modèle OSI"],
      -4,
      0,
      "À observer",
      { subject: subjects[2], questions: [] },
    ),
  ];
  const attempts: Attempt[] = [];
  [lessons[1], lessons[2], lessons[3]].forEach((l, i) => {
    const questions = i === 2 ? l.questions.slice(0, 2) : l.questions;
    const answers = questions.map((q, j) => ({
      option: j === 1 ? (q.correct + 1) % 4 : q.correct,
      confidence: confidenceLevels[j === 1 ? 2 : 0],
    }));
    attempts.push({
      id: "history-" + i,
      classroom,
      lessonId: l.id,
      title: l.title,
      date: relativeDate([-1, -2, -9][i]),
      mode: "quiz",
      questions,
      answers,
      score: questions.length - 1,
      total: questions.length,
    });
  });
  const practice: Practice[] = [
    {
      id: "check-bounds",
      classroom,
      lessonId: "listes",
      concept: topics[0],
      mode: "confirmation",
      due: relativeDate(0),
      used: lessons[2].questions.map((q) => q.id),
      question: followupBank[0],
      fromAttempt: "history-1",
      done: false,
    },
    {
      id: "retest-list",
      classroom,
      lessonId: "listes",
      concept: topics[1],
      mode: "retest",
      due: relativeDate(0),
      used: [bank[8].id, bank[9].id],
      question: followupBank[4],
      done: false,
    },
    {
      id: "week-types",
      classroom,
      lessonId: "variables",
      concept: topics[5],
      mode: "review",
      due: relativeDate(0),
      used: [bank[27].id, bank[28].id, bank[29].id],
      question: followupBank[17],
      done: false,
    },
  ];
  return { lessons, attempts, practice, sessions: {} };
}
const seed = makeSeed();
let cache: LearningData = seed;
let lastSerialized: string | null = null;
function snapshot(): LearningData {
  if (typeof window === "undefined") return seed;
  try {
    const raw = localStorage.getItem(key);
    if (raw !== lastSerialized) {
      cache = raw ? (JSON.parse(raw) as LearningData) : seed;
      lastSerialized = raw;
    }
  } catch {
    /* Keep the current session when storage is unavailable. */
  }
  return cache;
}
function write(data: LearningData) {
  cache = data;
  try {
    const raw = JSON.stringify(data);
    localStorage.setItem(key, raw);
    lastSerialized = raw;
  } catch {
    /* The in-memory session remains usable. */
  }
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const sync = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener();
  };
  window.addEventListener("storage", sync);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", sync);
  };
}
export const useLearning = () =>
  useSyncExternalStore(subscribe, snapshot, () => seed);
export const learningService = {
  simulateWeek() {
    const data = snapshot();
    write({ ...data, simulatedDays: (data.simulatedDays || 0) + 7 });
  },
  resetClock() {
    write({ ...snapshot(), simulatedDays: 0 });
  },
  saveLesson(lesson: Lesson) {
    const data = snapshot();
    const saved = { ...lesson, id: lesson.id || uid() };
    write({
      ...data,
      lessons: [saved, ...data.lessons.filter((l) => l.id !== saved.id)],
    });
    return saved;
  },
  saveSession(id: string, session: Session) {
    const data = snapshot();
    write({ ...data, sessions: { ...data.sessions, [id]: session } });
  },
  submit(
    classroom: string,
    lesson: Lesson,
    task: Practice | undefined,
    sessionId: string,
    session: Session,
  ) {
    const data = snapshot();
    const previous = data.attempts.find(
      (a) =>
        a.classroom === classroom &&
        (task
          ? a.practiceId === task.id
          : a.mode === "quiz" && a.lessonId === lesson.id),
    );
    if (previous) return previous;
    const answers = session.questions.map((q, i) => {
      const answer = session.answers[i];
      if (
        answer?.option === undefined ||
        !q.options[answer.option] ||
        !answer.confidence ||
        !confidenceLevels.includes(answer.confidence)
      )
        throw new Error(
          "Réponds à chaque question et indique ton niveau de confiance.",
        );
      return { option: answer.option, confidence: answer.confidence };
    });
    const wrong = session.questions.filter(
      (q, i) => q.correct !== answers[i].option,
    );
    const attempt: Attempt = {
      id: uid(),
      classroom,
      lessonId: lesson.id,
      title: task ? task.concept : lesson.title,
      date: new Date().toISOString(),
      mode: task?.mode || "quiz",
      questions: session.questions,
      answers,
      score: answers.length - wrong.length,
      total: answers.length,
      practiceId: task?.id,
    };
    const practice = data.practice.map((p) =>
      p.id === task?.id ? { ...p, done: true } : p,
    );
    const plan = (
      concept: string,
      mode: Practice["mode"],
      due: number,
      used: string[],
    ) => {
      const question = [...followupBank, ...bank].find(
        (q) =>
          q.concept === concept &&
          !used.includes(q.id) &&
          !session.questions.some((old) => old.text.trim() === q.text.trim()),
      );
      if (question)
        practice.push({
          id: uid(),
          classroom,
          lessonId: lesson.id,
          concept,
          mode,
          due: relativeDate(due),
          used,
          fromAttempt: attempt.id,
          question,
          done: false,
        });
    };
    const used = [...(task?.used || []), ...session.questions.map((q) => q.id)];
    if (!task)
      [...new Set(wrong.map((q) => q.concept))]
        .slice(0, 2)
        .forEach((concept) => plan(concept, "confirmation", 0, used));
    else if (task.mode === "confirmation" && wrong.length)
      plan(task.concept, "retest", 0, used);
    else if (task.mode !== "review") plan(task.concept, "review", 7, used);
    const sessions = { ...data.sessions };
    delete sessions[sessionId];
    const lessons = data.lessons.map((l) =>
      !task && l.id === lesson.id ? { ...l, responses: l.responses + 1 } : l,
    );
    write({
      ...data,
      lessons,
      practice,
      attempts: [attempt, ...data.attempts],
      sessions,
    });
    return attempt;
  },
};
export function useLearningSummary(classroom: string) {
  const data = useLearning();
  const lessons = data.lessons.filter((l) => l.classroom === classroom);
  const available = lessons.filter(
    (l) =>
      l.status === "published" &&
      l.questions.length &&
      (!l.release || isDue(l.release)),
  );
  const attempts = data.attempts
    .filter((a) => a.classroom === classroom)
    .sort((a, b) => b.date.localeCompare(a.date));
  const priorityLesson = available.find(
    (l) => !attempts.some((a) => a.mode === "quiz" && a.lessonId === l.id),
  );
  const tasks = data.practice.filter(
    (p) => p.classroom === classroom && !p.done && isDue(p.due),
  );
  const verification = tasks.find((p) => p.mode === "confirmation") || tasks[0];
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return {
    lessons,
    recentLessons: available
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 4),
    latestAttempt: attempts[0],
    completedThisWeek: attempts.filter(
      (a) => a.mode === "quiz" && new Date(a.date) >= monday,
    ).length,
    weeklyTarget: 4,
    priority: priorityLesson
      ? {
          title: priorityLesson.title,
          count: priorityLesson.questions.length,
          href: quizHref(priorityLesson.id),
        }
      : null,
    verificationHref: verification
      ? practiceHref(verification)
      : "/student/tasks",
    reviewTopic: verification?.concept || "",
    suspected: !!verification,
  };
}
