"""FastAPI application entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.voice import router as voice_router
from app.config import ensure_directories, settings
from app.errors import VoiceAssistantError
from app.services.speech_service import cleanup_expired_audio

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

APP_DIR = Path(__file__).resolve().parent

ensure_directories()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_directories()
    cleanup_expired_audio()
    logger.info(
        "Providers: transcription=%s llm=%s tts=%s",
        settings.resolved_transcription_provider(),
        settings.resolved_llm_provider(),
        settings.resolved_tts_provider(),
    )
    yield


app = FastAPI(
    title="AI Voice Assistant",
    description="College voice assistant: speech-to-text, LLM answers, and text-to-speech.",
    version="1.0.0",
    lifespan=lifespan,
)

if settings.cors_origin_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

app.include_router(voice_router)
app.mount("/static", StaticFiles(directory=APP_DIR / "static"), name="static")


@app.exception_handler(VoiceAssistantError)
async def handle_voice_error(_request: Request, exc: VoiceAssistantError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message}},
    )


@app.exception_handler(Exception)
async def handle_unexpected_error(_request: Request, exc: Exception) -> JSONResponse:
    if isinstance(exc, (StarletteHTTPException, RequestValidationError)):
        raise exc
    logger.exception("Unhandled server error")
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "internal_error",
                "message": "The server encountered an unexpected error. Try again.",
            }
        },
    )


@app.get("/live", response_class=HTMLResponse)
@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    # Render the template with simple replacement so Python 3.14 does not
    # hit a Jinja2 cache hashing bug (unhashable dict in the cache key).
    html = (APP_DIR / "templates" / "index.html").read_text(encoding="utf-8")
    html = html.replace("{{ max_duration }}", str(settings.max_audio_duration_seconds))
    html = html.replace("{{ max_size_mb }}", str(settings.max_audio_size_mb))
    return HTMLResponse(html)
