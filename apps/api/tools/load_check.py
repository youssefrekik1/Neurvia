"""Measure grounded-chat latency when several teachers ask at the same time.

Each simulated teacher gets a lesson with one small indexed PDF and a conversation; the tool then sends one
question per teacher simultaneously at each concurrency level and reports wall-clock latencies. Run it on an
otherwise idle machine: all requests share the local model server.

    python -m tools.load_check --levels 1 2 4
"""

import argparse
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import httpx

from tools.check_documents import INDEX_TEXT, account, checked, digital_pdf, lesson, wait_for

QUESTION = "According to the course, what is the last valid non-negative index of a Python list?"


def prepare(api, teachers):
    pdf = digital_pdf("Python: List indexing " + uuid4().hex[:6], [INDEX_TEXT])
    sessions = []
    for _ in range(teachers):
        _, headers = account(api, "teacher")
        _, lesson_id = lesson(api, headers, "Load check")
        root = f"/lessons/{lesson_id}/documents"
        doc = checked(api, "POST", root, 202, headers=headers, files={"file": ("cours.pdf", pdf, "application/pdf")}).json()
        sessions.append((headers, lesson_id, doc["id"]))
    for headers, lesson_id, doc_id in sessions:
        wait_for(api, f"/lessons/{lesson_id}/documents/{doc_id}", headers, {"ready"})
    return sessions


def ask(url, session):
    headers, lesson_id, doc_id = session
    with httpx.Client(base_url=url + "/api/v1", timeout=900) as api:
        assistant = f"/lessons/{lesson_id}/course-assistant"
        chat = checked(api, "POST", assistant, headers=headers).json()
        started = time.perf_counter()
        chat = checked(api, "POST", f"{assistant}/{chat['id']}/messages", headers=headers,
                       json={"document_ids": [doc_id], "message": QUESTION}).json()
        return time.perf_counter() - started, bool(chat["messages"][-1]["sources"])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://127.0.0.1:8010")
    parser.add_argument("--levels", type=int, nargs="+", default=[1, 2, 4])
    args = parser.parse_args()
    with httpx.Client(base_url=args.url + "/api/v1", timeout=310) as api:
        sessions = prepare(api, max(args.levels))
    ask(args.url, sessions[0])  # warm the models so the first level does not include loading time
    print("concurrent | min s | median s | max s | grounded answers")
    for level in args.levels:
        with ThreadPoolExecutor(level) as pool:
            results = list(pool.map(lambda session: ask(args.url, session), sessions[:level]))
        times = [elapsed for elapsed, _ in results]
        print(f"{level:>10} | {min(times):5.1f} | {statistics.median(times):8.1f} | {max(times):5.1f} | "
              f"{sum(grounded for _, grounded in results)}/{level}", flush=True)


if __name__ == "__main__":
    main()
