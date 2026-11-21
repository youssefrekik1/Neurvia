from collections import Counter, defaultdict
from dataclasses import dataclass
from itertools import combinations

from sqlalchemy import select

from app.analytics.classroom import Profile, insights, jaccard
from app.models import Answer, Attempt, Concept, DiagnosisSummary, Membership, Misconception, MisconceptionObservation, Question, Quiz
from app.models import enums as e


@dataclass
class ClassroomData:
    memberships: dict
    profiles: list[Profile]
    rows: list
    priorities: list
    concept_rates: dict
    submitted: int

    def participation(self):
        return {"enrolled_count": len(self.profiles), "submitted_count": self.submitted,
                "insufficient_count": sum(0 < p.answered < 4 for p in self.profiles)}

    def graph(self, tau, synthetic):
        nodes = []
        for profile in self.profiles:
            quality = ("insufficient" if not profile.sufficient else "corroborated" if profile.strong
                       else "suspected" if profile.errors else "no_observed_error")
            nodes.append({
                "id": profile.key, "label": self.memberships[profile.key].pseudonym,
                "diagnosis_quality": quality, "is_synthetic": synthetic,
                "percent_correct": profile.correct / profile.answered if profile.answered else None,
                "correct_count": profile.correct, "answered_count": profile.answered,
                "concept_rates": self.concept_rates[profile.key], "misconception_codes": sorted(profile.errors),
            })
        edges = []
        for left, right in combinations([row for row in self.profiles if row.sufficient], 2):
            strong = jaccard(left.strong, right.strong)
            all_errors = jaccard(left.errors, right.errors)
            if strong and float(strong) >= tau:
                edges.append({"source": left.key, "target": right.key, "similarity": float(strong), "provisional": False})
            elif all_errors and float(all_errors) >= tau:
                edges.append({"source": left.key, "target": right.key, "similarity": float(all_errors), "provisional": True})
        return nodes, edges


def lesson_rows(db, lesson_id):
    return list(db.execute(
        select(Answer, Attempt, Quiz.kind, Concept.code)
        .join(Attempt, Attempt.id == Answer.attempt_id).join(Quiz, Quiz.id == Attempt.quiz_id)
        .join(Question, Question.id == Answer.question_id).join(Concept, Concept.id == Question.concept_id)
        .where(Quiz.lesson_id == lesson_id, Attempt.status == e.AttemptStatus.submitted)
    ))


def load_classroom(db, lesson, weight: float):
    members = {str(row.id): row for row in db.scalars(select(Membership).where(
        Membership.classroom_id == lesson.classroom_id
    ).order_by(Membership.pseudonym, Membership.id))}
    diag = defaultdict(dict)
    for student, code, status in db.execute(select(DiagnosisSummary.student_id, Misconception.code, DiagnosisSummary.status)
                                            .join(Misconception).where(DiagnosisSummary.lesson_id == lesson.id)):
        diag[student][code] = status
    rows = lesson_rows(db, lesson.id)
    by_student = defaultdict(list)
    for answer, attempt, kind, concept_code in rows:
        if kind == e.QuestionRole.initial:
            by_student[attempt.student_id].append((answer, concept_code))
    profiles = []
    rates = {}
    for key, member in members.items():
        answers = by_student[member.user_id]
        statuses = diag[member.user_id]
        active = frozenset(code for code, status in statuses.items()
                           if status in (e.DiagnosisStatus.suspected, e.DiagnosisStatus.corroborated))
        strong = frozenset(code for code, status in statuses.items() if status == e.DiagnosisStatus.corroborated)
        profiles.append(Profile(key, len(answers), sum(row.is_correct for row, _ in answers), active, strong))
        concept_counts, concept_correct = Counter(), Counter()
        for answer, code in answers:
            concept_counts[code] += 1
            concept_correct[code] += int(answer.is_correct)
        rates[key] = {code: concept_correct[code] / total for code, total in concept_counts.items()}

    by_error = defaultdict(list)
    observations = db.execute(
        select(Misconception.code, Misconception.label_fr, MisconceptionObservation.student_id, Answer.confidence)
        .join(MisconceptionObservation, Misconception.id == MisconceptionObservation.misconception_id)
        .join(Answer, Answer.id == MisconceptionObservation.answer_id)
        .where(MisconceptionObservation.lesson_id == lesson.id,
               MisconceptionObservation.evidence_stage.in_([e.QuestionRole.initial, e.QuestionRole.confirmation]))
    )
    for code, label, student_id, confidence in observations:
        by_error[code].append((label, student_id, confidence))
    priorities = []
    for code, observations in by_error.items():
        affected = {student_id for _, student_id, _ in observations}
        confident = sum(confidence == e.Confidence.sure for _, _, confidence in observations) / len(observations)
        priorities.append({
            "misconception_code": code, "label": observations[0][0], "affected_students": len(affected),
            "observed_count": len(observations), "confident_wrong_share": confident,
            "corroborated_students": sum(diag[id].get(code) == e.DiagnosisStatus.corroborated
                                        and len(by_student[id]) >= 4 for id in affected),
            "priority_score": len(affected) * (1 + weight * confident),
        })
    priorities.sort(key=lambda row: (-row["priority_score"], row["misconception_code"]))
    return ClassroomData(members, profiles, rows, priorities[:3], rates, len(by_student))


def dashboard_view(data, lesson, classroom):
    return {"lesson_id": lesson.id, "priorities": data.priorities, "participation": data.participation(),
            "insights": insights(data.profiles, {key: row.pseudonym for key, row in data.memberships.items()}),
            "is_synthetic": classroom.is_synthetic}
