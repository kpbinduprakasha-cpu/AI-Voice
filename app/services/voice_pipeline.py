"""Orchestrate transcription, language-model answering, and speech."""

from __future__ import annotations

from pathlib import Path

from app.errors import AudioValidationError, LLMError
from app.schemas.voice import VoiceResponse
from app.services.llm_service import answer_from_text
from app.services.speech_service import audio_url_for, cleanup_expired_audio, generate_speech
from app.services.transcription import transcribe_audio


def process_voice_request(audio_path: Path) -> dict:
    """Run the complete voice pipeline and return a JSON-serializable result."""
    if audio_path is None:
        raise AudioValidationError("No audio path was provided.")

    path = Path(audio_path)
    cleanup_expired_audio()

    transcript = transcribe_audio(path)
    if not transcript.strip():
        raise LLMError(
            "The transcript is empty, so an answer cannot be generated.",
            status_code=422,
            code="empty_transcript",
        )

    answer = answer_from_text(transcript)
    speech_path = generate_speech(answer)
    response = VoiceResponse(
        transcript=transcript,
        answer=answer,
        audio_url=audio_url_for(speech_path),
    )
    return response.model_dump()
