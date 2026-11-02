"""Layer 1: the keyword pre-filter that runs before the model.

A blocked message never reaches Bedrock: no tokens, no latency, and the
attack is never written to the conversation memory. Keyword rules have false
positives and negatives; the fixed prompt rules (layer 2) and the output
check (layer 4) are the backstop for what slips through.
"""
import re
from dataclasses import dataclass

from . import rules
from .normalize import bare, normalize, squeeze_letters

MAX_INPUT_CHARS = 2000

ALLOW = "allow"
GREETING = "greeting"
BLOCKED = "blocked"
SUPPORT = "support"

EMPTY_INPUT = "empty_input"
INPUT_TOO_LONG = "input_too_long"


@dataclass(frozen=True)
class Verdict:
    action: str
    category: str | None = None


@dataclass(frozen=True)
class _CompiledCategory:
    name: str
    action: str
    patterns: tuple[re.Pattern, ...]
    squeezed_patterns: tuple[re.Pattern, ...]
    compact: tuple[str, ...]


def _compile(categories) -> tuple[_CompiledCategory, ...]:
    compiled = []
    for category in categories:
        compiled.append(
            _CompiledCategory(
                name=category.name,
                action=category.action,
                patterns=tuple(re.compile(pattern) for pattern in category.patterns),
                squeezed_patterns=tuple(re.compile(squeeze_letters(pattern)) for pattern in category.patterns),
                compact=tuple(squeeze_letters(signature) for signature in category.compact),
            )
        )
    return tuple(compiled)


_CATEGORIES = _compile(rules.CATEGORIES)
_GREETINGS = frozenset(squeeze_letters(greeting) for greeting in rules.GREETINGS)


def match_category(text: str) -> tuple[str, str] | None:
    """The first ``(category, action)`` whose rules match ``text``, or None."""
    variants = normalize(text)
    for category in _CATEGORIES:
        for pattern in category.patterns:
            if pattern.search(variants.words) or pattern.search(variants.plain):
                return category.name, category.action
        for pattern in category.squeezed_patterns:
            if pattern.search(variants.squeezed):
                return category.name, category.action
        for signature in category.compact:
            if signature in variants.compact:
                return category.name, category.action
    return None


def is_greeting(text: str) -> bool:
    return squeeze_letters(bare(text)) in _GREETINGS


def check_input(text: str, max_chars: int = MAX_INPUT_CHARS) -> Verdict:
    """What to do with one user message before calling the model."""
    message = str(text or "")
    if not message.strip():
        return Verdict(BLOCKED, EMPTY_INPUT)
    if len(message) > max_chars:
        return Verdict(BLOCKED, INPUT_TOO_LONG)
    matched = match_category(message)
    if matched:
        name, action = matched
        return Verdict(SUPPORT if action == rules.SUPPORT else BLOCKED, name)
    if is_greeting(message):
        return Verdict(GREETING)
    return Verdict(ALLOW)


def is_offense(category: str | None) -> bool:
    """Whether a ``blocked_category`` should add to the actor's repeat-offender count."""
    return bool(category) and category in rules.OFFENSE_CATEGORIES
