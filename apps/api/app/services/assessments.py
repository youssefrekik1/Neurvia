from datetime import timedelta

from sqlalchemy import select

from app.analytics.diagnostics import Evidence, quadrant, summarize
from app.core.errors import error
from app.models import (
    Answer, Attempt, ConfirmationAssignment, DiagnosisSummary, Misconception,
    MisconceptionObservation, Question, QuestionOption, Quiz, QuizQuestion, RetestSchedule,
)
from app.models import enums as e
from app.services.questions import bank_items, fingerprint, quiz_items, student_view


def choose_variant(db, *, lesson_id, student_id, teacher_id, roles, concept_ids, target_id=None):
    # Count items assigned only to this student, plus any initial quiz already opened.
    excluded = {
        fingerprint(stem, code) for stem, code in db.execute(
            select(Question.stem, Question.code)
            .join(QuizQuestion, QuizQuestion.question_id == Question.id)
            .join(Quiz, Quiz.id == QuizQuestion.quiz_id)
            .outerjoin(Attempt, (Attempt.quiz_id == Quiz.id) & (Attempt.student_id == student_id))
            .where(Quiz.lesson_id == lesson_id, (Quiz.recipient_id == student_id) | Attempt.id.is_not(None))
        )
    }
    for role in roles:
        for item, _ in bank_items(db, teacher_id, role=role, concept_ids=concept_ids):
            if fingerprint(item.stem, item.code) in excluded:
                continue
            if target_id is not None and (
                (role == e.QuestionRole.confirmation and item.target_misconception_id != target_id)
                or (role != e.QuestionRole.confirmation and not db.scalar(select(QuestionOption.id).where(
                    QuestionOption.question_id == item.id, QuestionOption.misconception_id == target_id,
                ).limit(1)))
            ):
                continue
            return item
    return None


def personal_quiz(db, *, lesson_id, student_id, item, now, due=None, parent=None):
    quiz = Quiz(
        lesson_id=lesson_id, kind=item.role, status=e.QuizStatus.published,
        recipient_id=student_id, parent_quiz_id=parent, scheduled_for=due,
        generation_mode="bank", validated_at=now, validated_by=item.validated_by,
    )
    db.add(quiz)
    db.flush()
    db.add(QuizQuestion(quiz_id=quiz.id, question_id=item.id, position=1))
    db.flush()
    return quiz


def saved_rows(db, attempt_id):
    return list(db.execute(
        select(Answer, Question, QuestionOption).join(Question, Answer.question_id == Question.id)
        .join(QuestionOption, Answer.option_id == QuestionOption.id)
        .where(Answer.attempt_id == attempt_id).order_by(Answer.created_at, Answer.id)
    ))


def get_or_begin(db, quiz, student_id, now):
    existing = db.scalar(select(Attempt).where(Attempt.quiz_id == quiz.id, Attempt.student_id == student_id))
    if existing:
        return existing
    if quiz.status != e.QuizStatus.published:
        raise error(409, "QUIZ_NOT_OPEN", "Ce quiz n’est pas ouvert.")
    if quiz.scheduled_for and quiz.scheduled_for > now:
        raise error(404)
    row = Attempt(quiz_id=quiz.id, student_id=student_id, status=e.AttemptStatus.in_progress, started_at=now)
    db.add(row)
    db.flush()
    return row


def save_choice(db, attempt, quiz, data):
    if attempt.status == e.AttemptStatus.submitted or quiz.status != e.QuizStatus.published:
        raise error(409, "ATTEMPT_CLOSED", "La tentative ne peut plus être modifiée.")
    option = db.scalar(select(QuestionOption).join(QuizQuestion, QuizQuestion.question_id == QuestionOption.question_id)
                       .where(QuizQuestion.quiz_id == quiz.id, QuestionOption.question_id == data.question_id,
                              QuestionOption.id == data.option_id))
    if option is None:
        raise error(422, "INVALID_OPTION", "L’option ne correspond pas à cette question.")
    answer = db.scalar(select(Answer).where(
        Answer.attempt_id == attempt.id, Answer.question_id == data.question_id
    ))
    values = {"option_id": option.id, "confidence": data.confidence, "is_correct": option.is_correct,
              "quadrant": quadrant(option.is_correct, data.confidence)}
    if "justification" in data.model_fields_set:
        values["justification"] = data.justification
    elif answer is not None and answer.option_id != option.id:
        values["justification"] = None
    if answer is None:
        answer = Answer(attempt_id=attempt.id, question_id=data.question_id, **values)
        db.add(answer)
    else:
        for name, value in values.items():
            setattr(answer, name, value)
    db.flush()
    return answer


def refresh_diagnoses(db, *, student_id, lesson_id, weakened_ids=frozenset()):
    codes = {row.id: row.code for row in db.scalars(select(Misconception))}
    rows = list(db.execute(
        select(MisconceptionObservation, Answer, Question)
        .join(Answer, MisconceptionObservation.answer_id == Answer.id)
        .join(Question, Answer.question_id == Question.id)
        .where(MisconceptionObservation.student_id == student_id,
               MisconceptionObservation.lesson_id == lesson_id,
               MisconceptionObservation.evidence_stage.in_([e.QuestionRole.initial, e.QuestionRole.confirmation]))
    ))
    results = summarize([
        Evidence(codes[row.misconception_id], fingerprint(question.stem, question.code),
                 answer.confidence == e.Confidence.sure)
        for row, answer, question in rows
    ], {codes[key] for key in weakened_ids})
    existing = {codes[row.misconception_id]: row for row in db.scalars(
        select(DiagnosisSummary).where(DiagnosisSummary.student_id == student_id,
                                      DiagnosisSummary.lesson_id == lesson_id)
    )}
    by_code = {code: id for id, code in codes.items()}
    for code, (status, evidence, distinct) in results.items():
        row = existing.get(code)
        if row is None:
            row = DiagnosisSummary(student_id=student_id, lesson_id=lesson_id, misconception_id=by_code[code])
            db.add(row)
        row.status = status
        row.evidence_count = evidence
        row.distinct_questions_count = distinct
    db.flush()


