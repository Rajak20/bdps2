"""
Authentication middleware for BDPS.
 
Verifies the Supabase-issued JWT sent by the frontend in the
Authorization: Bearer <token> header, and attaches the caller's
profile (id, email, role) to flask.g.user for the duration of the request.
 
Two decorators are provided:
    @login_required   - any authenticated, active user
    @admin_required    - authenticated user with role == 'admin'
"""
from functools import wraps
from flask import request, jsonify, g
# import jwt
# import os
 
 
class AuthError(Exception):
    def __init__(self, message, status_code=401):
        self.message = message
        self.status_code = status_code
 
 
def _extract_token():
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        raise AuthError('Missing or malformed Authorization header')
    return auth_header.split(' ', 1)[1].strip()
 
 
# def _verify_token(token):
#     secret = os.getenv('SUPABASE_JWT_SECRET')
#     if not secret:
#         raise AuthError('Server misconfigured: SUPABASE_JWT_SECRET not set in .env', 500)
#     try:
#         payload = jwt.decode(
#             token,
#             secret,
#             algorithms=['HS256'],
#             audience='authenticated'
#         )
#         return payload
#     except jwt.ExpiredSignatureError:
#         raise AuthError('Session expired, please log in again')
#     except jwt.InvalidTokenError as e:
#         raise AuthError(f'Invalid token: {str(e)}')
 
 
# def get_current_user(supabase_client):
#     """
#     Verifies the bearer token and fetches the caller's profile row.
#     Returns a dict: {id, email, full_name, role, is_active}
#     Raises AuthError on any failure.
#     """
#     token = _extract_token()
#     payload = _verify_token(token)
#     user_id = payload.get('sub')
#     if not user_id:
#         raise AuthError('Token missing subject claim')
 
#     response = supabase_client.table('profiles').select('*').eq('id', user_id).execute()
#     if not response.data:
#         raise AuthError('No profile found for this account', 404)
 
#     profile = response.data[0]
#     if not profile.get('is_active', True):
#         raise AuthError('This account has been deactivated', 403)
 
#     return profile


def get_current_user(supabase_client):
    token = _extract_token()

    try:
        user_response = supabase_client.auth.get_user(token)

        if not user_response.user:
            raise AuthError("Invalid or expired token")

        user = user_response.user

        response = (
            supabase_client
            .table("profiles")
            .select("*")
            .eq("id", user.id)
            .execute()
        )

        if not response.data:
            raise AuthError("No profile found", 404)

        profile = response.data[0]

        if not profile.get("is_active", True):
            raise AuthError("This account has been deactivated", 403)

        return profile

    except Exception as e:
        raise AuthError(str(e))
    


 
 
def login_required(supabase_client_getter):
    """
    Decorator factory. Usage:
        @app.route(...)
        @login_required(lambda: supabase)
        def my_view():
            user = g.user
            ...
    """
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            try:
                g.user = get_current_user(supabase_client_getter())
            except AuthError as e:
                return jsonify({'error': e.message}), e.status_code
            return f(*args, **kwargs)
        return wrapper
    return decorator
 
 
def admin_required(supabase_client_getter):
    """
    Decorator factory requiring role == 'admin'. Usage identical to login_required.
    """
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            try:
                user = get_current_user(supabase_client_getter())
            except AuthError as e:
                return jsonify({'error': e.message}), e.status_code
            if user.get('role') != 'admin':
                return jsonify({'error': 'Admin access required'}), 403
            g.user = user
            return f(*args, **kwargs)
        return wrapper
    return decorator