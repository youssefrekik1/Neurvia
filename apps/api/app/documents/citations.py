import re

from pydantic import BaseModel, ConfigDict, Field


class CitationDraft(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    source: str = Field(pattern=r"^P[1-9][0-9]?$")
    quote: str = Field(min_length=12, max_length=500)


def keyed(hits):
    return {f"P{index}": hit for index, hit in enumerate(hits, start=1)}


def context(evidence):
    return [{"source": key, "page": hit.number, "passage": hit.content} for key, hit in evidence.items()]


def verify_citations(citations, evidence):
    checked = []
    seen = set()
    for citation in citations:
        hit = evidence.get(citation.source)
        if hit is None:
            raise ValueError("unknown citation source")
        # PDFs and model output can wrap the same words differently. Store the original substring.
        pattern = r"\s+".join(re.escape(part) for part in citation.quote.split())
        match = re.search(pattern, hit.content) if pattern else None
        if match is None:
            raise ValueError("citation does not match the selected source")
        quote = match.group()
        key = (hit.chunk_id, quote)
        if key not in seen:
            checked.append((hit, quote))
            seen.add(key)
    if not checked:
        raise ValueError("answer requires source evidence")
    return checked
