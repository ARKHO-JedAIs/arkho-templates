import json
from typing import Dict, Any, Optional, Union

def create_response(
    status_code: int,
    body: Union[Dict[str, Any], str, None] = None,
    headers: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """
    Create standardized API Gateway response
    
    Note: CORS headers should be handled by @with_cors decorator or add_cors_headers()
    from cors_middleware module for better flexibility and consistency.
    
    Args:
        status_code: HTTP status code
        body: Response body (dict will be JSON serialized)
        headers: Additional headers
    
    Returns:
        API Gateway response dictionary
    """
    response_headers = headers.copy() if headers else {}
    
    # Prepare response body and set content type
    response_body = body
    if isinstance(body, dict):
        response_body = json.dumps(body, default=str, ensure_ascii=False)
        response_headers['Content-Type'] = 'application/json; charset=utf-8'
    elif isinstance(body, str):
        response_body = body
        # Only set content-type if not already specified
        if 'Content-Type' not in response_headers:
            response_headers['Content-Type'] = 'text/plain; charset=utf-8'
    elif body is None:
        response_body = ''
    else:
        # For other types, convert to JSON
        response_body = json.dumps(body, default=str, ensure_ascii=False)
        response_headers['Content-Type'] = 'application/json; charset=utf-8'
    
    return {
        'statusCode': status_code,
        'headers': response_headers,
        'body': response_body
    }

def create_success_response(
    data: Any = None,
    message: str = 'Success',
    status_code: int = 200,
    headers: Optional[Dict[str, str]] = None,
    metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create standardized success response
    
    Args:
        data: Response data
        message: Success message
        status_code: HTTP status code (default: 200)
        headers: Additional headers
        metadata: Additional metadata (pagination, timestamps, etc.)
    
    Returns:
        API Gateway success response
    """
    body = {
        'success': True,
        'message': message
    }
    
    if data is not None:
        body['data'] = data
    
    if metadata:
        body['metadata'] = metadata
    
    return create_response(status_code, body, headers)

def create_error_response(
    error_message: str,
    status_code: int = 400,
    error_code: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """
    Create standardized error response
    
    Args:
        error_message: Error message
        status_code: HTTP status code (default: 400)
        error_code: Custom error code
        details: Additional error details
        headers: Additional headers
    
    Returns:
        API Gateway error response
    """
    body = {
        'success': False,
        'error': {
            'message': error_message,
            'code': error_code or f'ERROR_{status_code}'
        }
    }
    
    if details:
        body['error']['details'] = details
    
    return create_response(status_code, body, headers)

def create_validation_error_response(
    validation_errors: Dict[str, str],
    message: str = 'Validation failed'
) -> Dict[str, Any]:
    """
    Create validation error response
    
    Args:
        validation_errors: Dictionary of field validation errors
        message: Error message
    
    Returns:
        API Gateway validation error response
    """
    return create_error_response(
        error_message=message,
        status_code=422,
        error_code='VALIDATION_ERROR',
        details={'validation_errors': validation_errors}
    )

def create_not_found_response(
    resource: str = 'Resource',
    resource_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Create not found error response
    
    Args:
        resource: Resource type name
        resource_id: Resource identifier
    
    Returns:
        API Gateway not found response
    """
    message = f"{resource} not found"
    if resource_id:
        message += f" (ID: {resource_id})"
    
    return create_error_response(
        error_message=message,
        status_code=404,
        error_code='NOT_FOUND'
    )

def create_unauthorized_response(
    message: str = 'Unauthorized access'
) -> Dict[str, Any]:
    """
    Create unauthorized error response
    
    Args:
        message: Error message
    
    Returns:
        API Gateway unauthorized response
    """
    return create_error_response(
        error_message=message,
        status_code=401,
        error_code='UNAUTHORIZED'
    )

def create_forbidden_response(
    message: str = 'Access forbidden'
) -> Dict[str, Any]:
    """
    Create forbidden error response
    
    Args:
        message: Error message
    
    Returns:
        API Gateway forbidden response
    """
    return create_error_response(
        error_message=message,
        status_code=403,
        error_code='FORBIDDEN'
    )

def create_internal_error_response(
    message: str = 'Internal server error',
    error_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Create internal server error response
    
    Args:
        message: Error message
        error_id: Unique error identifier for tracking
    
    Returns:
        API Gateway internal error response
    """
    details = {}
    if error_id:
        details['error_id'] = error_id
    
    return create_error_response(
        error_message=message,
        status_code=500,
        error_code='INTERNAL_ERROR',
        details=details if details else None
    )

def create_paginated_response(
    items: list,
    total_count: int,
    page: int = 1,
    page_size: int = 20,
    message: str = 'Items retrieved successfully',
    headers: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """
    Create paginated response with metadata
    
    Args:
        items: List of items for current page
        total_count: Total number of items across all pages
        page: Current page number (1-based)
        page_size: Number of items per page
        message: Success message
        headers: Additional headers
    
    Returns:
        API Gateway response with pagination metadata
    """
    total_pages = (total_count + page_size - 1) // page_size  # Ceiling division
    
    metadata = {
        'pagination': {
            'current_page': page,
            'page_size': page_size,
            'total_items': total_count,
            'total_pages': total_pages,
            'has_next': page < total_pages,
            'has_previous': page > 1
        }
    }
    
    return create_success_response(
        data=items,
        message=message,
        metadata=metadata,
        headers=headers
    )

def create_created_response(
    data: Any,
    message: str = 'Resource created successfully',
    location: Optional[str] = None,
    headers: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """
    Create 201 Created response
    
    Args:
        data: Created resource data
        message: Success message
        location: Location header for the created resource
        headers: Additional headers
    
    Returns:
        API Gateway 201 response
    """
    response_headers = headers.copy() if headers else {}
    
    if location:
        response_headers['Location'] = location
    
    return create_success_response(
        data=data,
        message=message,
        status_code=201,
        headers=response_headers
    )

def create_no_content_response(
    headers: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """
    Create 204 No Content response
    
    Args:
        headers: Additional headers
    
    Returns:
        API Gateway 204 response
    """
    return create_response(204, None, headers)

def create_redirect_response(
    location: str,
    permanent: bool = False,
    headers: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """
    Create redirect response
    
    Args:
        location: Redirect URL
        permanent: Whether it's a permanent redirect (301 vs 302)
        headers: Additional headers
    
    Returns:
        API Gateway redirect response
    """
    response_headers = headers.copy() if headers else {}
    response_headers['Location'] = location
    
    status_code = 301 if permanent else 302
    
    return create_response(status_code, None, response_headers)

def create_file_response(
    file_content: Union[str, bytes],
    filename: str,
    content_type: str = 'application/octet-stream',
    inline: bool = False,
    headers: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """
    Create file download response
    
    Args:
        file_content: File content (string or bytes)
        filename: Name of the file
        content_type: MIME type of the file
        inline: Whether to display inline or as attachment
        headers: Additional headers
    
    Returns:
        API Gateway file response
    """
    response_headers = headers.copy() if headers else {}
    
    response_headers['Content-Type'] = content_type
    
    disposition = 'inline' if inline else 'attachment'
    response_headers['Content-Disposition'] = f'{disposition}; filename="{filename}"'
    
    # Handle binary content
    if isinstance(file_content, bytes):
        import base64
        body = base64.b64encode(file_content).decode('utf-8')
        response_headers['Content-Transfer-Encoding'] = 'base64'
        return {
            'statusCode': 200,
            'headers': response_headers,
            'body': body,
            'isBase64Encoded': True
        }
    
    return create_response(200, file_content, response_headers)
