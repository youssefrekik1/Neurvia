import json
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import ROOT
from app.models import Concept, Misconception, MisconceptionConcept, Question, QuestionOption
from app.models import enums as e
from app.schemas.common import Input
from app.schemas.learning import QuestionDraft

SEED = ROOT / "data" / "seed_python.json"


class SeedConcept(Input):
    code: str
    label_fr: str
    label_en: str
    label_ar: str


class SeedMisconception(Input):
    code: str
    label_fr: str
    label_en: str
    remediation_hint: str
    allowed_concept_codes: list[str] = Field(min_length=1)
    is_transversal: bool


class SeedQuestion(QuestionDraft):
    seed_key: str
    role: e.QuestionRole
    variant_family_id: str
    status: Literal["draft"]


class BankSeed(Input):
    note: str
    subject: str
    concepts: list[SeedConcept]
    misconceptions: list[SeedMisconception]
    questions: list[SeedQuestion]

    @model_validator(mode="after")
    def check_links(self):
        concept_codes = {item.code for item in self.concepts}
        for keys in (
            [item.code for item in self.concepts],
            [item.code for item in self.misconceptions],
            [item.seed_key for item in self.questions],
        ):
            if len(keys) != len(set(keys)):
                raise ValueError("Identifiants du seed en double.")
        allowed = {code: set() for code in concept_codes}
        for item in self.misconceptions:
            for code in item.allowed_concept_codes:
                if code not in allowed:
                    raise ValueError(f"Concept inconnu : {code}")
                allowed[code].add(item.code)
        for item in self.questions:
            if item.concept_code not in allowed:
                raise ValueError(f"Concept inconnu : {item.concept_code}")
            item.check_taxonomy(item.concept_code, allowed[item.concept_code])
        return self


def read_seed(path: Path = SEED) -> BankSeed:
    return BankSeed.model_validate_json(path.read_bytes())


def import_bank(session: Session, seed: BankSeed) -> None:
    """Import in the caller's transaction and preserve existing teacher-reviewed records."""
    concepts = {row.code: row for row in session.scalars(select(Concept))}
    misconceptions = {row.code: row for row in session.scalars(select(Misconception))}
    for item in seed.concepts:
        if item.code not in concepts:
            row = Concept(code=item.code, subject=seed.subject, label_fr=item.label_fr)
            session.add(row)
            concepts[item.code] = row
    for item in seed.misconceptions:
        if item.code not in misconceptions:
            row = Misconception(
                code=item.code, label_fr=item.label_fr, remediation_hint=item.remediation_hint,
                is_transversal=item.is_transversal,
            )
            session.add(row)
            misconceptions[item.code] = row
    session.flush()

    links = {
        (error_id, concept_id) for error_id, concept_id in session.execute(
            select(MisconceptionConcept.misconception_id, MisconceptionConcept.concept_id)
        )
    }
    for item in seed.misconceptions:
        for code in item.allowed_concept_codes:
            key = (misconceptions[item.code].id, concepts[code].id)
            if key not in links:
                session.add(MisconceptionConcept(misconception_id=key[0], concept_id=key[1]))
                links.add(key)

    existing = set(session.scalars(select(Question.seed_key)))
    for item in seed.questions:
        if item.seed_key in existing:
            continue
        question = Question(
            concept_id=concepts[item.concept_code].id, seed_key=item.seed_key, stem=item.stem,
            code=item.code, explanation=item.explanation, source=e.Source.bank, role=item.role,
            variant_family_id=item.variant_family_id, status=e.QuestionStatus.draft,
            difficulty=item.difficulty,
        )
        session.add(question)
        session.flush()
        for position, option in enumerate(item.options, start=1):
            error = misconceptions.get(option.misconception_code)
            session.add(QuestionOption(
                question_id=question.id, position=position, text=option.text,
                is_correct=option.is_correct, misconception_id=error.id if error else None,
            ))


def normalize_annex(path: Path) -> dict:
    """Convert the annex's draft data without granting approval or changing the item text."""
    annex = json.loads(path.read_text(encoding="utf-8-sig").split("```json")[-1].split("```")[0])
    allowed = {item["code"]: set() for item in annex["misconceptions"]}
    for item in annex["misconceptions"]:
        if item["concept"]:
            allowed[item["code"]].add(item["concept"])
        else:
            allowed[item["code"]].update(concept["code"] for concept in annex["concepts"])

    items = []
    for row in annex["questions"] + annex["variants"]:
        for option in row["options"]:
            code = option.pop("misconception")
            option["misconception_code"] = code
            if code:
                allowed[code].add(row["concept"])
        items.append({
            "seed_key": row["id"], "variant_family_id": row["variant_group"],
            "role": "immediate_retest" if row["is_variant"] else "initial", "status": "draft",
            "concept_code": row["concept"], **{key: row[key] for key in (
                "difficulty", "stem", "code", "options", "explanation"
            )},
        })

    return {
        "note": annex["_note"], "subject": annex["subject"], "concepts": annex["concepts"],
        "misconceptions": [
            {key: value for key, value in item.items() if key != "concept"} | {
                "allowed_concept_codes": sorted(allowed[item["code"]]),
                "is_transversal": item["concept"] is None,
            }
            for item in annex["misconceptions"]
        ],
        "questions": items,
    }


if __name__ == "__main__":
    normalized = normalize_annex(ROOT / "FAHM_Specification_Finale_Pour_Codex.md")
    BankSeed.model_validate(normalized)
    SEED.parent.mkdir(exist_ok=True)
    with SEED.open("x", encoding="utf-8", newline="\n") as output:
        json.dump(normalized, output, ensure_ascii=False, indent=2)
        output.write("\n")
