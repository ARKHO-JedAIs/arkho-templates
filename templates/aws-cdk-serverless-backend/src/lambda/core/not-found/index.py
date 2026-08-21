from typing import Dict, Any
from common import get_logger, with_cors, create_error_response

logger = get_logger(__name__)


@with_cors()
def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Handler for 404 Not Found responses
    """
    path = event.get('path', 'unknown')
    method = event.get('httpMethod', 'unknown')
    
    logger.warning(f"Route not found: {method} {path}")
    
    return create_error_response(
        error_message=f'Route not found: {method} {path}',
        status_code=404,
        error_code='ROUTE_NOT_FOUND'
    )
