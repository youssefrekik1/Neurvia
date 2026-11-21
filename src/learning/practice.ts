import { topics, type Question } from "./bank";

/* These items are reserved for follow-up assessments and never enter a prepared quiz. */
const followups: [string, string[], number, string][][] = [
  [
    [
      "Quelle est la première valeur absente de la suite 2, 3, 4 générée par range(2, 5) après 4 ?",
      ["3", "4", "5", "2"],
      2,
      "range s’arrête avant 5.",
    ],
    [
      "Que produit list(range(5, 9)) ?",
      ["[5, 6, 7, 8]", "[5, 6, 7, 8, 9]", "[6, 7, 8, 9]", "[0, 1, 2, 3]"],
      0,
      "La borne de départ est 5. La borne 9 est exclue.",
    ],
    [
      "Pour afficher 10, 11 et 12, quelle borne placer dans range(10, …) ?",
      ["11", "12", "13", "14"],
      2,
      "La borne finale doit dépasser de 1 la dernière valeur souhaitée.",
    ],
  ],
  [
    [
      'Avec mois = ["mars", "avril", "mai"], que vaut mois[1] ?',
      ['"mars"', '"avril"', '"mai"', "Une erreur"],
      1,
      "L’indice 1 désigne le deuxième élément.",
    ],
    [
      "Un tableau comporte sept éléments. Quel est son dernier indice positif ?",
      ["5", "6", "7", "8"],
      1,
      "Les indices vont de 0 à 6 pour sept éléments.",
    ],
    [
      "Avec a = [8, 6, 4, 2], que renvoie a[-2] ?",
      ["8", "6", "4", "2"],
      2,
      "L’indice −2 désigne l’avant-dernier élément.",
    ],
  ],
  [
    [
      "Combien de passages effectue cette boucle ?\nn = 6\nwhile n > 2:\n    n -= 2",
      ["1", "2", "3", "4"],
      1,
      "La boucle démarre à 6 puis à 4. À 2, la condition devient fausse.",
    ],
    [
      "Que vaut t à la sortie ?\nt = 2\nwhile t < 5:\n    t += 2",
      ["4", "5", "6", "7"],
      2,
      "t prend les valeurs 4 puis 6, et 6 < 5 est faux.",
    ],
    [
      "Quelle mise à jour termine « while x < 10 » si x commence à 3 ?",
      ["x -= 1", "x = 3", "x += 1", "x = 0"],
      2,
      "Augmenter x rapproche sa valeur de la borne 10.",
    ],
  ],
  [
    [
      "Avec x = 6, quelle expression est fausse ?",
      ["x > 2", "x == 6", "x < 6", "x >= 6"],
      2,
      "Une valeur n’est pas strictement inférieure à elle-même.",
    ],
    [
      "Que vaut False or True ?",
      ["True", "False", "None", "0"],
      0,
      "or est vrai si l’un de ses opérandes booléens est vrai.",
    ],
    [
      "Avec a = 2 et b = 4, que vaut a != b and b > 3 ?",
      ["True", "False", "None", "4"],
      0,
      "Les deux comparaisons sont vraies.",
    ],
  ],
  [
    [
      "Que renvoie f(5) ?\ndef f(n):\n    return n + 2",
      ["2", "3", "5", "7"],
      3,
      "Le résultat est 5 + 2, soit 7.",
    ],
    [
      "Quelle instruction termine immédiatement un appel de fonction ?",
      ["print(0)", "x = 1", "return 0", "x += 1"],
      2,
      "return termine l’appel et renvoie la valeur indiquée.",
    ],
    [
      "Que vaut carre(3) ?\ndef carre(n):\n    return n * n",
      ["3", "6", "9", "27"],
      2,
      "Le produit de 3 par lui-même est 9.",
    ],
  ],
  [
    [
      "Quel est le type de False ?",
      ["int uniquement", "bool", "str", "float"],
      1,
      "False est une valeur de type bool.",
    ],
    [
      'Que vaut str(4) + "2" ?',
      ["6", "42 comme entier", '"42"', "Une erreur"],
      2,
      'La conversion produit la chaîne "4". Les deux chaînes sont concaténées.',
    ],
    [
      "Après a = 6 puis a = a // 2, que vaut a ?",
      ["3", "6", "12", "2"],
      0,
      "La division entière de 6 par 2 vaut 3.",
    ],
  ],
];
export const followupBank: Question[] = followups.flatMap((items, index) =>
  items.map(([text, options, correct, explanation], n) => ({
    id: "practice-" + index + "-" + n,
    concept: topics[index],
    text,
    options,
    correct,
    explanation,
    source: "Banque de questions" as const,
    level: "Intermédiaire" as const,
    misconceptions: options.map((_, i) =>
      i === correct
        ? ""
        : "Cette réponse peut indiquer une confusion sur la notion « " +
          topics[index].toLocaleLowerCase("fr") +
          " ».",
    ),
  })),
);
