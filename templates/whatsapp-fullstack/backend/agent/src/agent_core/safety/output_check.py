"""Layer 4: checking the model's answer before it reaches the user.

The canary is a random string generated once per process and placed in the
system prompt with an order never to repeat it. It has no meaning to anyone,
so the only way it shows up in an answer is the model echoing its own
instructions: a reliable leak signal that does not depend on wording.
"""
import re
import secrets
from collections.abc import Iterable

from .normalize import bare

OUTPUT_LEAK = "output_leak"

CANARY = "ref-" + secrets.token_hex(8)

# Words in a row copied from the fixed rules that count as a leak. A refusal
# that happens to share a short phrase with a rule must not trip it.
SHINGLE_WORDS = 10
MIN_SHARED_SHINGLES = 3

SECRET_PATTERNS: tuple[re.Pattern, ...] = (
    re.compile(r"\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}\b"),
    re.compile(r"(?i)aws_secret_access_key\s*[:=]"),
    re.compile(r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
    re.compile(r"\b(?:xox[baprs]|ghp|gho|github_pat|sk_live|rk_live)_[A-Za-z0-9_]{16,}"),
)


def _shingles(text: str) -> set[tuple[str, ...]]:
    words = bare(text).split()
    return {tuple(words[index : index + SHINGLE_WORDS]) for index in range(len(words) - SHINGLE_WORDS + 1)}


class OutputChecker:
    """Built once per system prompt: it knows the canary and the protected text."""

    def __init__(self, protected_texts: Iterable[str], canary: str = CANARY):
        self.canary = canary
        self._protected: set[tuple[str, ...]] = set()
        for text in protected_texts:
            self._protected |= _shingles(text)

    def leak_reason(self, answer: str) -> str | None:
        """Why ``answer`` must not be sent (``canary``, ``rules``, ``secret``), or None."""
        text = str(answer or "")
        if not text:
            return None
        # The random part alone also counts: the model may reformat the prefix.
        if self.canary and self.canary.lower().rsplit("-", 1)[-1] in text.lower():
            return "canary"
        if self._protected and len(_shingles(text) & self._protected) >= MIN_SHARED_SHINGLES:
            return "rules"
        if any(pattern.search(text) for pattern in SECRET_PATTERNS):
            return "secret"
        return None
