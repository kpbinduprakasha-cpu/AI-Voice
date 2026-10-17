# AI Voice Assistant

A college-focused voice assistant built with Python and FastAPI. You speak or upload audio, the backend transcribes it, a language model answers in simple English, and the reply is spoken back in the browser.

**Core pipeline**

User voice → audio upload → speech-to-text → system prompt + LLM → text-to-speech → audio playback → transcript and answer on screen.

This repository is the complete application. The workspace folder itself is the project root (you do not need a nested `ai-voice-assistant` folder if you already opened this directory).

## Architecture and data flow

1. The web page records audio with the browser `MediaRecorder` API, or you choose a file.
2. Nothing is uploaded until you click **Ask Assistant**.
3. `POST /api/voice` saves the upload under a random server-side name.
4. `transcribe_audio()` converts speech to text (OpenAI-compatible Whisper API or local faster-whisper).
5. `answer_from_text()` sends `SYSTEM_PROMPT` plus the transcript to an LLM (OpenAI-compatible chat API or local Ollama).
6. `generate_speech()` writes a unique MP3 or WAV file.
7. The API returns JSON: `transcript`, `answer`, `audio_url`.
8. The uploaded input file is deleted in a `finally` block. Generated replies stay on disk for a limited time so the player can load them.

```text
Validate input
    → transcribe
    → validate transcript
    → generate LLM answer
    → generate speech
    → return transcript, answer, audio URL
```

Cloud models and local models are **not** the same. A small Ollama model will be weaker than a hosted GPT model. Local `pyttsx3` voices sound more robotic than OpenAI or edge-tts neural voices.

## Folder structure

```text
ai-voice-assistant/
├── .env
├── .env.example
├── .gitignore
├── requirements.txt
├── README.md
├── app/
│   ├── main.py                 FastAPI app, homepage, error handlers
│   ├── config.py               Environment settings and provider resolution
│   ├── prompts.py              SYSTEM_PROMPT (edit this to change personality)
│   ├── errors.py               Safe application errors
│   ├── api/voice.py            /api/voice, /api/health, /api/audio/{filename}
│   ├── services/
│   │   ├── transcription.py    Speech-to-text
│   │   ├── llm_service.py      Language model
│   │   ├── speech_service.py   Text-to-speech and audio cleanup
│   │   └── voice_pipeline.py   End-to-end orchestration
│   ├── schemas/voice.py        JSON response models
│   ├── static/css|js|audio     Frontend assets
│   └── templates/index.html    Web UI
├── data/                       Uploads and generated audio (not committed)
└── tests/                      pytest coverage with mocked providers
```

## Required software

- Windows 10 or 11
- Python 3.10 or newer (this project was verified with the Python available on the machine)
- Visual Studio Code (optional)
- A microphone for live recording
- **One** of these AI setups:
  - An OpenAI-compatible API key, or
  - Local Ollama for the LLM, plus a local STT/TTS option

## Installation (Windows PowerShell)

