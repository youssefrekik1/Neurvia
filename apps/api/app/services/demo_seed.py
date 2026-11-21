from datetime import timedelta
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import password_hash
from app.models import Classroom, Concept, Lesson, LessonConcept, Membership, Question, Quiz, QuizQuestion, User
from app.models import enums as e
from app.schemas.learning import QuestionDraft
from app.services.assessments import confirmation_for, get_or_begin, save_choice, submit_attempt
from app.schemas.learning import AnswerInput
from app.services.questions import approve_question, create_question, opts, question_input, quiz_items
from app.services.demo_students import CLASSROOMS, STUDENTS, TEACHER


def fixture_id(key: str):
    return uuid5(NAMESPACE_URL, f"fahm:phase-0:{key}")


TEACHER_ID = fixture_id("teacher")
STUDENT_IDS = tuple(fixture_id(f"student-{number}") for number in range(1, 21))
CLASSROOM_ID = fixture_id("classroom")
LESSON_ID = fixture_id("lesson")
INITIAL_QUIZ_ID = fixture_id("quiz-initial")
DEMO_JOIN_CODE = "FAHMDEMO24"
DEMO_PASSWORD = "FAHM-demo-2026"
CLASSROOM_IDS = (fixture_id("algo-classroom-a"), fixture_id("classroom-2"))
ALGO_TEACHER_ID = fixture_id("algo-teacher")

# Reviewed for the synthetic scenario only. Real teachers approve their own bank separately.
VARIANTS = {
    ("C_INDEXING", "M_OFF_BY_ONE"): [
        ("Quel indice positif désigne le dernier élément de cette liste ?", "valeurs = [6, 8, 4, 2, 9]",
         ["4", "5", "1", "2"], "Cinq éléments occupent les indices 0 à 4."),
        ("Que produit cet accès à un indice situé juste après la fin ?", "[12, 15][2]",
         ["IndexError", "15", "12", "None"], "Les indices non négatifs valides sont 0 et 1."),
        ("Quelle valeur faut-il donner à i pour afficher la dernière mesure ?", "mesures = [5, 9, 2]\nprint(mesures[i])",
         ["2", "3", "0", "1"], "La dernière mesure est à la position 2."),
    ],
    ("C_CONDITIONS", "M_COND_LOGIC"): [
        ("On exige le badge ET le code. Quelle condition traduit cette règle ?", None,
         ["badge and code", "badge or code", "not badge", "not code"], "Les deux conditions doivent être vraies."),
        ("Seuls les multiples de deux et de trois sont acceptés. Quel test utiliser ?", None,
         ["n % 2 == 0 and n % 3 == 0", "n % 2 == 0 or n % 3 == 0", "n % 2 == 1", "n % 3 == 1"],
         "Le test doit vérifier les deux restes."),
        ("Une alarme se déclenche avec au moins un capteur actif. Quel test choisir ?", None,
         ["a or b", "a and b", "not a and not b", "a == b"], "or suffit quand au moins une condition est vraie."),
    ],
    ("C_TYPES", "M_TYPE_INPUT"): [
        ("L’utilisateur entre 8. Quel est le type de x après cette instruction ?", "x = input()",
         ["str", "int", "float", "bool"], "input renvoie toujours une chaîne."),
        ("Quel traitement permet d’ajouter 2 à la valeur entière saisie ?", "n = input()",
         ["int(n) + 2", "n + 2", "str(n) + '2'", "len(n) + 2"], "int transforme la chaîne en entier avant le calcul."),
        ("Si l’utilisateur saisit 42, qu’affiche ce programme ?", "x = input()\nprint(x * 2)",
         ["4242", "84", "42", "Une erreur de syntaxe"], "Multiplier une chaîne par 2 répète le texte."),
    ],
}


def parse_variant(concept, target, value):
    stem, code, labels, explanation = value
    return QuestionDraft(
        concept_code=concept, stem=stem, code=code, explanation=explanation, options=[
            {"text": text, "is_correct": index == 0, "misconception_code": target if index == 1 else None}
            for index, text in enumerate(labels)
        ],
    )


