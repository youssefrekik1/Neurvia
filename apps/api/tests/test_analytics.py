from fractions import Fraction

import pytest

from app.analytics.classroom import Profile, average_linkage, jaccard, suggest
from app.analytics.diagnostics import Evidence, quadrant, summarize
from app.models.enums import Confidence, DiagnosisStatus, Quadrant


@pytest.mark.parametrize(("correct", "confidence", "result"), [
    (True, "sure", Quadrant.acquired), (True, "medium", Quadrant.fragile),
    (False, "sure", Quadrant.misconception), (False, "unsure", Quadrant.gap),
])
def test_quadrants(correct, confidence, result):
    assert quadrant(correct, Confidence(confidence)) == result
    with pytest.raises(ValueError):
        quadrant(correct, "unknown")


def test_diagnostic_requires_distinct_items_and_conflict_is_weakened():
    first = Evidence("a", ("first", ""), True)
    second = Evidence("a", ("second", ""), False)
    other = Evidence("b", ("second", ""), True)
    assert summarize([first, first, other], set())["a"] == (DiagnosisStatus.suspected, 2, 1)
    assert summarize([first, second], set())["a"][0] == DiagnosisStatus.corroborated
    assert summarize([first, second], {"a"})["a"][0] == DiagnosisStatus.contradicted_or_transient


def test_similarity_and_average_linkage():
    assert jaccard(set(), set()) is None
    assert jaccard({"a", "b"}, {"a", "b", "c"}) == Fraction(2, 3)
    assert jaccard({"a"}, {"b"}) == 0
    profiles = [Profile(key, n, 4, frozenset(errors), frozenset())
                for key, n, errors in [
                    ("a", 6, {"a"}), ("b", 6, {"a", "b"}), ("c", 6, {"a"}),
                    ("d", 3, {"a"}), ("e", 6, set()),
                ]]
    expected = [(("a", "b", "c"), "a", 2 / 3, "provisional")]
    assert suggest(profiles) == expected
    assert suggest(list(reversed(profiles))) == expected
    assert average_linkage(profiles, strong=False, threshold=0.8, min_size=3) == []
