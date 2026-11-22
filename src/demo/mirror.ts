// Demo-mode responses for MindMirror and Groupes, built from the fictional class in ./data.
import { CONCEPTS, MISCONCEPTIONS, STUDENTS } from "./data";
import type { Schema } from "../lib/api";

export const DEMO_LESSON = "00000000-0000-4000-8000-00000000c001";
const CONCEPT_CODES = ["C_CARD", "C_EA_REL", "C_KEYS", "C_ALG"];
const now = () => new Date().toISOString();

const PLANS: Record<string, Schema["RemediationPlan"]> = {
  M_CARD_SIDE: {
    title: "Lire une cardinalité du bon côté", objective: "Lire correctement les cardinalités (min, max) d’une association.",
    duration_min: 10, steps: [
      { start_min: 0, end_min: 3, action: "Rappel : la cardinalité se lit du côté de l’entité, « un client passe… »." },
      { start_min: 3, end_min: 7, action: "Par deux, lire à voix haute 3 associations du cours (BD-Cours-1.pdf p. 50)." },
      { start_min: 7, end_min: 10, action: "Question de vérification individuelle, réponse avec niveau de confiance." },
    ],
    example: "CLIENT (0,n) — passe — (1,1) COMMANDE : un client passe 0 à n commandes.",
    counter_example: "Lire « un client passe une seule commande » en prenant le (1,1) côté COMMANDE.",
    explanation: "Chaque couple (min, max) décrit combien de fois une occurrence de l’entité voisine participe à l’association.",
    check_question: "ÉTUDIANT (0,n) — s’inscrit — (1,n) MODULE : un étudiant peut-il n’avoir aucun module ?",
  },
  M_FK_SIDE: {
    title: "Placer la clé étrangère côté n", objective: "Traduire une association 1,n par une clé étrangère du bon côté.",
    duration_min: 10, steps: [
      { start_min: 0, end_min: 3, action: "Règle : la clé de l’entité côté 1 migre dans la table côté n." },
      { start_min: 3, end_min: 8, action: "Traduire CLIENT–COMMANDE puis AUTEUR–LIVRE au tableau (BD-cours-2.pdf p. 11)." },
      { start_min: 8, end_min: 10, action: "Question de vérification individuelle." },
    ],
    example: "COMMANDE(id_commande, date, #id_client)", counter_example: "CLIENT(id_client, nom, #id_commande)",
    explanation: "Une commande n’a qu’un client : c’est donc elle qui peut stocker sa référence.",
    check_question: "SERVICE (1,1) — emploie — (0,n) EMPLOYÉ : dans quelle table va la clé étrangère ?",
  },
  M_SEL_PROJ: {
    title: "Sélection ou projection ?", objective: "Distinguer σ (lignes) et π (colonnes).", duration_min: 10, steps: [
      { start_min: 0, end_min: 3, action: "σ filtre des lignes, π garde des colonnes : schéma au tableau." },
      { start_min: 3, end_min: 8, action: "Classer 6 requêtes en σ, π ou les deux (BD-Cours-4.pdf p. 35-48)." },
      { start_min: 8, end_min: 10, action: "Question de vérification individuelle." },
    ],
    example: "σ ville='Sousse' (CLIENT)", counter_example: "π ville='Sousse' (CLIENT)",
    explanation: "Une condition porte toujours sur des lignes : elle appelle une sélection.",
    check_question: "Pour obtenir les noms des clients de Sousse, dans quel ordre appliquer σ et π ?",
  },
};

type State = {
  groups: Record<string, { status: Schema["GroupStatus"]; members?: string[]; intervention?: Schema["InterventionView"] }>;
};
const state: State = { groups: {} };

function lesson(): Schema["LessonView"] {
  return {
    id: DEMO_LESSON, classroom_id: "demo", title: "Chapitre 1 · Conception et modèle Entité-Association",
    concept_codes: CONCEPT_CODES, status: "published", is_synthetic: true, created_at: now(),
    submitted_count: 22, question_count: 12, quiz_id: "00000000-0000-4000-8000-00000000c002", quiz_status: "published",
  };
}

function taxonomy(): Schema["ConceptView"][] {
  return CONCEPTS.map((concept) => ({
    code: concept.code, label_fr: concept.name, subject: "Bases de données",
    misconceptions: MISCONCEPTIONS.filter((m) => m.concept === concept.code).map((m) => ({ code: m.code, label_fr: m.label })),
  }));
}

// Each misconception is held by as many students as the class statistics say (11, 9, 8, 7, 5).
const HOLDERS: Record<string, Set<number>> = Object.fromEntries(MISCONCEPTIONS.map((m, mi) => [
  m.code, new Set(Array.from({ length: m.students }, (_, j) => (j * 5 + mi * 3) % STUDENTS.length)),
]));

