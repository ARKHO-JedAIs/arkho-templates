from typing import Dict, Any
from common import get_logger, with_cors, create_success_response

logger = get_logger(__name__)


@with_cors()
def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Handler for the public GET /hello-world route.

    Reference example of the API Gateway -> Lambda wiring: it depends on no
    other resource, so the API can be verified right after the first deploy.
    Copy this shape for real endpoints (python-common layer, @with_cors, and a
    standardized response body), then delete this folder along with its
    entries in LambdaFactory and ApiFactory.
    """
    logger.info("Hello-world route invoked")

    return create_success_response(
        data={'message': 'Hello, world!'},
        message='Hello-world example endpoint'
    )
