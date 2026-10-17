"""Application errors that map to safe HTTP responses."""


class VoiceAssistantError(Exception):
    """Base error for expected application failures."""

    status_code = 500
    code = "internal_error"

    def __init__(self, message: str, *, status_code: int | None = None, code: str | None = None):
        super().__init__(message)
        self.message = message
        if status_code is not None:
            self.status_code = status_code
        if code is not None:
            self.code = code


class ConfigurationError(VoiceAssistantError):
    status_code = 503
    code = "configuration_error"


class AudioValidationError(VoiceAssistantError):
    status_code = 400
    code = "invalid_audio"


class AudioTooLargeError(VoiceAssistantError):
    status_code = 413
    code = "audio_too_large"


class TranscriptionError(VoiceAssistantError):
    status_code = 502
    code = "transcription_failed"


class LLMError(VoiceAssistantError):
    status_code = 502
    code = "llm_failed"


class SpeechError(VoiceAssistantError):
    status_code = 502
    code = "tts_failed"
