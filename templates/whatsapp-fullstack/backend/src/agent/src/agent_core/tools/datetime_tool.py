from strands import tool

from ..prompt import local_now


class DateTimeTools:
    def __init__(self, timezone_name: str):
        self._timezone = timezone_name or "UTC"

    @tool
    def get_current_datetime(self) -> str:
        """Get the current date, weekday and time in the business time zone. Use it before resolving relative
        dates such as "tomorrow" or "next Monday" when the conversation has been going on for a while."""
        moment = local_now(self._timezone)
        return f"{moment.strftime('%A %Y-%m-%d %H:%M')} ({self._timezone})"
