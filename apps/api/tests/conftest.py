import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

# Set NEURVIA_TEST_POSTGRES to a PostgreSQL URL whose user may create databases to run the whole suite
# against PostgreSQL. Each test then gets a fresh database cloned from an Alembic-migrated template.
POSTGRES = os.environ.get("NEURVIA_TEST_POSTGRES")
TEMPLATE = "neurvia_test_template"


def admin(statement):
    import psycopg
    with psycopg.connect(POSTGRES.replace("postgresql+psycopg://", "postgresql://", 1), autocommit=True) as conn:
        conn.execute(statement)


def database(name):
    return POSTGRES.rsplit("/", 1)[0] + "/" + name


@pytest.fixture(scope="session")
def postgres_template():
    admin(f'DROP DATABASE IF EXISTS "{TEMPLATE}" WITH (FORCE)')
    admin(f'CREATE DATABASE "{TEMPLATE}"')
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True, capture_output=True,
                   cwd=Path(__file__).resolve().parents[1], env={**os.environ, "DATABASE_URL": database(TEMPLATE)})
    yield TEMPLATE
    admin(f'DROP DATABASE IF EXISTS "{TEMPLATE}" WITH (FORCE)')


@pytest.fixture
def database_url(tmp_path, request):
    if not POSTGRES:
        yield f"sqlite:///{(tmp_path / 'test.db').as_posix()}"
        return
    name = "neurvia_test_" + uuid4().hex[:12]
    admin(f'CREATE DATABASE "{name}" TEMPLATE "{request.getfixturevalue("postgres_template")}"')
    try:
        yield database(name)
    finally:
        admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


@pytest.fixture
def settings(database_url):
    return Settings(_env_file=None, database_url=database_url, llm_enabled=False)


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
