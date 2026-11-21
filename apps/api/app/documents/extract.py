from collections import defaultdict
from csv import DictReader
from dataclasses import dataclass
from io import BytesIO, StringIO
import logging
import re
from re import search
from subprocess import SubprocessError, run

import httpx
import pymupdf as pdf
from PIL import Image

logger = logging.getLogger(__name__)
MAX_ARTIFACT = 16 * 1024 * 1024
# Symbol-font bullets (Wingdings and similar) land in the Unicode private-use area.
PRIVATE_GLYPHS = re.compile("[-]")


@dataclass
class Block:
    kind: str
    bounds: list[float]
    text: str
    method: str
    confidence: float | None = None
    review: bool = False
    image: bytes | None = None


def classify(value: str, monospaced=False):
    if monospaced or search(r"(?m)^\s*(def |for |while |class |import |>>> )", value):
        return "code"
    if search(r"[∑∫√≤≥∂∈∞∀∃]", value):
        return "formula"
    return "text"


def rect(points, page):
    return pdf.Rect(points) & page.rect


def is_data_table(table):
    """Tell a data table from a layout frame such as the border of an exported slide.

    Slide decks draw frames that table detection reports as a page-sized table whose one or two cells hold
    the whole slide. Treating that as a table turns every slide into Markdown noise and hides its text from
    normal block extraction, so only grids with several filled cells and no dominant cell count as tables.
    """
    filled = [cell.strip() for row in table.extract() for cell in row if cell and cell.strip()]
    total = sum(map(len, filled))
    return len(filled) >= 4 and total > 0 and max(map(len, filled)) < 0.6 * total


def digital_blocks(page):
    result = []
    tables = []
    if len(page.get_drawings()) >= 4:
        try:
            for table in page.find_tables().tables[:25]:
                if is_data_table(table):
                    tables.append((rect(table.bbox, page), table.to_markdown()[:24000]))
        except (ValueError, RuntimeError):
            logger.info("layout_table_extraction_failed")
    result.extend(Block("table", list(box), value, "digital") for box, value in tables if value.strip())
    flags = pdf.TEXTFLAGS_DICT & ~pdf.TEXT_PRESERVE_IMAGES
    for block in page.get_text("dict", flags=flags, sort=True)["blocks"]:
        if not block.get("lines"):
            continue
        bounds = rect(block["bbox"], page)
        if any((bounds & box).get_area() > 0.7 * bounds.get_area() for box, _ in tables):
            continue
        value = "\n".join("".join(span["text"] for span in line["spans"]) for line in block["lines"]).strip("\n")
        value = PRIVATE_GLYPHS.sub("•", value)
        mono = any(span["flags"] & pdf.TEXT_FONT_MONOSPACED
                   for line in block["lines"] for span in line["spans"])
        if value.strip():
            result.append(Block(classify(value, mono), list(bounds), value, "digital"))
    diagrams = [image["bbox"] for image in page.get_image_info()]
    if 3 <= len(page.get_drawings()) <= 500:
        diagrams.extend(page.cluster_drawings())
    seen = set()
    for points in diagrams[:30]:
        box = rect(points, page)
        key = tuple(round(point) for point in box)
        # A drawing cluster covering most of the page is a slide frame or background, not a figure.
        if box.is_empty or box.get_area() < 1800 or box.get_area() > 0.8 * page.rect.get_area() or key in seen:
            continue
        if any((box & table_rect).get_area() > 0.6 * box.get_area() for table_rect, _ in tables):
            continue
        seen.add(key)
        result.append(Block("figure", list(box), "", "layout", review=True,
                            image=render(page, clip=box)))
    return merge_lines(sorted(result, key=lambda block: (round(block.bounds[1]), round(block.bounds[0]))))


def merge_lines(blocks, *, gap=28, limit=1500):
    """Join consecutive digital text blocks of one column into paragraphs.

    Slides and some exports store every line as a separate block; indexed alone, single lines make poor
    retrieval units and fragment the assembled context. Blocks only merge when they are vertically close,
    overlap horizontally (so two columns stay apart) and stay under `limit` characters.
    """
    merged = []
    for block in blocks:
        previous = merged[-1] if merged else None
        if (previous and block.kind == previous.kind == "text" and block.method == previous.method == "digital"
                and block.bounds[1] - previous.bounds[3] < gap
                and min(block.bounds[2], previous.bounds[2]) > max(block.bounds[0], previous.bounds[0])
                and len(previous.text) + len(block.text) < limit):
            previous.text += "\n" + block.text
            previous.bounds = [min(previous.bounds[0], block.bounds[0]), min(previous.bounds[1], block.bounds[1]),
                               max(previous.bounds[2], block.bounds[2]), max(previous.bounds[3], block.bounds[3])]
        else:
            merged.append(block)
    return merged


