"""A received WhatsApp audio as text, with Amazon Transcribe, so the agent can read it.

The audio is already in the media bucket (ws-handler downloads it under
``media/``). A batch transcription job reads it from there; its output stays in
the bucket Transcribe manages and is fetched through the presigned
``TranscriptFileUri``, so nothing else is written to the media bucket. The job
is deleted once read: the text is stored with the message.

It runs in the agent worker, so the wait does not hold the webhook. The language
is the one chosen on the web's "Voz" page (common.whatsapp.voice, es-US by default).
"""
import json
import time
import urllib.request
import uuid

import boto3

from . import media, usage, voice

# The IAM policy scopes reading and deleting jobs to this prefix (lib/stack/agent).
JOB_NAME_PREFIX = "wa-transcribe-"
POLL_SECONDS = 1.5
MAX_WAIT_SECONDS = 60
FETCH_TIMEOUT_SECONDS = 10

# WhatsApp MIME types mapped to the MediaFormat values Transcribe accepts. A
# voice note is audio/ogg (Opus), the default.
MEDIA_FORMATS = {
    "audio/ogg": "ogg",
    "audio/oga": "ogg",
    "audio/opus": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "mp4",
    "audio/aac": "mp4",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/amr": "amr",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
    "audio/flac": "flac",
}
DEFAULT_MEDIA_FORMAT = "ogg"

_client = None


class TranscriptionFailed(RuntimeError):
    """The audio could not be turned into text."""


def _transcribe():
    global _client
    if _client is None:
        _client = boto3.client("transcribe")
    return _client


def media_format(mime_type: str) -> str:
    return MEDIA_FORMATS.get(media.base_mime(mime_type), DEFAULT_MEDIA_FORMAT)


def _fetch(uri: str) -> str:
    if not uri.startswith("https://"):
        raise TranscriptionFailed("The transcript URI is not HTTPS")
    with urllib.request.urlopen(uri, timeout=FETCH_TIMEOUT_SECONDS) as response:  # noqa: S310
        body = json.loads(response.read().decode("utf-8"))
    results = body.get("results") or {}
    transcripts = results.get("transcripts") or []
    usage.record(usage.TRANSCRIPTION, seconds=spoken_seconds(results))
    return " ".join(str(t.get("transcript") or "") for t in transcripts if isinstance(t, dict)).strip()


def spoken_seconds(results: dict) -> float:
    """How long the voice note was, from the end time of its last word (0 when silent)."""
    ends = []
    for item in results.get("items") or []:
        try:
            ends.append(float(item.get("end_time")))
        except (TypeError, ValueError, AttributeError):
            continue
    return max(ends, default=0.0)


def transcribe(key: str, mime_type: str = "") -> str:
    """The text of the audio stored under ``key``; empty when nothing was said.

    Raises TranscriptionFailed when the job fails or takes longer than
    ``MAX_WAIT_SECONDS``.
    """
    if not key:
        raise TranscriptionFailed("The audio was not stored")
    client = _transcribe()
    job_name = f"{JOB_NAME_PREFIX}{uuid.uuid4()}"
    client.start_transcription_job(
        TranscriptionJobName=job_name,
        Media={"MediaFileUri": f"s3://{media._bucket()}/{key}"},
        MediaFormat=media_format(mime_type),
        LanguageCode=voice.read()[voice.TRANSCRIBE_LANGUAGE_KEY],
    )
    try:
        deadline = time.monotonic() + MAX_WAIT_SECONDS
        while True:
            job = client.get_transcription_job(TranscriptionJobName=job_name)["TranscriptionJob"]
            status = job.get("TranscriptionJobStatus")
            if status == "COMPLETED":
                return _fetch(str((job.get("Transcript") or {}).get("TranscriptFileUri") or ""))
            if status == "FAILED":
                raise TranscriptionFailed(job.get("FailureReason") or "Transcription failed")
            if time.monotonic() >= deadline:
                raise TranscriptionFailed(f"Transcription took longer than {MAX_WAIT_SECONDS} s")
            time.sleep(POLL_SECONDS)
    finally:
        try:
            client.delete_transcription_job(TranscriptionJobName=job_name)
        except Exception:  # noqa: BLE001
            pass
