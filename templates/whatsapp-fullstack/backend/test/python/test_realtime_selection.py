"""The realtime mutation selects every field the web reads from its events.

AppSync forwards to subscribers only the fields the publishing mutation
selects; one left out arrives as null, and the web drops an event without
its payload, so live updates stop without any error. Both copies of the
mutation (the Lambdas' layer and the agent's own) are checked.

Run from the backend root: python -m unittest discover -s test/python -v
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COPIES = (
    ROOT / "src" / "layer" / "python-common" / "python" / "common" / "whatsapp" / "realtime.py",
    ROOT / "src" / "agent" / "src" / "agent_core" / "whatsapp_store.py",
)
# What the frontend's onEvent subscription asks for (frontend/src/features/whatsapp/realtime.ts).
SUBSCRIBED_FIELDS = {"id", "type", "message", "payload", "timestamp"}


def selected_fields(source: str) -> set[str]:
    selection = re.search(r"publishEvent\([^)]*\)\s*\{([^}]*)\}", source)
    assert selection, "publishEvent mutation not found"
    return set(selection.group(1).split())


class MutationSelectionTest(unittest.TestCase):
    def test_every_subscribed_field_is_selected_by_the_mutation(self):
        for path in COPIES:
            with self.subTest(copy=path.name):
                self.assertTrue(SUBSCRIBED_FIELDS <= selected_fields(path.read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
