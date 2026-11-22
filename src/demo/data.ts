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
  { code: "C_SGBD", name: "SGBD et niveaux de description", chapter: "Ch. 1 · Conception", prereqs: [], mastery: 0.9, low: 0.83, high: 0.95, lastSeen: 9, plateau: 0, source: "BD-Cours-1.pdf · p. 12" },
  { code: "C_ENTITY", name: "Entités, attributs, identifiants", chapter: "Ch. 1 · Conception", prereqs: ["C_SGBD"], mastery: 0.78, low: 0.67, high: 0.86, lastSeen: 6, plateau: 0, source: "BD-Cours-1.pdf · p. 43" },
  { code: "C_CARD", name: "Associations et cardinalités", chapter: "Ch. 1 · Conception", prereqs: ["C_ENTITY"], mastery: 0.38, low: 0.25, high: 0.52, lastSeen: 3, plateau: 11, source: "BD-Cours-1.pdf · p. 50" },
  { code: "C_KEYS", name: "Clés primaires et étrangères", chapter: "Ch. 2 · Modèle relationnel", prereqs: ["C_ENTITY"], mastery: 0.64, low: 0.52, high: 0.75, lastSeen: 2, plateau: 0, source: "BD-cours-2.pdf · p. 4" },
  { code: "C_EA_REL", name: "Passage E-A → relationnel", chapter: "Ch. 2 · Modèle relationnel", prereqs: ["C_CARD", "C_KEYS"], mastery: 0.43, low: 0.3, high: 0.57, lastSeen: 1, plateau: 2, source: "BD-cours-2.pdf · p. 11" },
  { code: "C_DF", name: "Dépendances fonctionnelles", chapter: "Ch. 3 · Normalisation", prereqs: ["C_KEYS"], mastery: 0.57, low: 0.43, high: 0.7, lastSeen: 5, plateau: 0, source: "BD-Cours-3.pdf · p. 9" },
  { code: "C_NF", name: "Formes normales (1FN → BCNF)", chapter: "Ch. 3 · Normalisation", prereqs: ["C_DF"], mastery: 0.46, low: 0.32, high: 0.6, lastSeen: 4, plateau: 0, source: "BD-Cours-3.pdf · p. 27" },
  { code: "C_ALG", name: "Sélection et projection", chapter: "Ch. 4 · Algèbre relationnelle", prereqs: ["C_EA_REL"], mastery: 0.52, low: 0.38, high: 0.66, lastSeen: 1, plateau: 0, source: "BD-Cours-4.pdf · p. 35" },
  { code: "C_JOIN", name: "Jointure et division", chapter: "Ch. 4 · Algèbre relationnelle", prereqs: ["C_ALG"], mastery: 0.27, low: 0.13, high: 0.44, lastSeen: 0, plateau: 0, source: "BD-Cours-4.pdf · p. 56" },
];

/** Concept the student is working towards (next exam topic). */
export const TARGET = "C_JOIN";

