// Fictional data for demo mode and for the insight pages. Every name and number here is made up.

export type Concept = {
  code: string;
  name: string;
  chapter: string;
  prereqs: string[];
  /** Student's estimated mastery (0–1) and its 80% range. */
  mastery: number;
  low: number;
  high: number;
  /** Days since the concept was last practised. */
  lastSeen: number;
  /** Days without progress despite practice. */
  plateau: number;
  source: string;
};

export const CONCEPTS: Concept[] = [
  { code: "C_VARS", name: "Variables et affectation", chapter: "Ch. 1 · Bases", prereqs: [], mastery: 0.91, low: 0.84, high: 0.96, lastSeen: 9, plateau: 0, source: "Chapitre-1-5.pdf · p. 3" },
  { code: "C_TYPES", name: "Types et conversions", chapter: "Ch. 1 · Bases", prereqs: ["C_VARS"], mastery: 0.48, low: 0.36, high: 0.6, lastSeen: 4, plateau: 11, source: "Chapitre-1-5.pdf · p. 7" },
  { code: "C_INPUT", name: "Entrées / sorties (input, print)", chapter: "Ch. 1 · Bases", prereqs: ["C_TYPES"], mastery: 0.55, low: 0.41, high: 0.68, lastSeen: 4, plateau: 3, source: "Chapitre-1-5.pdf · p. 11" },
  { code: "C_CONDITIONS", name: "Conditions et logique booléenne", chapter: "Ch. 2 · Contrôle", prereqs: ["C_TYPES"], mastery: 0.62, low: 0.5, high: 0.73, lastSeen: 2, plateau: 0, source: "Chapitre-2-5.pdf · p. 4" },
  { code: "C_LOOPS", name: "Boucles for et range", chapter: "Ch. 2 · Contrôle", prereqs: ["C_CONDITIONS"], mastery: 0.44, low: 0.3, high: 0.58, lastSeen: 1, plateau: 2, source: "Chapitre-2-5.pdf · p. 9" },
  { code: "C_WHILE", name: "Boucles while", chapter: "Ch. 2 · Contrôle", prereqs: ["C_CONDITIONS"], mastery: 0.57, low: 0.42, high: 0.7, lastSeen: 6, plateau: 0, source: "Chapitre-2-5.pdf · p. 14" },
  { code: "C_INDEXING", name: "Listes et indexation", chapter: "Ch. 3 · Données", prereqs: ["C_LOOPS"], mastery: 0.38, low: 0.24, high: 0.53, lastSeen: 1, plateau: 0, source: "Chapitre-3-2.pdf · p. 5" },
  { code: "C_FUNCTIONS", name: "Fonctions et return", chapter: "Ch. 3 · Données", prereqs: ["C_INDEXING", "C_INPUT"], mastery: 0.29, low: 0.15, high: 0.46, lastSeen: 0, plateau: 0, source: "Chapitre-3-2.pdf · p. 12" },
  { code: "C_RECURSION", name: "Récursivité", chapter: "Ch. 3 · Données", prereqs: ["C_FUNCTIONS"], mastery: 0.12, low: 0.03, high: 0.3, lastSeen: 99, plateau: 0, source: "Chapitre-3-2.pdf · p. 21" },
];

export const conceptByCode = Object.fromEntries(CONCEPTS.map((c) => [c.code, c]));

export type Misconception = {
  code: string;
  concept: string;
  label: string;
  example: string;
  fix: string;
  students: number;
  confident: number;
};

export const MISCONCEPTIONS: Misconception[] = [
  { code: "M_OFF_BY_ONE", concept: "C_INDEXING", label: "Décalage d’indice (le dernier élément est à len)", example: "valeurs[len(valeurs)] → IndexError", fix: "Une liste de n éléments a des indices de 0 à n − 1. Le dernier est valeurs[-1] ou valeurs[n - 1].", students: 11, confident: 7 },
  { code: "M_TYPE_INPUT", concept: "C_TYPES", label: "input() renvoie un nombre", example: "n = input(); n + 2 → TypeError", fix: "input() renvoie toujours une chaîne. Convertis avec int(...) ou float(...) avant de calculer.", students: 9, confident: 6 },
  { code: "M_RANGE_END", concept: "C_LOOPS", label: "range(n) inclut n", example: "range(5) → 0..5 ?", fix: "range(n) s’arrête avant n : range(5) donne 0, 1, 2, 3, 4.", students: 8, confident: 3 },
  { code: "M_RETURN_PRINT", concept: "C_FUNCTIONS", label: "Confondre print et return", example: "def f(): print(3) → f() + 1 échoue", fix: "print affiche une valeur ; return la renvoie à l’appelant pour qu’il l’utilise.", students: 7, confident: 4 },
  { code: "M_COND_LOGIC", concept: "C_CONDITIONS", label: "Inverser and et or", example: "badge or code pour « les deux »", fix: "and exige que les deux conditions soient vraies, or qu’au moins une le soit.", students: 5, confident: 2 },
];

