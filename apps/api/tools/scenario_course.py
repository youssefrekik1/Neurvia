"""Build a realistic class through the public API: a teacher, a new subject, course PDFs and students' answers.

Default scenario: an introductory databases course ("Bases de données") with four teacher-validated concepts,
the course PDFs, a grounded quiz, document-grounded follow-up variants and 30 students whose answers follow
five profiles (four share misconceptions, one has mastered the material), so diagnosis, MindMirror and
grouping have real material to work with.

Every step goes through the HTTP API, as the browser would. Progress is saved to --state so that a long run
(model generation on a local GPU) can resume. Steps a teacher performs by hand in the interface — reviewing
flagged extraction blocks, approving generated items and publishing — are automated here for test data
only, and each one is logged.

    python -m tools.scenario_course --corpus ../../cours --state scenario.json
"""

import argparse
import json
import random
import time
from pathlib import Path

import httpx

PASSWORD = "Neurvia-BD-2026"
SUBJECT = "Bases de données"

TAXONOMY = [
    ("Modèle Entité-Association", [
        ("Confond une entité et un attribut", "Demander si l’élément possède une identité et ses propres attributs."),
        ("Inverse les cardinalités d’une association",
         "Lire chaque cardinalité depuis l’entité vers l’association, avec un exemple concret."),
        ("Place l’attribut d’une association N-N dans une des entités",
         "Vérifier de quelles entités dépend la valeur de l’attribut."),
    ]),
    ("Traduction du modèle E-A en modèle relationnel", [
        ("Traduit une association N-N par une simple clé étrangère",
         "Montrer qu’une association N-N devient une relation dont la clé combine les deux clés."),
        ("Place la clé étrangère du côté 1 d’une association 1-N",
         "Rappeler que la clé étrangère migre vers l’entité côté N."),
        ("Oublie les attributs portés par l’association lors de la traduction",
         "Lister les attributs de l’association avant de créer la relation."),
    ]),
    ("Normalisation", [
        ("Confond dépendance partielle et dépendance transitive",
         "Comparer une dépendance vers une partie de la clé et une dépendance entre attributs non clés."),
        ("Pense qu’une relation en 3FN ne contient plus aucune redondance",
         "Étudier un contre-exemple résolu seulement par la forme normale de Boyce-Codd."),
        ("Considère un attribut multivalué comme compatible avec la 1FN",
         "Revenir à la définition d’un attribut atomique."),
    ]),
    ("Algèbre relationnelle", [
        ("Confond sélection et projection", "Associer la sélection aux lignes et la projection aux colonnes."),
        ("Confond jointure naturelle et produit cartésien",
         "Comparer le nombre de tuples obtenus sur deux petites relations."),
        ("Oublie que la projection élimine les doublons",
         "Rappeler que le résultat d’un opérateur est un ensemble, sans doublon."),
    ]),
]
# Indexes into the flattened misconception list: profile -> misconceptions held.
PROFILES = {"A": (3, 4), "B": (6, 7), "C": (9, 10), "D": (0, 1), "maîtrise": ()}
DISTRIBUTION = ["A"] * 7 + ["B"] * 7 + ["C"] * 6 + ["D"] * 5 + ["maîtrise"] * 5
CONFIDENCE = (("sure", 0.6), ("medium", 0.3), ("unsure", 0.1))


def log(*parts):
    print(time.strftime("%H:%M:%S"), *parts, flush=True)


class Api:
    def __init__(self, url):
        self.http = httpx.Client(base_url=url + "/api/v1", timeout=600)

    def call(self, method, path, headers=None, expected=(200, 201, 202), **kwargs):
        response = self.http.request(method, path, headers=headers, **kwargs)
        # Registration, login and model routes are rate limited per minute; wait out the window.
        for _ in range(3):
            if response.status_code != 429:
                break
            log(f"rate limited on {path}; waiting 61 s")
            time.sleep(61)
            response = self.http.request(method, path, headers=headers, **kwargs)
        if response.status_code not in expected:
            raise RuntimeError(f"{method} {path}: {response.status_code} {response.text[:600]}")
        return response.json()

    def account(self, email, name, role):
        body = {"email": email, "password": PASSWORD}
        login = self.http.post("/auth/login", json=body)
        if login.status_code == 429:
            return {"Authorization": "Bearer " + self.call("POST", "/auth/login", json=body)["access_token"]}
        if login.status_code != 200:
            self.call("POST", "/auth/register", json={**body, "full_name": name, "role": role})
            return {"Authorization": "Bearer " + self.call("POST", "/auth/login", json=body)["access_token"]}
        return {"Authorization": "Bearer " + login.json()["access_token"]}


class State(dict):
    def __init__(self, path):
        super().__init__(json.loads(path.read_text(encoding="utf-8")) if path.exists() else {})
        self.path = path

    def save(self):
        self.path.write_text(json.dumps(self, ensure_ascii=False, indent=2), encoding="utf-8")


