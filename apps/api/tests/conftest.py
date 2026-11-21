import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.demo_seed import DEMO_PASSWORD


@pytest.fixture
def api(tmp_path):
    settings = Settings(
        _env_file=None, database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        demo_mode=True, demo_admin_secret="test-admin-secret", llm_enabled=False,
    )
    with TestClient(create_app(settings)) as client:
        yield client


def login(client, email, password=DEMO_PASSWORD):
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def teacher(api):
    return login(api, "prof.fahm@example.com")


@pytest.fixture
def student(api):
    return login(api, "eleve1.fahm@example.com")
