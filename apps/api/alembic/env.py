from alembic import context

from app.core.config import Settings
from app.db.base import Base
from app.db.session import build_database
from app.models import documents  # noqa: F401  (registers the document tables)

config = context.config


def migrate(connection):
    context.configure(connection=connection, target_metadata=Base.metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    raise RuntimeError("Run schema upgrades against an explicit database connection.")
elif connection := config.attributes.get("connection"):
    migrate(connection)
else:
    engine, _ = build_database(Settings().db_url)
    try:
        with engine.connect() as connection:
            migrate(connection)
    finally:
        engine.dispose()