def wait_ready(api, teacher, root, ids):
    """Wait for extraction, confirm flagged blocks unchanged (logged), then wait for indexing."""
    pending = set(ids)
    while pending:
        for doc_id in sorted(pending):
            doc = api.call("GET", f"{root}/{doc_id}", teacher)
            if doc["state"] == "failed":
                raise RuntimeError(f"{doc['name']} failed: {doc['failure']}")
            if doc["state"] == "review":
                flagged = 0
                for number in range(1, doc["page_count"] + 1):
                    for block in api.call("GET", f"{root}/{doc_id}/pages/{number}", teacher)["blocks"]:
                        if block["review_required"]:
                            doc = api.call("PATCH", f"{root}/{doc_id}/blocks/{block['id']}", teacher,
                                           json={"revision": doc["revision"], "text": block["text"]})
                            flagged += 1
                api.call("POST", f"{root}/{doc_id}/review", teacher,
                         json={"revision": doc["revision"], "validated": True})
                log(f"{doc['name']}: {doc['page_count']} pages, {flagged} flagged block(s) confirmed as extracted")
            elif doc["state"] == "ready":
                log(f"{doc['name']}: indexed ({doc['page_count']} pages)")
                pending.discard(doc_id)
        time.sleep(3)


def pick(options, held, skill, rng):
    """Choose an option index and confidence for a student with the given misconceptions and skill."""
    def confidence():
        roll, total = rng.random(), 0
        for value, weight in CONFIDENCE:
            total += weight
            if roll <= total:
                return value
        return "medium"

    tempting = [index for index, option in enumerate(options) if option["misconception_code"] in held]
    if tempting and rng.random() < 0.85:
        return rng.choice(tempting), confidence()
    if rng.random() < skill:
        return next(index for index, option in enumerate(options) if option["is_correct"]), confidence()
    wrong = [index for index, option in enumerate(options) if not option["is_correct"]]
    return rng.choice(wrong), rng.choice(["medium", "unsure"])


