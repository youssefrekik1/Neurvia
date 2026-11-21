from app.ai.tasks import generic_plan
from app.models.enums import QuestionRole
from app.schemas.learning import StudentQuestion, TeacherQuestion
from app.services.demo_seed import CLASSROOM_ID, LESSON_ID, STUDENT_IDS, fixture_id

INITIAL = fixture_id("quiz-initial")
DRAFT = fixture_id("quiz-draft")
IMMEDIATE = fixture_id("quiz-immediate")
J7 = fixture_id("quiz-j7")
GROUP_ID = fixture_id("group")
PLAN_ID = fixture_id("plan")
MEMBERS = [fixture_id(f"membership-{number}") for number in range(1, len(STUDENT_IDS) + 1)]
ERROR_CODE = "M_OFF_BY_ONE"
CONCEPT = "C_INDEXING"

SAMPLE_QUESTIONS = {
    "initial-1": ("Pour cette liste, quel est l’indice du dernier élément ?",
                  "couleurs = ['vert', 'bleu', 'rouge', 'gris']", ("3", "4", "1", "-4"),
                  "Avec quatre éléments, les indices positifs utilisables vont de 0 à 3."),
    "initial-2": ("Que renvoie len sur la liste ci-dessous ?",
                  "len(['un', 'deux', 'trois'])", ("3", "2", "0", "4"),
                  "len donne le nombre d’éléments dans la liste."),
    "initial-3": ("Quel élément est lu par l’expression suivante ?",
                  "['pomme', 'poire', 'orange'][0]", ("pomme", "poire", "orange", "IndexError"),
                  "L’indice zéro désigne le premier élément."),
    "initial-4": ("Quels indices non négatifs sont accessibles dans cette liste ?",
                  "fruits = ['kiwi', 'figue']", ("0 et 1", "1 et 2", "0 et 2", "2 et 3"),
                  "Les deux indices positifs utilisables sont 0 et 1."),
    "confirmation": ("Quelle expression lit le dernier élément d’une liste non vide ?",
                     None, ("liste[len(liste) - 1]", "liste[len(liste)]", "liste[0]", "liste[len(liste) + 1]"),
                     "Le nombre d’éléments dépasse de un le dernier indice positif."),
    "immediate": ("Que produit l’accès suivant à un indice situé juste après la fin ?",
                  "[12, 15][2]", ("IndexError", "15", "12", "None"),
                  "Une liste de deux éléments s’arrête à l’indice 1."),
    "j7": ("Quel indice doit terminer cette boucle sans dépasser la liste ?",
           "mesures = [6, 8, 4, 2, 9]\n# La boucle utilise mesures[i].",
           ("4", "5", "3", "6"), "Cinq éléments occupent les indices 0 à 4."),
}
ROLES = {
    "confirmation": QuestionRole.confirmation,
    "immediate": QuestionRole.immediate_retest,
    "j7": QuestionRole.j7_retest,
}


def question(key: str) -> TeacherQuestion:
    stem, code, options, explanation = SAMPLE_QUESTIONS[key]
    return TeacherQuestion(
        id=fixture_id(f"question-{key}"), stem=stem, code=code, explanation=explanation,
        concept_code=CONCEPT, role=ROLES.get(key, QuestionRole.initial),
        source="teacher", status="draft", version=1,
        options=[
            {"id": fixture_id(f"option-{key}-{index}"), "text": label,
             "is_correct": index == 0, "misconception_code": ERROR_CODE if index == 1 else None}
            for index, label in enumerate(options)
        ],
    )


def student_question(item: TeacherQuestion) -> StudentQuestion:
    return StudentQuestion(
        id=item.id, concept_code=item.concept_code, stem=item.stem, code=item.code,
        options=[{"id": option.id, "text": option.text} for option in item.options],
    )


def initial_questions() -> list[TeacherQuestion]:
    return [question(f"initial-{number}") for number in range(1, 5)]


def sample_plan():
    return generic_plan("Indices et bornes", "Tracer les indices de trois listes de longueurs différentes.")


def sample_group():
    return {
        "id": GROUP_ID, "label": "Indices et bornes", "student_ids": MEMBERS,
        "main_misconception_code": ERROR_CODE, "status": "suggested",
        "confidence_label": "provisional", "avg_similarity": 0.67, "is_synthetic": True,
        "evidence_summary": "Trois profils fictifs partagent un distracteur lié aux indices.",
    }


def sample_dashboard():
    return {
        "lesson_id": LESSON_ID,
        "priorities": [{
            "misconception_code": ERROR_CODE, "label": "Indices et bornes",
            "affected_students": 3, "observed_count": 4, "corroborated_students": 1,
            "confident_wrong_share": 0.5, "priority_score": 3.75,
        }],
        "participation": {"enrolled_count": 3, "submitted_count": 3, "insufficient_count": 0},
        "insights": [{
            "kind": "different_scores_shared_error", "labels": ["Étudiant 01", "Étudiant 02"],
            "scores": [2, 3], "misconception_codes": [ERROR_CODE],
        }],
        "is_synthetic": True,
    }


def sample_graph(tau: float):
    return {
        "nodes": [
            {"id": member, "label": f"Étudiant {index:02}", "diagnosis_quality": "suspected",
             "is_synthetic": True}
            for index, member in enumerate(MEMBERS, start=1)
        ],
        "edges": [
            {"source": MEMBERS[0], "target": member, "similarity": 0.67, "provisional": True}
            for member in MEMBERS[1:] if tau <= 0.67
        ],
        "is_synthetic": True,
    }


def sample_before_after():
    return {
        "lesson_id": LESSON_ID,
        "concepts": [{
            "concept_code": CONCEPT,
            "initial": {"correct": 2, "attempts": 4, "rate": 0.5},
            "immediate": {"correct": 2, "attempts": 3, "rate": 2 / 3},
            "j7": {"correct": 0, "attempts": 0, "rate": None},
        }],
        "is_synthetic": True,
    }


def task_for(quiz_id, kind, status="available", **data):
    return {
        "id": quiz_id, "quiz_id": quiz_id, "lesson_id": LESSON_ID, "classroom_id": CLASSROOM_ID,
        "title": "Boucles et indices Python", "kind": kind, "status": status,
        "is_synthetic": True, **data,
    }
