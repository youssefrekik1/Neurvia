from dataclasses import dataclass
from fractions import Fraction
from itertools import combinations


@dataclass(frozen=True)
class Profile:
    key: str
    answered: int
    correct: int
    errors: frozenset[str]
    strong: frozenset[str]

    @property
    def sufficient(self):
        return self.answered >= 4


def jaccard(left, right):
    union = left | right
    return Fraction(len(left & right), len(union)) if union else None


def average_linkage(profiles, *, strong, threshold, min_size):
    features = {p.key: p.strong if strong else p.errors for p in profiles if p.sufficient}
    features = {key: values for key, values in features.items() if values}
    pairs = {frozenset((a, b)): jaccard(features[a], features[b]) or Fraction(0)
             for a, b in combinations(sorted(features), 2)}
    clusters = [(key,) for key in sorted(features)]
    while len(clusters) > 1:
        scores = [
            (sum(pairs[frozenset((a, b))] for a in left for b in right) / (len(left) * len(right)),
             left, right) for left, right in combinations(clusters, 2)
        ]
        score, left, right = min(scores, key=lambda item: (-item[0], item[1], item[2]))
        if not score or float(score) < threshold:
            break
        clusters = sorted([c for c in clusters if c not in (left, right)] + [tuple(sorted(left + right))])
    result = []
    for members in clusters:
        if len(members) < min_size:
            continue
        common = set.intersection(*(set(features[key]) for key in members))
        if not common:
            continue
        links = [pairs[frozenset((a, b))] for a, b in combinations(members, 2)]
        result.append((members, sorted(common)[0], float(sum(links) / len(links))))
    return result


def suggest(profiles, *, threshold=0.5, min_size=3):
    corroborated = average_linkage(profiles, strong=True, threshold=threshold, min_size=min_size)
    used = {key for members, _, _ in corroborated for key in members}
    provisional = average_linkage([p for p in profiles if p.key not in used], strong=False,
                                  threshold=threshold, min_size=min_size)
    return [(members, code, score, "corroborated") for members, code, score in corroborated] + [
        (members, code, score, "provisional") for members, code, score in provisional
    ]


def insights(profiles, labels):
    found = {}
    for left, right in combinations([p for p in profiles if p.sufficient], 2):
        same_score = (left.correct, left.answered) == (right.correct, right.answered)
        different = left.errors ^ right.errors
        shared = left.errors & right.errors
        if same_score and different:
            found.setdefault("same_score_different_errors", (left, right, different))
        if not same_score and shared:
            found.setdefault("different_scores_shared_error", (left, right, shared))
    return [{"kind": kind, "labels": [labels[a.key], labels[b.key]],
             "scores": [a.correct, b.correct], "misconception_codes": sorted(errors)}
            for kind, (a, b, errors) in found.items()]
