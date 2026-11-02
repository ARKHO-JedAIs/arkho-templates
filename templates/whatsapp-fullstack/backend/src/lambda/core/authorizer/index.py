"""
Lambda Authorizer for API Gateway
Validates Cognito JWT tokens and generates IAM policies
"""
import json
import os
from typing import Any, Dict, Optional
import jwt
from jwt import PyJWKClient
import logging

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Environment variables
USER_POOL_ID = os.environ.get('USER_POOL_ID')
APP_CLIENT_ID = os.environ.get('APP_CLIENT_ID')
# AWS_REGION is injected automatically by the Lambda runtime
AWS_REGION = os.environ.get('AWS_REGION')

# Cognito issuer and JWKS URL (built once at cold start)
COGNITO_ISSUER = f'https://cognito-idp.{AWS_REGION}.amazonaws.com/{USER_POOL_ID}'
JWKS_URL = f'{COGNITO_ISSUER}/.well-known/jwks.json'

# Cache for JWKS client
jwks_client = None


def get_jwks_client() -> PyJWKClient:
    """Get or create JWKS client (cached)"""
    global jwks_client
    if jwks_client is None:
        jwks_client = PyJWKClient(JWKS_URL)
    return jwks_client


def extract_token(authorization_header: Optional[str]) -> Optional[str]:
    """Extract token from Authorization header"""
    if not authorization_header:
        return None
    
    # Handle "Bearer <token>" format
    if authorization_header.startswith('Bearer '):
        return authorization_header[7:]
    
    # Handle raw token
    return authorization_header


def verify_token(token: str) -> Dict[str, Any]:
    """
    Verify and decode Cognito JWT token
    
    Args:
        token: JWT token string
        
    Returns:
        Decoded token payload
        
    Raises:
        Exception: If token is invalid
    """
    try:
        # Get signing key from JWKS
        client = get_jwks_client()
        signing_key = client.get_signing_key_from_jwt(token)
        
        # Decode and verify token
        # Note: Access tokens use 'client_id' instead of 'aud', so we verify it manually
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=['RS256'],
            options={
                'verify_signature': True,
                'verify_exp': True,
                'verify_aud': False,  # Access tokens don't have 'aud', they have 'client_id'
            }
        )
        
        # Check token_use claim (prefer 'access', but allow 'id' for backward compatibility)
        token_use = payload.get('token_use')
        if token_use not in ['id', 'access']:
            raise Exception(f'Invalid token_use: {token_use}')
        
        # Log warning if using ID token (not recommended for APIs)
        if token_use == 'id':
            logger.warning('Using ID token for API authorization. Consider using Access token instead.')
        
        # Check issuer
        if payload.get('iss') != COGNITO_ISSUER:
            raise Exception('Invalid issuer')
        
        # Verify client_id (for Access tokens) or aud (for ID tokens)
        if token_use == 'access':
            # Access tokens have 'client_id' instead of 'aud'
            client_id = payload.get('client_id')
            if client_id != APP_CLIENT_ID:
                raise Exception(f'Invalid client_id: {client_id}')
        else:
            # ID tokens have 'aud'
            aud = payload.get('aud')
            if aud != APP_CLIENT_ID:
                raise Exception(f'Invalid audience: {aud}')
        
        logger.info(f"Token verified successfully for user: {payload.get('sub')} (token_use: {token_use})")
        return payload
        
    except jwt.ExpiredSignatureError:
        logger.error('Token has expired')
        raise Exception('Token expired')
    except jwt.InvalidTokenError as e:
        logger.error(f'Invalid token: {str(e)}')
        raise Exception(f'Invalid token: {str(e)}')
    except Exception as e:
        logger.error(f'Token verification failed: {str(e)}')
        raise


def generate_policy(principal_id: str, effect: str, resource: str, context: Optional[Dict] = None) -> Dict:
    """
    Generate IAM policy for API Gateway
    
    Args:
        principal_id: User identifier
        effect: 'Allow' or 'Deny'
        resource: API Gateway resource ARN
        context: Additional context to pass to Lambda
        
    Returns:
        IAM policy document
    """
    policy = {
        'principalId': principal_id,
        'policyDocument': {
            'Version': '2012-10-17',
            'Statement': [
                {
                    'Action': 'execute-api:Invoke',
                    'Effect': effect,
                    'Resource': resource
                }
            ]
        }
    }
    
    if context:
        policy['context'] = context
    
    return policy


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict:
    """
    Lambda Authorizer handler
    
    Event structure:
    {
        "type": "TOKEN",
        "authorizationToken": "Bearer <token>",
        "methodArn": "arn:aws:execute-api:region:account:api-id/stage/method/resource"
    }
    """
    logger.info(f'Authorizer invoked with event: {json.dumps(event)}')
    
    try:
        # Extract token from event
        authorization_token = event.get('authorizationToken')
        method_arn = event.get('methodArn')
        
        if not authorization_token:
            logger.error('No authorization token provided')
            raise Exception('Unauthorized')
        
        # Extract token from Bearer format
        token = extract_token(authorization_token)
        if not token:
            logger.error('Invalid token format')
            raise Exception('Unauthorized')
        
        # Verify token
        payload = verify_token(token)
        
        # Extract user information
        user_id = payload.get('sub')
        token_use = payload.get('token_use', 'unknown')
        
        # Access tokens and ID tokens have different claims
        if token_use == 'access':
            # Access token claims
            username = payload.get('username', user_id)
            email = payload.get('email', '')
            # Access tokens may include scopes and groups
            scopes = payload.get('scope', '')
            groups = payload.get('cognito:groups', [])
        else:
            # ID token claims
            username = payload.get('cognito:username', payload.get('username', user_id))
            email = payload.get('email', '')
            scopes = ''
            groups = []
        
        # Build resource ARN pattern to allow all methods/resources
        # Format: arn:aws:execute-api:region:account:api-id/stage/*/*
        arn_parts = method_arn.split(':')
        api_gateway_arn_tmp = arn_parts[5].split('/')
        aws_account_id = arn_parts[4]
        region = arn_parts[3]
        api_id = api_gateway_arn_tmp[0]
        stage = api_gateway_arn_tmp[1]
        
        # Allow all methods and resources for this API/stage
        resource = f'arn:aws:execute-api:{region}:{aws_account_id}:{api_id}/{stage}/*/*'
        
        # Generate Allow policy with user context
        policy = generate_policy(
            principal_id=user_id,
            effect='Allow',
            resource=resource,
            context={
                'userId': user_id,
                'username': username,
                'email': email,
                'tokenUse': token_use,
                'scopes': scopes if token_use == 'access' else '',
                'groups': ','.join(groups) if groups else '',
            }
        )
        
        logger.info(f'Authorization successful for user: {user_id}')
        return policy
        
    except Exception as e:
        logger.error(f'Authorization failed: {str(e)}')
        # Return Deny policy or raise exception
        # Raising exception returns 401 Unauthorized
        raise Exception('Unauthorized')
