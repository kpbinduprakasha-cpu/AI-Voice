"""Speech-to-text adapters."""

from __future__ import annotations

from pathlib import Path

from openai import APIStatusError, APITimeoutError, AuthenticationError, OpenAI, RateLimitError

from app.config import settings
from app.errors import AudioValidationError, ConfigurationError, TranscriptionError


def transcribe_audio(audio_path: Path) -> str:
    """Convert an audio file to a clean transcript string."""
    settings.ensure_runtime_ready("transcription")
    path = Path(audio_path)
    _validate_audio_file(path)

    provider = settings.resolved_transcription_provider()
    if provider == "openai":
        transcript = _transcribe_openai(path)
    elif provider == "faster-whisper":
        transcript = _transcribe_faster_whisper(path)
    else:
        raise ConfigurationError(
            f"Unsupported transcription provider '{provider}'. Use openai or faster-whisper."
        )

    cleaned = " ".join(transcript.split()).strip()
    if not cleaned:
        raise TranscriptionError(
            "The transcription was empty. Try recording again in a quieter place.",
            status_code=422,
            code="empty_transcript",
        )
    return cleaned


def _validate_audio_file(path: Path) -> None:
    if not path.exists() or not path.is_file():
        raise AudioValidationError("The audio file could not be found on the server.")
    size = path.stat().st_size
    if size == 0:
        raise AudioValidationError("The uploaded audio file is empty.")
    if size > settings.max_audio_bytes:
        raise AudioValidationError(
            f"The audio file exceeds the {settings.max_audio_size_mb:g} MB limit.",
            status_code=413,
            code="audio_too_large",
        )
    suffix = path.suffix.lower()
    if suffix not in settings.allowed_audio_extensions:
        raise AudioValidationError(
            f"Unsupported audio format '{suffix or 'unknown'}'. "
            "Use WAV, MP3, WEBM, OGG, M4A, or MP4."
        )


def _transcribe_openai(path: Path) -> str:
    client = OpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url or None,
        timeout=settings.request_timeout_seconds,
    )
    try:
        with path.open("rb") as audio_file:
            result = client.audio.transcriptions.create(
                model=settings.transcription_model,
                file=audio_file,
                language=settings.transcription_language or None,
            )
    except AuthenticationError as exc:
        raise TranscriptionError(
            "Transcription failed because the API key was rejected. Check OPENAI_API_KEY."
        ) from exc
    except RateLimitError as exc:
        raise TranscriptionError(
            "Transcription failed because the provider rate limit was reached. Try again later."
        ) from exc
    except APITimeoutError as exc:
        raise TranscriptionError("Transcription timed out. Try a shorter recording.") from exc
    except APIStatusError as exc:
        raise TranscriptionError("The transcription provider returned an error.") from exc
    except Exception as exc:
        raise TranscriptionError("Transcription failed. Check the audio format and provider settings.") from exc

    text = getattr(result, "text", None)
    if text is None and isinstance(result, dict):
        text = result.get("text")
    return str(text or "")


def _transcribe_faster_whisper(path: Path) -> str:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise ConfigurationError(
            "faster-whisper is not installed. Run: pip install faster-whisper"
        ) from exc

    try:
        model = WhisperModel(
            settings.faster_whisper_model,
            device=settings.faster_whisper_device,
            compute_type="int8" if settings.faster_whisper_device == "cpu" else "float16",
        )
        language = settings.transcription_language or None
        segments, _info = model.transcribe(str(path), language=language)
        parts = [segment.text for segment in segments]
        return " ".join(parts)
    except ConfigurationError:
        raise
    except Exception as exc:
        raise TranscriptionError(
            "Local transcription failed. Confirm the faster-whisper model downloaded correctly."
        ) from exc
