"""WhatsApp media in the private media bucket (WhatsAppFactory).

Inbound: End User Messaging Social downloads the file from Meta straight into
the bucket (``GetWhatsAppMessageMedia``) under ``media/``; it names the object
after the media id and the MIME subtype, so it is found by prefix and renamed
to its real extension. Outbound: the browser uploads to ``outbound/`` with a
presigned PUT and ``PostWhatsAppMessageMedia`` hands the object to WhatsApp.

The object key never leaves the backend: what the web gets is a short-lived
presigned GET URL (``exposed``).
"""
import mimetypes
import os
import re
import uuid

import boto3

from . import config

MEDIA_BUCKET_NAME = os.environ.get("WHATSAPP_MEDIA_BUCKET_NAME", "")


def _ttl_seconds() -> int:
    try:
        value = int(os.environ.get("MEDIA_URL_TTL_SECONDS", "900"))
    except ValueError:
        return 900
    return value if value > 0 else 900


MEDIA_URL_TTL_SECONDS = _ttl_seconds()
UPLOAD_URL_TTL_SECONDS = 300

INBOUND_PREFIX = "media/"
OUTBOUND_PREFIX = "outbound/"
OUTBOUND_KEY = re.compile(r"^outbound/[0-9a-f-]{36}\.[a-z0-9]{1,5}$")

# Message types that carry a file.
MEDIA_TYPES = ("image", "audio", "video", "document", "sticker")

MB = 1024 * 1024

# What WhatsApp accepts per message type: MIME types and the largest file.
# Sources: AWS End User Messaging Social "Supported media file types and sizes
# in WhatsApp" and Meta Cloud API "Media - Supported media types". Stickers are
# receive-only here (static 100 KB, animated 500 KB).
OUTBOUND_LIMITS: dict[str, dict] = {
    "image": {"max_bytes": 5 * MB, "mime_types": {"image/jpeg", "image/png"}},
    "audio": {
        "max_bytes": 16 * MB,
        "mime_types": {"audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"},
    },
    "video": {"max_bytes": 16 * MB, "mime_types": {"video/mp4", "video/3gpp"}},
    "document": {
        "max_bytes": 100 * MB,
        "mime_types": {
            "text/plain",
            "application/pdf",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        },
    },
}

# The extension a file is stored with; mimetypes is the fallback.
MEDIA_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "audio/aac": "aac",
    "audio/amr": "amr",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/ogg": "ogg",
    "video/mp4": "mp4",
    "video/3gpp": "3gp",
    "video/3gp": "3gp",
    "text/plain": "txt",
    "application/pdf": "pdf",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
}

s3 = boto3.client("s3")
social_messaging = boto3.client("socialmessaging")


class MediaRejected(ValueError):
    """The file cannot be sent through WhatsApp; the message is safe to return."""


def base_mime(mime_type: str) -> str:
    """``audio/ogg; codecs=opus`` -> ``audio/ogg``."""
    return str(mime_type or "").split(";")[0].strip().lower()


def extension_for(mime_type: str) -> str:
    mime = base_mime(mime_type)
    if mime in MEDIA_EXTENSIONS:
        return MEDIA_EXTENSIONS[mime]
    guessed = mimetypes.guess_extension(mime) or ""
    return guessed.lstrip(".") or "bin"


def _bucket() -> str:
    if not MEDIA_BUCKET_NAME:
        raise config.ConfigurationError("WHATSAPP_MEDIA_BUCKET_NAME is not configured")
    return MEDIA_BUCKET_NAME


def stored_media_key(media_id: str) -> dict | None:
    """The object EUM Social wrote for ``media_id`` (``{key, size}``), or None.

    Its name is ``media/<media id>.<MIME subtype>``, and the subtype can be
    long (``vnd.openxmlformats-...``), so it is looked up by prefix.
    """
    response = s3.list_objects_v2(Bucket=_bucket(), Prefix=f"{INBOUND_PREFIX}{media_id}.")
    for item in response.get("Contents", []):
        key = str(item.get("Key", ""))
        if not key.endswith(".json"):
            return {"key": key, "size": int(item.get("Size", 0))}
    return None


