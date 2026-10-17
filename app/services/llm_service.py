"""Language-model adapters for cloud APIs and local Ollama."""

from __future__ import annotations

import httpx
from openai import APIStatusError, APITimeoutError, AuthenticationError, OpenAI, RateLimitError

from app.config import settings
from app.errors import ConfigurationError, LLMError
from app.prompts import SYSTEM_PROMPT


def answer_from_text(user_text: str) -> str:
    """Generate an assistant reply from transcribed user text."""
    settings.ensure_runtime_ready("llm")
    cleaned = " ".join((user_text or "").split()).strip()
    if not cleaned:
        raise LLMError(
            "There is no question to answer because the transcript is empty.",
            status_code=400,
            code="empty_input",
        )

    provider = settings.resolved_llm_provider()
    if provider == "openai":
        answer = _answer_openai(cleaned)
    elif provider == "ollama":
        answer = _answer_ollama(cleaned)
    else:
        raise ConfigurationError(
            f"Unsupported LLM provider '{provider}'. Use openai or ollama."
        )

    final = " ".join(answer.split()).strip()
    if not final:
        raise LLMError("The language model returned an empty answer.")
    return final


def _answer_openai(user_text: str) -> str:
    client = OpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url or None,
        timeout=settings.request_timeout_seconds,
    )
    try:
        completion = client.chat.completions.create(
            model=settings.resolved_llm_model(),
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_text},
            ],
            temperature=0.4,
        )
    except AuthenticationError as exc:
        raise LLMError("The language model rejected the API key. Check OPENAI_API_KEY.") from exc
    except RateLimitError as exc:
        raise LLMError("The language model rate limit was reached. Try again later.") from exc
    except APITimeoutError as exc:
        raise LLMError("The language model timed out. Try a shorter question.") from exc
    except APIStatusError as exc:
        raise LLMError("The language model provider returned an error.") from exc
    except Exception as exc:
        raise LLMError("The language model request failed.") from exc

    try:
        content = completion.choices[0].message.content or ""
    except (AttributeError, IndexError) as exc:
        raise LLMError("The language model returned an unexpected response.") from exc
    return content


def _answer_ollama(user_text: str) -> str:
    url = settings.ollama_base_url.rstrip("/") + "/api/chat"
    payload = {
        "model": settings.resolved_llm_model(),
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_text},
        ],
        "stream": False,
    }
    try:
        response = httpx.post(url, json=payload, timeout=settings.request_timeout_seconds)
        response.raise_for_status()
        data = response.json()
    except httpx.ConnectError as exc:
        raise LLMError(
            "Could not connect to Ollama. Start Ollama locally or check OLLAMA_BASE_URL."
        ) from exc
    except httpx.TimeoutException as exc:
        raise LLMError("The local Ollama model timed out. Try a smaller model or a shorter question.") from exc
    except httpx.HTTPStatusError as exc:
        raise LLMError("Ollama returned an error. Confirm the model name is pulled.") from exc
    except Exception as exc:
        raise LLMError("The local language model request failed.") from exc

    message = data.get("message") or {}
    content = message.get("content") or data.get("response") or ""
    return str(content)