def render(page, clip=None):
    if page.rect.is_empty or max(page.rect.width, page.rect.height) <= 0:
        raise ValueError("invalid_page_size")
    scale = min(2.2, 2200 / max(page.rect.width, page.rect.height))
    data = page.get_pixmap(matrix=pdf.Matrix(scale, scale), clip=clip, colorspace=pdf.csRGB, alpha=False).tobytes("png")
    if len(data) > MAX_ARTIFACT:
        raise ValueError("rendered_page_too_large")
    return data


def crop(data, bounds, page):
    with Image.open(BytesIO(data)) as image:
        sx, sy = image.width / page.rect.width, image.height / page.rect.height
        x0, y0, x1, y1 = bounds
        box = (int(x0 * sx), int(y0 * sy), int(x1 * sx), int(y1 * sy))
        if box[0] >= box[2] or box[1] >= box[3]:
            return None
        buff = BytesIO()
        image.crop(box).save(buff, format="PNG")
        return buff.getvalue()


def ocr_blocks(data, page, settings):
    proc = run(
        [settings.document_tesseract, "stdin", "stdout", "-l",
         settings.document_ocr_languages, "--psm", "6", "tsv"],
        input=data, capture_output=True, timeout=65, check=True,
    )
    lines = defaultdict(list)
    with Image.open(BytesIO(data)) as frame:
        sx, sy = page.rect.width / frame.width, page.rect.height / frame.height
    for row in DictReader(StringIO(proc.stdout.decode("utf-8")), delimiter="\t"):
        if not (value := row.get("text", "").strip()) or float(row["conf"]) < 0:
            continue
        left, top = int(row["left"]), int(row["top"])
        bounds = [left * sx, top * sy, (left + int(row["width"])) * sx, (top + int(row["height"])) * sy]
        key = (row["block_num"], row["par_num"], row["line_num"])
        lines[key].append((value, bounds, float(row["conf"]) / 100))
    blocks = []
    for group in lines.values():
        value = " ".join(word for word, _, _ in group)
        score = sum(confidence for _, _, confidence in group) / len(group)
        boxes = [box for _, box, _ in group]
        bounds = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
        blocks.append(Block(classify(value), bounds, value, "ocr", score, review=True))
    return blocks[:400]


def scanned_blocks(page, data, settings, models):
    try:
        recognized = ocr_blocks(data, page, settings)
    except (OSError, SubprocessError, ValueError, KeyError):
        logger.info("ocr_unavailable")
        recognized = []
    confidence = sum(block.confidence for block in recognized) / len(recognized) if recognized else 0
    if settings.document_vision_enabled and (
        sum(len(block.text) for block in recognized) < 45 or confidence < 0.78
    ):
        try:
            interpreted = []
            for block in models.transcribe(data).blocks:
                left, top, right, bottom = block.bounds
                if not 0 <= left < right <= 1 or not 0 <= top < bottom <= 1:
                    continue
                bounds = [left * page.rect.width, top * page.rect.height,
                          right * page.rect.width, bottom * page.rect.height]
                image = crop(data, bounds, page) if block.kind in {"figure", "table", "formula"} else None
                interpreted.append(Block(block.kind, bounds, block.text, "vision", review=True, image=image))
            if interpreted:
                return interpreted
        except (httpx.HTTPError, ValueError, LookupError, TypeError):
            logger.info("vision_unavailable")
    return recognized or [Block("text", list(page.rect), "", "unreadable", review=True)]


def extract_page(page, settings, models):
    image = render(page)
    images = page.get_image_info()
    size = page.rect.get_area()
    full_page_bitmap = any(rect(item["bbox"], page).get_area() > 0.7 * size for item in images)
    text = page.get_text().strip()
    if full_page_bitmap or len(text) < 18:
        return image, scanned_blocks(page, image, settings, models)
    return image, digital_blocks(page)