export const conceptByCode: Record<string, Concept> = Object.fromEntries(CONCEPTS.map((c) => [c.code, c]));
// Math signal concept used by "Explique-le" (not part of the BD concept map).
conceptByCode.C_FOURIER = { code: "C_FOURIER", name: "Séries de Fourier", chapter: "Mathématiques du signal · Ch. 1", prereqs: [], mastery: 0.51, low: 0.37, high: 0.65, lastSeen: 2, plateau: 0, source: "Chapitre-1.pdf (manuscrit) · p. 1" };

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
  { code: "M_CARD_SIDE", concept: "C_CARD", label: "Lire la cardinalité du mauvais côté", example: "CLIENT (1,1) — passe — (0,n) COMMANDE", fix: "La cardinalité se lit du côté de l’entité : un client passe 0 à n commandes, une commande est passée par exactement 1 client.", students: 11, confident: 7 },
  { code: "M_FK_SIDE", concept: "C_EA_REL", label: "Clé étrangère placée côté 1", example: "CLIENT(id, …, #id_commande)", fix: "Pour une association 1,n, la clé de l’entité côté 1 migre dans la table côté n : COMMANDE(id, …, #id_client).", students: 9, confident: 6 },
  { code: "M_SEL_PROJ", concept: "C_ALG", label: "Confondre sélection σ et projection π", example: "π ville='Sousse' (CLIENT)", fix: "σ garde des lignes selon une condition, π garde des colonnes : σ ville='Sousse' (CLIENT).", students: 8, confident: 3 },
  { code: "M_JOIN_COND", concept: "C_JOIN", label: "Jointure sans condition", example: "CLIENT ⋈ COMMANDE sans critère", fix: "Sans condition de jointure on obtient le produit cartésien. Il faut égaler la clé étrangère à la clé primaire.", students: 7, confident: 4 },
  { code: "M_2FN_3FN", concept: "C_NF", label: "Confondre 2FN et 3FN", example: "« pas de dépendance transitive » pour la 2FN", fix: "2FN : aucun attribut ne dépend d’une partie de la clé. 3FN : aucun attribut non clé ne dépend d’un autre attribut non clé.", students: 5, confident: 2 },
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
  { label: "Lecture des cardinalités", before: 31, after: 74, j7: 69 },
  { label: "Placement de la clé étrangère", before: 38, after: 71, j7: 66 },
  { label: "Sélection vs projection", before: 44, after: 68, j7: 64 },
];

export type ReviewItem = { concept: string; due: number; reason: string };

export const REVIEW: ReviewItem[] = [
  { concept: "C_CARD", due: 0, reason: "Plateau de 11 jours : les quiz ne font plus progresser, on passe à « Explique-le »." },
  { concept: "C_SGBD", due: 0, reason: "Bien maîtrisé, revu il y a 9 jours : rappel espacé pour consolider." },
  { concept: "C_DF", due: 1, reason: "Incertitude élevée (43–70 %) : une question de plus affine l’estimation." },
  { concept: "C_KEYS", due: 3, reason: "Progression régulière, prochaine révision dans 3 jours." },
  { concept: "C_ALG", due: 4, reason: "Pratiqué hier. On laisse reposer avant de revenir." },
];

/** Key ideas the student should cover in an "Explique-le" for each concept. */
export const KEY_IDEAS: Record<string, { idea: string; words: string[] }[]> = {
  C_CARD: [
    { idea: "Une cardinalité est un couple (minimum, maximum)", words: ["min", "max", "couple", "(0", "(1"] },
    { idea: "Elle se lit du côté de l’entité concernée", words: ["côté", "cote", "entité", "chaque"] },
    { idea: "Le maximum n signifie « plusieurs »", words: ["plusieurs", ",n", "beaucoup"] },
    { idea: "Le minimum 0 signifie que la participation est facultative", words: ["0", "facultati", "optionnel", "aucun"] },
  ],
  C_EA_REL: [
    { idea: "Chaque entité devient une table", words: ["table", "relation"] },
    { idea: "L’identifiant devient la clé primaire", words: ["clé primaire", "cle primaire", "identifiant", "primary"] },
    { idea: "Pour une association 1,n, la clé migre côté n", words: ["côté n", "cote n", "migre", "étrangère", "etrangere"] },
    { idea: "Une association n,n devient une table à part", words: ["n,n", "nouvelle table", "table d’association", "table d'association"] },
  ],
  C_FOURIER: [
    { idea: "Un signal périodique s’écrit comme une somme de cosinus et de sinus", words: ["somme", "cos", "sin", "harmonique"] },
    { idea: "a₀ est la valeur moyenne du signal sur une période", words: ["moyenne", "a0", "a₀"] },
    { idea: "Les coefficients aₙ, bₙ se calculent par des intégrales", words: ["intégr", "integr", "∫"] },
    { idea: "Une fonction paire n’a que des termes en cosinus (bₙ = 0)", words: ["paire", "bn = 0", "bₙ = 0", "impaire"] },
  ],
};

export const COACH_STUDENT = { name: "Yassine Jaziri", classroom: "L2 Informatique A", streak: 6 };
