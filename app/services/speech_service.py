"""Text-to-speech adapters and generated-audio cleanup."""

from __future__ import annotations

import asyncio
import re
import threading
import time
import uuid
from pathlib import Path

from openai import APIStatusError, APITimeoutError, AuthenticationError, OpenAI, RateLimitError

from app.config import GENERATED_AUDIO_DIR, ensure_directories, settings
from app.errors import ConfigurationError, SpeechError

_TTS_LOCK = threading.Lock()
_OPENAI_TTS_LIMIT = 4000


def generate_speech(text: str) -> Path:
    """Convert assistant text into an audio file and return its path."""
    settings.ensure_runtime_ready("tts")
    ensure_directories()
    cleaned = " ".join((text or "").split()).strip()
    if not cleaned:
        raise SpeechError("There is no text to convert to speech.", status_code=400, code="empty_tts_input")

    spoken = _prepare_spoken_text(cleaned)
    provider = settings.resolved_tts_provider()
    output_id = uuid.uuid4().hex

    if provider == "openai":
        path = GENERATED_AUDIO_DIR / f"{output_id}.mp3"
        _speak_openai(spoken, path)
    elif provider == "pyttsx3":
        path = GENERATED_AUDIO_DIR / f"{output_id}.wav"
        _speak_pyttsx3(spoken, path)
    elif provider == "edge-tts":
        path = GENERATED_AUDIO_DIR / f"{output_id}.mp3"
        _speak_edge_tts(spoken, path)
    else:
        raise ConfigurationError(
            f"Unsupported TTS provider '{provider}'. Use openai, pyttsx3, or edge-tts."
        )

    if not path.exists() or path.stat().st_size == 0:
        raise SpeechError("Speech was generated but the audio file is missing or empty.")
    return path


def audio_url_for(path: Path) -> str:
    return f"/api/audio/{path.name}"


def cleanup_expired_audio(now: float | None = None) -> int:
    """Delete generated audio older than the configured retention window."""
    ensure_directories()
    cutoff = (now or time.time()) - (settings.generated_audio_retention_minutes * 60)
    removed = 0
    for file_path in GENERATED_AUDIO_DIR.glob("*"):
        if not file_path.is_file():
            continue
        try:
            if file_path.stat().st_mtime < cutoff:
                file_path.unlink()
                removed += 1
        except OSError:
            continue
    return removed


def _prepare_spoken_text(text: str) -> str:
    spoken = re.sub(r"[#*_`]+", "", text)
    spoken = spoken.replace("http://", "").replace("https://", "")
    return spoken[:8000]


def _chunk_text(text: str, limit: int) -> list[str]:
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    remaining = text
    while remaining:
        if len(remaining) <= limit:
            chunks.append(remaining)
            break
        split_at = remaining.rfind(". ", 0, limit)
        if split_at < limit // 2:
            split_at = remaining.rfind(" ", 0, limit)
        if split_at < 1:
            split_at = limit
        chunks.append(remaining[:split_at].strip())
        remaining = remaining[split_at:].strip()
    return [chunk for chunk in chunks if chunk]


def _speak_openai(text: str, output_path: Path) -> None:
    client = OpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url or None,
        timeout=settings.request_timeout_seconds,
    )
    chunks = _chunk_text(text, _OPENAI_TTS_LIMIT)
    try:
        parts: list[bytes] = []
        for chunk in chunks:
            response = client.audio.speech.create(
                model=settings.tts_model,
                voice=settings.tts_voice or "alloy",
                input=chunk,
            )
            parts.append(response.content)
        output_path.write_bytes(b"".join(parts))
    except AuthenticationError as exc:
        raise SpeechError("Text-to-speech failed because the API key was rejected.") from exc
    except RateLimitError as exc:
        raise SpeechError("Text-to-speech failed because the provider rate limit was reached.") from exc
    except APITimeoutError as exc:
        raise SpeechError("Text-to-speech timed out.") from exc
    except APIStatusError as exc:
        raise SpeechError("The text-to-speech provider rejected the request. Check TTS_MODEL and TTS_VOICE.") from exc
    except Exception as exc:
        raise SpeechError("Text-to-speech generation failed.") from exc


def _speak_pyttsx3(text: str, output_path: Path) -> None:
    try:
        import pyttsx3
    except ImportError as exc:
        raise ConfigurationError("pyttsx3 is not installed. Run: pip install pyttsx3") from exc

    try:
        with _TTS_LOCK:
            engine = pyttsx3.init()
            engine.save_to_file(text, str(output_path))
            engine.runAndWait()
            engine.stop()
    except Exception as exc:
        raise SpeechError(
            "Local text-to-speech failed. On Windows, confirm the SAPI voice is installed."
        ) from exc


def _speak_edge_tts(text: str, output_path: Path) -> None:
    try:
        import edge_tts
    except ImportError as exc:
        raise ConfigurationError("edge-tts is not installed. Run: pip install edge-tts") from exc

    voice = settings.tts_voice or "en-US-JennyNeural"

    async def _save() -> None:
        communicate = edge_tts.Communicate(text, voice)
        await communicate.save(str(output_path))

    try:
        asyncio.run(_save())
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(_save())
        finally:
            loop.close()
    except Exception as exc:
        raise SpeechError(
            "edge-tts failed. This provider needs internet access and a valid Microsoft voice name."
        ) from exc
