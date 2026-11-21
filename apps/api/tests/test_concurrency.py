"""Write serialization on PostgreSQL, which the read-check-write handlers rely on (as on SQLite)."""

import threading
import time

import pytest

from app.db.session import build_database
from app.services.access import start_write


def test_start_write_serializes_postgres_transactions(database_url):
    if not database_url.startswith("postgresql"):
        pytest.skip("SQLite serializes writers with BEGIN IMMEDIATE; set NEURVIA_TEST_POSTGRES to run this")
    engine, sessions = build_database(database_url)
    order = []
    try:
        first = sessions()
        start_write(first)
        order.append("first locked")

        def second():
            with sessions() as db:
                start_write(db)
                order.append("second locked")
                db.commit()

        worker = threading.Thread(target=second)
        worker.start()
        time.sleep(0.5)
        assert order == ["first locked"], "a second writer entered while the first held the lock"
        order.append("first committed")
        first.commit()
        first.close()
        worker.join(timeout=10)
        assert order == ["first locked", "first committed", "second locked"]
    finally:
        engine.dispose()
