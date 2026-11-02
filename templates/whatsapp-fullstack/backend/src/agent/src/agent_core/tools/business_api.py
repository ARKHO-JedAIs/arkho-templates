"""call_business_api: the example of where a project plugs its own data.

Registered only when ``AGENT_BUSINESS_API_URL`` is set. It is deliberately
narrow: GET only, a path relative to that base URL (the model can never point
it at another host), a 10 s timeout and a truncated answer wrapped as
untrusted ``<tool_output>``. A real project usually replaces it with one tool
per operation (``get_order_status(order_id)``, ``list_products(category)``)
with typed arguments and its own authentication; copy this file as the
starting point.
"""
import logging
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlparse
from urllib.request import Request, urlopen

from strands import tool

from ..prompt import TOOL_OUTPUT_TAG, wrap_untrusted

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 10
MAX_RESPONSE_CHARS = 4000
MAX_READ_BYTES = 256 * 1024


def _safe_path(path: str) -> str | None:
    text = str(path or "").strip().lstrip("/")
    parsed = urlparse(text)
    if parsed.scheme or parsed.netloc or ".." in text.split("/") or "\\" in text:
        return None
    return text


class BusinessApiTools:
    def __init__(self, base_url: str):
        self._base_url = base_url.rstrip("/") + "/"

    @tool
    def call_business_api(self, path: str, params: dict[str, str] | None = None) -> str:
        """Read data from the business API (orders, products, availability...). Read-only.

        Args:
            path: Path relative to the API, for example "orders/4821" or "products".
            params: Optional query string parameters, for example {"category": "salmon"}.
        """
        safe = _safe_path(path)
        if safe is None:
            return "Invalid path: use a path relative to the business API, without a host or '..'."
        url = urljoin(self._base_url, safe)
        if params:
            url += "?" + urlencode({str(key): str(value) for key, value in params.items()})
        request = Request(url, method="GET", headers={"Accept": "application/json"})
        try:
            with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                body = response.read(MAX_READ_BYTES).decode("utf-8", errors="replace")
        except HTTPError as error:
            logger.warning("Business API answered %s", error.code)
            return f"The business API answered with HTTP {error.code}."
        except (URLError, OSError, ValueError) as error:
            logger.warning("Business API call failed: %s", type(error).__name__)
            return "The business API is not available right now."
        if len(body) > MAX_RESPONSE_CHARS:
            body = body[:MAX_RESPONSE_CHARS] + "\n[truncated]"
        return wrap_untrusted(body, TOOL_OUTPUT_TAG, source="business_api")
