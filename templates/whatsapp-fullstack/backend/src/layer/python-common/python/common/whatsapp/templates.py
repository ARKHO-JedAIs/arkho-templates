"""Creating and editing WhatsApp message templates: checks and the Meta JSON.

The web sends a template as the creator holds it (``TemplateRequest`` below);
``validate`` applies Meta's rules and returns the ids of the failing ones,
and ``build_components`` / ``build_definition`` turn it into the definition
``CreateWhatsAppMessageTemplate`` and ``UpdateWhatsAppMessageTemplate`` take.

The rules and their ids mirror ``frontend/src/features/templates/
validateTemplate.ts`` and the limits ``templateRules.ts``: change both
together. Meta's recommendations (warnings there) are not enforced here.

TemplateRequest::

    {
      "name": "confirmacion_pedido", "language": "es", "category": "UTILITY",
      "parameterFormat": "POSITIONAL" | "NAMED",
      "header": null | {"format": "TEXT", "text": "..."}
                     | {"format": "IMAGE" | "VIDEO" | "DOCUMENT", "handle": "<metaHeaderHandle>"},
      "body": "...", "footer": "..." | null,
      "buttons": [{"type": "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE",
                   "text": "...", "url": "...", "phone": "...", "code": "..."}],
      "examples": {"header:<variable>": "...", "body:<variable>": "...", "button:<index>": "..."}
    }
"""
import json
import re

LIMITS = {
    "name_max": 512,
    "header_text_max": 60,
    "header_variables_max": 1,
    "body_max": 1024,
    "footer_max": 60,
    "buttons_max": 10,
    "button_text_max": 25,
    "url_max": 2000,
    "url_variables_max": 1,
    "phone_max": 20,
    "copy_code_example_max": 20,
    "example_max": 1024,
}

BUTTON_TYPE_MAX = {"QUICK_REPLY": 10, "URL": 2, "PHONE_NUMBER": 1, "COPY_CODE": 1}
CATEGORIES = ("UTILITY", "MARKETING", "AUTHENTICATION")
PARAMETER_FORMATS = ("POSITIONAL", "NAMED")
MEDIA_HEADERS = ("IMAGE", "VIDEO", "DOCUMENT")
HEADER_FORMATS = ("TEXT",) + MEDIA_HEADERS

# Request limits of End User Messaging Social (API reference): the whole
# definition on create, the components blob on update.
CREATE_DEFINITION_MAX_BYTES = 6000
UPDATE_COMPONENTS_MAX_CHARS = 3000

# Anything between two pairs of braces, valid or not, so a malformed name is
# reported instead of read as text.
TOKEN = re.compile(r"\{\{([^{}]*)\}\}")
POSITIONAL_NAME = re.compile(r"^\d+$")
NAMED_NAME = re.compile(r"^[a-z_][a-z0-9_]*$")
TEMPLATE_NAME = re.compile(r"^[a-z0-9_]+$")
URL_PATTERN = re.compile(r"^https?://[^\s/$.?#][^\s]*$", re.IGNORECASE)
PHONE_PATTERN = re.compile(r"^\+?\d{6,19}$")


class TemplateInvalid(ValueError):
    """The template breaks Meta's rules; ``rules`` are the failing rule ids."""

    def __init__(self, rules: list[str]):
        self.rules = rules
        super().__init__("The template does not meet WhatsApp's rules: " + ", ".join(rules))


def tokens(text: str) -> list[tuple[str, int, int]]:
    """``(name, start, end)`` of every variable in ``text``."""
    return [(match.group(1).strip(), match.start(), match.end()) for match in TOKEN.finditer(text or "")]


def distinct(text: str) -> list[str]:
    names: list[str] = []
    for name, _, _ in tokens(text):
        if name not in names:
            names.append(name)
    return names


def _text(value) -> str:
    return value if isinstance(value, str) else ""


def _header(request: dict) -> dict | None:
    header = request.get("header")
    return header if isinstance(header, dict) and header.get("format") not in (None, "", "NONE") else None


def _buttons(request: dict) -> list[dict]:
    buttons = request.get("buttons") or []
    return [button for button in buttons if isinstance(button, dict)] if isinstance(buttons, list) else []


def _examples(request: dict) -> dict:
    examples = request.get("examples")
    return examples if isinstance(examples, dict) else {}


