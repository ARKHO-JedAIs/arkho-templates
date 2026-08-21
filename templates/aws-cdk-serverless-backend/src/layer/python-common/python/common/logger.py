import logging
import os
from typing import Optional, Any


def setup_logger(name: Optional[str] = None, level: Optional[str] = None) -> logging.Logger:
    """Setup standardized logger for Lambda functions."""
    logger = logging.getLogger(name or __name__)
    log_level = level or os.getenv('LOG_LEVEL', 'INFO')
    logger.setLevel(getattr(logging, log_level.upper()))

    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)

    return logger


def get_logger(name: Optional[str] = None) -> logging.Logger:
    """Get a logger instance with standard configuration."""
    return setup_logger(name)


def log_request_metadata(logger: logging.Logger, context: Any) -> None:
    """Log safe, non-PHI Lambda request metadata.

    Logs only: request ID, function name, and remaining execution time.
    Does NOT log event payload — use this instead of logging the full event.
    """
    if context is None:
        return
    logger.info(
        "request_id=%s function=%s remaining_ms=%d",
        getattr(context, 'aws_request_id', 'unknown'),
        getattr(context, 'function_name', 'unknown'),
        getattr(context, 'get_remaining_time_in_millis', lambda: 0)(),
    )


def log_error(logger: logging.Logger, error: Exception, context: Optional[str] = None) -> None:
    """Log error with context information."""
    error_msg = f"Error: {str(error)}"
    if context:
        error_msg = f"{context} - {error_msg}"
    logger.error(error_msg, exc_info=True)
