import { useMemo, useSyncExternalStore } from "react";

export const primaryClass = "L1 Python · Groupe A";
export const conceptNames = [
  "Variables et types",
  "Conditions",
  "Boucles",
  "Fonctions",
] as const;
type ErrorKey =
  "borne" | "iteration" | "condition" | "booleen" | "indice" | "position";
export type Student = {
  id: string;
  mastery: number | null;
  concepts: (number | null)[];
  errors: ErrorKey[];
  corroborated: boolean;
};
export type Plan = {
  objectif: string;
  exemple: string;
  contreExemple: string;
  exercice: string;
  verification: string;
};
export type Group = {
  id: string;
  name: string;
  difficulty: string;
  reason: string;
  color: string;
  members: string[];
  status: "suggested" | "accepted" | "rejected";
  plan: Plan;
  validated: boolean;
};

// Observations anonymisées du jeu de démonstration. Les profils sans tentative
// restent distincts des profils observés sans erreur.
const observations: [number | null, ErrorKey[], boolean?][] = [
  [84, ["indice"]],
  [75, ["condition"]],
  [61, ["borne", "iteration"], true],
  [86, ["condition", "booleen"]],
  [91, []],
  [71, ["indice", "position"]],
  [73, ["borne"]],
  [67, ["condition", "booleen"]],
  [77, ["indice"]],
  [59, ["borne", "iteration"], true],
  [88, ["condition"]],
  [94, []],
  [75, ["borne", "iteration"]],
  [81, ["condition", "booleen"]],
  [72, ["borne"]],
  [78, ["indice", "position"]],
  [68, ["borne", "iteration"]],
  [66, ["borne"]],
  [null, []],
  [null, []],
  [null, []],
  [null, []],
];
export const students: Student[] = observations.map(
  ([mastery, errors, corroborated], i) => {
    const clamp = (value: number) => Math.min(100, Math.max(0, value));
    return {
      id: "A" + String(i + 1).padStart(2, "0"),
      mastery,
      errors,
      corroborated: Boolean(corroborated),
      concepts:
        i === 16
          ? [90, 65, 42, 63]
          : mastery === null
            ? [null, null, null, null]
            : [
                clamp(mastery + 8),
                clamp(mastery + (errors.includes("condition") ? -19 : 4)),
                clamp(mastery + (errors.includes("borne") ? -22 : 3)),
                clamp(mastery - 3),
              ],
    };
  },
);

export function getClassRoster(classroom: string) {
  return classroom === primaryClass ? students : [];
}

export function getRoster(classroom: string): string[] {
  return getClassRoster(classroom).map((student) => student.id);
}

export function similarity(a: Student, b: Student) {
  const union = new Set([...a.errors, ...b.errors]);
  return union.size
    ? a.errors.filter((error) => b.errors.includes(error)).length / union.size
    : 0;
}

