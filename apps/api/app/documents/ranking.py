import re
from collections import defaultdict

# Function words of the course languages. PostgreSQL's `simple` configuration keeps every token so that
# French, English and Arabic share one index; without this list, words such as "the" or "une" match
# nearly every page and dominate lexical ranking.
STOPWORDS = frozenset("""
a about after all also an and any are as at be because been but by can could did do does doing for from had
has have how i if in into is it its just more most my no not of on one or other our out so some such than
that the their them then there these they this those to too up use used using very was we were what when
where which while who why will with would you your
à au aux avec ce ces cet cette comme comment dans de des du elle en est et être eux il ils je la le les leur
leurs lorsqu lorsque mais même mes nous on ou où par pas pour pourquoi qu quand que quel quelle quelles quels
qui sa sans se ses son sont sur ta te tes ton tu un une vos votre vous
""".split())


def terms(value: str) -> set[str]:
    return set(re.findall(r"[^\W_]{2,}", value.casefold()))


def content_terms(value: str) -> set[str]:
    """Query terms without function words; falls back to every term for a query made only of them."""
    words = terms(value)
    return (words - STOPWORDS) or words


def fused_ranking(dense, lexical, *, constant=45):
    weights = defaultdict(float)
    for rows in (dense, lexical):
        for rank, key in enumerate(rows, start=1):
            weights[key] += 1.0 / (constant + rank)
    return dict(weights)


def rerank(weights, passages, query):
    wanted = content_terms(query)
    return {
        key: score + 0.018 * len(wanted & terms(passages[key])) / max(1, len(wanted))
        for key, score in weights.items()
    }
