"""Text normalization for the keyword pre-filter.

Attackers dodge keyword lists with accents, full-width letters, zero-width
characters, leetspeak, repeated letters and spacing ("i g n o r a"). Every
variant returned here folds one family of tricks so a single pattern list
covers them. The variants are only used for matching: the message the model
receives is never rewritten.
"""
import re
import unicodedata
from dataclasses import dataclass

LEET_MAP = str.maketrans(
    {
        "0": "o",
        "1": "i",
        "3": "e",
        "4": "a",
        "5": "s",
        "7": "t",
        "@": "a",
        "$": "s",
    }
)

_WHITESPACE = re.compile(r"\s+")
_RUN_OF_THREE = re.compile(r"(.)\1{2,}")
_RUN_OF_TWO = re.compile(r"(.)\1+")
# Letters split by spaces or punctuation, "i.g.n.o.r.a" or "s e x o": three or
# more single characters in a row are glued back into one word.
_SPACED_LETTERS = re.compile(r"\b(?:[a-z][\s.\-_*+,]{1,3}){2,}[a-z]\b")
_SEPARATORS = re.compile(r"[\s.\-_*+,]")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_PUNCTUATION = re.compile(r"[^\w\s]")


@dataclass(frozen=True)
class NormalizedText:
    """The variants of one message the rules are matched against."""

    plain: str
    """Folded text, spaced letters glued, digits kept ("de 14 anos", "xxx")."""
    words: str
    """``plain`` with leetspeak folded and runs of 3+ letters collapsed to one."""
    squeezed: str
    """``words`` with every run of a repeated letter collapsed ("kiill" -> "kil")."""
    compact: str
    """Only letters and digits, no separators at all ("i g n o r a" -> "ignora")."""


def _strip_invisible(text: str) -> str:
    kept = []
    for char in text:
        category = unicodedata.category(char)
        if char in "\n\t ":
            kept.append(char)
        elif category in ("Cc", "Cf", "Co", "Cs", "Zl", "Zp"):
            continue
        else:
            kept.append(char)
    return "".join(kept)


def fold(text: str) -> str:
    """NFKC, lowercase, no accents, no invisible characters, single spaces."""
    text = unicodedata.normalize("NFKC", str(text or ""))
    text = _strip_invisible(text).lower()
    decomposed = unicodedata.normalize("NFD", text)
    text = "".join(char for char in decomposed if not unicodedata.combining(char))
    return _WHITESPACE.sub(" ", text).strip()


def _join_spaced_letters(text: str) -> str:
    return _SPACED_LETTERS.sub(lambda match: _SEPARATORS.sub("", match.group(0)), text)


def normalize(text: str) -> NormalizedText:
    folded = fold(text)
    plain = _WHITESPACE.sub(" ", _join_spaced_letters(folded)).strip()
    leet = folded.translate(LEET_MAP)
    words = _join_spaced_letters(leet)
    words = _RUN_OF_THREE.sub(r"\1", words)
    words = _WHITESPACE.sub(" ", words).strip()
    squeezed = _RUN_OF_TWO.sub(r"\1", words)
    compact = _RUN_OF_TWO.sub(r"\1", _NON_ALNUM.sub("", leet))
    return NormalizedText(plain=plain, words=words, squeezed=squeezed, compact=compact)


def squeeze_letters(text: str) -> str:
    """Collapses runs of a repeated letter, also inside a regex.

    A letter right after a backslash is an escape (``\\b``, ``\\w``), so it
    never starts a run: ``\\bboobs`` becomes ``\\bbobs``, not ``\\bobs``.
    """
    return re.sub(r"(?<!\\)([a-z])\1+", r"\1", text)


def bare(text: str) -> str:
    """The folded text without punctuation, for exact phrase lookups (greetings)."""
    return _WHITESPACE.sub(" ", _PUNCTUATION.sub(" ", fold(text))).strip()
