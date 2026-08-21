from typing import Dict, Any
from common import get_logger, log_request_metadata

logger = get_logger(__name__)

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Pre-signup Lambda trigger for Cognito
    Validates user registration before allowing signup
    """
    log_request_metadata(logger, context)
    
    try:
        # Extract user attributes
        user_attributes = event.get('request', {}).get('userAttributes', {})
        email = user_attributes.get('email', '')
        
        logger.info(f"Pre-signup validation for email: {email}")
        
        # Add any custom validation logic here
        # For example, check if email domain is allowed
        # if not is_email_domain_allowed(email):
        #     raise Exception("Email domain not allowed")
        
        # Don't auto-confirm user - they need to verify their email first
        event["response"]["autoConfirmUser"] = False
        event["response"]["autoVerifyEmail"] = False
        
        logger.info(f"Pre-signup validation passed for: {email}")
        return event
        
    except Exception as e:
        logger.error(f"Pre-signup validation failed: {str(e)}")
        # For Cognito triggers, we should raise an exception to prevent signup
        raise e