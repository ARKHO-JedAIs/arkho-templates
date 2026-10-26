import json
import os
import time
from typing import Any, Dict

import boto3

from common import create_error_response, create_success_response, get_logger, with_cors

logger = get_logger(__name__)
s3_client = boto3.client("s3")

BUCKET_NAME = os.environ.get("TEMPLATES_BUCKET_NAME", "")
EXPIRY_SECONDS = int(os.environ.get("PRESIGNED_URL_EXPIRY_SECONDS", "3600"))


@with_cors()
def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Generate a presigned PUT URL for uploading a project template archive."""
    try:
        user_id = _get_user_id(event)
        if not user_id:
            return create_error_response(
                error_message="Unable to identify user",
                status_code=401,
                error_code="UNAUTHORIZED",
            )

        timestamp = str(int(time.time()))
        s3_key = f"templates/{user_id}/{timestamp}.zip"

        presigned_url = s3_client.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": BUCKET_NAME,
                "Key": s3_key,
                "ContentType": "application/zip",
            },
            ExpiresIn=EXPIRY_SECONDS,
        )

        logger.info(
            "Generated presigned URL for user %s, key: %s, expiry: %ds",
            user_id,
            s3_key,
            EXPIRY_SECONDS,
        )

        return create_success_response(
            data={
                "uploadUrl": presigned_url,
                "s3Key": s3_key,
                "expiresIn": EXPIRY_SECONDS,
            },
            message="Upload URL generated successfully",
        )

    except Exception as e:
        logger.error("Error generating presigned URL: %s", str(e))
        return create_error_response(
            error_message="Failed to generate upload URL",
            status_code=500,
            error_code="PRESIGNED_URL_ERROR",
        )


def _get_user_id(event: Dict[str, Any]) -> str | None:
    """Extract user_id from the authorizer context."""
    request_context = event.get("requestContext", {})
    authorizer = request_context.get("authorizer", {})
    return authorizer.get("sub") or authorizer.get("principalId")
