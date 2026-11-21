import json

from app.core.config import ROOT
from app.main import app


def write_contract():
    path = ROOT / "docs" / "openapi.json"
    path.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    write_contract()