def run(args):
    api, state, rng = Api(args.url), State(args.state), random.Random(args.seed)
    teacher = api.account(args.teacher, "Fatma Enseignante", "teacher")

    if "classroom" not in state:
        room = api.call("POST", "/classrooms", teacher, json={
            "name": "Bases de données — L2", "subject": SUBJECT, "join_ttl_hours": 720})
        state["classroom"], state["join_code"] = room["id"], room["join_code"]
        state.save()
        log("classroom", room["id"], "join code", room["join_code"])

    if "concepts" not in state:
        concepts = []
        for label, errors in TAXONOMY:
            view = api.call("POST", f"/classrooms/{state['classroom']}/taxonomy", teacher, json={
                "label": label, "validated": True,
                "misconceptions": [{"label": name, "remediation_hint": hint} for name, hint in errors]})
            concepts.append({"code": view["code"], "label": label,
                             "misconceptions": [item["code"] for item in view["misconceptions"]]})
        state["concepts"] = concepts
        state.save()
        log("validated", len(concepts), "concepts with", sum(len(c["misconceptions"]) for c in concepts),
            "misconceptions")
    misconceptions = [code for concept in state["concepts"] for code in concept["misconceptions"]]

    if "lesson" not in state:
        lesson = api.call("POST", f"/classrooms/{state['classroom']}/lessons", teacher, json={
            "title": "Modélisation, normalisation et algèbre relationnelle",
            "content_text": "Séance de synthèse : modèle Entité-Association, passage au modèle relationnel, "
                            "formes normales et opérateurs de l’algèbre relationnelle.",
            "concept_codes": [concept["code"] for concept in state["concepts"]]})
        state["lesson"] = lesson["id"]
        state.save()
    root = f"/lessons/{state['lesson']}/documents"
    assistant = f"/lessons/{state['lesson']}/course-assistant"

    if "documents" not in state:
        ids = []
        for path in sorted(args.corpus.glob(args.pattern)):
            doc = api.call("POST", root, teacher, files={"file": (path.name, path.read_bytes(), "application/pdf")})
            ids.append(doc["id"])
            log("uploaded", path.name)
        wait_ready(api, teacher, root, ids)
        state["documents"] = ids
        state.save()
    selection = {"document_ids": state["documents"]}

    if "conversation" not in state:
        chat = api.call("POST", assistant, teacher)
        for message in [
            "Comment traduit-on une association N-N du modèle Entité-Association en modèle relationnel ?",
            "Quelle différence le cours fait-il entre la deuxième et la troisième forme normale ?",
            "Je veux un quiz de huit questions sur la traduction E-A, la normalisation et l’algèbre relationnelle. "
            "Mes étudiants confondent souvent sélection et projection et placent mal les clés étrangères.",
        ]:
            started = time.perf_counter()
            chat = api.call("POST", f"{assistant}/{chat['id']}/messages", teacher, json={**selection, "message": message})
            answer = chat["messages"][-1]
            log(f"chat {time.perf_counter() - started:.0f}s, {len(answer['sources'])} source(s):", answer["text"][:160])
        chat = api.call("POST", f"{assistant}/{chat['id']}/brief/extract", teacher)
        brief = chat["brief"] | {"question_count": args.questions}
        chat = api.call("PATCH", f"{assistant}/{chat['id']}/brief", teacher,
                        json={**brief, "revision": chat["brief_revision"]})
        log("brief", json.dumps(chat["brief"], ensure_ascii=False))
        state["conversation"], state["brief_revision"] = chat["id"], chat["brief_revision"]
        state.save()
    generation = {**selection, "conversation_id": state["conversation"], "brief_revision": state["brief_revision"]}

    if "quiz" not in state:
        quiz, failures = None, 0
        while (not quiz or len(quiz["questions"]) < args.questions) and failures < 6:
            started = time.perf_counter()
            response = api.http.post(f"{assistant}/quiz", headers=teacher, json={**generation, "question_count": 1})
            if response.status_code == 200:
                quiz = response.json()
                log(f"question {len(quiz['questions'])}/{args.questions} in {time.perf_counter() - started:.0f}s")
            else:
                failures += 1
                log(f"question rejected after {time.perf_counter() - started:.0f}s: {response.text[:200]}")
        state["quiz"] = quiz["id"]
        state.save()

    if "variants" not in state:
        skip, created = [], 0
        for _ in range(120):
            started = time.perf_counter()
            result = api.call("POST", f"{assistant}/variants", teacher, json={**generation, "skip": skip})
            if result["question"]:
                created += 1
                item = result["question"]
                api.call("POST", f"/bank/questions/{item['id']}/approve", teacher, json={"validated": True})
                log(f"variant {item['role']} approved in {time.perf_counter() - started:.0f}s, {result['remaining']} slot(s) left")
            else:
                skip += result["attempted"]
                log(f"no supported variant for {result['attempted']} ({time.perf_counter() - started:.0f}s)")
                if result["remaining"] <= len(result["attempted"]):
                    break
        state["variants"] = {"approved": created, "unfilled": skip}
        state.save()

    quiz = api.call("GET", f"/quizzes/{state['quiz']}", teacher)
    if quiz["status"] == "draft":
        quiz = api.call("POST", f"/quizzes/{state['quiz']}/publish", teacher, json={"validated": True})
        log("quiz published with", len(quiz["questions"]), "questions (teacher approval automated for test data)")
    codes = {question["id"]: question["options"] for question in quiz["questions"]}
    codes |= {item["id"]: item["options"] for item in api.call("GET", "/bank/questions", teacher)}

    students = state.setdefault("students", {})
    for number, profile in enumerate(DISTRIBUTION[:args.students], start=1):
        email = f"etudiant{number:02d}.bd@example.com"
        if students.get(email, {}).get("done"):
            continue
        token = api.account(email, f"Étudiant BD {number:02d}", "student")
        api.call("POST", "/classrooms/join", token, expected=(200, 201, 409),
                 json={"code": state["join_code"], "pseudonym": f"BD-{number:02d}"})
        held = {misconceptions[index] for index in PROFILES[profile]}
        skill = 0.85 if profile == "maîtrise" else rng.uniform(0.45, 0.75)
        attempt = api.call("POST", f"/quizzes/{state['quiz']}/attempts", token)
        for question in attempt["questions"]:
            options = codes[question["id"]]
            index, confidence = pick(options, held, skill, rng)
            api.call("POST", f"/attempts/{attempt['id']}/answers", token, json={
                "question_id": question["id"], "option_id": options[index]["id"], "confidence": confidence})
        feedback = api.call("POST", f"/attempts/{attempt['id']}/submit", token)
        confirmation = api.call("GET", f"/attempts/{attempt['id']}/confirmation", token)
        confirmed = None
        if confirmation:
            question = confirmation["question"]
            options = codes[question["id"]]
            index, confidence = pick(options, held, skill, rng)
            api.call("POST", f"/attempts/{attempt['id']}/confirmation", token, json={
                "question_id": question["id"], "option_id": options[index]["id"], "confidence": confidence})
            confirmed = options[index]["misconception_code"]
        students[email] = {"profile": profile, "score": feedback["correct_count"],
                           "confirmation": bool(confirmation), "done": True}
        state.save()
        log(f"{email} ({profile}): {feedback['correct_count']}/{feedback['answered_count']}, "
            f"confirmation {'answered' if confirmation else 'none'}{' → ' + confirmed if confirmed else ''}")

    dashboard = api.call("GET", f"/lessons/{state['lesson']}/dashboard", teacher)
    log("dashboard:", json.dumps(dashboard, ensure_ascii=False)[:900])
    print(json.dumps({"teacher": args.teacher, "password": PASSWORD, "lesson": state["lesson"],
                      "classroom": state["classroom"], "join_code": state["join_code"]}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://127.0.0.1:8010")
    parser.add_argument("--corpus", type=Path, required=True, help="Folder containing the course PDFs")
    parser.add_argument("--pattern", default="BD-*.pdf", help="Which PDFs of the folder to upload")
    parser.add_argument("--state", type=Path, default=Path("scenario-state.json"))
    parser.add_argument("--teacher", default="prof.bd@example.com")
    parser.add_argument("--students", type=int, default=30)
    parser.add_argument("--questions", type=int, default=8)
    parser.add_argument("--seed", type=int, default=2026)
    run(parser.parse_args())
