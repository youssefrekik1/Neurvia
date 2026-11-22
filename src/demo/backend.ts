// In-browser stand-in for the Neurvia API in demo mode. Fictional data, kept in memory for the session.
import type { Schema } from "../lib/api";
import { DEMO_LESSON, mirrorResponse, mirrorState } from "./mirror";
import { CONCEPTS, MISCONCEPTIONS, STUDENTS } from "./data";

type Role = "teacher" | "student";
type Q = Schema["TeacherQuestion"];

const id = (n: number) => "00000000-0000-4000-8000-" + n.toString(16).padStart(12, "0");
const iso = (days = 0, hours = 0) => new Date(Date.now() + days * 86400000 + hours * 3600000).toISOString();

const BD = "Bases de données";
const SIG = "Mathématiques du signal";
const COHORT_A = id(0xc0a), COHORT_B = id(0xc0b);
const ROOM_BD_A = id(0xa1), ROOM_SIG_A = id(0xb1), ROOM_BD_B = id(0xa2), ROOM_SIG_B = id(0xb2);
const LESSON_BD1 = DEMO_LESSON, LESSON_BD2 = id(0xc003), LESSON_SIG1 = id(0xc101);
const QUIZ_BD1 = id(0xc002), QUIZ_SIG1 = id(0xc102), QUIZ_BD2 = id(0xc004), QUIZ_GROUNDED = id(0xc005);
const DOC_BD1 = id(0xd001), DOC_SIG1 = id(0xd101), DOC_BD2 = id(0xd002);
const ATTEMPT_DONE = id(0xe001);

const ROOMS: Schema["ClassroomView"][] = [
  { id: ROOM_BD_A, name: BD + " · L2 Informatique A", subject: BD, subject_name: BD, is_synthetic: true, cohort_id: COHORT_A, cohort_name: "L2 Informatique A", join_code: "BDL2A26", join_path: "/join/BDL2A26", join_expires_at: iso(7) },
  { id: ROOM_SIG_A, name: SIG + " · L2 Informatique A", subject: SIG, subject_name: SIG, is_synthetic: true, cohort_id: COHORT_A, cohort_name: "L2 Informatique A", join_code: "SIGL2A26", join_path: "/join/SIGL2A26", join_expires_at: iso(7) },
  { id: ROOM_BD_B, name: BD + " · L2 Informatique B", subject: BD, subject_name: BD, is_synthetic: true, cohort_id: COHORT_B, cohort_name: "L2 Informatique B", join_code: "BDL2B26", join_path: "/join/BDL2B26", join_expires_at: iso(7) },
  { id: ROOM_SIG_B, name: SIG + " · L2 Informatique B", subject: SIG, subject_name: SIG, is_synthetic: true, cohort_id: COHORT_B, cohort_name: "L2 Informatique B", join_code: "SIGL2B26", join_path: "/join/SIGL2B26", join_expires_at: iso(7) },
];
const isSignal = (room: string) => room === ROOM_SIG_A || room === ROOM_SIG_B;

// ---------- Taxonomy ----------
const SIGNAL_CONCEPTS = [
  { code: "C_FOURIER", label_fr: "Séries de Fourier et coefficients", misconceptions: [
    { code: "M_A0_FACTOR", label_fr: "Oublier le facteur 1/2π dans a₀" },
    { code: "M_BN_EVEN", label_fr: "Calculer bₙ pour une fonction paire" }] },
  { code: "C_PERIOD", label_fr: "Signaux périodiques et pulsation", misconceptions: [
    { code: "M_OMEGA_T", label_fr: "Confondre pulsation ω et période T" }] },
];
function taxonomy(): Schema["ConceptView"][] {
  return [
    ...CONCEPTS.map((c) => ({ code: c.code, label_fr: c.name, subject: BD,
      misconceptions: MISCONCEPTIONS.filter((m) => m.concept === c.code).map((m) => ({ code: m.code, label_fr: m.label })) })),
    ...SIGNAL_CONCEPTS.map((c) => ({ ...c, subject: SIG })),
  ];
}

// ---------- Questions ----------
let optionCounter = 0x9000;
function question(n: number, concept: string, stem: string, options: [string, string | null][], explanation: string,
  extra: Partial<Q> = {}, code: string | null = null): Q {
  return {
    id: id(0x7000 + n), concept_code: concept, stem, code, difficulty: 2, explanation, source: "llm", status: "validated",
    role: "initial", version: 1, source_pages: [], validated_by: "Hela Ben Amor", validated_at: iso(-3),
    options: options.map(([text, misconception], index) => ({
      id: id(optionCounter++), text, is_correct: index === 0, misconception_code: misconception })),
    ...extra,
  };
}
const shuffle = (q: Q, by: number): Q => ({ ...q, options: q.options.map((_, i, all) => all[(i + by) % all.length]) });
const page = (doc: "bd1" | "sig1", number: number, quote: string, objective?: string): Schema["SourceView"] => ({
  document_id: doc === "bd1" ? DOC_BD1 : DOC_SIG1, title: doc === "bd1" ? "BD-Cours-1.pdf" : "Chapitre-1.pdf (manuscrit)",
  page: number, path: `/demo/${doc}-p${number}.jpg`, quote, objective: objective ?? null,
});