def seed_named_classes(db: Session, now):
    # Synthetic accounts are loaded only when DEMO_MODE=true.
    teacher = db.get(User, ALGO_TEACHER_ID)
    if teacher is None:
        teacher = db.scalar(select(User).where(User.email == TEACHER["identifiant"]))
        if teacher is None:
            teacher = User(id=ALGO_TEACHER_ID, email=TEACHER["identifiant"],
                           password_hash=password_hash.hash(TEACHER["mot_de_passe"]),
                           full_name=f"{TEACHER['prenom']} {TEACHER['nom']}",
                           role=e.Role.teacher, is_synthetic=True)
            db.add(teacher)
            db.flush()

    for class_index, class_spec in enumerate(CLASSROOMS):
        room_id = CLASSROOM_IDS[class_index]
        room = db.get(Classroom, room_id)
        if room is None and class_index == 0:
            legacy_room = db.get(Classroom, CLASSROOM_ID)
            if legacy_room is not None and legacy_room.teacher_id == teacher.id:
                room = legacy_room
                room_id = room.id
        if room is None:
            room = Classroom(id=room_id, teacher_id=teacher.id, name=class_spec["nom"],
                              subject="python_intro", join_code=class_spec["code"],
                              join_expires_at=now + timedelta(days=3650), is_synthetic=True)
            db.add(room)
            db.flush()
        elif room.teacher_id == ALGO_TEACHER_ID and room.subject == "algorithmique":
            room.subject = "python_intro"
        students = STUDENTS[class_index * 40:(class_index + 1) * 40]
        for student in students:
            user = db.scalar(select(User).where(User.email == student["identifiant"]))
            if user is None:
                user = User(email=student["identifiant"],
                            password_hash=password_hash.hash(student["mot_de_passe"]),
                            full_name=f"{student['prenom']} {student['nom']}",
                            role=e.Role.student, is_synthetic=True)
                db.add(user)
                db.flush()
            member_id = db.scalar(select(Membership.id).where(
                Membership.classroom_id == room_id, Membership.user_id == user.id,
            ))
            if member_id is None:
                db.add(Membership(classroom_id=room_id, user_id=user.id,
                                  pseudonym=f"{student['prenom']} {student['nom']}"))
    db.flush()


