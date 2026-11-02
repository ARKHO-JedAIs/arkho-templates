"""Lambda entrypoint: the same image and the same turn, without AgentCore Runtime.

The function is invoked directly (``lambda:InvokeFunction``) with the
contract payload as the event and returns the contract response. A JSON
``body`` string (Function URL / API Gateway proxy) is accepted too.
Streaming is not available here.
"""
import json

from agent_core import configure_logging
from agent_core.turn import error_response, run_turn

configure_logging()


def handler(event, context):
    payload = event
    if isinstance(event, dict) and isinstance(event.get("body"), str):
        try:
            payload = json.loads(event["body"])
        except ValueError:
            return error_response()
    if isinstance(payload, dict) and payload.get("stream") is True:
        payload = {**payload, "stream": False}
    return run_turn(payload)
