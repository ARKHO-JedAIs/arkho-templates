import json
import os
from functools import wraps
from typing import Dict, Any, Callable, Union, Optional

def with_cors(
    origins: Optional[Union[str, list]] = None,
    methods: Optional[Union[str, list]] = None,
    headers: Optional[Union[str, list]] = None,
    max_age: Optional[int] = None
):
    """
    Decorator to add CORS headers to Lambda function responses
    
    Args:
        origins: Allowed origins (default: from CORS_ALLOWED_ORIGINS env var or '*')
        methods: Allowed HTTP methods (default: from CORS_ALLOWED_METHODS env var or 'GET,POST,PUT,DELETE,OPTIONS')
        headers: Allowed headers (default: from CORS_ALLOWED_HEADERS env var or common headers)
        max_age: Max age for preflight cache (default: from CORS_MAX_AGE env var or 86400 seconds)
    
    Environment Variables:
        CORS_ALLOWED_ORIGINS: Comma-separated list of allowed origins (e.g., 'https://app.mydomain.com,http://localhost:3000')
        CORS_ALLOWED_METHODS: Comma-separated list of allowed methods
        CORS_ALLOWED_HEADERS: Comma-separated list of allowed headers
        CORS_MAX_AGE: Max age for preflight cache in seconds
    
    Returns:
        Decorated function with CORS headers
    
    Usage:
        # Use environment variables (recommended)
        @with_cors()
        def handler(event, context):
            return {'message': 'Hello World'}
        
        # Override with explicit values
        @with_cors(origins=['https://example.com'], methods=['GET', 'POST'])
        def handler(event, context):
            return {'message': 'Hello World'}
    """
    def decorator(func: Callable) -> Callable:
        # Resolve configuration from environment variables or use defaults
        resolved_origins = origins
        if resolved_origins is None:
            env_origins = os.environ.get('CORS_ALLOWED_ORIGINS', '*')
            resolved_origins = [o.strip() for o in env_origins.split(',')] if ',' in env_origins else env_origins
        
        resolved_methods = methods if methods is not None else os.environ.get(
            'CORS_ALLOWED_METHODS', 
            'GET,POST,PUT,DELETE,OPTIONS'
        )
        
        resolved_headers = headers if headers is not None else os.environ.get(
            'CORS_ALLOWED_HEADERS',
            'Content-Type,Authorization,X-Requested-With,Accept,Origin,X-Api-Key'
        )
        
        resolved_max_age = max_age if max_age is not None else int(os.environ.get('CORS_MAX_AGE', '86400'))
        @wraps(func)
        def wrapper(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
            # Get the origin from the request
            request_origin = event.get('headers', {}).get('origin') or event.get('headers', {}).get('Origin')
            # Prepare CORS headers
            cors_headers = _build_cors_headers(resolved_origins, resolved_methods, resolved_headers, resolved_max_age, request_origin)
            
            # Handle preflight OPTIONS request
            if event.get('httpMethod') == 'OPTIONS':
                return {
                    'statusCode': 200,
                    'headers': cors_headers,
                    'body': ''
                }
            
            try:
                # Execute original function
                result = func(event, context)
                
                # If result is already a proper API Gateway response
                if isinstance(result, dict) and 'statusCode' in result:
                    # Add CORS headers to existing headers
                    result.setdefault('headers', {}).update(cors_headers)
                    return result
                
                # If result is a dict but not an API Gateway response
                if isinstance(result, dict):
                    return {
                        'statusCode': 200,
                        'headers': cors_headers,
                        'body': json.dumps(result, default=str)
                    }
                
                # If result is a string
                if isinstance(result, str):
                    return {
                        'statusCode': 200,
                        'headers': cors_headers,
                        'body': result
                    }
                
                # For any other type, serialize to JSON
                return {
                    'statusCode': 200,
                    'headers': cors_headers,
                    'body': json.dumps(result, default=str)
                }
                
            except Exception as e:
                # Return error with CORS headers
                return {
                    'statusCode': 500,
                    'headers': cors_headers,
                    'body': json.dumps({
                        'success': False,
                        'error': {
                            'message': str(e),
                            'code': 'INTERNAL_ERROR'
                        }
                    })
                }
        
        return wrapper
    return decorator

def _build_cors_headers(
    origins: Union[str, list],
    methods: Union[str, list], 
    headers: Union[str, list],
    max_age: int,
    request_origin: str = None
) -> Dict[str, str]:
    """
    Build CORS headers dictionary
    
    Args:
        origins: Allowed origins
        methods: Allowed methods
        headers: Allowed headers
        max_age: Max age for preflight cache
        request_origin: The origin from the request
    
    Returns:
        Dictionary with CORS headers
    """
    cors_headers = {}
    
    # Handle origins - CORS requires only one origin per response
    if isinstance(origins, list):
        # If request_origin is provided and is in allowed list, use it
        if request_origin and request_origin in origins:
            cors_headers['Access-Control-Allow-Origin'] = request_origin
        # Otherwise, use the first allowed origin or wildcard
        elif '*' in origins:
            cors_headers['Access-Control-Allow-Origin'] = '*'
        else:
            cors_headers['Access-Control-Allow-Origin'] = origins[0]
    else:
        cors_headers['Access-Control-Allow-Origin'] = origins
    
    # Handle methods
    if isinstance(methods, list):
        cors_headers['Access-Control-Allow-Methods'] = ','.join(methods)
    else:
        cors_headers['Access-Control-Allow-Methods'] = methods
    
    # Handle headers
    if isinstance(headers, list):
        cors_headers['Access-Control-Allow-Headers'] = ','.join(headers)
    else:
        cors_headers['Access-Control-Allow-Headers'] = headers
    
    # Add max age
    cors_headers['Access-Control-Max-Age'] = str(max_age)
    
    return cors_headers

def add_cors_headers(
    response: Dict[str, Any],
    origins: Union[str, list] = '*',
    methods: Union[str, list] = 'GET,POST,PUT,DELETE,OPTIONS',
    headers: Union[str, list] = 'Content-Type,Authorization,X-Requested-With,Accept,Origin,X-Api-Key',
    max_age: int = 86400,
    request_origin: str = None
) -> Dict[str, Any]:
    """
    Add CORS headers to an existing response dictionary
    
    Args:
        response: API Gateway response dictionary
        origins: Allowed origins (default: '*')
        methods: Allowed HTTP methods
        headers: Allowed headers
        max_age: Max age for preflight cache
    
    Returns:
        Response dictionary with CORS headers added
    
    Usage:
        response = {'statusCode': 200, 'body': 'Hello'}
        response = add_cors_headers(response)
    """
    cors_headers = _build_cors_headers(origins, methods, headers, max_age, request_origin)
    response.setdefault('headers', {}).update(cors_headers)
    return response

def create_cors_preflight_response(
    origins: Union[str, list] = '*',
    methods: Union[str, list] = 'GET,POST,PUT,DELETE,OPTIONS',
    headers: Union[str, list] = 'Content-Type,Authorization,X-Requested-With,Accept,Origin,X-Api-Key',
    max_age: int = 86400,
    request_origin: str = None
) -> Dict[str, Any]:
    """
    Create a preflight OPTIONS response with CORS headers
    
    Args:
        origins: Allowed origins (default: '*')
        methods: Allowed HTTP methods
        headers: Allowed headers
        max_age: Max age for preflight cache
    
    Returns:
        API Gateway preflight response
    
    Usage:
        if event.get('httpMethod') == 'OPTIONS':
            return create_cors_preflight_response()
    """
    cors_headers = _build_cors_headers(origins, methods, headers, max_age, request_origin)
    
    return {
        'statusCode': 200,
        'headers': cors_headers,
        'body': ''
    }
