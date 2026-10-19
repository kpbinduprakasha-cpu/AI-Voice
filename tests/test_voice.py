"""HTTP tests for health, uploads, audio serving, and cleanup."""

from __future__ import annotations

import io
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.config import GENERATED_AUDIO_DIR, UPLOAD_DIR, ensure_directories
from app.main import app
from app.services.speech_service import cleanup_expired_audio

client = TestClient(app)


def _tiny_wav_bytes() -> bytes:
    # Minimal PCM WAV header + a few silent samples.
    return (
        b"RIFF$\x00\x00\x00WAVEfmt "
        b"\x10\x00\x00\x00\x01\x00\x01\x00"
        b"D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00"
        b"data\x00\x00\x00\x00"
    )


@pytest.fixture
def wav_file():
    return ("question.wav", io.BytesIO(_tiny_wav_bytes()), "audio/wav")


def test_homepage_renders():
    response = client.get("/")
    assert response.status_code == 200
    assert "AI Voice Assistant" in response.text
    assert "/static/js/app.js" in response.text


def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert "transcription_provider" in payload
    assert "llm_provider" in payload


def test_empty_upload_rejected():
    response = client.post(
        "/api/voice",
        files={"file": ("empty.wav", io.BytesIO(b""), "audio/wav")},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_audio"


def test_invalid_format_rejected():
    response = client.post(
        "/api/voice",
        files={"file": ("notes.txt", io.BytesIO(b"not audio"), "text/plain")},
    )
    assert response.status_code == 400
    assert "error" in response.json()


def test_oversized_upload_rejected():
    with patch("app.api.voice.settings.max_audio_size_mb", 0.00001):
        response = client.post(
            "/api/voice",
            files={"file": ("big.wav", io.BytesIO(b"0" * 64), "audio/wav")},
        )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "audio_too_large"


def test_valid_upload_with_mocked_pipeline(wav_file):
    fake = {
        "transcript": "What is artificial intelligence?",
        "answer": "Artificial intelligence helps computers perform tasks that normally require human intelligence.",
        "audio_url": "/api/audio/abcdabcdabcdabcdabcdabcdabcdabcd.mp3",
    }
    with patch("app.api.voice.process_voice_request", return_value=fake):
        response = client.post("/api/voice", files={"file": wav_file})
    assert response.status_code == 200
    body = response.json()
    assert body["transcript"].startswith("What is")
    assert body["audio_url"].startswith("/api/audio/")


def test_chat_endpoint_success():
    with patch("app.api.voice.answer_from_text", return_value="Gemini answered clearly."):
        response = client.post("/api/chat", json={"message": "Hello Gemini", "voice": False})
    assert response.status_code == 200
    data = response.json()
    assert data["transcript"] == "Hello Gemini"
    assert data["answer"] == "Gemini answered clearly."


def test_chat_endpoint_empty_input():
    response = client.post("/api/chat", json={"message": "   ", "voice": False})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "empty_input"


def test_temporary_upload_is_deleted(wav_file):
    ensure_directories()
    before = {path.name for path in UPLOAD_DIR.glob("*")}
    with patch(
        "app.api.voice.process_voice_request",
        return_value={"transcript": "hi", "answer": "hello", "audio_url": "/api/audio/x.wav"},
    ):
        response = client.post("/api/voice", files={"file": wav_file})
    assert response.status_code == 200
    after = {path.name for path in UPLOAD_DIR.glob("*")}
    assert after == before


def test_provider_failure_does_not_invent_answer(wav_file):
    from app.errors import LLMError

    with patch(
        "app.api.voice.process_voice_request",
        side_effect=LLMError("The language model request failed."),
    ):
        response = client.post("/api/voice", files={"file": wav_file})
    assert response.status_code == 502
    assert "invent" not in response.json()["error"]["message"].lower()
    assert response.json()["error"]["code"] == "llm_failed"


def test_audio_url_rejects_unsafe_filenames():
    denied = client.get("/api/audio/not-a-uuid.mp3")
    assert denied.status_code == 400
    assert denied.json()["error"]["code"] == "invalid_filename"

    traversal = client.get("/api/audio/..%2Fconfig.py")
    assert traversal.status_code in {400, 404}


def test_audio_url_serves_generated_file(tmp_path):
    ensure_directories()
    filename = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.wav"
    path = GENERATED_AUDIO_DIR / filename
    path.write_bytes(_tiny_wav_bytes())
    try:
        response = client.get(f"/api/audio/{filename}")
        assert response.status_code == 200
        assert response.content.startswith(b"RIFF")
    finally:
        path.unlink(missing_ok=True)


def test_missing_audio_returns_404():
    response = client.get("/api/audio/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.mp3")
    assert response.status_code == 404


def test_generated_audio_cleanup():
    ensure_directories()
    stale = GENERATED_AUDIO_DIR / "cccccccccccccccccccccccccccccccc.wav"
    stale.write_bytes(b"old")
    old_mtime = 1
    try:
        import os

        os.utime(stale, (old_mtime, old_mtime))
        removed = cleanup_expired_audio(now=10**12)
        assert removed >= 1
        assert not stale.exists()
    finally:
        stale.unlink(missing_ok=True)
