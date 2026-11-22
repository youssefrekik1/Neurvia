"""Create the hackathon demo accounts through the API: one teacher, two classes, two subjects, one student.

Usage: python tools/setup_demo_accounts.py [--api http://127.0.0.1:8010/api/v1] [--upload]
--upload sends the course PDFs from public/backend/demo to the lessons of each class
(requires a Gemini key in the API and worker so that the documents can be indexed).
"""

import argparse
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[3]
TEACHER = {"email": "hela.benamor@neurvia.tn", "password": "Neurvia-Prof-2026!", "full_name": "Hela Ben Amor"}
STUDENT = {"email": "yassine.jaziri@neurvia.tn", "password": "Neurvia-Etud-2026!", "full_name": "Yassine Jaziri"}
CLASSES = ["L2 Informatique A", "L2 Informatique B"]

SUBJECTS = {
    "Bases de données": {
        "folder": "public/backend/demo",
        "concepts": [
            ("Modèle Entité-Association et cardinalités", [
                ("Inverser les cardinalités d’une association", "Lire la cardinalité du côté de l’entité : un client passe 0,n commandes."),
                ("Confondre entité et attribut", "Une entité a un identifiant et des propriétés ; un attribut décrit une entité."),
            ]),
            ("Passage du modèle E-A au modèle relationnel", [
                ("Créer une table pour chaque association 1,n", "Une association 1,n se traduit par une clé étrangère côté n, pas par une table."),
                ("Oublier la clé étrangère", "Chaque association binaire 1,n ajoute la clé de l’entité côté 1 dans la table côté n."),
            ]),
            ("Dépendances fonctionnelles et normalisation", [
                ("Confondre 2FN et 3FN", "2FN : pas de dépendance partielle à la clé ; 3FN : pas de dépendance transitive."),
                ("Penser qu’une table en 3FN est forcément en BCNF", "BCNF exige que toute source de DF soit une clé ; la 3FN tolère une exception."),
            ]),
            ("Algèbre relationnelle", [
                ("Confondre sélection et projection", "σ filtre des lignes selon une condition ; π garde des colonnes."),
                ("Oublier la condition de jointure", "Sans condition, on obtient un produit cartésien de toutes les lignes."),
            ]),
        ],
        "lessons": [
            ("Chapitre 1 · Conception et modèle Entité-Association", 0, "BD-Cours-1.pdf"),
        ],
    },
    "Mathématiques du signal": {
        "folder": "public/backend/demo",
        "concepts": [
            ("Séries de Fourier et coefficients", [
                ("Oublier le facteur 1/2π dans a₀", "a₀ = (1/2π)∫₀^{2π} f(x) dx : c’est la valeur moyenne du signal."),
                ("Calculer bₙ pour une fonction paire", "Si f est paire, tous les bₙ sont nuls : seuls les cosinus restent."),
            ]),
            ("Transformée de Fourier", [
                ("Appliquer la transformée à un signal non intégrable", "f doit être absolument intégrable sur ℝ (signal stable)."),
                ("Confondre domaine temporel et fréquentiel", "x représente le temps ou l’espace, s la fréquence en Hz."),
            ]),
            ("Transformée de Laplace", [
                ("Oublier la condition de causalité", "La transformée de Laplace s’applique à un signal causal : f(t) = 0 pour t < 0."),
                ("Ignorer le domaine de convergence", "F(p) n’est définie que pour Re(p) > α quand f est d’ordre exponentiel α."),
            ]),
        ],
        "lessons": [
            ("Chapitre 1 · Séries de Fourier", 0, "Chapitre-1.pdf"),
        ],
    },
}


def check(response):
    if response.status_code >= 400:
        raise SystemExit(f"{response.request.method} {response.request.url} → {response.status_code}: {response.text}")
    return response.json()


def login(http, account):
    token = check(http.post("/auth/login", json={"email": account["email"], "password": account["password"]}))
    return {"Authorization": "Bearer " + token["access_token"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:8010/api/v1")
    parser.add_argument("--upload", action="store_true")
    parser.add_argument("--upload-only", action="store_true", help="Accounts exist already: only send the PDFs.")
    args = parser.parse_args()
    with httpx.Client(base_url=args.api, timeout=300) as http:
        if args.upload_only:
            return upload_existing(http)
        check(http.post("/auth/register", json={**TEACHER, "role": "teacher"}))
        auth = login(http, TEACHER)
        cohorts = {name: check(http.post("/cohorts", json={"name": name}, headers=auth))["id"] for name in CLASSES}
        lessons = []
        for subject_name, spec in SUBJECTS.items():
            subject = check(http.post("/subjects", headers=auth,
                                      json={"name": subject_name, "cohort_ids": list(cohorts.values())}))
            for course in subject["courses"]:
                room = course["classroom_id"]
                codes = []
                for label, misconceptions in spec["concepts"]:
                    concept = check(http.post(f"/classrooms/{room}/taxonomy", headers=auth, json={
                        "label": label, "validated": True,
                        "misconceptions": [{"label": m, "remediation_hint": hint} for m, hint in misconceptions],
                    }))
                    codes.append(concept["code"])
                for title, index, pdf in spec["lessons"]:
                    lesson = check(http.post(f"/classrooms/{room}/lessons", headers=auth, json={
                        "title": title, "concept_codes": [codes[index]],
                        "content_text": f"{title}. Support : {pdf}.",
                    }))
                    lessons.append((course["cohort_name"], subject_name, lesson["id"], ROOT / spec["folder"] / pdf))
                print(f"{subject_name} · {course['cohort_name']} : {len(spec['lessons'])} séances")
        check(http.post("/auth/register", json={**STUDENT, "role": "student", "cohort_id": cohorts[CLASSES[0]]}))
        print(f"Étudiant {STUDENT['full_name']} inscrit en {CLASSES[0]}")
        if args.upload:
            for cohort, subject_name, lesson_id, path in lessons:
                with path.open("rb") as handle:
                    check(http.post(f"/lessons/{lesson_id}/documents", headers=auth,
                                    files={"file": (path.name, handle, "application/pdf")}))
                print(f"Importé : {path.name} → {subject_name} · {cohort}")


def upload_existing(http):
    auth = login(http, TEACHER)
    for subject in check(http.get("/subjects", headers=auth)):
        spec = SUBJECTS[subject["name"]]
        files = {title: pdf for title, _, pdf in spec["lessons"]}
        for course in subject["courses"]:
            for lesson in check(http.get(f"/classrooms/{course['classroom_id']}/lessons", headers=auth)):
                path = ROOT / spec["folder"] / files[lesson["title"]]
                with path.open("rb") as handle:
                    check(http.post(f"/lessons/{lesson['id']}/documents", headers=auth,
                                    files={"file": (path.name, handle, "application/pdf")}))
                print(f"Importé : {path.name} → {subject['name']} · {course['cohort_name']}", flush=True)


if __name__ == "__main__":
    main()
