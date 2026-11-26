"""Usage of the assistant and its estimated cost, for the Dashboard's "Uso y costos" tab.

Every billable thing the assistant does writes one event to the usage table
(``WHATSAPP_USAGE_TABLE_NAME``; partition ``day``, a date in ``USAGE_TIMEZONE``, sort ``id``):

- ``agent_turn``: one answer of the agent, with its tokens and outcome;
- ``narration``: the model retelling an answer to be read aloud;
- ``speech``: the characters Amazon Polly read aloud;
- ``transcription``: the seconds of a voice note Amazon Transcribe heard;
- ``template``: a WhatsApp template sent, with its category;
- ``message``: any other WhatsApp message, received (``direction: in``) or
  sent (``out``): AWS End User Messaging Social bills each one.

The agent's turns also carry their duration, from which AgentCore Runtime's
compute is estimated (``agentcore``).

Writing is best effort: without the table, or when the write fails, the
assistant goes on and only the log knows. Costs are estimates from the list
prices below (``PRICES``), never the AWS or Meta bill: the page says so.
"""
import logging
import os
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import boto3
from boto3.dynamodb.conditions import Key

logger = logging.getLogger(__name__)

TABLE_NAME = os.environ.get("WHATSAPP_USAGE_TABLE_NAME", "")
TIMEZONE = ZoneInfo(os.environ.get("USAGE_TIMEZONE", "America/Santiago"))
RETENTION_DAYS = 400

AGENT_TURN = "agent_turn"
NARRATION = "narration"
# A received image read by the agent's model (common.whatsapp.vision).
IMAGE_READING = "image_reading"
DOCUMENT_READING = "document_reading"
SPEECH = "speech"
TRANSCRIPTION = "transcription"
TEMPLATE = "template"
MESSAGE = "message"

# List prices in USD, checked on 2026-11-11. Estimates: the bill can differ
# (taxes, tiers, free tiers, exchange rates). Bedrock prices are per million
# tokens of the model family in the model id; the agent's model is matched by
# substring, the first that matches wins.
PRICES = {
    "checked_on": "2026-11-11",
    "bedrock_per_million_tokens": {
        "sonnet": {"input": 3.0, "output": 15.0, "cache_read": 0.30, "cache_write": 3.75},
        "haiku": {"input": 1.0, "output": 5.0, "cache_read": 0.10, "cache_write": 1.25},
        "opus": {"input": 5.0, "output": 25.0, "cache_read": 0.50, "cache_write": 6.25},
    },
    # Amazon Polly, per million characters, by engine.
    "polly_per_million_characters": {"standard": 4.0, "neural": 16.0, "generative": 30.0, "long-form": 100.0},
    # Amazon Transcribe batch, per minute (billed per second, 15 s minimum per job).
    "transcribe_per_minute": 0.024,
    "transcribe_minimum_seconds": 15,
    # WhatsApp templates to a Chilean number (Meta, per delivered message, by
    # category) plus AWS End User Messaging Social's per-message fee. Replies
    # inside the 24 hour window are free for Meta.
    "whatsapp_template_by_category": {"MARKETING": 0.0889, "UTILITY": 0.02, "AUTHENTICATION": 0.0285},
    "end_user_messaging_per_message": 0.005,
    # AgentCore Runtime compute, billed per second while a turn runs. The
    # estimate assumes the whole answer time at 1 vCPU and 2 GB, which is an
    # upper bound: AgentCore does not bill the CPU while it waits on I/O.
    "agentcore_per_vcpu_hour": 0.0895,
    "agentcore_per_gb_hour": 0.00945,
    "agentcore_vcpus": 1,
    "agentcore_memory_gb": 2,
}

_table = None


def _usage_table():
    global _table
    if _table is None:
        _table = boto3.resource("dynamodb").Table(TABLE_NAME)
    return _table


def local_day(moment: datetime | None = None) -> str:
    return (moment or datetime.now(timezone.utc)).astimezone(TIMEZONE).date().isoformat()


def _number(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float, Decimal)):
        return Decimal(str(value))
    return None


def record(kind: str, **fields) -> None:
    """Writes one usage event; never raises."""
    if not TABLE_NAME:
        return
    now = datetime.now(timezone.utc)
    item = {
        "day": local_day(now),
        "id": f"{now.isoformat(timespec='milliseconds')}#{uuid.uuid4().hex[:8]}",
        "kind": kind,
        "expires_at": int((now + timedelta(days=RETENTION_DAYS)).timestamp()),
    }
    for key, value in fields.items():
        number = _number(value)
        if number is not None:
            item[key] = number
        elif isinstance(value, str) and value:
            item[key] = value[:120]
    try:
        _usage_table().put_item(Item=item)
    except Exception:  # noqa: BLE001 - usage must never break an answer
        logger.exception("Usage event %s not stored", kind)


def tokens_of(usage: dict | None) -> dict:
    """The token counts of a Bedrock/Strands ``usage`` object, in this module's names."""
    usage = usage if isinstance(usage, dict) else {}
    return {
        "input_tokens": usage.get("inputTokens"),
        "output_tokens": usage.get("outputTokens"),
        "cache_read_tokens": usage.get("cacheReadInputTokens"),
        "cache_write_tokens": usage.get("cacheWriteInputTokens"),
    }


def all_events() -> list[dict]:
    """Every usage event kept (the table holds at most ``RETENTION_DAYS`` of them)."""
    if not TABLE_NAME:
        return []
    found: list[dict] = []
    kwargs: dict = {}
    while True:
        response = _usage_table().scan(**kwargs)
        found.extend(response.get("Items", []))
        if not response.get("LastEvaluatedKey"):
            return found
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]


