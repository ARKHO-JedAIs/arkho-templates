"""Bedrock AgentCore Runtime entrypoint (the image's default command).

POST /invocations with the contract payload. Without ``"stream": true`` the
answer is one JSON response; with it, the runtime streams Server-Sent Events
(``chunk`` ... ``done`` or ``error``) for the web chat.

Local run: ``python src/agentcore_main.py`` and
``curl -X POST localhost:8080/invocations -H "Content-Type: application/json" -d '{"prompt": "hola"}'``.
"""
import asyncio

from bedrock_agentcore.runtime import BedrockAgentCoreApp

from agent_core import configure_logging
from agent_core.turn import run_turn, stream_turn, wants_stream

configure_logging()
app = BedrockAgentCoreApp()


@app.entrypoint
async def invoke(payload, context=None):
    if wants_stream(payload):
        return stream_turn(payload)
    # The turn is blocking (boto3, Strands' sync call): off the event loop so /ping keeps answering.
    return await asyncio.to_thread(run_turn, payload)


if __name__ == "__main__":
    app.run()