const BD1_QUESTIONS: Q[] = [
  shuffle(question(1, "C_CARD", "CLIENT (0,n) — passe — (1,1) COMMANDE. Combien de commandes un client peut-il passer ?", [
    ["De 0 à plusieurs", null], ["Exactement une", "M_CARD_SIDE"], ["Au moins une", "M_CARD_SIDE"], ["Aucune", null]],
  "La cardinalité (0,n) se lit du côté de CLIENT : un client passe de 0 à n commandes.",
  { source_pages: [page("bd1", 50, "La cardinalité d’une entité dans une association est le couple (min, max)…", "Lire une cardinalité")] }), 1),
  question(2, "C_CARD", "Que signifie le minimum 0 dans une cardinalité (0,n) ?", [
    ["La participation est facultative", null], ["L’entité n’existe pas", null], ["Il y a exactement n occurrences", "M_CARD_SIDE"], ["L’association est réflexive", null]],
  "Un minimum de 0 indique qu’une occurrence peut ne participer à aucune association."),
  shuffle(question(3, "C_EA_REL", "CLIENT (0,n) — passe — (1,1) COMMANDE. Où placer la clé étrangère ?", [
    ["Dans COMMANDE : #id_client", null], ["Dans CLIENT : #id_commande", "M_FK_SIDE"], ["Dans une table PASSE", "M_FK_SIDE"], ["Dans les deux tables", null]],
  "Pour une association 1,n, la clé de l’entité côté 1 migre dans la table côté n.",
  { source_pages: [page("bd1", 49, "Association : exemple", "Traduire une association binaire")] }), 2),
  question(4, "C_ENTITY", "Quel élément identifie de façon unique chaque occurrence d’une entité ?", [
    ["L’identifiant", null], ["Un attribut quelconque", null], ["La cardinalité", "M_CARD_SIDE"], ["L’association", null]],
  "L’identifiant (souligné dans le schéma) distingue chaque occurrence.", { source_pages: [page("bd1", 47, "Identifiant", "Définir un identifiant")] }),
  shuffle(question(5, "C_ALG", "Quelle expression donne les clients de la ville de Sousse ?", [
    ["σ ville='Sousse' (CLIENT)", null], ["π ville='Sousse' (CLIENT)", "M_SEL_PROJ"], ["CLIENT × VILLE", null], ["π ville (CLIENT)", "M_SEL_PROJ"]],
  "La sélection σ garde les lignes qui vérifient la condition."), 3),
  question(6, "C_SGBD", "Quel niveau de description décrit la structure logique des données (tables, attributs) ?", [
    ["Le niveau logique", null], ["Le niveau physique", null], ["Le niveau externe", null], ["Le niveau matériel", null]],
  "Le niveau logique décrit les tables et leurs attributs, indépendamment du stockage."),
];
const SIG1_QUESTIONS: Q[] = [
  question(11, "C_FOURIER", "Que représente le coefficient a₀ d’une série de Fourier ?", [
    ["La valeur moyenne du signal sur une période", null], ["L’amplitude maximale", null], ["La fréquence fondamentale", "M_OMEGA_T"], ["La somme des bₙ", null]],
  "a₀ = 1/(2π) ∫₀^{2π} u(x) dx : c’est la valeur moyenne.", { source_pages: [page("sig1", 1, "a₀ = 1/2π ∫₀^{2π} U(x) dx", "Calculer a₀")] }),
  shuffle(question(12, "C_FOURIER", "Quelle est l’expression correcte de a₀ ?", [
    ["a₀ = 1/(2π) ∫₀^{2π} u(x) dx", null], ["a₀ = ∫₀^{2π} u(x) dx", "M_A0_FACTOR"], ["a₀ = 1/π ∫₀^{2π} u(x) dx", "M_A0_FACTOR"], ["a₀ = 2π ∫₀^{2π} u(x) dx", "M_A0_FACTOR"]],
  "En intégrant terme à terme sur [0, 2π], seul a₀ reste : 2π·a₀ = ∫ u.", { source_pages: [page("sig1", 1, "⇒ a₀ = 1/2π ∫₀^{2π} U(x) dx", "Calculer a₀")] }), 1),
  question(13, "C_FOURIER", "Si u est paire et 2π-périodique, que valent les coefficients bₙ ?", [
    ["Ils sont tous nuls", null], ["Ils sont tous égaux à a₀", null], ["Ils valent aₙ", "M_BN_EVEN"], ["On ne peut pas conclure", "M_BN_EVEN"]],
  "u(x)·sin(nx) est impaire : son intégrale sur une période symétrique est nulle.", { source_pages: [page("sig1", 3, "bₚ = 1/π ∫₀^{2π} sin(px) u(x) dx", "Coefficients bₙ")] }),
  question(14, "C_PERIOD", "Un signal a une pulsation ω. Quelle est sa période T ?", [
    ["T = 2π/ω", null], ["T = ω/2π", "M_OMEGA_T"], ["T = 2πω", "M_OMEGA_T"], ["T = 1/ω", "M_OMEGA_T"]],
  "T = 2π/ω et f = 1/T.", { source_pages: [page("sig1", 1, "T = 2π/ω, ω s’appelle la pulsation et f = 1/T est dite la fréquence", "Pulsation et période")] }),
];
const BD2_GENERATED: Q[] = [
  question(21, "C_EA_REL", "Comment traduire l’association n,n ÉTUDIANT — s’inscrit — MODULE ?", [
    ["Une table INSCRIPTION(#id_etudiant, #id_module)", null], ["Une clé étrangère dans ÉTUDIANT", "M_FK_SIDE"], ["Une clé étrangère dans MODULE", "M_FK_SIDE"], ["Rien, l’association disparaît", null]],
  "Une association n,n devient une table dont la clé est le couple des clés étrangères.",
  { status: "draft", source: "llm", validated_by: null, validated_at: null, source_pages: [page("bd1", 60, "Associations plurielles", "Traduire une association n,n")] }),
  question(22, "C_KEYS", "Que garantit une clé étrangère ?", [
    ["Que la valeur référencée existe dans l’autre table", null], ["Que la valeur est unique", null], ["Que la colonne n’est jamais vide", null], ["Que la table est en 3FN", null]],
  "Elle impose l’intégrité référentielle.", { status: "draft", source: "llm", validated_by: null, validated_at: null }),
  shuffle(question(23, "C_EA_REL", "SERVICE (1,1) — emploie — (0,n) EMPLOYÉ. Quelle table reçoit la clé étrangère ?", [
    ["SERVICE(id_service, …, #id_employe)", null], ["EMPLOYÉ(id_employe, …, #id_service)", "M_FK_SIDE"], ["Une table EMPLOIE", "M_FK_SIDE"], ["Aucune", null]],
  "Lire les cardinalités : un employé (0,n)… ici c’est le service qui a un seul employé, la clé migre côté SERVICE.",
  { status: "draft", source: "bank", validated_by: null, validated_at: null }), 1),
];