def seed_demo(db: Session, now):
    seed_named_classes(db, now)
    if db.get(Classroom, CLASSROOM_ID) is None:
        hash_value = password_hash.hash(DEMO_PASSWORD)
        db.add(User(id=TEACHER_ID, email="prof.fahm@example.com", password_hash=hash_value,
                    full_name="Professeur Démo", role=e.Role.teacher, is_synthetic=True))
        db.add_all(User(id=student_id, email=f"eleve{number}.fahm@example.com", password_hash=hash_value,
                        full_name=f"Étudiant Démo {number:02}", role=e.Role.student, is_synthetic=True)
                   for number, student_id in enumerate(STUDENT_IDS, start=1))
        db.flush()
        db.add(Classroom(id=CLASSROOM_ID, teacher_id=TEACHER_ID, name="Algorithmique — classe fictive",
                         subject="python_intro", join_code=DEMO_JOIN_CODE,
                         join_expires_at=now + timedelta(days=30), is_synthetic=True))
        db.flush()
        db.add_all(Membership(classroom_id=CLASSROOM_ID, user_id=student_id, pseudonym=f"Étudiant {number:02}")
                   for number, student_id in enumerate(STUDENT_IDS, start=1))
    # Upgrade an existing Phase 0 demo DB without discarding its classes or accounts.
    room = db.get(Classroom, CLASSROOM_ID)
    if room.teacher_id != TEACHER_ID:
        return
    if db.get(Quiz, INITIAL_QUIZ_ID):
        return
    existing = {user for user in db.scalars(select(Membership.user_id).where(Membership.classroom_id == room.id))}
    if len(existing) < len(STUDENT_IDS):
        for number, student in enumerate(STUDENT_IDS, start=1):
            if student in existing:
                continue
            if db.get(User, student) is None:
                db.add(User(id=student, email=f"eleve{number}.fahm@example.com",
                            password_hash=db.get(User, TEACHER_ID).password_hash,
                            full_name=f"Étudiant Démo {number:02}", role=e.Role.student, is_synthetic=True))
                db.flush()
            db.add(Membership(classroom_id=room.id, user_id=student, pseudonym=f"Étudiant {number:02}"))
    lesson = db.get(Lesson, LESSON_ID)
    if lesson is None:
        lesson = Lesson(id=LESSON_ID, classroom_id=room.id, title="Comprendre les pièges du code Python",
                        content_text="Tracer une boucle. Les indices non négatifs vont de 0 à n-1. "
                                     "and exige deux conditions vraies. input renvoie une chaîne.",
                        focus_brief_json={"difficulty": 1, "question_count": 6},
                        status=e.LessonStatus.published)
        db.add(lesson)
        db.flush()
    linked = set(db.scalars(select(LessonConcept.concept_id).where(LessonConcept.lesson_id == lesson.id)))
    concepts = {row.id: row.code for row in db.scalars(select(Concept))}
    for concept_id in concepts.keys() - linked:
        db.add(LessonConcept(lesson_id=lesson.id, concept_id=concept_id))
    for (concept, target), variants in VARIANTS.items():
        for role, variant in zip((e.QuestionRole.confirmation, e.QuestionRole.immediate_retest,
                                  e.QuestionRole.j7_retest), variants, strict=True):
            item = create_question(db, parse_variant(concept, target, variant), owner_id=TEACHER_ID,
                                   role=role, target_code=target)
            approve_question(db, item, TEACHER_ID, now)
    quiz = Quiz(id=INITIAL_QUIZ_ID, lesson_id=lesson.id, kind=e.QuestionRole.initial, status=e.QuizStatus.published,
                validated_by=TEACHER_ID, validated_at=now, generation_mode="bank")
    db.add(quiz)
    db.flush()
    for position, original in enumerate(db.scalars(select(Question).where(
        Question.seed_key.is_not(None), Question.role == e.QuestionRole.initial
    ).order_by(Question.seed_key)).all(), start=1):
        item = create_question(db, question_input(db, original, concepts[original.concept_id]),
                               source=e.Source.bank, owner_id=TEACHER_ID)
        approve_question(db, item, TEACHER_ID, now)
        db.add(QuizQuestion(quiz_id=quiz.id, question_id=item.id, position=position))
    db.flush()
    items = quiz_items(db, quiz.id)
    for index, student in enumerate(STUDENT_IDS[2:18]):
        wrong_code = tuple(VARIANTS)[index % 3][0]
        attempt = get_or_begin(db, quiz, student, now)
        limit = 3 if index == 15 else len(items)
        for _, item, concept in items[:limit]:
            options = opts(db, item.id)
            if concept.code == wrong_code:
                wrong = tuple(VARIANTS)[index % 3][1]
                option = next(row for row, code in options if code == wrong)
            elif index % 4 == 0 and concept.code == "C_SCOPE":
                option = next(row for row, code in options if not row.is_correct and code is None)
            else:
                option = next(row for row, _ in options if row.is_correct)
            save_choice(db, attempt, quiz, AnswerInput(question_id=item.id, option_id=option.id,
                                                      confidence=e.Confidence.sure if index % 2 else e.Confidence.medium))
        submit_attempt(db, attempt, quiz, room, now)
        if index in (0, 1):
            assigned = confirmation_for(db, attempt.id)
            private = db.get(Quiz, assigned.quiz_id) if assigned else None
            if private:
                verification = get_or_begin(db, private, student, now)
                _, item, _ = quiz_items(db, private.id)[0]
                option = next(row for row, _ in opts(db, item.id)
                              if (row.is_correct if index == 0 else row.misconception_id == assigned.misconception_id))
                save_choice(db, verification, private, AnswerInput(
                    question_id=item.id, option_id=option.id, confidence=e.Confidence.sure,
                ))
                submit_attempt(db, verification, private, room, now, assigned)
