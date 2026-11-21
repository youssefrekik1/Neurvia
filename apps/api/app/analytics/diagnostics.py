from collections import defaultdict
from dataclasses import dataclass

from app.models.enums import Confidence, DiagnosisStatus, Quadrant


@dataclass(frozen=True)
class Evidence:
    misconception: str
    item: tuple[str, str]
    confident: bool


def quadrant(correct: bool, confidence: Confidence) -> Quadrant:
    high = Confidence(confidence) == Confidence.sure
    if correct:
        return Quadrant.acquired if high else Quadrant.fragile
    return Quadrant.misconception if high else Quadrant.gap


def summarize(observations: list[Evidence], weakened: set[str]) -> dict[str, tuple[DiagnosisStatus, int, int]]:
    by_code = defaultdict(list)
    for observation in observations:
        by_code[observation.misconception].append(observation)
    result = {}
    for code, records in sorted(by_code.items()):
        distinct = len({record.item for record in records})
        status = DiagnosisStatus.suspected
        if code in weakened:
            status = DiagnosisStatus.contradicted_or_transient
        elif distinct >= 2:
            status = DiagnosisStatus.corroborated
        result[code] = (status, len(records), distinct)
    return result
