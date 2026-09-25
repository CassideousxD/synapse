import os
import secrets
import time

import bcrypt
import jwt
from fastapi import HTTPException, Request, status

JWT_ALGORITHM = "HS256"
DEFAULT_JWT_EXPIRY_SECONDS = 60 * 60 * 12  # 12h


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(
    subject: str,
    role: str = "teacher",
    expires_delta_seconds: int | None = None,
) -> str:
    secret = os.environ.get("JWT_SECRET", "")
    if not secret:
        raise RuntimeError("JWT_SECRET not set")
    if expires_delta_seconds is not None:
        expiry = expires_delta_seconds
    else:
        expiry = int(os.environ.get("JWT_EXPIRY_SECONDS", str(DEFAULT_JWT_EXPIRY_SECONDS)))
    now = int(time.time())
    payload = {"sub": subject, "role": role, "iat": now, "exp": now + expiry}
    return jwt.encode(payload, secret, algorithm=JWT_ALGORITHM)


def _bearer_token(request: Request) -> str:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return header[7:]


def get_token_payload(request: Request) -> dict:
    token = _bearer_token(request)
    secret = os.environ.get("JWT_SECRET", "")
    if not secret:
        raise HTTPException(status_code=500, detail="Server misconfigured: JWT_SECRET not set")
    try:
        payload = jwt.decode(token, secret, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired", headers={"WWW-Authenticate": "Bearer"})
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token", headers={"WWW-Authenticate": "Bearer"})
    return payload


def require_user(request: Request) -> dict:
    """FastAPI dependency: valid, unexpired JWT -> returns decoded token payload."""
    return get_token_payload(request)


def require_teacher(request: Request) -> str:
    """FastAPI dependency: valid, unexpired teacher JWT -> returns the subject (username/id)."""
    payload = get_token_payload(request)
    role = payload.get("role", "teacher")
    if role != "teacher":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher role required")
    return payload["sub"]


def require_student(request: Request) -> str:
    """FastAPI dependency: valid, unexpired student JWT -> returns the subject (username/id)."""
    payload = get_token_payload(request)
    role = payload.get("role")
    if role != "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student role required")
    return payload["sub"]


def require_client_secret(request: Request) -> None:
    """
    FastAPI dependency for the anonymous student PWA: proves 'this is our
    client', not who the student is. Real per-student auth is Phase 8.
    """
    expected = os.environ.get("SYNAPSE_CLIENT_SECRET", "")
    token = _bearer_token(request)
    if not expected or not secrets.compare_digest(token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid client secret",
            headers={"WWW-Authenticate": "Bearer"},
        )