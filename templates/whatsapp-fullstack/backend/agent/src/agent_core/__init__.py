"""Shared code of the WhatsApp AI agent: both entrypoints import from here."""
import logging


def configure_logging() -> None:
    """INFO for the agent's own loggers; Lambda and AgentCore already install a root handler."""
    if not logging.getLogger().handlers:
        logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    logging.getLogger("agent_core").setLevel(logging.INFO)
