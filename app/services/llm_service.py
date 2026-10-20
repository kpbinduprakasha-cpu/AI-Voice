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
    if provider == "gemini":
        answer = _answer_gemini(cleaned)
    elif provider == "openai":
        answer = _answer_openai(cleaned)
    elif provider == "ollama":
        answer = _answer_ollama(cleaned)
    else:
        raise ConfigurationError(
            f"Unsupported LLM provider '{provider}'. Use gemini, openai or ollama."
        )

    final = (answer or "").strip()
    if not final:
        raise LLMError("The language model returned an empty answer.")
    return final


def _answer_gemini(user_text: str) -> str:
    import os

    try:
        from google import genai
    except ImportError as exc:
        raise ConfigurationError(
            "google-genai is not installed. Run: pip install google-genai"
        ) from exc

    api_key = (
        settings.gemini_api_key.strip()
        or os.getenv("GEMINI_API_KEY", "").strip()
        or os.getenv("GOOGLE_API_KEY", "").strip()
    )

    try:
        client = genai.Client(api_key=api_key or None)
        interaction = client.interactions.create(
            model=settings.gemini_model or "gemini-3.8-flash",
            input=[
                {
                    "type": "text",
                    "text": f"{SYSTEM_PROMPT}\n\nStudent question: {user_text}",
                }
            ],
        )
        return str(interaction.output_text or "")
    except Exception as exc:
        raise LLMError(f"Google Gemini request failed: {exc}") from exc


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


def _ensure_ollama_started() -> bool:
    """Ensure Ollama daemon is active, starting it in the background if needed."""
    for test_url in ("http://127.0.0.1:11434", "http://localhost:11434"):
        try:
            r = httpx.get(test_url, timeout=1.0)
            if r.status_code == 200:
                return True
        except Exception:
            pass

    import shutil
    import subprocess
    import time

    ollama_bin = shutil.which("ollama")
    if not ollama_bin:
        return False

    try:
        subprocess.Popen(
            [ollama_bin, "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        for _ in range(8):
            time.sleep(0.5)
            try:
                r = httpx.get("http://127.0.0.1:11434", timeout=1.0)
                if r.status_code == 200:
                    return True
            except Exception:
                pass
    except Exception:
        pass
    return False


def _answer_ollama(user_text: str) -> str:
    candidate_urls = [
        settings.ollama_base_url.rstrip("/") + "/api/chat",
        "http://127.0.0.1:11434/api/chat",
        "http://localhost:11434/api/chat",
    ]
    seen = set()
    urls = [u for u in candidate_urls if not (u in seen or seen.add(u))]

    payload = {
        "model": settings.resolved_llm_model(),
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_text},
        ],
        "options": {
            "num_predict": 280,
            "temperature": 0.3,
        },
        "stream": False,
    }

    for attempt in range(2):
        for url in urls:
            try:
                response = httpx.post(url, json=payload, timeout=settings.request_timeout_seconds)
                response.raise_for_status()
                data = response.json()
                message = data.get("message") or {}
                content = message.get("content") or data.get("response") or ""
                return str(content)
            except httpx.ConnectError:
                continue
            except httpx.TimeoutException as exc:
                raise LLMError("The local Ollama model timed out. Try a smaller model or a shorter question.") from exc
            except httpx.HTTPStatusError as exc:
                raise LLMError(f"Ollama returned an error (status {exc.response.status_code}). Confirm model '{settings.resolved_llm_model()}' is pulled.") from exc
            except Exception as exc:
                raise LLMError(f"The local language model request failed: {exc}") from exc

        if attempt == 0:
            started = _ensure_ollama_started()
            if not started:
                break

    raise LLMError(
        "Could not connect to Ollama. Start Ollama locally ('ollama serve') or check OLLAMA_BASE_URL."
    )
