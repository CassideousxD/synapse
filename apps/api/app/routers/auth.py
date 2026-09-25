import os
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import UserRow, get_db
from app.core.rate_limit import (
    check_rate_limit_without_increment,
    extract_client_ip,
    get_limit_config,
    hash_identifier,
    rate_limit,
    record_failed_login,
)
from app.core.security import (
    create_access_token,
    hash_password,
    require_user,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class UserResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    email: str
    role: Literal["teacher", "student"]


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    email: str
    password: str
    rememberMe: bool = False


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    username: str | None = None
    email: str | None = None
    password: str
    rememberMe: bool = False


class LoginResponse(BaseModel):
    accessToken: str
    tokenType: str = "bearer"
    user: UserResponse | None = None


@router.post(
    "/register/teacher",
    response_model=LoginResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[
        Depends(
            rate_limit(
                "synapse:rl:auth:register",
                limit=get_limit_config("RATE_LIMIT_AUTH_PER_MINUTE", 5),
                window=60,
                key_extractor=lambda req: hash_identifier(extract_client_ip(req)),
            )
        )
    ],
)
async def register_teacher(req: RegisterRequest, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    return await _register_user(req, role="teacher", db=db)


@router.post(
    "/register/student",
    response_model=LoginResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[
        Depends(
            rate_limit(
                "synapse:rl:auth:register",
                limit=get_limit_config("RATE_LIMIT_AUTH_PER_MINUTE", 5),
                window=60,
                key_extractor=lambda req: hash_identifier(extract_client_ip(req)),
            )
        )
    ],
)
async def register_student(req: RegisterRequest, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    return await _register_user(req, role="student", db=db)


async def _register_user(req: RegisterRequest, role: Literal["teacher", "student"], db: AsyncSession) -> LoginResponse:
    email = req.email.strip().lower()
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    if not email:
        raise HTTPException(status_code=400, detail="Email cannot be empty")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    existing = await db.scalar(select(UserRow).where(UserRow.email == email))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists")

    user_id = f"u-{uuid.uuid4().hex[:12]}"
    user = UserRow(
        id=user_id,
        name=name,
        email=email,
        password_hash=hash_password(req.password),
        role=role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    user_resp = UserResponse(id=user.id, name=user.name, email=user.email, role=user.role)
    expiry = 60 * 60 * 24 * 30 if req.rememberMe else 60 * 60 * 2
    token = create_access_token(subject=user.id, role=user.role, expires_delta_seconds=expiry)
    return LoginResponse(accessToken=token, tokenType="bearer", user=user_resp)


@router.post("/login", response_model=LoginResponse)
async def login(
    req: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    identifier = (req.email or req.username or "").strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="Email or username is required")

    client_ip = extract_client_ip(request)
    limit = get_limit_config("RATE_LIMIT_AUTH_PER_MINUTE", 5)
    hashed_login_key = hash_identifier(f"{identifier}:{client_ip}")
    lockout_key = f"synapse:rl:auth:login:{hashed_login_key}"

    # Check if currently locked out due to prior failed attempts
    pre_check = await check_rate_limit_without_increment(lockout_key, limit=limit)
    if not pre_check.allowed:
        pre_check.set_headers(response)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded",
            headers={
                "Retry-After": str(pre_check.retry_after),
                "X-RateLimit-Limit": str(pre_check.limit),
                "X-RateLimit-Remaining": str(pre_check.remaining),
                "X-RateLimit-Reset": str(pre_check.reset),
            },
        )

    expiry = 60 * 60 * 24 * 30 if req.rememberMe else 60 * 60 * 2

    # 1. Look up in DB
    user = await db.scalar(
        select(UserRow).where(
            or_(
                UserRow.email == identifier.lower(),
                UserRow.name == identifier,
            )
        )
    )

    if user:
        if not verify_password(req.password, user.password_hash):
            fail_res = await record_failed_login(identifier, client_ip)
            fail_res.set_headers(response)
            if not fail_res.allowed:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Rate limit exceeded",
                    headers={
                        "Retry-After": str(fail_res.retry_after),
                        "X-RateLimit-Limit": str(fail_res.limit),
                        "X-RateLimit-Remaining": str(fail_res.remaining),
                        "X-RateLimit-Reset": str(fail_res.reset),
                    },
                )
            raise HTTPException(status_code=401, detail="Invalid username or password")

        token = create_access_token(subject=user.id, role=user.role, expires_delta_seconds=expiry)
        return LoginResponse(
            accessToken=token,
            tokenType="bearer",
            user=UserResponse(id=user.id, name=user.name, email=user.email, role=user.role),
        )

    # 2. Check legacy environment teacher (backward compatibility)
    expected_username = os.environ.get("TEACHER_USERNAME", "")
    expected_hash = os.environ.get("TEACHER_PASSWORD_HASH", "")

    if expected_username and expected_hash:
        if identifier == expected_username and verify_password(req.password, expected_hash):
            return LoginResponse(
                accessToken=create_access_token(subject=expected_username, role="teacher"),
                tokenType="bearer",
                user=UserResponse(
                    id="t-legacy",
                    name="Teacher",
                    email=f"{expected_username}@synapse.internal",
                    role="teacher",
                ),
            )

    fail_res = await record_failed_login(identifier, client_ip)
    fail_res.set_headers(response)
    if not fail_res.allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded",
            headers={
                "Retry-After": str(fail_res.retry_after),
                "X-RateLimit-Limit": str(fail_res.limit),
                "X-RateLimit-Remaining": str(fail_res.remaining),
                "X-RateLimit-Reset": str(fail_res.reset),
            },
        )
    raise HTTPException(status_code=401, detail="Invalid username or password")


@router.get("/me", response_model=UserResponse)
async def get_me(token_payload: dict = Depends(require_user), db: AsyncSession = Depends(get_db)) -> UserResponse:
    sub = token_payload.get("sub", "")
    user = await db.scalar(select(UserRow).where(or_(UserRow.id == sub, UserRow.email == sub.lower())))
    if user:
        return UserResponse(id=user.id, name=user.name, email=user.email, role=user.role)

    # Legacy teacher fallback
    expected_username = os.environ.get("TEACHER_USERNAME", "")
    if sub and (sub == expected_username or sub == "teacher1"):
        return UserResponse(
            id="t-legacy",
            name="Teacher",
            email=f"{sub}@synapse.internal",
            role="teacher",
        )

    raise HTTPException(status_code=404, detail="User not found")