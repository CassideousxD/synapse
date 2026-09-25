from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env from apps/api or repo root
root_env = Path(__file__).resolve().parents[3] / ".env"
if root_env.exists():
    load_dotenv(root_env)
else:
    load_dotenv()

from app.core.db import init_db
from app.routers import analytics, auth, classes, llm_proxy, notes, notifications, tests


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Synapse API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analytics.router)
app.include_router(llm_proxy.router)
app.include_router(auth.router)
app.include_router(classes.router)
app.include_router(notes.router)
app.include_router(tests.router)
app.include_router(notifications.router)


@app.get("/health")
def health():
    return {"ok": True}