Open PowerShell in this project folder:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
```

If PowerShell blocks script activation:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

Command Prompt alternative:

```cmd
.venv\Scripts\activate.bat
```

Edit `.env` and add credentials or local provider names. Then start the server:

```powershell
uvicorn app.main:app --reload
```

Open:

- App: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- Health: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)
- Interactive API docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

## Environment variables

| Variable | Purpose |
| --- | --- |
| `AI_PROVIDER` | Default hint: `openai`, `ollama`, `faster-whisper`, `pyttsx3`, `edge-tts` |
| `OPENAI_API_KEY` | Required for OpenAI-compatible cloud calls |
| `OPENAI_BASE_URL` | Defaults to OpenAI. Point this at Groq or another compatible server |
| `TRANSCRIPTION_PROVIDER` | `openai` or `faster-whisper` (blank inherits `AI_PROVIDER`) |
| `LLM_PROVIDER` | `openai` or `ollama` |
| `TTS_PROVIDER` | `openai`, `pyttsx3`, or `edge-tts` |
| `TRANSCRIPTION_MODEL` | Example: `whisper-1` |
| `LLM_MODEL` | Example: `gpt-4o-mini` |
| `TTS_MODEL` / `TTS_VOICE` | Cloud TTS model and voice |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | Local LLM |
| `MAX_AUDIO_SIZE_MB` | Upload cap (default 20) |
| `GENERATED_AUDIO_RETENTION_MINUTES` | How long reply audio is kept |
| `CORS_ORIGINS` | Leave empty for same-origin only |

Never put API keys in HTML or JavaScript. The browser only talks to this FastAPI app.

## Cloud and local configuration

### Cloud OpenAI-compatible (default)

```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-key
TRANSCRIPTION_MODEL=whisper-1
LLM_MODEL=gpt-4o-mini
TTS_MODEL=tts-1
TTS_VOICE=alloy
```

This is **not free**. OpenAI charges for Whisper, chat, and TTS. Check current prices on OpenAI’s website. Free trial credit, if any, is limited and expires. Groq and some other hosts offer a free tier with rate limits; you still must read that host’s terms and set `OPENAI_BASE_URL` plus their key.

### Local-friendly mix (no paid OpenAI key)

```env
AI_PROVIDER=ollama
TRANSCRIPTION_PROVIDER=faster-whisper
LLM_PROVIDER=ollama
TTS_PROVIDER=pyttsx3
OLLAMA_MODEL=llama3.2
FASTER_WHISPER_MODEL=base
```

Then:

```powershell
pip install faster-whisper
ollama pull llama3.2
```

`pyttsx3` uses the Windows SAPI voice and needs no API key. `edge-tts` is a separate optional package; it uses Microsoft Edge neural voices over the internet and is not an OpenAI product.

## API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Web interface |
| GET | `/api/health` | Provider status (no secrets) |
| POST | `/api/voice` | Upload audio, run the pipeline |
| GET | `/api/audio/{filename}` | Serve generated audio only |

Example success body:

```json
{
  "transcript": "What is artificial intelligence?",
  "answer": "Artificial intelligence helps computers perform tasks that normally require human intelligence.",
  "audio_url": "/api/audio/0123456789abcdef0123456789abcdef.mp3"
}
```

Errors look like this (no stack traces, no API keys):

```json
{
  "error": {
    "code": "transcription_failed",
    "message": "Transcription timed out. Try a shorter recording."
  }
}
```

## How to test voice input

1. Start `uvicorn`.
2. Allow microphone access, click **Start recording**, speak, click **Stop recording**.
3. Click **Ask Assistant**. Watch stages: Listening → Transcribing → Thinking → Generating Speech → Completed.
4. Confirm the transcript, the answer, and the audio player.
5. You can also upload a WAV or MP3 instead of recording.

Session history stays in `sessionStorage` only. Closing the tab clears it. There is no database in this version.

## Automated tests

Tests mock every AI provider. They do **not** make paid API calls.

```powershell
pytest -q
```

Optional real integration tests (manual, costs money or needs local models):

1. Put a real key or start Ollama.
2. Upload a short WAV through `/docs`.
3. Confirm a transcript, answer, and playable audio file.

## Output audio retention

Generated files live in `data/generated/`. They are not deleted immediately so the browser can play them. Files older than `GENERATED_AUDIO_RETENTION_MINUTES` (default 60) are removed on startup, health checks, and new voice requests. Do not treat this folder as a permanent archive.

Uploaded recordings in `data/uploads/` are deleted after each request, including failures.

## Security and privacy

- API keys stay on the server.
- Uploads are checked for extension, MIME type, and size.
- Filenames are random UUIDs. User filenames are not trusted.
- `/api/audio` only serves files that match a strict UUID pattern inside `data/generated/`.
- CORS is off unless you set `CORS_ORIGINS`.
- Logs do not print API keys or full recordings.
- Provider failures return an error. The app does not invent a fake answer.

## Common errors

| Symptom | What to try |
| --- | --- |
| `OPENAI_API_KEY is missing` | Add a key or switch to local providers |
| `Could not connect to Ollama` | Start Ollama and confirm `OLLAMA_BASE_URL` |
| Microphone permission denied | Allow access in the browser, or upload a file |
| Unsupported audio format | Use WAV, MP3, WEBM, OGG, or M4A |
| 413 audio too large | Shorten the recording or raise `MAX_AUDIO_SIZE_MB` |
| Empty transcript | Speak closer to the mic; avoid silent files |
| `faster-whisper is not installed` | `pip install faster-whisper` (may fail on some Python versions) |
| Virtualenv activation blocked | Use `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` |

## Module guide (simple English)

- `app/config.py` reads `.env` and decides which STT, LLM, and TTS providers to use.
- `app/prompts.py` holds the college-tutor instructions.
- `app/services/transcription.py` turns audio into text.
- `app/services/llm_service.py` asks the language model for an answer.
- `app/services/speech_service.py` turns that answer into a sound file.
- `app/services/voice_pipeline.py` runs those three steps in order and stops if one fails.
- `app/api/voice.py` is the HTTP layer: upload, JSON, audio download.
- `app/static/js/app.js` records audio, shows status, and plays the reply.

## Development workflow (how this project was built)

**Phase 1 — structure and configuration.** Created folders, `.env.example`, `config.py`, `requirements.txt`. Verify: the files exist and `python -c "from app.config import settings"` imports.

**Phase 2 — LLM service.** Implemented `answer_from_text`. Verify: unit tests with mocks, or a real Ollama/OpenAI call.

**Phase 3 — transcription.** Implemented `transcribe_audio`. Verify: mocked tests plus a real short WAV when a provider is configured.

**Phase 4 — TTS.** Implemented `generate_speech`. Verify: a WAV/MP3 appears under `data/generated/`.

**Phase 5 — `/api/voice` pipeline.** Wired upload → pipeline → JSON. Verify: TestClient tests and `/docs`.

**Phase 6 — recording UI.** Built `index.html`, CSS, and `app.js`. Verify: record, stop, then Ask Assistant.

**Phase 7 — security.** Size limits, UUID names, path traversal checks, cleanup, CORS default off.

**Phase 8 — tests and README.** `tests/test_voice.py`, `tests/test_pipeline.py`.

**Phase 9 — end-to-end.** Run pytest, start uvicorn, open the homepage.

## License and classroom use

Use this as a learning project. You are responsible for API bills, microphone consent, and any data you upload. Do not upload confidential recordings.
