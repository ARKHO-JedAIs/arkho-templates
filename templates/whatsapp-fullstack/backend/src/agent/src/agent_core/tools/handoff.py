"""request_human_handoff: the agent hands the WhatsApp conversation to a person.

It does what a person pressing "take conversation" in the inbox does through
``put-control``: ``mode`` becomes ``human`` (so the ws-handler stops calling
the agent), an internal notice is stored and the realtime events go out so
every open inbox updates at once.
"""
import logging

from strands import tool

from .. import whatsapp_store as store
from ..config import RuntimeConfig

logger = logging.getLogger(__name__)

MAX_REASON_CHARS = 300


def perform_handoff(config: RuntimeConfig, phone: str, reason: str) -> bool:
    """Moves the conversation to human mode and announces it; False when it could not.

    Used by the tool and by the self-harm path of the pre-filter, which hands
    over without calling the model.
    """
    reason = " ".join(str(reason or "").split())[:MAX_REASON_CHARS] or "Sin motivo indicado"
    if not config.conversations_table or not phone:
        logger.warning("Handoff skipped: no conversations table or phone")
        return False
    try:
        conversation = store.set_human_mode(config.conversations_table, config.region, phone, reason)
    except store.ConversationNotFound:
        logger.warning("Handoff skipped: the conversation does not exist")
        return False
    except Exception:  # noqa: BLE001
        logger.exception("Handoff failed: the conversation mode could not be updated")
        return False
    view = store.conversation_view(conversation)
    store.publish(config.appsync_url, config.region, phone, store.CONTROL_CHANGED, payload=view)
    store.publish(config.appsync_url, config.region, store.INBOX_CHANNEL, store.CONVERSATION_UPDATED, payload=view)
    if config.messages_table:
        try:
            notice = store.save_handoff_notice(config.messages_table, config.region, phone, reason, config.admin_group)
            store.publish(
                config.appsync_url,
                config.region,
                phone,
                store.CONVERSATION_EVENT,
                payload=notice,
                message=notice["message"],
            )
        except Exception:  # noqa: BLE001
            # The mode already changed; a missing notice must not undo the handoff.
            logger.exception("Handoff notice could not be stored")
    else:
        logger.warning("WHATSAPP_MESSAGES_TABLE_NAME is not set: the handoff notice is not stored")
    return True


class HandoffTools:
    """Bound to one request: the phone it may hand over is never chosen by the model."""

    def __init__(self, config: RuntimeConfig, phone: str):
        self._config = config
        self._phone = phone
        self.triggered = False
        self.reason = ""

    @tool
    def request_human_handoff(self, reason: str) -> str:
        """Hand this conversation to a person of the team. Use it when the user explicitly asks to talk to a
        person, when they say they want to hurt themselves, or when you cannot solve their request after trying.
        After calling it, do not keep solving the request: a person will continue the conversation.

        Args:
            reason: One short sentence with what the user needs and why a person must take over.
        """
        if self.triggered:
            return "The conversation was already handed to a person."
        if not perform_handoff(self._config, self._phone, reason):
            return "The handoff could not be completed. Tell the user to try again later; do not claim a person will answer."
        self.triggered = True
        self.reason = reason
        return "Done: a person of the team will continue this conversation. Tell the user briefly."
