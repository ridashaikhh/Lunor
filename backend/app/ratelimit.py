"""Tiny in-memory rate limiter so a public demo cannot burn through the Gemini quota.

Two ceilings: per visitor (by IP) per hour, and across everyone per day. State lives in memory, so it resets when the
server restarts - fine for a prototype. Limits are env-configurable.
"""
from __future__ import annotations

import os
import time
from collections import defaultdict, deque

PER_IP_PER_HOUR = int(os.getenv("RATE_LIMIT_PER_IP_HOUR", "60"))   # one full guided run is ~4 calls
GLOBAL_PER_DAY = int(os.getenv("RATE_LIMIT_GLOBAL_DAY", "1000"))
HOUR, DAY = 3600, 86400


class RateLimiter:
    def __init__(self, per_ip: int, per_ip_window: int, global_max: int, global_window: int, clock=time.monotonic):
        self.per_ip, self.per_ip_window = per_ip, per_ip_window
        self.global_max, self.global_window = global_max, global_window
        self.clock = clock
        self._by_ip: dict[str, deque[float]] = defaultdict(deque)
        self._all: deque[float] = deque()

    @staticmethod
    def _trim(q: deque, window: int, now: float) -> None:
        while q and now - q[0] >= window:
            q.popleft()

    def check(self, ip: str) -> str | None:
        """Record a request and return None, or return the reason it must be refused."""
        now = self.clock()
        self._trim(self._all, self.global_window, now)
        mine = self._by_ip[ip]
        self._trim(mine, self.per_ip_window, now)
        if len(self._all) >= self.global_max:
            return "The demo has reached its daily usage limit. Please try again tomorrow."
        if len(mine) >= self.per_ip:
            return "You have reached the hourly limit for this demo. Please try again later."
        mine.append(now)
        self._all.append(now)
        if len(self._by_ip) > 5000:  # keep memory bounded
            for key in [k for k, q in self._by_ip.items() if not q or now - q[-1] >= self.per_ip_window]:
                del self._by_ip[key]
        return None


limiter = RateLimiter(PER_IP_PER_HOUR, HOUR, GLOBAL_PER_DAY, DAY)


def client_ip(headers, fallback: str) -> str:
    """Behind a hosting proxy the visitor's address arrives in X-Forwarded-For (first entry = original client).
    It can be spoofed, which is why the global daily ceiling exists as the real backstop."""
    forwarded = headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or fallback