def events(start: date, end: date) -> list[dict]:
    """Every usage event of the days ``start``..``end`` (both included)."""
    if not TABLE_NAME:
        return []
    found: list[dict] = []
    day = start
    while day <= end:
        kwargs = {"KeyConditionExpression": Key("day").eq(day.isoformat())}
        while True:
            response = _usage_table().query(**kwargs)
            found.extend(response.get("Items", []))
            if not response.get("LastEvaluatedKey"):
                break
            kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
        day += timedelta(days=1)
    return found


def _f(item: dict, key: str) -> float:
    try:
        return float(item.get(key) or 0)
    except (TypeError, ValueError):
        return 0.0


def _model_prices(model: str) -> dict:
    model = (model or "").lower()
    families = PRICES["bedrock_per_million_tokens"]
    return next((prices for family, prices in families.items() if family in model), families["sonnet"])


def agentcore_cost(item: dict) -> float:
    """The estimated AgentCore Runtime compute of one agent turn."""
    hours = _f(item, "duration_ms") / 3_600_000
    return hours * (
        PRICES["agentcore_vcpus"] * PRICES["agentcore_per_vcpu_hour"]
        + PRICES["agentcore_memory_gb"] * PRICES["agentcore_per_gb_hour"]
    )


def cost_of(item: dict) -> tuple[str, float]:
    """(service, estimated USD) of one event; an agent turn's compute is ``agentcore_cost``."""
    kind = item.get("kind")
    if kind in (AGENT_TURN, NARRATION, IMAGE_READING, DOCUMENT_READING):
        prices = _model_prices(str(item.get("model") or ""))
        usd = sum(_f(item, f"{name}_tokens") * prices[name] for name in prices) / 1_000_000
        return "bedrock", usd
    if kind == SPEECH:
        per_million = PRICES["polly_per_million_characters"].get(str(item.get("engine") or "neural"), 16.0)
        return "polly", _f(item, "characters") * per_million / 1_000_000
    if kind == TRANSCRIPTION:
        seconds = max(_f(item, "seconds"), PRICES["transcribe_minimum_seconds"])
        return "transcribe", seconds / 60 * PRICES["transcribe_per_minute"]
    if kind == TEMPLATE:
        meta = PRICES["whatsapp_template_by_category"].get(str(item.get("category") or "").upper(), 0.0)
        return "whatsapp", meta + PRICES["end_user_messaging_per_message"]
    if kind == MESSAGE:
        return "whatsapp", PRICES["end_user_messaging_per_message"]
    return "other", 0.0


SERVICES = ("bedrock", "agentcore", "polly", "transcribe", "whatsapp")


def summarize(items: list[dict], start: date, end: date) -> dict:
    """Totals, estimated costs and one row per day of ``items`` (events of ``start``..``end``)."""
    days = {}
    day = start
    while day <= end:
        days[day.isoformat()] = {"date": day.isoformat(), "queries": 0, "cost": 0.0, **{s: 0.0 for s in SERVICES}}
        day += timedelta(days=1)

    outcomes: Counter = Counter()
    costs: defaultdict = defaultdict(float)
    durations: list[float] = []
    totals = Counter()
    for item in items:
        kind = item.get("kind")
        service, usd = cost_of(item)
        costs[service] += usd
        row = days.get(str(item.get("day")))
        if row is not None and service in SERVICES:
            row[service] += usd
            row["cost"] += usd
        if kind == AGENT_TURN:
            compute = agentcore_cost(item)
            costs["agentcore"] += compute
            if row is not None:
                row["agentcore"] += compute
                row["cost"] += compute
            outcomes[str(item.get("outcome") or "answered")] += 1
            totals["input_tokens"] += _f(item, "input_tokens") + _f(item, "cache_read_tokens") + _f(item, "cache_write_tokens")
            totals["output_tokens"] += _f(item, "output_tokens")
            if item.get("duration_ms") is not None:
                durations.append(_f(item, "duration_ms") / 1000)
            if row is not None:
                row["queries"] += 1
        elif kind == SPEECH:
            totals["voice_answers"] += 1
            totals["characters"] += _f(item, "characters")
        elif kind == TRANSCRIPTION:
            totals["voice_notes"] += 1
            totals["transcribed_seconds"] += _f(item, "seconds")
        elif kind == TEMPLATE:
            totals["templates"] += 1
            totals["messages_out"] += 1
        elif kind == MESSAGE:
            totals["messages_in" if item.get("direction") == "in" else "messages_out"] += 1

    queries = sum(outcomes.values())
    total_cost = sum(costs[s] for s in SERVICES)
    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "queries": queries,
        "outcomes": {
            "answered": outcomes.get("answered", 0),
            "blocked": outcomes.get("blocked", 0),
            "handoff": outcomes.get("handoff", 0),
            "failed": outcomes.get("failed", 0),
        },
        "avg_response_seconds": round(sum(durations) / len(durations), 1) if durations else None,
        "tokens": {"input": int(totals["input_tokens"]), "output": int(totals["output_tokens"])},
        "tokens_per_query": round((totals["input_tokens"] + totals["output_tokens"]) / queries) if queries else None,
        "messages": {"in": int(totals["messages_in"]), "out": int(totals["messages_out"])},
        "voice_answers": int(totals["voice_answers"]),
        "voice_notes": int(totals["voice_notes"]),
        "templates": int(totals["templates"]),
        "costs": {
            **{service: round(costs[service], 4) for service in SERVICES},
            "total": round(total_cost, 4),
            "per_query": round(total_cost / queries, 4) if queries else None,
        },
        "by_day": [
            {**row, "cost": round(row["cost"], 4), **{s: round(row[s], 4) for s in SERVICES}}
            for row in days.values()
        ],
        "prices": PRICES,
    }