const FIRST = ["Adam", "Nour", "Marwan", "Mariam", "Yassine", "Ines", "Ayoub", "Lina", "Omar", "Salma", "Hamza", "Rania", "Karim", "Eya", "Mehdi", "Yasmine", "Aziz", "Sarra", "Firas", "Malek", "Skander", "Amira", "Wassim", "Chaima"];

function seeded(seed: number) {
  let state = seed;
  return () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
}

export type StudentRow = {
  id: string;
  name: string;
  pseudonym: string;
  mastery: Record<string, number>;
  engagement: number;
  trend: number;
  lastActive: number;
  mainMisconception?: string;
};

export const STUDENTS: StudentRow[] = FIRST.map((name, index) => {
  const random = seeded(index * 97 + 13);
  const ability = 0.55 + random() * 0.42;
  const mastery: Record<string, number> = {};
  CONCEPTS.forEach((concept, depth) => {
    const base = ability - depth * 0.04 + (random() - 0.5) * 0.3;
    mastery[concept.code] = Math.max(0.03, Math.min(0.98, base));
  });
  const engagement = index === 4 || index === 17 || index === 21 ? 0.18 + random() * 0.12 : 0.45 + random() * 0.5;
  const weakest = MISCONCEPTIONS[Math.floor(random() * MISCONCEPTIONS.length)];
  return {
    id: "s" + index,
    name,
    pseudonym: "Étudiant·e " + String(index + 1).padStart(2, "0"),
    mastery,
    engagement,
    trend: Math.round((random() - 0.35) * 24),
    lastActive: engagement < 0.32 ? 6 + Math.floor(random() * 5) : Math.floor(random() * 3),
    mainMisconception: ability < 0.7 ? weakest.code : undefined,
  };
});

export const WEEKLY = [
  { week: "S1", mastery: 41, participation: 72 },
  { week: "S2", mastery: 46, participation: 78 },
  { week: "S3", mastery: 49, participation: 81 },
  { week: "S4", mastery: 55, participation: 79 },
  { week: "S5", mastery: 63, participation: 88 },
];

export const BEFORE_AFTER = [
  { label: "Décalage d’indice", before: 31, after: 74, j7: 69 },
  { label: "input() et types", before: 38, after: 71, j7: 66 },
  { label: "range(n)", before: 44, after: 68, j7: 64 },
];

export type ReviewItem = { concept: string; due: number; reason: string };

export const REVIEW: ReviewItem[] = [
  { concept: "C_TYPES", due: 0, reason: "Plateau de 11 jours : les quiz ne font plus progresser, on passe à « Explique-le »." },
  { concept: "C_VARS", due: 0, reason: "Bien maîtrisé, revu il y a 9 jours : rappel espacé pour consolider." },
  { concept: "C_WHILE", due: 1, reason: "Incertitude élevée (42–70 %) : une question de plus affine l’estimation." },
  { concept: "C_CONDITIONS", due: 3, reason: "Progression régulière, prochaine révision dans 3 jours." },
  { concept: "C_INDEXING", due: 4, reason: "Pratiqué hier. On laisse reposer avant de revenir." },
];

/** Key ideas the student should cover in an "Explique-le" for each concept. */
export const KEY_IDEAS: Record<string, { idea: string; words: string[] }[]> = {
  C_TYPES: [
    { idea: "input() renvoie toujours une chaîne (str)", words: ["chaîne", "chaine", "str", "texte", "string"] },
    { idea: "Il faut convertir avec int() ou float() pour calculer", words: ["int(", "int ", "float", "convert"] },
    { idea: "Chaque valeur a un type (int, float, str, bool)", words: ["type", "bool", "entier", "réel"] },
    { idea: "Additionner str et int provoque une erreur (TypeError)", words: ["erreur", "typeerror", "concat", "impossible"] },
  ],
  C_INDEXING: [
    { idea: "Les indices commencent à 0", words: ["0", "zéro", "zero"] },
    { idea: "Le dernier indice vaut len(liste) − 1", words: ["len", "-1", "− 1", "moins un", "n-1", "n - 1"] },
    { idea: "Un indice hors limites provoque IndexError", words: ["indexerror", "erreur", "hors", "dépasse"] },
    { idea: "Les indices négatifs partent de la fin", words: ["négatif", "negatif", "fin", "[-1]"] },
  ],
  C_LOOPS: [
    { idea: "range(n) produit 0 à n − 1", words: ["n-1", "n - 1", "avant", "exclu", "0"] },
    { idea: "La boucle for parcourt chaque élément", words: ["chaque", "parcourt", "élément", "itère"] },
    { idea: "range(a, b, pas) contrôle début, fin et pas", words: ["pas", "début", "step", "range(a"] },
  ],
};

export const COACH_STUDENT = { name: "Nour Mabrouk", classroom: "L1 Informatique A", streak: 6 };