// ---------- Mutable state ----------
type QuizState = { lesson: string; status: Schema["QuizStatus"]; questions: Q[]; mode: Schema["TeacherQuiz"]["generation_mode"]; grounded: boolean };
type DocState = Schema["DocumentView"] & { lesson: string; key: "bd1" | "sig1"; uploadedAt?: number };
type AttemptState = { quiz: string; answers: Record<string, Schema["AnswerSaved"]>; feedback?: Schema["Feedback"] };

const state = {
  lessons: {
    [LESSON_BD1]: { title: "Chapitre 1 · Conception et modèle Entité-Association", concepts: ["C_SGBD", "C_ENTITY", "C_CARD", "C_EA_REL", "C_ALG"], status: "published" as Schema["LessonStatus"], quiz: QUIZ_BD1 as string | null, created: iso(-9), submitted: 22, content: "Conception d’une base de données : entités, attributs, identifiants, associations et cardinalités (BD-Cours-1.pdf).", signal: false },
    [LESSON_BD2]: { title: "Chapitre 2 · Traduction vers le modèle relationnel", concepts: ["C_EA_REL", "C_KEYS"], status: "draft" as Schema["LessonStatus"], quiz: null as string | null, created: iso(-1), submitted: 0, content: "Passage du modèle Entité-Association au modèle relationnel : tables, clés primaires et étrangères.", signal: false },
    [LESSON_SIG1]: { title: "Chapitre 1 · Séries de Fourier", concepts: ["C_FOURIER", "C_PERIOD"], status: "draft" as Schema["LessonStatus"], quiz: null as string | null, created: iso(-1), submitted: 0, content: "Séries trigonométriques, calcul des coefficients de Fourier a₀, aₙ, bₙ (cours manuscrit).", signal: true },
  } as Record<string, { title: string; concepts: string[]; status: Schema["LessonStatus"]; quiz: string | null; created: string; submitted: number; content: string; signal: boolean }>,
  quizzes: {
    [QUIZ_BD1]: { lesson: LESSON_BD1, status: "published", questions: BD1_QUESTIONS, mode: "mixed", grounded: true },
  } as Record<string, QuizState>,
  documents: [
    { id: DOC_BD1, resource_id: id(0xd0f1), name: "BD-Cours-1.pdf", number: 1, revision: 3, state: "ready", page_count: 74, byte_size: 1820221, model_revision: "gemini-3.5-flash-lite", progress: 100, job_kind: null, attempts: 1, failure: null, created_at: iso(-9), lesson: LESSON_BD1, key: "bd1" },
    { id: DOC_BD2, resource_id: id(0xd0f3), name: "BD-Cours-1.pdf", number: 1, revision: 1, state: "ready", page_count: 74, byte_size: 1820221, model_revision: "gemini-3.5-flash-lite", progress: 100, job_kind: null, attempts: 1, failure: null, created_at: iso(-1), lesson: LESSON_BD2, key: "bd1" },
  ] as DocState[],
  reviewed: new Set<string>(),
  attempts: {} as Record<string, AttemptState>,
  confirmationDone: false,
  bank: [] as Q[],
  conversations: {} as Record<string, Schema["ConversationView"]>,
  counter: 0x100,
};
state.bank = [...BD1_QUESTIONS.slice(0, 4), { ...BD2_GENERATED[0], role: "confirmation", target_misconception_code: "M_FK_SIDE" },
  { ...SIG1_QUESTIONS[1], status: "draft", validated_by: null, validated_at: null }];

// Demo state survives full page reloads (some screens navigate with window.location) for the browser session.
const STORE = "neurvia.demo.state";
(() => {
  if (typeof window === "undefined") return;
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) ?? "null");
    if (!saved) return;
    Object.assign(state, saved.state, { reviewed: new Set(saved.state.reviewed) });
    optionCounter = saved.optionCounter;
    Object.assign(mirrorState, saved.mirror);
  } catch { sessionStorage.removeItem(STORE); }
})();
function persist() {
  sessionStorage.setItem(STORE, JSON.stringify({ state: { ...state, reviewed: [...state.reviewed] }, optionCounter, mirror: mirrorState }));
}
export function resetDemoState() { sessionStorage.removeItem(STORE); }

// ---------- Views ----------
function lessonView(lessonId: string, room: string, role: Role): Schema["LessonView"] {
  const l = state.lessons[lessonId];
  const quiz = l.quiz ? state.quizzes[l.quiz] : undefined;
  return {
    id: lessonId, classroom_id: room, title: l.title, concept_codes: l.concepts, status: l.status, is_synthetic: true,
    content_text: l.content, created_at: l.created, submitted_count: l.submitted, quiz_id: l.quiz,
    quiz_status: quiz?.status ?? null, question_count: quiz?.questions.length ?? 0,
    focus_brief: role === "teacher" ? { pitfalls: ["cardinalités lues du mauvais côté"], difficulty: 2, question_count: 6, instructions: "Privilégier des schémas du cours." } : null,
  };
}
function teacherQuiz(quizId: string): Schema["TeacherQuiz"] {
  const q = state.quizzes[quizId];
  return {
    id: quizId, lesson_id: q.lesson, status: q.status, kind: "initial", generation_mode: q.mode, used_fallback: false,
    questions: q.questions, is_synthetic: true, is_grounded: q.grounded,
    validated_by: q.status === "draft" ? null : "Hela Ben Amor", validated_at: q.status === "draft" ? null : iso(-3),
  };
}
const studentQuestion = (q: Q): Schema["StudentQuestion"] => ({
  id: q.id, concept_code: q.concept_code, stem: q.stem, code: q.code ?? null, options: q.options.map((o) => ({ id: o.id, text: o.text })),
});
function quadrant(correct: boolean, confidence: Schema["Confidence"]): Schema["Quadrant"] {
  if (correct) return confidence === "unsure" ? "fragile" : "acquired";
  return confidence === "sure" ? "misconception" : "gap";
}