def example_of(request: dict, scope: str, name: str) -> str:
    return _text(_examples(request).get(f"{scope}:{name}")).strip()


def url_variable(button: dict) -> str | None:
    found = tokens(_text(button.get("url")))
    return found[0][0] if found else None


def variables(request: dict) -> list[tuple[str, str]]:
    """``(example key, label)`` of every variable: header, body, then URL buttons."""
    found: list[tuple[str, str]] = []
    header = _header(request)
    if header and header.get("format") == "TEXT":
        found += [(f"header:{name}", name) for name in distinct(_text(header.get("text")))]
    found += [(f"body:{name}", name) for name in distinct(_text(request.get("body")))]
    for index, button in enumerate(_buttons(request)):
        if button.get("type") == "URL" and url_variable(button) is not None:
            found.append((f"button:{index}", str(index)))
    return found


def _quick_replies_grouped(buttons: list[dict]) -> bool:
    changes = 0
    for index in range(1, len(buttons)):
        if (buttons[index - 1].get("type") == "QUICK_REPLY") != (buttons[index].get("type") == "QUICK_REPLY"):
            changes += 1
    return changes <= 1


def _url_ok(url: str) -> bool:
    if not url.strip() or len(url) > LIMITS["url_max"]:
        return False
    found = tokens(url)
    if len(found) > LIMITS["url_variables_max"]:
        return False
    if found:
        name, start, end = found[0]
        if end != len(url) or name != "1":
            return False
        base = url[:start] or url
    else:
        base = url
    return URL_PATTERN.match(base) is not None


def validate(request: dict, require_identity: bool = True) -> list[str]:
    """The ids of the rules ``request`` breaks; empty when it can be sent to Meta.

    ``require_identity`` False (an edit) skips name, language and category,
    which an edit does not send.
    """
    failed: list[str] = []

    def rule(rule_id: str, ok: bool) -> None:
        if not ok:
            failed.append(rule_id)

    parameter_format = request.get("parameterFormat")
    rule("parameter-format", parameter_format in PARAMETER_FORMATS)
    named = parameter_format == "NAMED"

    if require_identity:
        name = _text(request.get("name"))
        rule("name-required", name.strip() != "")
        if name.strip():
            rule("name-format", TEMPLATE_NAME.match(name) is not None)
            rule("name-length", len(name) <= LIMITS["name_max"])
        rule("category-required", request.get("category") in CATEGORIES)
        rule("language-required", _text(request.get("language")).strip() != "")
    elif request.get("category") is not None:
        rule("category-required", request.get("category") in CATEGORIES)

    header = _header(request)
    if header:
        header_format = header.get("format")
        rule("header-format", header_format in HEADER_FORMATS)
        if header_format == "TEXT":
            text = _text(header.get("text"))
            names = distinct(text)
            rule("header-text-required", text.strip() != "")
            rule("header-text-length", len(text) <= LIMITS["header_text_max"])
            rule("header-variables-count", len(tokens(text)) <= LIMITS["header_variables_max"])
            if names:
                rule(
                    "header-variable-format",
                    all((NAMED_NAME.match(name) if named else name == "1") for name in names),
                )
        elif header_format in MEDIA_HEADERS:
            rule("header-media-handle", _text(header.get("handle")).strip() != "")

    body = _text(request.get("body"))
    body_tokens = tokens(body)
    body_names = distinct(body)
    rule("body-required", body.strip() != "")
    rule("body-length", len(body) <= LIMITS["body_max"])
    if body_names:
        pattern = NAMED_NAME if named else POSITIONAL_NAME
        wrong = [name for name in body_names if not pattern.match(name)]
        rule("body-variable-format", not wrong)
        if not named and not wrong:
            numbers = sorted(int(name) for name in body_names)
            rule("body-positional-sequence", numbers == list(range(1, len(numbers) + 1)))
        if named:
            rule(
                "body-named-unique",
                all(sum(1 for token in body_tokens if token[0] == name) == 1 for name in body_names),
            )

    footer = _text(request.get("footer"))
    if footer:
        rule("footer-length", len(footer) <= LIMITS["footer_max"])
        rule("footer-no-variables", not tokens(footer))

    buttons = _buttons(request)
    if buttons:
        rule("buttons-max", len(buttons) <= LIMITS["buttons_max"])
        rule("buttons-type", all(button.get("type") in BUTTON_TYPE_MAX for button in buttons))
        rule(
            "buttons-type-limits",
            all(
                sum(1 for button in buttons if button.get("type") == kind) <= maximum
                for kind, maximum in BUTTON_TYPE_MAX.items()
            ),
        )
        if len(buttons) > 1:
            rule("buttons-grouping", _quick_replies_grouped(buttons))
        rule(
            "buttons-text",
            all(
                _text(button.get("text")).strip() != "" and len(_text(button.get("text"))) <= LIMITS["button_text_max"]
                for button in buttons
            ),
        )
        urls = [button for button in buttons if button.get("type") == "URL"]
        if urls:
            rule("buttons-url", all(_url_ok(_text(button.get("url"))) for button in urls))
        phones = [button for button in buttons if button.get("type") == "PHONE_NUMBER"]
        if phones:
            rule(
                "buttons-phone",
                all(
                    len(_text(button.get("phone"))) <= LIMITS["phone_max"]
                    and PHONE_PATTERN.match(_text(button.get("phone"))) is not None
                    for button in phones
                ),
            )
        codes = [button for button in buttons if button.get("type") == "COPY_CODE"]
        if codes:
            rule(
                "buttons-copy-code",
                all(
                    _text(button.get("code")).strip() != ""
                    and len(_text(button.get("code"))) <= LIMITS["copy_code_example_max"]
                    for button in codes
                ),
            )

    found = variables(request)
    if found:
        rule(
            "examples-complete",
            all(
                0 < len(_text(_examples(request).get(key)).strip()) <= LIMITS["example_max"]
                for key, _ in found
            ),
        )
    return failed


