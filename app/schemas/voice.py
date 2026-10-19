"""Request and response models for the voice API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class VoiceResponse(BaseModel):
    transcript: str
    answer: str
    audio_url: str


class ChatRequest(BaseModel):
    message: str
    voice: bool = True


class ChatResponse(BaseModel):
    transcript: str
    answer: str
    audio_url: str = ""


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail


class HealthResponse(BaseModel):
    status: str = "ok"
    transcription_provider: str
    llm_provider: str
    tts_provider: str
    llm_model: str
    transcription_model: str
    tts_model: str
    max_audio_size_mb: float
    generated_audio_retention_minutes: int
    openai_configured: bool
    gemini_configured: bool = False
    notes: list[str] = Field(default_factory=list)
