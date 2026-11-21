"""Provision a university and assign existing teacher accounts as members."""

import argparse
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.core.config import Settings
from app.db.migrate import initialize_schema
from app.db.session import build_database
from app.models import User
from app.models.documents import Institution, InstitutionMember
from app.models.enums import Role


def provision(name, institution_id, teachers):
    engine, sessions = build_database(Settings().db_url)
    try:
        if engine.dialect.name != "postgresql":
            raise ValueError("Institution provisioning requires PostgreSQL.")
        initialize_schema(engine)
        with sessions.begin() as db:
            users = list(db.scalars(select(User).where(User.email.in_(teachers), User.role == Role.teacher,
                                                       User.is_synthetic.is_(False))))
            if len(users) != len(teachers):
                raise ValueError("Every email must belong to an existing non-synthetic teacher.")
            institution = db.get(Institution, institution_id) if institution_id else Institution(name=name)
            if institution is None or institution.is_synthetic:
                raise ValueError("Institution does not exist.")
            db.add(institution)
            db.flush()
            for user in users:
                db.execute(insert(InstitutionMember).values(institution_id=institution.id, user_id=user.id)
                           .on_conflict_do_nothing(index_elements=["institution_id", "user_id"]))
        return institution.id
    finally:
        engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--name")
    target.add_argument("--institution", type=UUID)
    parser.add_argument("teacher_email", nargs="+")
    args = parser.parse_args()
    if args.name and not 0 < len(args.name.strip()) <= 160:
        parser.error("Institution name must contain 1 to 160 characters.")
    print(provision(args.name, args.institution, {value.casefold() for value in args.teacher_email}))
