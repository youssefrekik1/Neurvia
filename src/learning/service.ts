"use client";

import { useCallback } from "react";
import { api, refresh, type Schema, useResource } from "../lib/api";
import { levels, type Level, type Question } from "./bank";

export const subjects = ["Algorithmique & Python"];
export const confidenceLevels = ["Sûr", "Moyennement sûr", "Incertain"] as const;
const confidenceCodes = ["sure", "medium", "unsure"] as const;
export type Confidence = (typeof confidenceLevels)[number];
export type Mode = "quiz" | "confirmation" | "retest" | "review";
export type Lesson = {
  id: string; classroom: string; classroomName: string; title: string; subject: string;
  concepts: string[]; content: string; date: string; questions: Question[];
  status: "draft" | "published" | "closed"; count: number; level: Level; evaluate: string[];
  responses: number; difficulty: string; trend: string; quizId?: string; release?: string;
  pitfalls: string; instructions: string; usedFallback?: boolean;
};
export type Answer = { option: number; confidence: Confidence };
export type Attempt = {
  id: string; classroom: string; lessonId: string; title: string; date: string; mode: Mode;
  questions: Question[]; answers: Answer[]; score: number; total: number;
  diagnoses: Schema["Diagnosis"][]; quality: Schema["Feedback"]["diagnosis_quality"];
};
export type Practice = {
  id: string; classroom: string; lessonId: string; concept: string; mode: Exclude<Mode, "quiz">;
  due: string; fromAttempt?: string; quizId?: string; done: boolean; pending: boolean;
};
export type Session = {
  attemptId?: string; questions: Question[];
  answers: Partial<Record<number, Partial<Answer>>>; index: number;
};
export type LearningData = {
  lessons: Lesson[]; attempts: Attempt[]; practice: Practice[]; taxonomy: Schema["ConceptView"][];
  tasks: Schema["StudentTask"][]; interventions: Schema["AssignedPlan"][];
};

const empty: LearningData = { lessons: [], attempts: [], practice: [], taxonomy: [], tasks: [], interventions: [] };
const modes = { initial: "quiz", confirmation: "confirmation", immediate_retest: "retest", j7_retest: "review" } as const;
const sources = { bank: "Banque", llm: "IA", teacher: "Professeur" } as const;
export const modeTitles: Record<Mode, string> = {
  quiz: "Quiz", confirmation: "Vérification", retest: "Retest immédiat", review: "Révision J+7",
};
export const lessonHref = (id: string) => "/teacher/lessons/" + encodeURIComponent(id);
export const quizHref = (lessonId: string) => "/student/quiz?lesson=" + encodeURIComponent(lessonId);
export const practiceHref = (p: Practice) => "/student/quiz?mode=" + p.mode + "&task=" + encodeURIComponent(p.id);
export const feedbackHref = (id: string) => "/student/quiz?result=" + encodeURIComponent(id);

export function dayLabel(date: string, long = false) {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: long ? "long" : "short",
    timeZone: "Africa/Tunis" }).format(new Date(date));
}
export function isDue(date: string) { return Date.parse(date) <= Date.now(); }

export function blankLesson(classroom: string): Lesson {
  return {
    id: "", classroom, classroomName: "", title: "", subject: subjects[0], concepts: [], content: "",
    date: new Date().toISOString(), questions: [], status: "draft", count: 6, level: levels[0],
    evaluate: [], responses: 0, difficulty: "À observer", trend: "À observer", pitfalls: "", instructions: "",
  };
}
function label(code: string, taxonomy: Schema["ConceptView"][]) {
  return taxonomy.find((item) => item.code === code)?.label_fr ?? code;
}
function question(row: Schema["StudentQuestion"] | Schema["TeacherQuestion"], taxonomy: Schema["ConceptView"][]): Question {
  const teacher = "source" in row ? row : null;
  return {
    id: row.id, text: row.stem, code: row.code ?? undefined, options: row.options.map((o) => o.text),
    optionIds: row.options.map((o) => o.id), concept: label(row.concept_code, taxonomy),
    conceptCode: row.concept_code, correct: teacher?.options.findIndex((o) => o.is_correct) ?? -1,
    explanation: teacher?.explanation ?? "", misconceptions: teacher?.options.map((o) => o.misconception_code ?? "") ?? [],
    source: teacher ? sources[teacher.source] : "Professeur", level: levels[(teacher?.difficulty ?? 1) - 1] ?? levels[0],
  };
}
function toAttempt(row: Schema["Feedback"], lessons: Lesson[], taxonomy: Schema["ConceptView"][]): Attempt {
  const rows = row.questions.flatMap((item) => {
    const answer = row.answers.find((a) => a.question_id === item.id);
    if (!answer) return [];
    const q = question(item, taxonomy);
    const correct = item.options.findIndex((o) => o.id === answer.correct_option_id);
    const option = item.options.findIndex((o) => o.id === answer.selected_option_id);
    return [{ question: { ...q, correct, explanation: answer.explanation },
              answer: { option, confidence: confidenceLevels[confidenceCodes.indexOf(answer.confidence)] } }];
  });
  return {
    id: row.attempt_id, classroom: row.classroom_id, lessonId: row.lesson_id,
    title: lessons.find((l) => l.id === row.lesson_id)?.title ?? modeTitles[modes[row.kind]],
    date: row.submitted_at, mode: modes[row.kind], questions: rows.map((r) => r.question),
    answers: rows.map((r) => r.answer), score: row.correct_count, total: row.answered_count,
    diagnoses: row.suspected_difficulties, quality: row.diagnosis_quality,
  };
}

