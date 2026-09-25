import os
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import UserRow, get_db
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


@router.post("/register/teacher", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
async def register_teacher(req: RegisterRequest, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    return await _register_user(req, role="teacher", db=db)


@router.post("/register/student", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
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
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    identifier = (req.email or req.username or "").strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="Email or username is required")

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