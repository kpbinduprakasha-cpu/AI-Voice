"""Load and validate environment configuration."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
GENERATED_AUDIO_DIR = DATA_DIR / "generated"


class Settings(BaseSettings):
    """Application settings loaded from `.env` and process environment."""

    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ai_provider: str = "openai"

    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"

    transcription_provider: str = ""
    llm_provider: str = ""
    tts_provider: str = ""

    transcription_model: str = "whisper-1"
    transcription_language: str = "en"
    llm_model: str = "gpt-4o-mini"
    tts_model: str = "tts-1"
    tts_voice: str = "alloy"

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"

    faster_whisper_model: str = "base"
    faster_whisper_device: str = "cpu"

    max_audio_size_mb: float = 20
    max_audio_duration_seconds: int = 120
    request_timeout_seconds: float = 90
    generated_audio_retention_minutes: int = 60

    cors_origins: str = ""

    allowed_audio_extensions: tuple[str, ...] = Field(
        default=(".wav", ".mp3", ".webm", ".ogg", ".m4a", ".mp4", ".mpeg", ".mpga", ".flac")
    )

    @field_validator(
        "ai_provider",
        "transcription_provider",
        "llm_provider",
        "tts_provider",
        mode="before",
    )
    @classmethod
    def normalize_provider(cls, value: str) -> str:
        return str(value or "").strip().lower()

    @property
    def max_audio_bytes(self) -> int:
        return int(self.max_audio_size_mb * 1024 * 1024)

    @property
    def cors_origin_list(self) -> list[str]:
        if not self.cors_origins.strip():
            return []
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    def resolved_transcription_provider(self) -> str:
        return self.transcription_provider or self.ai_provider

    def resolved_llm_provider(self) -> str:
        provider = self.llm_provider or self.ai_provider
        if provider in {"faster-whisper", "pyttsx3", "edge-tts"}:
            return "openai"
        return provider

    def resolved_tts_provider(self) -> str:
        provider = self.tts_provider or self.ai_provider
        if provider in {"faster-whisper", "ollama"}:
            return "pyttsx3"
        return provider

    def resolved_llm_model(self) -> str:
        if self.resolved_llm_provider() == "ollama":
            return self.ollama_model or self.llm_model
        return self.llm_model

    def ensure_runtime_ready(self, stage: str) -> None:
        """Raise a clear configuration error for the requested pipeline stage."""
        from app.errors import ConfigurationError

        if stage == "transcription":
            provider = self.resolved_transcription_provider()
            if provider == "openai":
                self._require_openai()
                if not self.transcription_model:
                    raise ConfigurationError("TRANSCRIPTION_MODEL is not set.")
            elif provider == "faster-whisper":
                if not self.faster_whisper_model:
                    raise ConfigurationError("FASTER_WHISPER_MODEL is not set.")
            else:
                raise ConfigurationError(
                    f"Unsupported transcription provider '{provider}'. "
                    "Use openai or faster-whisper."
                )
        elif stage == "llm":
            provider = self.resolved_llm_provider()
            if provider == "openai":
                self._require_openai()
                if not self.llm_model:
                    raise ConfigurationError("LLM_MODEL is not set.")
            elif provider == "ollama":
                if not self.ollama_base_url:
                    raise ConfigurationError("OLLAMA_BASE_URL is not set.")
                if not (self.ollama_model or self.llm_model):
                    raise ConfigurationError("OLLAMA_MODEL or LLM_MODEL is not set.")
            else:
                raise ConfigurationError(
                    f"Unsupported LLM provider '{provider}'. Use openai or ollama."
                )
        elif stage == "tts":
            provider = self.resolved_tts_provider()
            if provider == "openai":
                self._require_openai()
                if not self.tts_model:
                    raise ConfigurationError("TTS_MODEL is not set.")
            elif provider in {"pyttsx3", "edge-tts"}:
                return
            else:
                raise ConfigurationError(
                    f"Unsupported TTS provider '{provider}'. Use openai, pyttsx3, or edge-tts."
                )
        else:
            raise ConfigurationError(f"Unknown configuration stage '{stage}'.")

    def _require_openai(self) -> None:
        from app.errors import ConfigurationError

        if not self.openai_api_key.strip():
            raise ConfigurationError(
                "OPENAI_API_KEY is missing. Set it in the .env file for OpenAI-compatible APIs, "
                "or switch to local providers (faster-whisper, ollama, pyttsx3)."
            )


def ensure_directories() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    GENERATED_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    static_audio = PROJECT_ROOT / "app" / "static" / "audio"
    static_audio.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    ensure_directories()
    return Settings()


settings = get_settings()