def confirmation_for(db, initial_id):
    return db.scalar(select(ConfirmationAssignment).where(
        ConfirmationAssignment.initial_attempt_id == initial_id
    ))


def assign_confirmation(db, attempt, quiz, classroom, rows, now):
    if len(rows) < 4:
        return
    candidates = db.execute(
        select(DiagnosisSummary.misconception_id, Misconception.code)
        .join(Misconception)
        .where(DiagnosisSummary.student_id == attempt.student_id, DiagnosisSummary.lesson_id == quiz.lesson_id,
               DiagnosisSummary.status == e.DiagnosisStatus.suspected)
    ).all()
    order = []
    for misconception_id, code in candidates:
        matching = [(answer, item) for answer, item, option in rows if option.misconception_id == misconception_id]
        if not matching:
            continue
        confident = any(answer.confidence == e.Confidence.sure for answer, _ in matching)
        order.append((not confident, code, misconception_id, {item.concept_id for _, item in matching}))
    for _, _, misconception_id, concepts in sorted(order):
        option = choose_variant(
            db, lesson_id=quiz.lesson_id, student_id=attempt.student_id, teacher_id=classroom.teacher_id,
            roles=[e.QuestionRole.confirmation], concept_ids=concepts, target_id=misconception_id,
        )
        if option is None:
            continue
        private = personal_quiz(db, lesson_id=quiz.lesson_id, student_id=attempt.student_id,
                                item=option, now=now, parent=quiz.id)
        db.add(ConfirmationAssignment(initial_attempt_id=attempt.id, quiz_id=private.id,
                                      misconception_id=misconception_id))
        return


def enqueue_j7(db, attempt, quiz, classroom, question, now, target_id):
    existing = db.scalar(select(RetestSchedule).where(
        RetestSchedule.student_id == attempt.student_id, RetestSchedule.lesson_id == quiz.lesson_id,
        RetestSchedule.concept_id == question.concept_id, RetestSchedule.kind == e.RetestKind.j7,
    ))
    if existing:
        return
    due = now + timedelta(days=7)
    item = choose_variant(db, lesson_id=quiz.lesson_id, student_id=attempt.student_id,
                          teacher_id=classroom.teacher_id, roles=[e.QuestionRole.j7_retest],
                          concept_ids={question.concept_id}, target_id=target_id)
    private = personal_quiz(db, lesson_id=quiz.lesson_id, student_id=attempt.student_id,
                            item=item, now=now, due=due, parent=quiz.id) if item else None
    db.add(RetestSchedule(student_id=attempt.student_id, lesson_id=quiz.lesson_id, concept_id=question.concept_id,
                          kind=e.RetestKind.j7, due_at=due, quiz_id=private.id if private else None,
                          target_misconception_id=target_id,
                          status=e.ScheduleStatus.pending if private else e.ScheduleStatus.skipped))


def submit_attempt(db, attempt, quiz, classroom, now, assignment=None):
    if attempt.status == e.AttemptStatus.submitted:
        return
    if quiz.status != e.QuizStatus.published:
        raise error(409, "QUIZ_NOT_OPEN", "Ce quiz est fermé.")
    rows = saved_rows(db, attempt.id)
    if not rows:
        raise error(409, "NO_ANSWERS", "Enregistrez au moins une réponse.")
    attempt.status, attempt.submitted_at = e.AttemptStatus.submitted, now
    for answer, _, option in rows:
        if not answer.is_correct and option.misconception_id is not None:
            db.add(MisconceptionObservation(
                answer_id=answer.id, student_id=attempt.student_id, lesson_id=quiz.lesson_id,
                misconception_id=option.misconception_id, evidence_stage=quiz.kind,
            ))
    db.flush()
    if quiz.kind == e.QuestionRole.initial:
        refresh_diagnoses(db, student_id=attempt.student_id, lesson_id=quiz.lesson_id)
        assign_confirmation(db, attempt, quiz, classroom, rows, now)
    elif quiz.kind == e.QuestionRole.confirmation:
        weakened = {assignment.misconception_id} if rows[0][0].is_correct else set()
        refresh_diagnoses(db, student_id=attempt.student_id, lesson_id=quiz.lesson_id, weakened_ids=weakened)
    else:
        schedule = db.scalar(select(RetestSchedule).where(RetestSchedule.quiz_id == quiz.id))
        if schedule:
            schedule.status = e.ScheduleStatus.done
        if quiz.kind == e.QuestionRole.immediate_retest:
            enqueue_j7(db, attempt, quiz, classroom, rows[0][1], now,
                       schedule.target_misconception_id if schedule else rows[0][1].target_misconception_id)


def questions_for_student(db, quiz):
    return [student_view(db, row, concept.code) for _, row, concept in quiz_items(db, quiz.id)]
