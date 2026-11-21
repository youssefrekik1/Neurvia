import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
                    llm_enabled=False)


@pytest.fixture
def api(settings):
    with TestClient(create_app(settings)) as client:
        yield client


def call(client, meth, path, headers=None, data=None, expected=200):
    response = client.request(meth, "/api/v1" + path, headers=headers, json=data)
    assert response.status_code == expected, (meth, path, response.status_code, response.text)
    return response.json()


def login(client, email, password="fixture-pass-123"):
    token = call(client, "POST", "/auth/login", data={"email": email, "password": password})
    return {"Authorization": f"Bearer {token['access_token']}"}


def register(client, name, role):
    payload = {"email": f"{name}@example.com", "full_name": name, "role": role, "password": "fixture-pass-123"}
    result = call(client, "POST", "/auth/register", data=payload, expected=201)
    assert "password_hash" not in result
    return login(client, payload["email"])
