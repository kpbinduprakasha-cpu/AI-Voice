"""Unit tests for transcription, LLM, TTS, and the voice pipeline."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.config import Settings
from app.errors import AudioValidationError, LLMError, SpeechError, TranscriptionError
from app.services import llm_service, speech_service, transcription, voice_pipeline


def _write_wav(path: Path) -> Path:
    path.write_bytes(
        b"RIFF$\x00\x00\x00WAVEfmt "
        b"\x10\x00\x00\x00\x01\x00\x01\x00"
        b"D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00"
        b"data\x00\x00\x00\x00"
    )
    return path


def _skip_runtime_check(_self, _stage: str) -> None:
    return None


def test_transcribe_audio_success(tmp_path):
    audio = _write_wav(tmp_path / "clip.wav")
    with (
        patch.object(Settings, "ensure_runtime_ready", _skip_runtime_check),
        patch.object(Settings, "resolved_transcription_provider", return_value="openai"),
        patch.object(transcription, "_transcribe_openai", return_value="  What is AI?  "),
    ):
        assert transcription.transcribe_audio(audio) == "What is AI?"


def test_transcribe_audio_failure(tmp_path):
    audio = _write_wav(tmp_path / "clip.wav")
    with (
        patch.object(Settings, "ensure_runtime_ready", _skip_runtime_check),
        patch.object(Settings, "resolved_transcription_provider", return_value="openai"),
        patch.object(transcription, "_transcribe_openai", side_effect=TranscriptionError("failed")),
    ):
        with pytest.raises(TranscriptionError):
            transcription.transcribe_audio(audio)


def test_transcribe_rejects_missing_file(tmp_path):
    with patch.object(Settings, "ensure_runtime_ready", _skip_runtime_check):
        with pytest.raises(AudioValidationError):
            transcription.transcribe_audio(tmp_path / "missing.wav")


def test_answer_from_text_success():
    with (
        patch.object(Settings, "ensure_runtime_ready", _skip_runtime_check),
        patch.object(Settings, "resolved_llm_provider", return_value="openai"),
        patch.object(llm_service, "_answer_openai", return_value="AI helps computers learn patterns."),
    ):
        assert "computers" in llm_service.answer_from_text("What is AI?")


def test_answer_from_text_empty_input():
    with patch.object(Settings, "ensure_runtime_ready", _skip_runtime_check):
        with pytest.raises(LLMError):
            llm_service.answer_from_text("   ")


def test_answer_from_text_failure():
    with (
        patch.object(Settings, "ensure_runtime_ready", _skip_runtime_check),
        patch.object(Settings, "resolved_llm_provider", return_value="openai"),
        patch.object(llm_service, "_answer_openai", side_effect=LLMError("provider down")),
    ):
        with pytest.raises(LLMError):
            llm_service.answer_from_text("Explain recursion.")


def test_generate_speech_success(tmp_path):
    def fake_speak(_text, path):
        path.write_bytes(b"RIFF-data")

    with (
        patch.object(Settings, "ensure_runtime_ready", _skip_runtime_check),
        patch.object(Settings, "resolved_tts_provider", return_value="pyttsx3"),
        patch("app.services.speech_service.GENERATED_AUDIO_DIR", tmp_path),
        patch.object(speech_service, "ensure_directories"),
        patch.object(speech_service, "_speak_pyttsx3", side_effect=fake_speak),
    ):
        result = speech_service.generate_speech("Hello students")
    assert result.exists()
    assert result.suffix == ".wav"


def test_generate_speech_failure():
    with (
        patch.object(Settings, "ensure_runtime_ready", _skip_runtime_check),
        patch.object(Settings, "resolved_tts_provider", return_value="openai"),
        patch.object(speech_service, "_speak_openai", side_effect=SpeechError("tts failed")),
    ):
        with pytest.raises(SpeechError):
            speech_service.generate_speech("Hello")


def test_full_pipeline_with_mocked_services(tmp_path):
    audio = _write_wav(tmp_path / "input.wav")
    spoken = tmp_path / "out.mp3"
    spoken.write_bytes(b"ID3")
    with (
        patch.object(voice_pipeline, "cleanup_expired_audio"),
        patch.object(voice_pipeline, "transcribe_audio", return_value="What is a linked list?"),
        patch.object(voice_pipeline, "answer_from_text", return_value="A linked list stores items in nodes."),
        patch.object(voice_pipeline, "generate_speech", return_value=spoken),
    ):
        result = voice_pipeline.process_voice_request(audio)
    assert result["transcript"] == "What is a linked list?"
    assert "nodes" in result["answer"]
    assert result["audio_url"].endswith("out.mp3")


def test_pipeline_stops_when_transcription_fails(tmp_path):
    audio = _write_wav(tmp_path / "input.wav")
    llm = MagicMock()
    tts = MagicMock()
    with (
        patch.object(voice_pipeline, "cleanup_expired_audio"),
        patch.object(voice_pipeline, "transcribe_audio", side_effect=TranscriptionError("bad audio")),
        patch.object(voice_pipeline, "answer_from_text", llm),
        patch.object(voice_pipeline, "generate_speech", tts),
    ):
        with pytest.raises(TranscriptionError):
            voice_pipeline.process_voice_request(audio)
    llm.assert_not_called()
    tts.assert_not_called()
