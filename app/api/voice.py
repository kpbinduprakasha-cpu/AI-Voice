"""Voice, health, and generated-audio HTTP endpoints."""

from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from app.config import GENERATED_AUDIO_DIR, UPLOAD_DIR, ensure_directories, settings
from app.errors import AudioTooLargeError, AudioValidationError, VoiceAssistantError
from app.schemas.voice import HealthResponse, VoiceResponse
from app.services.speech_service import cleanup_expired_audio
from app.services.voice_pipeline import process_voice_request

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

_SAFE_AUDIO_NAME = re.compile(r"^[a-fA-F0-9]{32}\.(mp3|wav|ogg)$")
_EXTENSION_BY_CONTENT_TYPE = {
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".mp4",
    "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/flac": ".flac",
    "video/webm": ".webm",
}


def error_response(exc: VoiceAssistantError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message}},
    )


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    cleanup_expired_audio()
    transcription = settings.resolved_transcription_provider()
    llm = settings.resolved_llm_provider()
    tts = settings.resolved_tts_provider()
    notes: list[str] = []
    openai_needed = "openai" in {transcription, llm, tts}
    if openai_needed and not settings.openai_api_key.strip():
        notes.append("OPENAI_API_KEY is not set. Cloud OpenAI-compatible calls will fail.")
    if llm == "ollama":
        notes.append("LLM uses Ollama. Local model quality depends on the pulled model.")
    if transcription == "faster-whisper":
        notes.append("Transcription uses faster-whisper. The first run downloads a model.")
    if tts == "pyttsx3":
        notes.append("TTS uses the local system voice. Quality is lower than neural cloud voices.")
    if tts == "edge-tts":
        notes.append("TTS uses edge-tts. It needs internet access and is not a paid OpenAI API.")
    return HealthResponse(
        status="ok",
        transcription_provider=transcription,
        llm_provider=llm,
        tts_provider=tts,
        llm_model=settings.resolved_llm_model(),
        transcription_model=(
            settings.faster_whisper_model
            if transcription == "faster-whisper"
            else settings.transcription_model
        ),
        tts_model=settings.tts_model if tts == "openai" else tts,
        max_audio_size_mb=settings.max_audio_size_mb,
        generated_audio_retention_minutes=settings.generated_audio_retention_minutes,
        openai_configured=bool(settings.openai_api_key.strip()),
        notes=notes,
    )


@router.post("/voice", response_model=VoiceResponse)
async def create_voice_response(file: UploadFile = File(...)) -> VoiceResponse | JSONResponse:
    ensure_directories()
    cleanup_expired_audio()
    temp_path: Path | None = None
    try:
        temp_path = await _save_upload(file)
        result = process_voice_request(temp_path)
        return VoiceResponse(**result)
    except VoiceAssistantError as exc:
        logger.warning("Voice request failed: %s", exc.code)
        return error_response(exc)
    except Exception:
        logger.exception("Unexpected voice pipeline failure")
        return error_response(
            VoiceAssistantError("The voice request failed. Try again with a shorter recording.")
        )
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                logger.warning("Could not delete temporary upload %s", temp_path.name)


@router.get("/audio/{filename}")
def get_generated_audio(filename: str):
    if not _SAFE_AUDIO_NAME.match(filename):
        return error_response(
            VoiceAssistantError(
                "Invalid audio filename.",
                status_code=400,
                code="invalid_filename",
            )
        )

    ensure_directories()
    audio_root = GENERATED_AUDIO_DIR.resolve()
    requested = (GENERATED_AUDIO_DIR / filename).resolve()
    if not str(requested).startswith(str(audio_root)):
        return error_response(
            VoiceAssistantError("Access to that file is not allowed.", status_code=403, code="forbidden")
        )
    if not requested.is_file():
        return error_response(
            VoiceAssistantError("The generated audio file was not found.", status_code=404, code="not_found")
        )

    media_type = "audio/mpeg" if requested.suffix == ".mp3" else "audio/wav"
    return FileResponse(requested, media_type=media_type, filename=requested.name)


async def _save_upload(upload: UploadFile) -> Path:
    original_name = upload.filename or "recording.webm"
    suffix = Path(original_name).suffix.lower()
    content_type = (upload.content_type or "").split(";")[0].strip().lower()

    if suffix not in settings.allowed_audio_extensions:
        suffix = _EXTENSION_BY_CONTENT_TYPE.get(content_type, "")
    if suffix not in settings.allowed_audio_extensions:
        raise AudioValidationError(
            "Unsupported audio format. Record in the browser or upload WAV, MP3, WEBM, OGG, or M4A."
        )

    max_bytes = int(settings.max_audio_size_mb * 1024 * 1024)
    destination = UPLOAD_DIR / f"{uuid.uuid4().hex}{suffix}"
    total = 0
    try:
        with destination.open("wb") as buffer:
            while True:
                chunk = await upload.read(1024 * 64)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise AudioTooLargeError(
                        f"The audio file exceeds the {settings.max_audio_size_mb:g} MB limit."
                    )
                buffer.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()

    if total == 0:
        destination.unlink(missing_ok=True)
        raise AudioValidationError("The uploaded audio file is empty.")
    return destination