function feedback(attemptId: string, quizId: string, answers: Schema["AnswerSaved"][], kind: Schema["QuestionRole"], submitted: string): Schema["Feedback"] {
  const quiz = state.quizzes[quizId];
  const lessonId = quiz.lesson;
  const rows = answers.map((a) => {
    const q = quiz.questions.find((item) => item.id === a.question_id)!;
    const chosen = q.options.find((o) => o.id === a.option_id)!;
    const right = q.options.find((o) => o.is_correct)!;
    return { q, a, chosen, right, correct: chosen.is_correct };
  });
  const suspected = new Map<string, number>();
  rows.forEach((r) => { if (!r.correct && r.chosen.misconception_code) suspected.set(r.chosen.misconception_code, (suspected.get(r.chosen.misconception_code) ?? 0) + 1); });
  return {
    attempt_id: attemptId, correct_count: rows.filter((r) => r.correct).length, answered_count: rows.length,
    total_questions: quiz.questions.length, diagnosis_quality: rows.length >= 4 ? "sufficient" : "insufficient",
    answers: rows.map((r) => ({ question_id: r.q.id, is_correct: r.correct, quadrant: quadrant(r.correct, r.a.confidence),
      correct_option_id: r.right.id, explanation: r.q.explanation, selected_option_id: r.chosen.id, confidence: r.a.confidence })),
    suspected_difficulties: [...suspected].map(([code, count]) => ({
      misconception_code: code, status: kind === "confirmation" ? "corroborated" : "suspected",
      message: kind === "confirmation" ? "Erreur confirmée par une question indépendante : une remédiation ciblée est recommandée." : "Ta réponse correspond à cette erreur de raisonnement. Une question de vérification permettra de la confirmer.",
      evidence_count: count, distinct_questions_count: count })),
    confirmation_available: kind === "initial" && suspected.size > 0, is_synthetic: true, submitted_at: submitted,
    lesson_id: lessonId, classroom_id: state.lessons[lessonId].signal ? ROOM_SIG_A : ROOM_BD_A, kind,
    questions: quiz.questions.filter((q) => answers.some((a) => a.question_id === q.id)).map(studentQuestion),
  };
}

// Yassine already took the BD quiz: 3/6, two cardinality / foreign-key mix-ups given with confidence.
(() => {
  const pick = (n: number, correct: boolean, confidence: Schema["Confidence"]): Schema["AnswerSaved"] => {
    const q = BD1_QUESTIONS[n];
    const option = correct ? q.options.find((o) => o.is_correct)! : q.options.find((o) => !o.is_correct && o.misconception_code) ?? q.options.find((o) => !o.is_correct)!;
    return { question_id: q.id, option_id: option.id, confidence, saved: true };
  };
  const answers = [pick(0, false, "sure"), pick(1, true, "medium"), pick(2, false, "sure"), pick(3, true, "sure"), pick(4, false, "unsure"), pick(5, true, "medium")];
  state.attempts[ATTEMPT_DONE] = { quiz: QUIZ_BD1, answers: Object.fromEntries(answers.map((a) => [a.question_id, a])),
    feedback: feedback(ATTEMPT_DONE, QUIZ_BD1, answers, "initial", iso(-2)) };
})();

const CONFIRMATION: Q = question(31, "C_CARD", "ÉTUDIANT (0,n) — s’inscrit — (1,n) MODULE. Un étudiant peut-il n’être inscrit à aucun module ?", [
  ["Oui, le minimum côté ÉTUDIANT est 0", null], ["Non, il doit suivre au moins un module", "M_CARD_SIDE"], ["Non, il suit exactement un module", "M_CARD_SIDE"], ["On ne peut pas savoir", null]],
"La cardinalité (0,n) se lit côté ÉTUDIANT : il peut n’avoir aucune inscription.", { role: "confirmation" });

function tasks(room: string): Schema["StudentTask"][] {
  const list: Schema["StudentTask"][] = [];
  const done = (quizId: string) => Object.values(state.attempts).some((a) => a.quiz === quizId && a.feedback);
  if (isSignal(room)) {
    if (state.quizzes[QUIZ_SIG1]?.status !== "published") return list;
    list.push({ id: id(0xf101), lesson_id: LESSON_SIG1, classroom_id: room, title: "Quiz · Séries de Fourier", kind: "initial",
      status: done(QUIZ_SIG1) ? "done" : "available", quiz_id: QUIZ_SIG1, due_at: iso(1), is_synthetic: true });
    return list;
  }
  list.push({ id: id(0xf001), lesson_id: LESSON_BD1, classroom_id: room, title: "Quiz · Modèle Entité-Association", kind: "initial", status: "done", quiz_id: QUIZ_BD1, attempt_id: ATTEMPT_DONE, due_at: iso(-2), is_synthetic: true });
  list.push({ id: id(0xf002), lesson_id: LESSON_BD1, classroom_id: room, title: "Associations et cardinalités", kind: "confirmation", status: state.confirmationDone ? "done" : "available", attempt_id: ATTEMPT_DONE, due_at: iso(0), is_synthetic: true });
  list.push({ id: id(0xf003), lesson_id: LESSON_BD1, classroom_id: room, title: "Passage E-A → relationnel", kind: "immediate_retest", status: "pending", quiz_id: QUIZ_BD1, due_at: iso(2), is_synthetic: true });
  list.push({ id: id(0xf004), lesson_id: LESSON_BD1, classroom_id: room, title: "Associations et cardinalités", kind: "j7_retest", status: "pending", quiz_id: QUIZ_BD1, due_at: iso(7), is_synthetic: true });
  return list;
}