function errorsOf(index: number) {
  return MISCONCEPTIONS.filter((m) => HOLDERS[m.code].has(index)).map((m) => m.code).slice(0, 2);
}

const GROUP_SOURCES = ["M_CARD_SIDE", "M_FK_SIDE", "M_SEL_PROJ"];

function groups(): Schema["GroupView"][] {
  return GROUP_SOURCES.map((code, index) => {
    const id = `00000000-0000-4000-8000-0000000d000${index + 1}`;
    const saved = state.groups[id];
    const defaults = STUDENTS.filter((_, i) => errorsOf(i).includes(code)).map((s) => s.id);
    const misconception = MISCONCEPTIONS.find((m) => m.code === code)!;
    return {
      id, label: "Groupe " + (index + 1) + " · " + misconception.label, student_ids: saved?.members ?? defaults,
      main_misconception_code: code, status: saved?.status ?? "suggested",
      confidence_label: index < 2 ? "corroborated" : "provisional",
      evidence_summary: `${defaults.length} étudiants choisissent la même mauvaise réponse sur deux questions indépendantes`
        + (index < 2 ? ", confirmée par une variante." : ". À confirmer par une variante."),
      avg_similarity: 0.82 - index * 0.07, is_synthetic: true, intervention: saved?.intervention ?? null,
    };
  });
}

function graph(): Schema["Graph"] {
  const nodes: Schema["GraphNode"][] = STUDENTS.map((student, index) => {
    const rates = Object.fromEntries(CONCEPT_CODES.map((code) => [code, Math.round(student.mastery[code] * 100) / 100]));
    const answered = student.engagement < 0.32 ? 3 : 12;
    const percent = CONCEPT_CODES.reduce((sum, code) => sum + student.mastery[code], 0) / CONCEPT_CODES.length;
    const errors = errorsOf(index);
    return {
      id: student.id, label: student.name, is_synthetic: true, answered_count: answered,
      percent_correct: answered < 4 ? null : percent, correct_count: Math.round(percent * answered),
      concept_rates: answered < 4 ? {} : rates, misconception_codes: answered < 4 ? [] : errors,
      diagnosis_quality: answered < 4 ? "insufficient" : errors.length === 0 ? "no_observed_error"
        : index % 4 === 0 ? "suspected" : "corroborated",
    };
  });
  const edges: Schema["GraphEdge"][] = [];
  for (let a = 0; a < nodes.length; a += 1)
    for (let b = a + 1; b < nodes.length; b += 1) {
      const shared = nodes[a].misconception_codes.filter((code) => nodes[b].misconception_codes.includes(code));
      if (shared.length) edges.push({ source: nodes[a].id, target: nodes[b].id, similarity: 0.6 + shared.length * 0.15, provisional: (a + b) % 5 === 0 });
    }
  return { nodes, edges, groups: groups(), is_synthetic: true };
}

function dashboard(): Schema["Dashboard"] {
  return {
    lesson_id: DEMO_LESSON, is_synthetic: true,
    participation: { enrolled_count: 24, submitted_count: 22, insufficient_count: 3 },
    priorities: MISCONCEPTIONS.slice(0, 4).map((m, index) => ({
      misconception_code: m.code, label: m.label, affected_students: m.students, observed_count: m.students + 4,
      corroborated_students: m.confident, confident_wrong_share: m.confident / m.students, priority_score: 0.9 - index * 0.15,
    })),
    insights: [
      { kind: "same_score_different_errors", labels: ["Malek", "Adam"], scores: [58, 58], misconception_codes: ["M_CARD_SIDE", "M_SEL_PROJ"] },
      { kind: "different_scores_shared_error", labels: ["Ines", "Hamza"], scores: [83, 42], misconception_codes: ["M_FK_SIDE"] },
    ],
  };
}

function counts(correct: number, attempts: number): Schema["Counts"] {
  return { correct, attempts, rate: attempts ? correct / attempts : null };
}

function beforeAfter(): Schema["BeforeAfter"] {
  const rows = [[7, 22, 16, 21, 15, 20], [9, 22, 16, 22, 14, 21], [10, 22, 15, 22, 14, 21], [12, 22, 16, 22, 15, 21]];
  return {
    lesson_id: DEMO_LESSON, is_synthetic: true,
    concepts: CONCEPT_CODES.map((code, i) => ({
      concept_code: code, initial: counts(rows[i][0], rows[i][1]), immediate: counts(rows[i][2], rows[i][3]), j7: counts(rows[i][4], rows[i][5]),
    })),
    error_counts: groups().map((group, i) => ({
      group_id: group.id, misconception_code: group.main_misconception_code,
      initial: counts(2 + i, 11 - i), immediate: counts(8 - i, 11 - i), j7: counts(7 - i, 11 - i),
    })),
  };
}

