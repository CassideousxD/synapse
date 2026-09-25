from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal

from app.llm.client import NimError, call_nim
from app.core.security import require_client_secret
from fastapi import Depends

router = APIRouter(prefix="/llm", tags=["llm-proxy"])


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["system", "user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tier: Literal["fast", "main", "heavy"]
    messages: list[ChatMessage] = Field(min_length=1)
    temperature: float | None = None
    maxTokens: int | None = None


@router.post("/chat")
async def chat(req: ChatRequest, _client=Depends(require_client_secret)):
    """
    The ONLY place the NVIDIA_API_KEY is ever used. Never sent to, or
    readable by, the browser — the PWA only ever talks to this route.
    """
    try:
        result = await call_nim(
            req.tier,
            [m.model_dump() for m in req.messages],
            req.temperature,
            req.maxTokens,
        )
        return result
    except NimError as e:
        if e.status is not None:
            # Pass NVIDIA's own status through (429/5xx) so the client's
            # existing retry logic — tuned for exactly these codes — just works.
            status = e.status
        elif "timed out" in str(e):
            status = 504
        elif "no message content" in str(e):
            status = 502
        else:
            status = 500  # e.g. missing API key — a real server misconfig
        return JSONResponse(status_code=status, content={"detail": str(e)})