// ---------- Course assistant ----------
function assistantAnswer(message: string, lessonId: string): Schema["MessageView"] {
  const signal = state.lessons[lessonId]?.signal;
  const q = message.toLowerCase();
  let text: string, sources: Schema["SourceView"][];
  if (signal || q.includes("fourier") || q.includes("a0") || q.includes("a₀")) {
    text = "D’après votre cours manuscrit, a₀ s’obtient en intégrant terme à terme la série sur [0, 2π] : les intégrales des cosinus et sinus sont nulles, il reste 2π·a₀ = ∫₀^{2π} u(x) dx, donc a₀ = 1/(2π) ∫₀^{2π} u(x) dx. C’est la valeur moyenne du signal. Pour p ≥ 1, aₚ = 1/π ∫₀^{2π} cos(px) u(x) dx et bₚ = 1/π ∫₀^{2π} sin(px) u(x) dx.";
    sources = [page("sig1", 1, "⇒ a₀ = 1/2π ∫₀^{2π} U(x) dx"), page("sig1", 3, "aₚ = 1/π ∫₀^{2π} cos(px) u(x) dx ∀p ≥ 1")];
  } else if (q.includes("étrang") || q.includes("relationnel") || q.includes("tradu")) {
    text = "Dans votre support, une association binaire 1,n se traduit en ajoutant la clé de l’entité côté 1 comme clé étrangère dans la table côté n. Une association n,n devient une table à part, dont la clé est formée des deux clés étrangères.";
    sources = [page("bd1", 49, "Association : exemple"), page("bd1", 60, "Associations plurielles")];
  } else {
    text = "Le support définit la cardinalité comme un couple (min, max) placé entre une entité et une association : il indique combien de fois une occurrence de l’entité participe à l’association. Les étudiants qui se trompent la lisent souvent du côté de l’autre entité. Je vous suggère un exemple CLIENT — passe — COMMANDE en début de séance.";
    sources = [page("bd1", 50, "Cardinalité"), page("bd1", 63, "Diagramme Entité-Association")];
  }
  return { id: id(state.counter++), role: "assistant", text, sources };
}

// ---------- Document pages ----------
type DemoPage = { width: number; height: number; blocks: { bounds: number[]; text: string }[] };
let pagesCache: Promise<Record<string, DemoPage[]>> | null = null;
const loadPages = () => (pagesCache ??= fetch("/backend/demo/pages.json").then((r) => r.json() as Promise<Record<string, DemoPage[]>>));
const SIGNAL_TRANSCRIPTION: Record<number, [string, number][]> = {
  1: [["Chapitre 1 : Séries de Fourier – Coefficients de Fourier", 0.97], ["I – Séries trigonométriques. Définition : on appelle série trigonométrique toute série de fonctions Σ uₙ(x) où le terme général uₙ est une fonction réelle définie sur ℝ : uₙ(x) = aₙ cos(nωx) + bₙ sin(nωx).", 0.81],
    ["(aₙ) et (bₙ) sont des réels indépendants de x, ω un réel positif. T = 2π/ω, ω s’appelle la pulsation et f = 1/T est dite la fréquence.", 0.74],
    ["Cas particulier T = 2π : uₙ(x) = aₙ cos(nx) + bₙ sin(nx). En intégrant terme à terme l’égalité (1) sur [0, 2π], on obtient ∫₀^{2π} U(x) dx = 2π a₀ ⇒ a₀ = 1/2π ∫₀^{2π} U(x) dx.", 0.62]],
  2: [["Par analogie, on va effectuer le calcul des coefficients aₙ et bₙ pour n ≥ 1. Soit p ≥ 1 : cos(px)·U(x) = a₀ cos(px) + Σ aₙ cos(nx) cos(px) + bₙ sin(nx) cos(px) (2)", 0.66],
    ["Notons Iₙ,ₚ = ∫₀^{2π} cos(nx) cos(px) dx, Jₙ,ₚ = ∫₀^{2π} sin(nx) cos(px) dx, Kₙ,ₚ = ∫₀^{2π} sin(nx) sin(px) dx.", 0.58],
    ["On a cos a · cos b = ½ (cos(a + b) + cos(a − b)). Donc Iₙ,ₚ = 0 si n ≠ p et π si n = p. On vérifie de même que Kₙ,ₚ = 0 si n ≠ p, π si n = p, et Jₙ,ₚ = 0.", 0.71]],
  3: [["On obtient : aₚ = 1/π ∫₀^{2π} cos(px) u(x) dx et bₚ = 1/π ∫₀^{2π} sin(px) u(x) dx, ∀p ≥ 1, et a₀ = 1/2π ∫₀^{2π} u(x) dx, b₀ = 0.", 0.69],
    ["Rq : soit g une fonction périodique de période 2π presque partout continue. ∀α ∈ ℝ : ∫₀^{2π} g(t) dt = ∫_α^{α+2π} g(t) dt.", 0.77],
    ["Les formules de a₀, aₙ et bₙ peuvent être généralisées avec un intervalle d’intégration [α, α + 2π], α réel quelconque.", 0.83]],
};
async function pageView(doc: DocState, number: number): Promise<Schema["PageView"]> {
  const pages = await loadPages();
  const p = pages[doc.key][number - 1];
  const signal = doc.key === "sig1";
  const blocks: Schema["BlockView"][] = signal
    ? (SIGNAL_TRANSCRIPTION[number] ?? [[`Page ${number} : suite du calcul des coefficients et exemples (transcription validée).`, 0.9]]).map(([text, confidence], i, all) => {
      const blockId = id(0x5000 + number * 16 + i);
      return { id: blockId, kind: i === 0 && number === 1 ? "heading" : "text", bounds: [0.06, 0.05 + (0.9 / all.length) * i, 0.94, 0.05 + (0.9 / all.length) * (i + 1)],
        text, extracted_text: text, method: "vision", confidence, has_image: false,
        review_required: doc.state === "review" && confidence < 0.8 && !state.reviewed.has(blockId) };
    })
    : p.blocks.slice(0, 12).map((b, i) => ({ id: id(0x6000 + number * 32 + i), kind: "text", bounds: b.bounds, text: b.text, extracted_text: b.text,
      method: "digital", confidence: 0.99, review_required: false, has_image: false }));
  return { number, width: p.width, height: p.height, image_path: `/demo/${doc.key}-p${number}.jpg`, blocks };
}

