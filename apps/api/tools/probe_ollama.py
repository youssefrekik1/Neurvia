"""Opt-in live Qwen check using a temporary database and anonymous Python content."""

from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter

import httpx
from fastapi.testclient import TestClient

from app.ai.tasks import generate_remediation_plan
from app.core.config import Settings
from app.main import create_app


def verify(profile):
    with httpx.Client(base_url=profile.llm_base_url, trust_env=False, timeout=5.0) as ollama:
        models = ollama.get("/api/tags").raise_for_status().json()["models"]
    available = {item["name"] for item in models}
    if profile.llm_model not in available:
        raise SystemExit(f"Model {profile.llm_model} is not installed.")
    print(f"Installed models: {', '.join(sorted(available))}", flush=True)

    with TemporaryDirectory() as tmp:
        db = (Path(tmp) / "probe.db").as_posix()
        settings = profile.model_copy(update={"database_url": f"sqlite:///{db}", "demo_mode": False,
                                              "llm_enabled": True})
        with TestClient(create_app(settings)) as client:
            def post(path, data, expected=200):
                response = client.post("/api/v1" + path, json=data, headers=headers)
                if response.status_code != expected:
                    raise RuntimeError(f"{path}: {response.status_code} {response.json()}")
                return response.json()

            def metrics(response):
                if response.request.url.path != "/api/chat":
                    return
                response.read()
                if response.is_success:
                    payload = response.json()
                    print("Ollama", payload.get("model"), "input tokens", payload.get("prompt_eval_count"),
                          "output tokens", payload.get("eval_count"), "inference seconds",
                          round((payload.get("total_duration") or 0) / 1e9, 3), flush=True)
                else:
                    print(f"Ollama HTTP {response.status_code}", flush=True)

            client.app.state.gateway.client.http.event_hooks["response"].append(metrics)
            headers = {}
            account = {"email": "probe@example.com", "password": "synthetic-probe-password"}
            post("/auth/register", {**account, "full_name": "Test Qwen", "role": "teacher"}, 201)
            token = post("/auth/login", account)["access_token"]
            headers["Authorization"] = "Bearer " + token
            room = post("/classrooms", {"name": "Vérification locale"}, 201)
            lesson = post(f"/classrooms/{room['id']}/lessons", {
                "title": "Conversion des chaînes en Python", "concept_codes": ["C_TYPES"],
                "content_text": "input() renvoie une chaîne. int('12') renvoie l'entier 12. "
                                "L'opérateur + concatène deux chaînes et additionne des entiers.",
                "focus_brief": {"question_count": 1, "instructions": "Proposer un exercice bref sur input() et int()."},
            }, 201)
            begin = perf_counter()
            draft = post(f"/lessons/{lesson['id']}/quiz/generate", {"question_count": 1})
            assert draft["status"] == "draft" and len(draft["questions"]) == 1
            assert draft["questions"][0]["source"] == "llm"
            print(f"Question endpoint returned a validated draft in {perf_counter() - begin:.2f}s", flush=True)

            begin = perf_counter()
            result = generate_remediation_plan(
                client.app.state.gateway, misconception_label="Type renvoyé par input()",
                hint="Comparer la concaténation de chaînes et l’addition d’entiers.", group_size=5,
                course_excerpt="input() renvoie un texte. int() convertit les chiffres en entier.",
            )
            assert result.source == "llm"
            print(f"Remediation gateway validated a 10-minute plan in {perf_counter() - begin:.2f}s", flush=True)


if __name__ == "__main__":
    verify(Settings())