function schedule(kind: Schema["RetestKind"]): Schema["ScheduleResult"] {
  const due = new Date(Date.now() + (kind === "j7" ? 7 : 2) * 86400000).toISOString();
  return { lesson_id: DEMO_LESSON, is_synthetic: true, schedules: CONCEPT_CODES.slice(0, 2).map((code, i) => ({
    id: `00000000-0000-4000-8000-0000000e000${i}`, concept_code: code, kind, status: "pending", due_at: due,
  })) };
}

function findIntervention(id: string) {
  return Object.values(state.groups).find((g) => g.intervention?.id === id);
}

/** Mock for MindMirror and Groupes endpoints; undefined when the path is not handled here. */
export function mirrorResponse(route: string, method: string, data: unknown): unknown {
  const body = (data ?? {}) as Record<string, unknown>;
  if (/^\/classrooms\/[^/]+\/lessons$/.test(route) && method === "GET") return [lesson()];
  if (/^\/classrooms\/[^/]+\/members$/.test(route))
    return STUDENTS.map((s) => ({ id: s.id, pseudonym: s.pseudonym, is_synthetic: true }));
  if (route === "/taxonomy") return taxonomy();
  if (route === `/lessons/${DEMO_LESSON}`) return lesson();
  if (route === `/lessons/${DEMO_LESSON}/graph`) return graph();
  if (route === `/lessons/${DEMO_LESSON}/dashboard`) return dashboard();
  if (route === `/lessons/${DEMO_LESSON}/groups`) return groups();
  if (route === `/lessons/${DEMO_LESSON}/groups/suggest`) return groups();
  if (route === `/lessons/${DEMO_LESSON}/before-after`) return beforeAfter();
  if (route === `/lessons/${DEMO_LESSON}/retest`) return schedule("immediate");
  if (route === `/lessons/${DEMO_LESSON}/j7/schedule`) return schedule("j7");
  const member = route.match(/^\/lessons\/[^/]+\/members\/([^/]+)\/difficulty-assistance$/);
  if (member) {
    const index = STUDENTS.findIndex((s) => s.id === member[1]);
    const misconceptions = MISCONCEPTIONS.filter((m) => errorsOf(Math.max(0, index)).includes(m.code));
    return { model: "gemini-3.5-flash-lite", evidence: misconceptions.map((m) => ({
      question: m.code === "M_CARD_SIDE" ? "CLIENT (0,n) — passe — (1,1) COMMANDE : combien de commandes un client peut-il passer ?"
        : m.code === "M_FK_SIDE" ? "Dans quelle table placer la clé étrangère de l’association CLIENT–COMMANDE ?"
          : "Quelle expression donne les clients de Sousse ?",
      selected_option: m.example, confidence: "sure" as const, objective: m.fix, misconception_label: m.label,
      rationale: "La réponse choisie correspond exactement à cette erreur, et l’étudiant s’est déclaré sûr de lui.",
    })) } satisfies Schema["DifficultyAssistance"];
  }
  const group = route.match(/^\/groups\/([^/]+)$/);
  if (group && method === "PATCH") {
    const action = body.action as string;
    state.groups[group[1]] = { ...state.groups[group[1]],
      status: action === "reject" ? "rejected" : action === "modify" ? "modified" : "accepted",
      ...(action === "modify" ? { members: body.student_ids as string[] } : {}) };
    return groups().find((g) => g.id === group[1]);
  }
  const plan = route.match(/^\/groups\/([^/]+)\/remediation$/);
  if (plan) {
    const view = groups().find((g) => g.id === plan[1])!;
    const intervention: Schema["InterventionView"] = {
      id: plan[1].replace("0000000d", "0000000f"), group_id: plan[1], status: "draft", source: "llm", used_fallback: false,
      is_synthetic: true, plan: PLANS[view.main_misconception_code],
    };
    state.groups[plan[1]] = { ...state.groups[plan[1]], status: state.groups[plan[1]]?.status ?? "accepted", intervention };
    return intervention;
  }
  const edit = route.match(/^\/interventions\/([^/]+)$/);
  if (edit && method === "PATCH") {
    const saved = findIntervention(edit[1]);
    if (saved?.intervention) saved.intervention = { ...saved.intervention, plan: body.plan as Schema["RemediationPlan"], source: "teacher" };
    return saved?.intervention;
  }
  const assign = route.match(/^\/interventions\/([^/]+)\/assign$/);
  if (assign) {
    const saved = findIntervention(assign[1]);
    if (saved?.intervention) saved.intervention = { ...saved.intervention, status: "assigned" };
    return saved?.intervention;
  }
  return undefined;
}