def _named_params(request: dict, scope: str, names: list[str]) -> list[dict]:
    return [{"param_name": name, "example": example_of(request, scope, name)} for name in names]


def build_components(request: dict) -> list[dict]:
    """The Meta ``components`` of a valid request (``validate`` first)."""
    named = request.get("parameterFormat") == "NAMED"
    components: list[dict] = []

    header = _header(request)
    if header and header.get("format") == "TEXT":
        text = _text(header.get("text"))
        component: dict = {"type": "HEADER", "format": "TEXT", "text": text}
        names = distinct(text)
        if names:
            component["example"] = (
                {"header_text_named_params": _named_params(request, "header", names)}
                if named
                else {"header_text": [example_of(request, "header", names[0])]}
            )
        components.append(component)
    elif header and header.get("format") in MEDIA_HEADERS:
        components.append(
            {"type": "HEADER", "format": header["format"], "example": {"header_handle": [_text(header.get("handle"))]}}
        )

    body = _text(request.get("body"))
    component = {"type": "BODY", "text": body}
    names = distinct(body)
    if names:
        if named:
            component["example"] = {"body_text_named_params": _named_params(request, "body", names)}
        else:
            ordered = sorted(names, key=int)
            component["example"] = {"body_text": [[example_of(request, "body", name) for name in ordered]]}
    components.append(component)

    footer = _text(request.get("footer")).strip()
    if footer:
        components.append({"type": "FOOTER", "text": footer})

    buttons = []
    for index, button in enumerate(_buttons(request)):
        kind = button.get("type")
        text = _text(button.get("text")).strip()
        if kind == "QUICK_REPLY":
            buttons.append({"type": kind, "text": text})
        elif kind == "URL":
            entry = {"type": kind, "text": text, "url": _text(button.get("url")).strip()}
            if url_variable(button) is not None:
                entry["example"] = [example_of(request, "button", str(index))]
            buttons.append(entry)
        elif kind == "PHONE_NUMBER":
            buttons.append({"type": kind, "text": text, "phone_number": _text(button.get("phone")).strip()})
        elif kind == "COPY_CODE":
            buttons.append({"type": kind, "example": _text(button.get("code")).strip()})
    if buttons:
        components.append({"type": "BUTTONS", "buttons": buttons})
    return components


def build_definition(request: dict) -> dict:
    """The whole definition ``CreateWhatsAppMessageTemplate`` takes."""
    return {
        "name": _text(request.get("name")).strip(),
        "language": _text(request.get("language")).strip(),
        "category": request.get("category"),
        "parameter_format": request.get("parameterFormat"),
        "components": build_components(request),
    }


def encoded(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
