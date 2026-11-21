from datetime import UTC, datetime, timedelta
from threading import Lock
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class DemoClock:
    def __init__(self):
        self._start = datetime.now(UTC)
        self._offset = timedelta()
        self._lock = Lock()

    def now(self) -> datetime:
        with self._lock:
            return self._start + self._offset

    def advance(self, days: int) -> datetime:
        with self._lock:
            self._offset += timedelta(days=days)
            return self._start + self._offset

    def reset(self) -> datetime:
        with self._lock:
            self._offset = timedelta()
            return self._start
