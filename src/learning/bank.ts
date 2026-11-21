export const topics = [
  "Bornes des boucles",
  "Indices et listes",
  "Boucles conditionnelles",
  "Conditions",
  "Fonctions",
  "Variables et types",
] as const;
export const levels = ["Essentiel", "Intermédiaire", "Approfondi"] as const;
export type Level = (typeof levels)[number];
export type Question = {
  id: string;
  text: string;
  options: string[];
  correct: number;
  concept: string;
  explanation: string;
  misconceptions: string[];
  source: "Banque de questions" | "Professeur";
  level: Level;
};
type Entry = [string, string[], number, string, string[]];
const entries: Entry[][] = [
  [
    [
      "Quelles valeurs parcourt range(1, 4) ?",
      ["1, 2, 3", "1, 2, 3, 4", "0, 1, 2, 3", "2, 3, 4"],
      0,
      "La première borne est incluse. La seconde est exclue.",
      [
        "",
        "Tu as peut-être inclus la borne de fin.",
        "Tu as peut-être ignoré la borne de départ.",
        "Tu as peut-être décalé les deux bornes.",
      ],
    ],
    [
      'Combien de fois cette boucle affiche-t-elle « bonjour » ?\nfor i in range(2, 5):\n    print("bonjour")',
      ["2 fois", "3 fois", "4 fois", "5 fois"],
      1,
      "La boucle parcourt 2, 3 et 4, soit trois passages.",
      [
        "Tu as peut-être oublié le premier passage.",
        "",
        "Tu as peut-être inclus la borne finale.",
        "Tu as peut-être confondu la borne finale avec le nombre de passages.",
      ],
    ],
    [
      "Pour parcourir 4, 5 et 6, quelle expression convient ?",
      ["range(4, 6)", "range(3, 6)", "range(4, 7)", "range(5, 7)"],
      2,
      "Il faut commencer à 4 et s’arrêter juste avant 7.",
      [
        "Vérifie si 6 est inclus.",
        "Vérifie la première valeur.",
        "",
        "Vérifie si 4 est inclus.",
      ],
    ],
    [
      "Quelle liste produit list(range(1, 7, 2)) ?",
      ["[1, 3, 5, 7]", "[2, 4, 6]", "[1, 2, 3, 4, 5, 6]", "[1, 3, 5]"],
      3,
      "Le pas vaut 2 et la dernière valeur doit rester strictement inférieure à 7.",
      [
        "7 est la borne exclue.",
        "Le parcours commence à 1.",
        "Le troisième argument fixe le pas.",
        "",
      ],
    ],
    [
      "Quelle est la dernière valeur de range(8, 2, -2) ?",
      ["2", "4", "6", "0"],
      1,
      "Avec un pas de −2, les valeurs sont 8, 6 et 4. La borne 2 est exclue.",
      [
        "La borne finale est exclue.",
        "",
        "Le parcours peut encore avancer après 6.",
        "Le parcours s’arrête avant 2.",
      ],
    ],
    [
      "Que vaut sum(range(2, 6)) ?",
      ["20", "10", "14", "12"],
      2,
      "La somme est 2 + 3 + 4 + 5 = 14.",
      [
        "Tu as peut-être inclus 6.",
        "Tu as peut-être commencé à 1 ou omis une valeur.",
        "",
        "Tu as peut-être omis la première valeur.",
      ],
    ],
    [
      "Pour une liste de longueur n, quel parcours visite tous ses indices ?",
      ["range(n)", "range(1, n)", "range(n + 1)", "range(1, n + 1)"],
      0,
      "Les indices valides vont de 0 à n − 1 inclus.",
      [
        "",
        "L’indice 0 serait omis.",
        "L’indice n serait hors de la liste.",
        "Le premier indice manque et le dernier dépasse la liste.",
      ],
    ],
    [
      "Quelles valeurs parcourt range(3, 3) ?",
      ["3 uniquement", "0 à 3", "Aucune valeur", "3 et 4"],
      2,
      "Le point de départ atteint déjà la borne exclue.",
      [
        "La borne finale est exclue.",
        "La première borne vaut 3.",
        "",
        "Le parcours ne peut pas atteindre ou dépasser 3.",
      ],
    ],
  ],
  [
    [
      "Quel est le premier indice d’une liste Python non vide ?",
      ["1", "0", "−1 uniquement", "La longueur de la liste"],
      1,
      "En Python, l’indexation commence à zéro.",
      [
        "Tu as peut-être compté les positions à partir de 1.",
        "",
        "−1 désigne le dernier élément.",
        "La longueur dépasse le dernier indice valide.",
      ],
    ],
    [
      'Que vaut couleurs[2] si couleurs = ["bleu", "vert", "ocre"] ?',
      ['"bleu"', '"vert"', '"ocre"', "Une erreur"],
      2,
      "Les trois éléments ont les indices 0, 1 et 2.",
      [
        "Le premier élément est à l’indice 0.",
        "Le deuxième élément est à l’indice 1.",
        "",
        "L’indice 2 existe pour trois éléments.",
      ],
    ],
    [
      "Dans notes = [12, 15, 17, 14], comment lire la dernière note ?",
      ["notes[4]", "notes[-1]", "notes[1]", "len(notes)"],
      1,
      "L’indice −1 permet de lire le dernier élément.",
      [
        "4 dépasse le dernier indice valide.",
        "",
        "1 désigne le deuxième élément.",
        "len renvoie la taille.",
      ],
    ],
    [
      "Que renvoie [10, 20, 30, 40][1:3] ?",
      ["[10, 20]", "[20, 30, 40]", "[30]", "[20, 30]"],
      3,
      "La tranche commence à l’indice 1 inclus et s’arrête avant l’indice 3.",
      [
        "Vérifie le premier indice.",
        "La borne de fin de tranche est exclue.",
        "La tranche comprend aussi l’indice de début.",
        "",
      ],
    ],
    [
      "Une liste contient cinq éléments. Quel indice positif provoque une erreur ?",
      ["1", "3", "4", "5"],
      3,
      "Pour cinq éléments, le dernier indice positif valide est 4.",
      [
        "Le deuxième élément existe.",
        "Le quatrième élément existe.",
        "Le cinquième élément existe.",
        "",
      ],
    ],
    [
      "Avec a = [3, 6, 9], que vaut a[len(a) - 2] ?",
      ["3", "6", "9", "Une erreur"],
      1,
      "len(a) vaut 3. L’indice 1 désigne le deuxième élément, 6.",
      [
        "L’indice calculé vaut 1.",
        "",
        "Le dernier indice est 2.",
        "L’indice obtenu est valide.",
      ],
    ],
  ],
  [
    [
      "Quand une boucle while s’exécute-t-elle ?",
      [
        "Tant que la condition est vraie",
        "Une seule fois",
        "Uniquement si la condition est fausse",
        "Toujours trois fois",
      ],
      0,
      "Python teste la condition avant chaque passage.",
      [
        "",
        "Le nombre de passages dépend de la condition.",
        "La boucle continue quand la condition est vraie.",
        "Aucun nombre de passages n’est imposé.",
      ],
    ],
    [
      "Quelle valeur de n termine cette boucle ?\nn = 0\nwhile n < 3:\n    n += 1",
      ["0", "2", "3", "4"],
      2,
      "Après trois incréments, n vaut 3 et la condition devient fausse.",
      [
        "La condition est vraie au départ.",
        "À 2, la condition reste vraie.",
        "",
        "La boucle s’arrête dès que n vaut 3.",
      ],
    ],
    [
      "Combien de passages effectue « while x > 5 » si x vaut 4 au départ ?",
      ["0", "1", "4", "5"],
      0,
      "La condition est testée avant le premier passage et elle est déjà fausse.",
      [
        "",
        "Le premier passage exige une condition vraie.",
        "Le nombre de passages ne vaut pas la valeur initiale.",
        "La borne ne donne pas le nombre de passages.",
      ],
    ],
    [
      "Que se passe-t-il ici ?\nx = 2\nwhile x > 0:\n    x += 1",
      [
        "Deux passages",
        "Aucun passage",
        "Une erreur de syntaxe",
        "La boucle continue sans fin",
      ],
      3,
      "x augmente et reste positif, donc la condition reste vraie.",
      [
        "x ne diminue pas.",
        "La condition est vraie au départ.",
        "Cette syntaxe est valide.",
        "",
      ],
    ],
    [
      "Après cette boucle, combien vaut k ?\nk = 1\nwhile k < 8:\n    k *= 2",
      ["4", "8", "16", "2"],
      1,
      "k prend les valeurs 2, 4 puis 8. Le test devient alors faux.",
      [
        "À 4, la boucle continue.",
        "",
        "À 8, la boucle est déjà terminée.",
        "2 est seulement la première mise à jour.",
      ],
    ],
  ],
  [
    [
      "Quel opérateur teste l’égalité ?",
      ["=", "==", "!=", ">="],
      1,
      "== compare deux valeurs.",
      [
        "= affecte une valeur.",
        "",
        "!= teste une différence.",
        ">= compare un ordre.",
      ],
    ],
    [
      "Que vaut 5 > 3 and 2 > 4 ?",
      ["True", "None", "False", "2"],
      2,
      "and exige que les deux comparaisons soient vraies.",
      [
        "La deuxième comparaison est fausse.",
        "Le résultat est un booléen.",
        "",
        "Les comparaisons renvoient des booléens.",
      ],
    ],
    [
      "Avec x = 4, quelle condition est vraie ?",
      ["x < 4", "x != 4", "x > 4", "x >= 4"],
      3,
      ">= inclut le cas d’égalité.",
      ["< exclut l’égalité.", "x est égal à 4.", "> exclut l’égalité.", ""],
    ],
    [
      "Que vaut not (2 < 1 or 3 == 3) ?",
      ["True", "False", "None", "3"],
      1,
      "or donne True car 3 == 3. not inverse ensuite le résultat.",
      [
        "Vérifie l’effet de not.",
        "",
        "L’expression est booléenne.",
        "Une comparaison renvoie un booléen.",
      ],
    ],
  ],
  [
    [
      "Quel mot-clé renvoie une valeur à l’appelant ?",
      ["print", "def", "return", "for"],
      2,
      "return transmet le résultat de la fonction à l’appelant.",
      [
        "print affiche une valeur.",
        "def déclare une fonction.",
        "",
        "for démarre une boucle.",
      ],
    ],
    [
      "Que renvoie double(4) ?\ndef double(x):\n    return 2 * x",
      ["2", "4", "6", "8"],
      3,
      "Le paramètre x vaut 4. Le produit 2 × 4 vaut 8.",
      [
        "Le paramètre intervient dans le calcul.",
        "La valeur renvoyée est calculée.",
        "L’opérateur est une multiplication.",
        "",
      ],
    ],
    [
      "Que renvoie une fonction qui se termine sans return ?",
      ["0", "False", "None", "Une chaîne vide"],
      2,
      "Python renvoie implicitement None.",
      [
        "Le résultat implicite n’est pas un nombre.",
        "Le résultat implicite n’est pas un booléen.",
        "",
        "Le résultat implicite n’est pas du texte.",
      ],
    ],
    [
      "Que vaut f(3, 2) ?\ndef f(a, b=4):\n    return a - b",
      ["1", "−1", "5", "7"],
      0,
      "L’argument fourni, 2, remplace la valeur par défaut de b.",
      [
        "",
        "La valeur par défaut est remplacée.",
        "L’opération est une soustraction.",
        "Les paramètres sont 3 et 2.",
      ],
    ],
  ],
  [
    [
      'Quel est le type de "12" en Python ?',
      ["int", "float", "str", "bool"],
      2,
      "Les guillemets délimitent une chaîne de caractères.",
      [
        "Les guillemets changent le type.",
        "Il ne s’agit pas d’un nombre décimal.",
        "",
        "Les booléens sont True et False.",
      ],
    ],
    [
      "Que vaut x après ces instructions ?\nx = 4\nx += 3",
      ["3", "4", "7", "43"],
      2,
      "+= ajoute 3 à la valeur entière de x.",
      [
        "La valeur initiale intervient.",
        "La valeur est mise à jour.",
        "",
        "Les deux opérandes sont des entiers.",
      ],
    ],
    [
      'Que vaut int("5") + 2 ?',
      ['"52"', "7", "Une erreur", "5"],
      1,
      "int convertit le texte en entier avant l’addition.",
      [
        "La conversion a déjà eu lieu.",
        "",
        "Le texte représente bien un entier.",
        "L’addition ajoute 2 au résultat.",
      ],
    ],
    [
      "Quel est le type du résultat de 5 / 2 en Python 3 ?",
      ["int", "str", "bool", "float"],
      3,
      "La division / de deux entiers renvoie un nombre à virgule flottante.",
      [
        "// effectue la division entière.",
        "Aucune conversion en texte n’est demandée.",
        "L’opération ne teste pas une condition.",
        "",
      ],
    ],
  ],
];
export const bank: Question[] = entries.flatMap((group, topic) =>
  group.map(([text, options, correct, explanation, misconceptions], index) => ({
    id: "bank-" + topic + "-" + index,
    text,
    options,
    correct,
    explanation,
    misconceptions,
    concept: topics[topic],
    source: "Banque de questions" as const,
    level: levels[Math.min(2, Math.floor(index / 2))],
  })),
);
export const initialQuestions = [
  bank[0],
  bank[9],
  bank[14],
  bank[3],
  bank[10],
  bank[15],
];
export function selectQuestions(
  concepts: string[],
  level: Level,
  count: number,
  excluded: string[] = [],
) {
  const pools = concepts.map((concept) =>
    bank
      .filter((q) => q.concept === concept && !excluded.includes(q.id))
      .sort(
        (a, b) =>
          Math.abs(levels.indexOf(a.level) - levels.indexOf(level)) -
          Math.abs(levels.indexOf(b.level) - levels.indexOf(level)),
      ),
  );
  const selected: Question[] = [];
  for (
    let i = 0;
    selected.length < count && pools.some((pool) => pool[i]);
    i++
  ) {
    for (const pool of pools)
      if (pool[i] && selected.length < count) selected.push(pool[i]);
  }
  return selected;
}
