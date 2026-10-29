"""The tools of one request, bound to its actor, channel and settings."""
from dataclasses import dataclass

from ..config import AgentSettings, RuntimeConfig
from ..prompt import WHATSAPP
from .business_api import BusinessApiTools
from .datetime_tool import DateTimeTools
from .handoff import HandoffTools, perform_handoff


@dataclass
class RequestTools:
    tools: list
    handoff: HandoffTools | None


def build_tools(config: RuntimeConfig, settings: AgentSettings, channel: str, phone: str) -> RequestTools:
    """The handoff tool only exists on WhatsApp: there is a conversation in the inbox to hand over."""
    tools: list = [DateTimeTools(settings.timezone).get_current_datetime]
    handoff = None
    if channel == WHATSAPP and phone and config.conversations_table:
        handoff = HandoffTools(config, phone)
        tools.append(handoff.request_human_handoff)
    if config.business_api_url:
        tools.append(BusinessApiTools(config.business_api_url).call_business_api)
    return RequestTools(tools=tools, handoff=handoff)


__all__ = ["RequestTools", "build_tools", "perform_handoff"]