async function load(key: string): Promise<LearningData> {
  const [role, classroom] = key.split(":");
  const teacher = role === "teacher";
  const [rows, taxonomy, rooms] = await Promise.all([
    api<Schema["LessonView"][]>("/classrooms/" + classroom + "/lessons"),
    api<Schema["ConceptView"][]>("/taxonomy"),
    api<Schema["ClassroomView"][]>("/classrooms"),
  ]);
  const room = rooms.find((r) => r.id === classroom);
  const lessons = await Promise.all(rows.map(async (row): Promise<Lesson> => {
    const quiz = teacher && row.quiz_id ? await api<Schema["TeacherQuiz"]>("/quizzes/" + row.quiz_id) : undefined;
    const brief = row.focus_brief;
    const concepts = row.concept_codes.map((code) => label(code, taxonomy));
    return {
      ...blankLesson(classroom), id: row.id, title: row.title, date: row.created_at,
      classroomName: room?.name ?? "", concepts, evaluate: concepts, content: row.content_text ?? "",
      status: row.status, responses: row.submitted_count ?? 0, quizId: row.quiz_id ?? undefined,
      count: teacher ? brief?.question_count ?? 6 : row.question_count ?? 0,
      level: levels[(brief?.difficulty ?? 1) - 1], pitfalls: brief?.pitfalls?.join(", ") ?? "",
      instructions: brief?.instructions ?? "", usedFallback: quiz?.used_fallback,
      questions: quiz?.questions.map((q) => question(q, taxonomy)) ?? [],
    };
  }));
  if (teacher) return { ...empty, lessons, taxonomy };
  const [tasks, feedback, interventions] = await Promise.all([
    api<Schema["StudentTask"][]>("/me/tasks?include_upcoming=true&classroom_id=" + classroom),
    api<Schema["Feedback"][]>("/me/feedback?classroom_id=" + classroom),
    api<Schema["AssignedPlan"][]>("/me/interventions?classroom_id=" + classroom),
  ]);
  return {
    lessons, taxonomy, tasks, interventions,
    attempts: feedback.map((row) => toAttempt(row, lessons, taxonomy)),
    practice: tasks.flatMap((item): Practice[] => item.kind === "initial" ? [] : [{
      id: item.id, classroom, lessonId: item.lesson_id, concept: item.title,
      mode: modes[item.kind], due: item.due_at ?? new Date().toISOString(),
      fromAttempt: item.kind === "confirmation" ? item.attempt_id ?? undefined : undefined,
      quizId: item.quiz_id ?? undefined, done: item.status === "done", pending: item.status === "pending",
    }]),
  };
}

export function useLearning(classroom: string, teacher: boolean) {
  const resource = useResource(classroom ? (teacher ? "teacher:" : "student:") + classroom : "", load);
  return { ...resource, data: resource.value ?? empty };
}

