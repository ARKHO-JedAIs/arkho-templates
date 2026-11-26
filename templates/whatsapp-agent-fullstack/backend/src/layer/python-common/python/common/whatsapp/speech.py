"""An agent answer told aloud with Amazon Polly.

The answer is written to be read on WhatsApp (icons, *bold*, `---` separators,
`|` between data, dd-mm-aaaa dates). ``speakable`` strips what a voice should not
read and Polly synthesizes MP3 (``audio/mpeg``, which WhatsApp accepts as an
audio message), in pieces under Polly's per-request limit that are joined back
(MP3 frames concatenate).
"""
import logging
import re

import boto3
from botocore.config import Config

from . import usage, voice

logger = logging.getLogger(__name__)

MIME_TYPE = "audio/mpeg"
# SynthesizeSpeech takes up to 3000 billed characters per request.
MAX_CHUNK_CHARS = 2800

MONTHS = (
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
)
# Icons, variation selectors and joiners: nothing a voice should read.
EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿️‍]")
DATE_TIME = re.compile(r"\b(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?\b")

_client = None
# boto3's defaults (60 s per read, retried) let one slow call outlast the worker's
# timeout, and the queue is FIFO per number: a stuck job would hold back every later
# message of that number. A slow Polly call fails fast instead.
POLLY_CLIENT_CONFIG = Config(connect_timeout=5, read_timeout=20, retries={"max_attempts": 2, "mode": "standard"})


def _polly():
    global _client
    if _client is None:
        _client = boto3.client("polly", config=POLLY_CLIENT_CONFIG)
    return _client


def _spoken_date(match: re.Match) -> str:
    day, month, _year, hour, minute = match.groups()
    month_index = int(month) - 1
    if not 0 <= month_index < 12:
        return match.group(0)
    text = f"{int(day)} de {MONTHS[month_index]}"
    return f"{text} a las {int(hour)}:{minute}" if hour else text


def speakable(text: str) -> str:
    """``text`` as plain sentences: no icons, formatting or separators, dates in words."""
    sentences = []
    for line in str(text or "").splitlines():
        line = EMOJI.sub("", line)
        line = re.sub(r"[*_~`]", "", line)
        if not line.strip() or re.fullmatch(r"\s*-{3,}\s*", line):
            continue
        line = DATE_TIME.sub(_spoken_date, line)
        line = line.replace(" | ", ", ").replace("|", ", ").replace(" · ", ", ").replace(" — ", ", ").replace("—", ",")
        line = re.sub(r"\s+", " ", line).strip(" ,")
        if line and line[-1] not in ".!?:":
            line += "."
        if line:
            sentences.append(line)
    return " ".join(sentences)


def chunks(text: str, limit: int = MAX_CHUNK_CHARS) -> list[str]:
    """``text`` in pieces of at most ``limit`` characters, cut between sentences, then words."""
    pieces: list[str] = []
    rest = text.strip()
    while len(rest) > limit:
        window = rest[: limit + 1]
        cut = next((window.rfind(sep) + 1 for sep in (". ", " ") if window.rfind(sep) > limit // 2), limit)
        pieces.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    if rest:
        pieces.append(rest)
    return pieces


def synthesize(text: str, voice_id: str = "", engine: str = "") -> bytes:
    """The MP3 of ``text`` read aloud; ValueError when nothing is left to read.

    The voice and engine are the configured ones (common.whatsapp.voice) unless given.
    """
    spoken = speakable(text)
    if not spoken:
        raise ValueError("Nothing to read aloud")
    if not voice_id or not engine:
        settings = voice.read()
        voice_id = voice_id or settings[voice.VOICE_ID_KEY]
        engine = engine or settings[voice.ENGINE_KEY]
    audio = b""
    for piece in chunks(spoken, MAX_CHUNK_CHARS):
        response = _polly().synthesize_speech(
            Text=piece, TextType="text", OutputFormat="mp3", VoiceId=voice_id, Engine=engine
        )
        audio += response["AudioStream"].read()
    usage.record(usage.SPEECH, characters=len(spoken), engine=engine, voice=voice_id)
    return audio
