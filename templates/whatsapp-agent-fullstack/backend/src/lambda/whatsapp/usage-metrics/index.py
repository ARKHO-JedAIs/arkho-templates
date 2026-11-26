"""usage-metrics: the Dashboard's "Uso y costos" tab.

    GET /whatsapp/usage?from=YYYY-MM-DD&to=YYYY-MM-DD
    GET /whatsapp/usage?all=true      every day recorded, up to today

The assistant's usage and its estimated cost for those days (dates in the usage timezone,
both included; default the last 7 days up to today, at most the 400 days kept): agent
queries by outcome, tokens, answers told aloud, voice notes heard, templates
sent, the estimated USD per service and one row per day for the charts. The
events are the ones common.whatsapp.usage records; costs use its list prices,
which the response carries so the page can show them. Needs the `dashboard`
page permission.
"""
from datetime import date, datetime, timedelta
from traceback import format_exc

from common import create_error_response, create_success_response, get_logger, with_cors
from common.whatsapp import http, usage

logger = get_logger(__name__)

PERMISSION = "dashboard"
DEFAULT_DAYS = 7
# Any range the table still holds (its items expire after RETENTION_DAYS).
MAX_DAYS = usage.RETENTION_DAYS


class BadPeriod(ValueError):
    """The from/to query is not a valid period."""


def today() -> date:
    return datetime.fromisoformat(f"{usage.local_day()}T00:00:00").date()


def period(query: dict, now: date) -> tuple[date, date]:
    try:
        end = date.fromisoformat(query["to"]) if query.get("to") else now
        start = date.fromisoformat(query["from"]) if query.get("from") else end - timedelta(days=DEFAULT_DAYS - 1)
    except ValueError as error:
        raise BadPeriod("from and to must be YYYY-MM-DD") from error
    if end > now:
        raise BadPeriod("to cannot be in the future")
    if start > end:
        raise BadPeriod("from cannot be after to")
    if (end - start).days + 1 > MAX_DAYS:
        raise BadPeriod(f"at most {MAX_DAYS} days")
    return start, end


def everything():
    """The whole record, from its first day up to today (no previous period to compare with)."""
    try:
        items = usage.all_events()
        end = today()
        days = sorted(str(item.get("day")) for item in items if item.get("day"))
        start = date.fromisoformat(days[0]) if days else end
        summary = usage.summarize(items, start, end)
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_error_response("Failed to read the usage", 500, "INTERNAL_ERROR")
    summary["previous"] = None
    return create_success_response(data=summary)


@with_cors()
def handler(event, context):
    if not http.is_allowed(event, PERMISSION):
        return create_error_response("Your profile cannot see the usage", 403, "FORBIDDEN")
    query = event.get("queryStringParameters") or {}
    if str(query.get("all") or "").lower() == "true":
        return everything()
    try:
        start, end = period(query, today())
    except BadPeriod as error:
        return create_error_response(str(error), 422, "VALIDATION_ERROR")
    try:
        summary = usage.summarize(usage.events(start, end), start, end)
        length = (end - start).days + 1
        previous_end = start - timedelta(days=1)
        previous_start = previous_end - timedelta(days=length - 1)
        previous = usage.summarize(usage.events(previous_start, previous_end), previous_start, previous_end)
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_error_response("Failed to read the usage", 500, "INTERNAL_ERROR")
    summary["previous"] = {
        "queries": previous["queries"],
        "cost": previous["costs"]["total"],
        "avg_response_seconds": previous["avg_response_seconds"],
    }
    return create_success_response(data=summary)