function conceptCodes(labels: string[], taxonomy: Schema["ConceptView"][]) {
  return labels.map((name) => {
    const concept = taxonomy.find((row) => [row.label_fr, row.code].some((value) =>
      value.toLocaleLowerCase("fr") === name.trim().toLocaleLowerCase("fr")));
    if (!concept) throw new Error("Concept absent de la taxonomie : " + name);
    return concept.code;
  });
}
export async function saveLesson(lesson: Lesson, taxonomy: Schema["ConceptView"][]) {
  const payload: Schema["LessonCreate"] = {
    title: lesson.title, content_text: lesson.content, concept_codes: conceptCodes(lesson.evaluate, taxonomy),
    focus_brief: {
      difficulty: levels.indexOf(lesson.level) + 1, question_count: lesson.count,
      pitfalls: lesson.pitfalls.split(",").map((value) => value.trim()).filter(Boolean),
      instructions: lesson.instructions,
    },
  };
  return api<Schema["LessonView"]>(lesson.id ? "/lessons/" + lesson.id :
    "/classrooms/" + lesson.classroom + "/lessons", lesson.id ? "PATCH" : "POST", payload);
}
export async function prepareQuiz(lesson: Lesson, taxonomy: Schema["ConceptView"][], seed: boolean) {
  if (!lesson.quizId) await saveLesson(lesson, taxonomy);
  return api<Schema["TeacherQuiz"]>("/lessons/" + lesson.id + "/quiz/generate", "POST",
    { question_count: lesson.count, use_seed_drafts: seed } satisfies Schema["QuizGenerate"]);
}
export async function saveQuestion(quizId: string, value: Question, taxonomy: Schema["ConceptView"][], id?: string) {
  await api("/quizzes/" + quizId + "/questions" + (id ? "/" + id : ""), id ? "PATCH" : "POST", {
    concept_code: conceptCodes([value.concept], taxonomy)[0], stem: value.text,
    code: value.code ?? null, difficulty: levels.indexOf(value.level) + 1, explanation: value.explanation,
    options: value.options.map((text, i) => ({ text, is_correct: i === value.correct,
      misconception_code: i === value.correct ? null : value.misconceptions[i] || null })),
  } satisfies Schema["QuestionDraft"]);
  refresh();
}
export function useSession(lesson: Lesson, task: Practice | undefined, taxonomy: Schema["ConceptView"][]) {
  const mode = task?.mode;
  const parentId = task?.fromAttempt;
  const quizId = task?.quizId ?? lesson.quizId;
  const get = useCallback(async (): Promise<Session> => {
    if (mode === "confirmation") {
      const item = await api<Schema["Confirmation"] | null>("/attempts/" + parentId + "/confirmation");
      if (!item) throw new Error("Cette vérification est terminée ou indisponible.");
      return { questions: [question(item.question, taxonomy)], answers: {}, index: 0 };
    }
    const attempt = await api<Schema["AttemptView"]>("/quizzes/" + quizId + "/attempts", "POST");
    const items = attempt.questions.map((row) => question(row, taxonomy));
    const answers: Session["answers"] = {};
    for (const answer of attempt.saved_answers ?? []) {
      const index = items.findIndex((item) => item.id === answer.question_id);
      if (index < 0) continue;
      const option = items[index].optionIds?.indexOf(answer.option_id);
      answers[index] = { option, confidence: confidenceLevels[confidenceCodes.indexOf(answer.confidence)] };
    }
    return { attemptId: attempt.id, questions: items, answers, index: 0 };
  }, [mode, parentId, quizId, taxonomy]);
  return useResource(task?.id || lesson.quizId || "", get);
}
export function answerPayload(item: Question, answer: Answer): Schema["AnswerInput"] {
  return { question_id: item.id, option_id: item.optionIds![answer.option],
    confidence: confidenceCodes[confidenceLevels.indexOf(answer.confidence)] };
}
export function useLearningSummary(classroom: string, teacher = false) {
  const { data, loading, error } = useLearning(classroom, teacher);
  const open = data.tasks.find((task) => task.kind === "initial" && task.status === "available");
  const next = data.lessons.find((item) => item.id === open?.lesson_id);
  const verification = data.practice.find((task) => task.mode === "confirmation" && !task.done);
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return {
    loading, error, lessons: data.lessons, recentLessons: data.lessons.slice(0, 5), latestAttempt: data.attempts[0],
    completedThisWeek: data.attempts.filter((attempt) => attempt.mode === "quiz" && Date.parse(attempt.date) >= +monday).length,
    weeklyTarget: data.lessons.filter((lesson) => lesson.quizId).length,
    priority: next ? { title: next.title, count: next.count, href: quizHref(next.id) } : null,
    verificationHref: verification ? practiceHref(verification) : undefined,
    reviewTopic: verification?.concept ?? "", suspected: !!verification,
  };
}