// ---------- Router ----------
const json = (value: unknown) => value;
const body = (data: unknown) => (data ?? {}) as Record<string, unknown>;

export function demoBackend(route: string, method: string, data: unknown, role: Role, query: URLSearchParams): unknown {
  const result = handle(route, method, data, role, query);
  if (method !== "GET") persist();
  return result;
}

function handle(route: string, method: string, data: unknown, role: Role, query: URLSearchParams): unknown {
  const b = body(data);
  let m: RegExpMatchArray | null;

  if (route === "/demo/advance") return { now: iso(7) };
  if (route === "/classrooms" && method === "GET") return role === "teacher" ? ROOMS : ROOMS.filter((r) => r.cohort_id === COHORT_A);
  if (route === "/taxonomy") return taxonomy();
  if ((m = route.match(/^\/classrooms\/([^/]+)\/lessons$/)) && method === "GET") {
    const ids = isSignal(m[1]) ? [LESSON_SIG1] : [LESSON_BD2, LESSON_BD1];
    return ids.filter((l) => role === "teacher" || state.lessons[l].status !== "draft").map((l) => lessonView(l, m![1], role));
  }
  if ((m = route.match(/^\/classrooms\/([^/]+)\/lessons$/)) && method === "POST") {
    const lessonId = id(state.counter++);
    state.lessons[lessonId] = { title: String(b.title), concepts: (b.concept_codes as string[]) ?? [], status: "draft", quiz: null, created: iso(), submitted: 0, content: String(b.content_text ?? ""), signal: isSignal(m[1]) };
    return lessonView(lessonId, m[1], role);
  }
  if ((m = route.match(/^\/classrooms\/([^/]+)\/members$/)))
    return STUDENTS.map((s) => ({ id: s.id, pseudonym: s.pseudonym, is_synthetic: true }));
  if ((m = route.match(/^\/classrooms\/([^/]+)\/join-code$/))) return ROOMS.find((r) => r.id === m![1]);
  if (route === "/classrooms/join") return ROOMS[0];
  if ((m = route.match(/^\/classrooms\/([^/]+)\/taxonomy$/))) return taxonomy()[0];

  // Curriculum
  if (route === "/subjects" && method === "GET") return [BD, SIG].map((name, i): Schema["SubjectView"] => ({
    id: id(0x5b0 + i), name, key: name, courses: ROOMS.filter((r) => r.subject === name).map((r) => ({
      cohort_id: r.cohort_id!, cohort_name: r.cohort_name!, classroom_id: r.id, student_count: r.cohort_id === COHORT_A ? 24 : 21,
      lesson_count: name === BD ? 2 : 1 })) }));
  if (route === "/subjects" || route.startsWith("/subjects/")) return json({ ok: true });
  if (route === "/cohorts" || route === "/me/cohorts") {
    if (method === "POST") return { id: id(state.counter++), name: String(b.name), student_count: 0 };
    return [{ id: COHORT_A, name: "L2 Informatique A", student_count: 24 }, { id: COHORT_B, name: "L2 Informatique B", student_count: 21 }];
  }
  if (route === "/me/cohort") return { id: COHORT_A, name: "L2 Informatique A", student_count: 24 };

  // Lessons and quizzes (teacher)
  if ((m = route.match(/^\/lessons\/([^/]+)$/)) && state.lessons[m[1]]) {
    if (method === "PATCH") Object.assign(state.lessons[m[1]], { title: b.title ?? state.lessons[m[1]].title, concepts: b.concept_codes ?? state.lessons[m[1]].concepts, content: b.content_text ?? state.lessons[m[1]].content });
    return lessonView(m[1], state.lessons[m[1]].signal ? ROOM_SIG_A : ROOM_BD_A, role);
  }
  if ((m = route.match(/^\/lessons\/([^/]+)\/quiz\/generate$/))) {
    const signal = state.lessons[m[1]]?.signal;
    const quizId = m[1] === LESSON_BD2 ? QUIZ_BD2 : m[1] === LESSON_SIG1 ? QUIZ_SIG1 : id(state.counter++);
    const drafts = (signal ? SIG1_QUESTIONS : BD2_GENERATED).map((q) => ({ ...q, status: "draft" as const, validated_by: null, validated_at: null }));
    state.quizzes[quizId] = { lesson: m[1], status: "draft", mode: signal ? "llm" : "mixed", grounded: true, questions: structuredClone(drafts) };
    state.lessons[m[1]].quiz = quizId;
    return teacherQuiz(quizId);
  }
  if ((m = route.match(/^\/quizzes\/([^/]+)$/)) && state.quizzes[m[1]]) return teacherQuiz(m[1]);
  if ((m = route.match(/^\/quizzes\/([^/]+)\/publish$/))) {
    const quiz = state.quizzes[m[1]];
    quiz.status = "published"; quiz.questions = quiz.questions.map((q) => ({ ...q, status: "validated", validated_by: "Hela Ben Amor", validated_at: iso() }));
    state.lessons[quiz.lesson].status = "published";
    return teacherQuiz(m[1]);
  }
  if ((m = route.match(/^\/quizzes\/([^/]+)\/close$/))) {
    state.quizzes[m[1]].status = "closed"; state.lessons[state.quizzes[m[1]].lesson].status = "closed";
    return teacherQuiz(m[1]);
  }
  if ((m = route.match(/^\/quizzes\/([^/]+)\/questions\/([^/]+)\/regenerate$/))) {
    const quiz = state.quizzes[m[1]];
    quiz.questions = quiz.questions.map((q) => q.id === m![2] ? { ...q, stem: q.stem.replace(/\?$/, " (reformulée par Neurvia) ?"), version: q.version + 1, status: "draft" } : q);
    return teacherQuiz(m[1]);
  }
  if ((m = route.match(/^\/quizzes\/([^/]+)\/questions(?:\/([^/]+))?$/)) && method !== "GET") {
    const quiz = state.quizzes[m[1]];
    if (method === "DELETE") quiz.questions = quiz.questions.filter((q) => q.id !== m![2]);
    else {
      const draft = b as unknown as Schema["QuestionDraft"];
      const next: Q = { ...(quiz.questions.find((q) => q.id === m![2]) ?? question(state.counter++, draft.concept_code, "", [], "")),
        concept_code: draft.concept_code, stem: draft.stem, code: draft.code ?? null, explanation: draft.explanation, difficulty: draft.difficulty,
        source: "teacher", status: "draft", options: draft.options.map((o) => ({ ...o, id: id(optionCounter++), misconception_code: o.misconception_code ?? null })) };
      quiz.questions = m[2] ? quiz.questions.map((q) => (q.id === m![2] ? next : q)) : [...quiz.questions, { ...next, id: id(state.counter++) }];
    }
    return teacherQuiz(m[1]);
  }

  // Documents and course assistant
  if ((m = route.match(/^\/lessons\/([^/]+)\/documents$/))) {
    if (method === "POST") {
      if (state.lessons[m[1]]?.signal && !state.documents.some((d) => d.id === DOC_SIG1))
        state.documents.push({ id: DOC_SIG1, resource_id: id(0xd0f2), name: "Chapitre-1.pdf", number: 1, revision: 1, state: "processing",
          page_count: 12, byte_size: 8135479, model_revision: "gemini-3.5-flash-lite", progress: 4, job_kind: "extract", attempts: 1,
          failure: null, created_at: iso(), lesson: m[1], key: "sig1", uploadedAt: Date.now() });
      return state.documents.find((d) => d.lesson === m![1]);
    }
    for (const doc of state.documents) {
      if (doc.state !== "processing" || !doc.uploadedAt) continue;
      const elapsed = Date.now() - doc.uploadedAt;
      if (elapsed < 9000) doc.progress = Math.max(4, Math.round(elapsed / 90));
      else Object.assign(doc, { state: "review", progress: 100, job_kind: null, revision: 2 });
    }
    return state.documents.filter((d) => d.lesson === m![1]);
  }
  if ((m = route.match(/^\/lessons\/([^/]+)\/documents\/usage$/))) return { originals_bytes: 9955700, rendered_bytes: 3100000, crops_bytes: 120000, versions: 3 };
  if ((m = route.match(/^\/lessons\/[^/]+\/documents\/([^/]+)\/pages\/(\d+)$/))) {
    const doc = state.documents.find((d) => d.id === m![1])!;
    return pageView(doc, Number(m[2]));
  }
  if ((m = route.match(/^\/lessons\/[^/]+\/documents\/([^/]+)\/blocks\/([^/]+)$/))) {
    const doc = state.documents.find((d) => d.id === m![1])!;
    state.reviewed.add(m[2]); doc.revision += 1;
    return doc;
  }
  if ((m = route.match(/^\/lessons\/[^/]+\/documents\/([^/]+)\/(review|retry)$/))) {
    const doc = state.documents.find((d) => d.id === m![1])!;
    doc.state = "ready"; doc.revision += 1; doc.failure = null;
    return doc;
  }
  if ((m = route.match(/^\/lessons\/([^/]+)\/documents\/([^/]+)$/))) return state.documents.find((d) => d.id === m![2]);
  if ((m = route.match(/^\/lessons\/([^/]+)\/course-assistant$/))) {
    if (method === "GET") return state.conversations[m[1]] ?? null;
    const conversation: Schema["ConversationView"] = { id: id(state.counter++), messages: [], brief_revision: 1,
      brief: { focus_topics: [], exclusions: [], observed_difficulties: ["Lecture des cardinalités"], question_count: 3, difficulty: 2 } };
    return (state.conversations[m[1]] = conversation);
  }
  if ((m = route.match(/^\/lessons\/([^/]+)\/course-assistant\/([^/]+)\/messages$/))) {
    const conversation = state.conversations[m[1]];
    conversation.messages = [...conversation.messages,
      { id: id(state.counter++), role: "teacher", text: String(b.message), sources: [] }, assistantAnswer(String(b.message), m[1])];
    if (String(b.message).match(/\d+ questions?/)) conversation.brief = { ...conversation.brief, question_count: Number(String(b.message).match(/(\d+) questions?/)![1]) };
    conversation.brief_revision += 1;
    return new Promise((resolve) => setTimeout(() => resolve({ ...conversation }), 1400));
  }
  if ((m = route.match(/^\/lessons\/([^/]+)\/course-assistant\/([^/]+)\/brief$/))) return state.conversations[m[1]];
  if ((m = route.match(/^\/lessons\/([^/]+)\/course-assistant\/quiz$/))) {
    const signal = state.lessons[m[1]]?.signal;
    state.quizzes[QUIZ_GROUNDED] = { lesson: m[1], status: "draft", mode: "llm", grounded: true,
      questions: (signal ? SIG1_QUESTIONS.slice(0, 3) : BD1_QUESTIONS.slice(0, 3)).map((q) => ({ ...q, status: "draft", validated_by: null, validated_at: null })) };
    state.lessons[m[1]].quiz ??= QUIZ_GROUNDED;
    return new Promise((resolve) => setTimeout(() => resolve(teacherQuiz(QUIZ_GROUNDED)), 1800));
  }
  if ((m = route.match(/^\/lessons\/([^/]+)\/course-assistant\/variants$/))) {
    const skip = (b.skip as string[]) ?? [];
    const pool = [CONFIRMATION, BD2_GENERATED[2]].filter((q) => !skip.includes(q.id));
    return { question: pool[0] ?? null, remaining: Math.max(0, pool.length - 1), attempted: skip } satisfies Schema["VariantResult"];
  }

  // Analytics, MindMirror and groups: any demo lesson uses the BD class constellation.
  if ((m = route.match(/^\/lessons\/([^/]+)\/(graph|dashboard|groups|groups\/suggest|before-after|retest|j7\/schedule|members\/[^/]+\/difficulty-assistance)$/)))
    return mirrorResponse(`/lessons/${DEMO_LESSON}/${m[2]}`, method, data);
  if (route.startsWith("/groups/") || route.startsWith("/interventions/")) return mirrorResponse(route, method, data);

  // Question bank
  if (route === "/bank/questions" && method === "GET") return state.bank;
  if (route === "/bank/questions" && method === "POST") {
    const draft = b as unknown as Schema["BankQuestionCreate"];
    const created: Q = { ...question(state.counter++, draft.concept_code, draft.stem, [], draft.explanation),
      options: draft.options.map((o) => ({ ...o, id: id(optionCounter++), misconception_code: o.misconception_code ?? null })),
      role: draft.role, status: "draft", source: "teacher", validated_by: null, validated_at: null, target_misconception_code: draft.target_misconception_code ?? null };
    state.bank = [created, ...state.bank];
    return created;
  }
  if ((m = route.match(/^\/bank\/questions\/([^/]+)\/approve$/))) {
    state.bank = state.bank.map((q) => q.id === m![1] ? { ...q, status: "validated", validated_by: "Hela Ben Amor", validated_at: iso() } : q);
    return state.bank.find((q) => q.id === m![1]);
  }

  // Student
  if (route === "/me/tasks") return tasks(query.get("classroom_id") ?? ROOM_BD_A);
  if (route === "/me/feedback") {
    const room = query.get("classroom_id") ?? ROOM_BD_A;
    return Object.values(state.attempts).filter((a) => a.feedback && a.feedback.classroom_id === (isSignal(room) ? ROOM_SIG_A : ROOM_BD_A))
      .map((a) => ({ ...a.feedback!, classroom_id: room })).reverse();
  }
  if (route === "/me/interventions") return isSignal(query.get("classroom_id") ?? "") ? [] : [{
    id: id(0xf00f), lesson_id: LESSON_BD1, lesson_title: state.lessons[LESSON_BD1].title, assigned_at: iso(-1), is_synthetic: true,
    plan: { title: "Lire une cardinalité du bon côté", objective: "Lire correctement les cardinalités (min, max) d’une association.", duration_min: 10,
      steps: [{ start_min: 0, end_min: 3, action: "Relire BD-Cours-1.pdf p. 50 : la cardinalité se lit côté entité." },
        { start_min: 3, end_min: 7, action: "Lire à voix haute 3 associations du cours en complétant « un client passe… »." },
        { start_min: 7, end_min: 10, action: "Répondre à la question de vérification." }],
      example: "CLIENT (0,n) — passe — (1,1) COMMANDE : un client passe 0 à n commandes.",
      counter_example: "Lire « un client passe une seule commande ».",
      explanation: "Le couple (min, max) décrit combien de fois une occurrence de l’entité participe à l’association.",
      check_question: "ÉTUDIANT (0,n) — s’inscrit — (1,n) MODULE : un étudiant peut-il n’avoir aucun module ?" },
  }] satisfies Schema["AssignedPlan"][];
  if ((m = route.match(/^\/quizzes\/([^/]+)\/attempts$/))) {
    const open = Object.entries(state.attempts).find(([, a]) => a.quiz === m![1] && !a.feedback);
    const attemptId = open?.[0] ?? id(state.counter++);
    if (!open) state.attempts[attemptId] = { quiz: m[1], answers: {} };
    const quiz = state.quizzes[m[1]];
    return { id: attemptId, quiz_id: m[1], status: "in_progress", kind: "initial", is_synthetic: true,
      questions: quiz.questions.map(studentQuestion), saved_answers: Object.values(state.attempts[attemptId].answers) } satisfies Schema["AttemptView"];
  }
  if ((m = route.match(/^\/attempts\/([^/]+)\/answers$/))) {
    const answer = { ...(b as unknown as Schema["AnswerInput"]), saved: true as const };
    state.attempts[m[1]].answers[answer.question_id] = answer;
    return answer;
  }
  if ((m = route.match(/^\/attempts\/([^/]+)\/submit$/))) {
    const attempt = state.attempts[m[1]];
    attempt.feedback = feedback(m[1], attempt.quiz, Object.values(attempt.answers), "initial", iso());
    state.lessons[state.quizzes[attempt.quiz].lesson].submitted += 1;
    return attempt.feedback;
  }
  if ((m = route.match(/^\/attempts\/([^/]+)\/feedback$/))) return state.attempts[m[1]]?.feedback;
  if ((m = route.match(/^\/attempts\/([^/]+)\/confirmation$/))) {
    if (method === "GET") return state.confirmationDone ? null : { question: studentQuestion(CONFIRMATION), misconception_code: "M_CARD_SIDE", is_synthetic: true };
    state.confirmationDone = true;
    const answer = { ...(b as unknown as Schema["AnswerInput"]), saved: true as const };
    const quizId = id(0xc0c);
    state.quizzes[quizId] ??= { lesson: LESSON_BD1, status: "published", questions: [CONFIRMATION], mode: "bank", grounded: false };
    const attemptId = id(state.counter++);
    state.attempts[attemptId] = { quiz: quizId, answers: { [answer.question_id]: answer },
      feedback: feedback(attemptId, quizId, [answer], "confirmation", iso()) };
    return state.attempts[attemptId].feedback;
  }
  return undefined;
}
