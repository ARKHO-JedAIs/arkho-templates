"""Security in code, no Bedrock Guardrail: five layers.

1. ``prefilter`` - keyword rules before the model (``rules.py`` is the data).
2. Fixed prompt rules - ``agent_core.prompt.FIXED_RULES``, placed after the
   admin prompt and declared to win over it.
3. Untrusted content delimiting - ``agent_core.prompt.wrap_untrusted``.
4. ``output_check`` - canary, verbatim rules and secret-like patterns.
5. Repeat offenders - every blocked turn returns ``blocked_category``; the
   caller keeps the per-actor counter, using ``is_offense`` to decide which
   categories count.
"""
from .output_check import CANARY, OUTPUT_LEAK, OutputChecker
from .prefilter import (
    ALLOW,
    BLOCKED,
    EMPTY_INPUT,
    GREETING,
    INPUT_TOO_LONG,
    MAX_INPUT_CHARS,
    SUPPORT,
    Verdict,
    check_input,
    is_offense,
)

__all__ = [
    "ALLOW",
    "BLOCKED",
    "CANARY",
    "EMPTY_INPUT",
    "GREETING",
    "INPUT_TOO_LONG",
    "MAX_INPUT_CHARS",
    "OUTPUT_LEAK",
    "OutputChecker",
    "SUPPORT",
    "Verdict",
    "check_input",
    "is_offense",
]
