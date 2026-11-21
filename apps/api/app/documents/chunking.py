from collections.abc import Iterable

CHUNK_BYTES = 1600


def split_block(text: str, kind: str, limit: int = CHUNK_BYTES) -> Iterable[str]:
    """Keep structured items whole, and slice oversized text/code on line or word boundaries."""
    if not text.strip():
        return
    if kind in {"formula", "table", "code"} and len(text.encode()) <= limit * 2:
        yield text
        return
    current = ""
    for line in text.splitlines(keepends=True):
        if len(line.encode()) > limit:
            units = line.split(" ") if kind == "text" else [line]
        else:
            units = [line]
        for index, unit in enumerate(units):
            if len(units) > 1 and index + 1 < len(units):
                unit += " "
            if current and len((current + unit).encode()) > limit:
                yield current
                current = ""
            # Byte limits are conservative for multilingual Qwen context and OCR input.
            while len(unit.encode()) > limit * 2:
                cut = max(1, limit // 4)
                yield unit[:cut]
                unit = unit[cut:]
            current += unit
    if current.strip():
        yield current
