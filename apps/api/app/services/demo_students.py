"""Synthetic, named demo accounts. Do not use these credentials outside local demos."""
from pathlib import Path
import json

_DATA = json.loads((Path(__file__).resolve().parents[4] / "data" / "demo_classrooms.json").read_text(encoding="utf-8"))
TEACHER = _DATA["professeur"]
CLASSROOMS = _DATA["classes"]
STUDENTS = _DATA["eleves"]