def rename_media(key: str, media_id: str, mime_type: str) -> str:
    """Copies the object to ``media/<media id>.<real extension>``; the new key.

    A failed copy keeps the original key: the file is still there and served.
    """
    target = f"{INBOUND_PREFIX}{media_id}.{extension_for(mime_type)}"
    if target == key:
        return key
    bucket = _bucket()
    try:
        s3.copy_object(
            Bucket=bucket,
            Key=target,
            CopySource={"Bucket": bucket, "Key": key},
            ContentType=base_mime(mime_type) or "application/octet-stream",
            MetadataDirective="REPLACE",
        )
    except Exception:  # noqa: BLE001
        return key
    try:
        s3.delete_object(Bucket=bucket, Key=key)
    except Exception:  # noqa: BLE001
        pass
    return target


def download_inbound(media_id: str, origination_phone_number_id: str) -> dict:
    """Downloads one received file into the bucket: ``{key, mimeType, size}``.

    Raises when the download fails; the caller keeps the message without it.
    """
    response = social_messaging.get_whatsapp_message_media(
        mediaId=media_id,
        originationPhoneNumberId=origination_phone_number_id or config.origination_phone_number_id(),
        metadataOnly=False,
        destinationS3File={"bucketName": _bucket(), "key": INBOUND_PREFIX},
    )
    mime_type = base_mime(response.get("mimeType", ""))
    stored = stored_media_key(media_id)
    if stored is None:
        raise LookupError(f"The media {media_id} was not found in the bucket")
    key = rename_media(stored["key"], media_id, mime_type)
    return {"key": key, "mimeType": mime_type, "size": stored["size"]}


def outbound_type(mime_type: str) -> str:
    """The WhatsApp message type a file is sent as; MediaRejected if none fits."""
    mime = base_mime(mime_type)
    for message_type, limits in OUTBOUND_LIMITS.items():
        if mime in limits["mime_types"]:
            return message_type
    raise MediaRejected(f"WhatsApp does not accept {mime or 'this file type'}")


def validate_outbound(mime_type: str, size: int) -> str:
    """The message type for the file; MediaRejected when type or size is not accepted."""
    message_type = outbound_type(mime_type)
    limit = OUTBOUND_LIMITS[message_type]["max_bytes"]
    if size <= 0:
        raise MediaRejected("The file is empty")
    if size > limit:
        raise MediaRejected(f"A {message_type} can be at most {limit // MB} MB")
    return message_type


def new_outbound_key(mime_type: str) -> str:
    return f"{OUTBOUND_PREFIX}{uuid.uuid4()}.{extension_for(mime_type)}"


def presign_upload(key: str, mime_type: str) -> str:
    """A PUT URL bound to ``key`` and its Content-Type (a different one is refused)."""
    return s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": _bucket(), "Key": key, "ContentType": base_mime(mime_type)},
        ExpiresIn=UPLOAD_URL_TTL_SECONDS,
    )


def uploaded_object(key: str) -> dict:
    """``{mimeType, size}`` of an uploaded file; MediaRejected when it is not there."""
    if not OUTBOUND_KEY.fullmatch(key or ""):
        raise MediaRejected("media.key is not an upload of this API")
    try:
        head = s3.head_object(Bucket=_bucket(), Key=key)
    except Exception as error:  # noqa: BLE001
        raise MediaRejected("The file was not uploaded") from error
    return {"mimeType": base_mime(head.get("ContentType", "")), "size": int(head.get("ContentLength", 0))}


def post_to_whatsapp(key: str, origination_phone_number_id: str | None = None) -> str:
    """Hands an uploaded file to WhatsApp; the media id a message refers to."""
    response = social_messaging.post_whatsapp_message_media(
        originationPhoneNumberId=origination_phone_number_id or config.origination_phone_number_id(),
        sourceS3File={"bucketName": _bucket(), "key": key},
    )
    return str(response.get("mediaId", ""))


def presign_download(key: str, filename: str = "") -> str:
    params = {"Bucket": _bucket(), "Key": key}
    if filename:
        safe = re.sub(r'["\\\r\n]', "", filename)[:200]
        params["ResponseContentDisposition"] = f'inline; filename="{safe}"'
    return s3.generate_presigned_url("get_object", Params=params, ExpiresIn=MEDIA_URL_TTL_SECONDS)


def exposed(item: dict | None) -> dict | None:
    """The message as the web may see it: ``media.key`` swapped for a presigned ``url``.

    A URL that cannot be signed leaves that one message without it.
    """
    if not item or not isinstance(item.get("media"), dict):
        return item
    media = dict(item["media"])
    key = media.pop("key", None)
    if key and not media.get("error"):
        try:
            media["url"] = presign_download(str(key), str(media.get("filename") or ""))
        except Exception:  # noqa: BLE001
            media["error"] = "url_unavailable"
    return {**item, "media": media}