// Single-link clustering is independent of the positions used by the renderer.
function clusterProfiles(roster: Student[]) {
  const remaining = new Set(roster.filter((student) => student.errors.length));
  const clusters: Student[][] = [];
  for (const start of remaining) {
    remaining.delete(start);
    const cluster = [start];
    for (const member of cluster) {
      for (const candidate of remaining) {
        if (similarity(member, candidate) >= 0.5) {
          remaining.delete(candidate);
          cluster.push(candidate);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

const groupTemplates: Omit<Group, "members" | "status" | "validated">[] = [
  {
    id: "boucles",
    name: "Groupe Boucles",
    difficulty: "Bornes des boucles Python",
    reason:
      "Les réponses confondent la borne de fin de range() et la dernière valeur visitée.",
    color: "#70caff",
    plan: {
      objectif: "Prédire les valeurs parcourues par une boucle for.",
      exemple: "Avec range(1, 4), la boucle parcourt 1, 2 et 3.",
      contreExemple: "range(1, 4) ne visite jamais la valeur 4.",
      exercice:
        "Faire tracer deux boucles à la main, puis comparer les valeurs obtenues en binôme.",
      verification:
        "Quelles valeurs prend i dans for i in range(2, 6) ? Pourquoi ?",
    },
  },
  {
    id: "conditions",
    name: "Groupe Conditions",
    difficulty: "Conditions composées",
    reason:
      "Plusieurs réponses montrent une confusion entre les opérateurs and et or.",
    color: "#f5c879",
    plan: {
      objectif: "Distinguer une conjonction et une disjonction.",
      exemple: "Pour x = 4, x > 0 and x < 5 vaut True.",
      contreExemple: "Pour x = 7, x > 0 and x < 5 vaut False.",
      exercice:
        "Compléter quatre lignes d’une table de vérité et justifier chaque réponse.",
      verification: "Pour x = 0, que vaut x > 0 or x == 0 ? Expliquez.",
    },
  },
  {
    id: "indices",
    name: "Groupe Indices",
    difficulty: "Indices et listes",
    reason:
      "Les réponses associent la première position à l’indice 1 au lieu de 0.",
    color: "#c499ff",
    plan: {
      objectif: "Associer chaque élément d’une liste à son indice.",
      exemple: "Dans [12, 16, 21], l’élément d’indice 0 vaut 12.",
      contreExemple:
        "L’indice 3 est hors des limites de cette liste de trois éléments.",
      exercice:
        "Annoter les indices de quatre cartes, puis prédire la valeur de deux accès.",
      verification: "Dans [8, 4, 6, 2], quel indice donne la valeur 6 ?",
    },
  },
];
const clusterError: Record<string, ErrorKey> = {
  boucles: "borne",
  conditions: "condition",
  indices: "indice",
};
const clusters = clusterProfiles(students);
export const initialGroups: Group[] = groupTemplates.map((group) => ({
  ...group,
  members: (
    clusters.find((cluster) =>
      cluster[0].errors.includes(clusterError[group.id]),
    ) ?? []
  )
    .map((student) => student.id)
    .sort(),
  status: "suggested",
  validated: false,
}));

export function studentDifficulty(student: Student) {
  if (student.errors.includes("borne"))
    return "Structures de boucles (for / while)";
  if (student.errors.includes("condition"))
    return "Conditions composées (and / or)";
  if (student.errors.includes("indice")) return "Indices et listes";
  return student.mastery === null
    ? "En attente de réponses"
    : "Aucune difficulté repérée";
}

const eventName = "neurvia:mirror-groups";
const key = (classroom: string) => "neurvia.mirror.groups.v1." + classroom;
const read = (classroom: string) => {
  try {
    return window.localStorage.getItem(key(classroom)) ?? "";
  } catch {
    return "";
  }
};
function decode(classroom: string, snapshot: string): Group[] {
  if (classroom !== primaryClass) return [];
  try {
    const changed = JSON.parse(snapshot) as Partial<
      Record<string, Partial<Group>>
    >;
    return initialGroups.map((group) => ({ ...group, ...changed[group.id] }));
  } catch {
    return initialGroups;
  }
}
function subscribe(callback: () => void) {
  window.addEventListener(eventName, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener("storage", callback);
  };
}
export function updateGroup(
  classroom: string,
  id: string,
  change: Partial<Pick<Group, "members" | "status" | "plan" | "validated">>,
) {
  const current = decode(classroom, read(classroom));
  const group = current.find((item) => item.id === id);
  if (!group) return;
  window.localStorage.setItem(
    key(classroom),
    JSON.stringify(
      Object.fromEntries(
        current.map((item) => [
          item.id,
          item.id === id ? { ...item, ...change } : item,
        ]),
      ),
    ),
  );
  window.dispatchEvent(new Event(eventName));
}
export function useMirrorGroups(classroom: string) {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => read(classroom),
    () => "",
  );
  return useMemo(() => decode(classroom, snapshot), [classroom, snapshot]);
}
export function getSuggestedGroupCount(classroom: string) {
  return decode(classroom, read(classroom)).filter(
    (group) => group.status === "suggested",
  ).length;
}
export function useSuggestedGroupCount(classroom: string) {
  return useMirrorGroups(classroom).filter(
    (group) => group.status === "suggested",
  ).length;
}
export function groupEvidence(group: Group) {
  const confirmed = students.filter(
    (s) =>
      group.members.includes(s.id) &&
      s.corroborated &&
      s.errors.includes(clusterError[group.id]),
  ).length;
  return confirmed
    ? confirmed + " cas corroboré" + (confirmed > 1 ? "s" : "")
    : "Hypothèse à vérifier";
}
