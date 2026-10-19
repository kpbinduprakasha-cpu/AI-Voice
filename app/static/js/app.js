(() => {
  // DOM Elements
  const welcomeHero = document.getElementById("welcomeHero");
  const messagesThread = document.getElementById("messagesThread");
  const textInput = document.getElementById("textInput");
  const micBtn = document.getElementById("micBtn");
  const liveVoiceBtn = document.getElementById("liveVoiceBtn");
  const thinkBtn = document.getElementById("thinkBtn");
  const audioFileInput = document.getElementById("audioFileInput");
  const recordingHud = document.getElementById("recordingHud");
  const recordingTimer = document.getElementById("recordingTimer");
  const cancelRecordingBtn = document.getElementById("cancelRecordingBtn");
  const finishRecordingBtn = document.getElementById("finishRecordingBtn");
  const errorToast = document.getElementById("errorToast");
  const errorMessage = document.getElementById("errorMessage");
  const toastClose = document.getElementById("toastClose");
  const providerName = document.getElementById("providerName");
  const providerBadge = document.getElementById("providerBadge");
  const clearChatChip = document.getElementById("clearChatChip");
  const suggestionChips = document.getElementById("suggestionChips");
  const audioPlayer = document.getElementById("audioPlayer");

  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;
  let timerInterval = null;
  let recordSeconds = 0;
  let isThinking = false;
  let isBusy = false;
  let activeAudioBtn = null;
  let isLiveVoiceMode = false;

  // Session Chat History
  const chatHistory = JSON.parse(sessionStorage.getItem("chatHistory") || "[]");

  // Initialize
  init();

  function init() {
    renderHistory();
    checkHealth();

    // Event Listeners
    textInput.addEventListener("keydown", handleTextKeydown);
    textInput.addEventListener("input", autoResizeTextarea);
    micBtn.addEventListener("click", toggleRecording);
    liveVoiceBtn.addEventListener("click", handleLiveVoiceClick);
    thinkBtn.addEventListener("click", toggleThinkMode);
    cancelRecordingBtn.addEventListener("click", cancelRecording);
    finishRecordingBtn.addEventListener("click", finishRecording);
    audioFileInput.addEventListener("change", handleFileSelected);
    toastClose.addEventListener("click", hideError);
    clearChatChip.addEventListener("click", clearConversation);

    // Audio player event listeners to reset play/stop buttons
    audioPlayer.addEventListener("ended", onAudioFinished);
    audioPlayer.addEventListener("pause", onAudioFinished);

    // Suggestion chips
    document.querySelectorAll(".chip[data-prompt]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const prompt = chip.getAttribute("data-prompt");
        textInput.value = prompt + " ";
        textInput.focus();
        autoResizeTextarea();
      });
    });
  }

  // Auto-resize textarea
  function autoResizeTextarea() {
    textInput.style.height = "auto";
    textInput.style.height = Math.min(textInput.scrollHeight, 160) + "px";
  }

  // Health check
  async function checkHealth() {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error("Health check failed");
      const data = await res.json();

      let displayName = "K P Air";
      if (data.llm_provider === "gemini") {
        displayName = "K P Air (Gemini)";
      } else if (data.llm_provider === "ollama") {
        displayName = `K P Air (${data.llm_model})`;
      } else if (data.llm_provider === "openai") {
        displayName = "K P Air (OpenAI)";
      }

      providerName.textContent = displayName;
      if (data.notes && data.notes.length > 0) {
        providerBadge.title = data.notes.join("\n");
      }
    } catch {
      providerName.textContent = "Offline";
      const dot = providerBadge.querySelector(".status-dot");
      if (dot) dot.classList.add("warn");
    }
  }

  // Toggle Think mode
  function toggleThinkMode() {
    isThinking = !isThinking;
    thinkBtn.classList.toggle("active", isThinking);
  }

  // Handle Enter key for sending text message
  function handleTextKeydown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const message = textInput.value.trim();
      if (!message || isBusy) return;
      sendTextMessage(message);
    }
  }

  // Send typed text message
  async function sendTextMessage(message) {
    isBusy = true;
    hideError();
    stopAudio();
    textInput.value = "";
    autoResizeTextarea();

    // Append user message immediately
    appendMessage("user", message);
    const assistantBubble = appendLoadingMessage();

    try {
      const fullPrompt = isThinking ? `[Think deeply and reason step-by-step]\n${message}` : message;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: fullPrompt, voice: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data.error && data.error.message) || "Request failed");
      }

      updateAssistantMessage(assistantBubble, data.answer, data.audio_url);
      saveChatTurn(message, data.answer, data.audio_url);

      // In typed chat mode, we do NOT force auto-play so user can read quietly or click Listen
      if (isLiveVoiceMode && data.audio_url) {
        playAudio(data.audio_url, assistantBubble.querySelector(".play-audio-btn"));
      }
    } catch (err) {
      removeLoadingMessage(assistantBubble);
      showError(err.message || "Failed to get response");
    } finally {
      isBusy = false;
    }
  }

  // Live Voice Button: handles start voice / stop voice / stop playback
  function handleLiveVoiceClick() {
    // If audio is currently playing, clicking blue button immediately stops voice!
    if (!audioPlayer.paused && audioPlayer.src) {
      stopAudio();
      return;
    }

    // If currently recording, finish and send
    if (isRecording) {
      finishRecording();
      return;
    }

    // Otherwise, start live voice recording
    isLiveVoiceMode = true;
    startRecording();
  }

  // Voice Recording Logic
  async function toggleRecording() {
    // If audio is playing, stop it first
    if (!audioPlayer.paused && audioPlayer.src) {
      stopAudio();
    }

    if (isRecording) {
      finishRecording();
    } else {
      startRecording();
    }
  }

  async function startRecording() {
    hideError();
    stopAudio();
    if (isBusy) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError("Microphone access is not supported in this browser. Please upload audio instead.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickSupportedMimeType();
      mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.addEventListener("dataavailable", (e) => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      });

      mediaRecorder.addEventListener("stop", () => {
        stream.getTracks().forEach((track) => track.stop());
      });

      mediaRecorder.start();
      isRecording = true;
      showRecordingHud(true);
      micBtn.classList.add("recording");
      liveVoiceBtn.classList.add("active");

      recordSeconds = 0;
      recordingTimer.textContent = "00:00";
      timerInterval = setInterval(() => {
        recordSeconds++;
        const mins = String(Math.floor(recordSeconds / 60)).padStart(2, "0");
        const secs = String(recordSeconds % 60).padStart(2, "0");
        recordingTimer.textContent = `${mins}:${secs}`;
        if (recordSeconds >= 120) finishRecording();
      }, 1000);
    } catch (err) {
      showError("Could not access microphone. Please allow microphone permissions.");
    }
  }

  function finishRecording() {
    if (!mediaRecorder || !isRecording) return;
    isRecording = false;
    clearInterval(timerInterval);
    showRecordingHud(false);
    micBtn.classList.remove("recording");
    liveVoiceBtn.classList.remove("active");

    mediaRecorder.addEventListener("stop", async () => {
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      if (blob.size === 0) {
        showError("The recording was empty.");
        return;
      }
      uploadAudioBlob(blob, `recording.${blob.type.includes("mp4") ? "mp4" : "webm"}`);
    }, { once: true });

    mediaRecorder.stop();
  }

  function cancelRecording() {
    if (!mediaRecorder || !isRecording) return;
    isRecording = false;
    clearInterval(timerInterval);
    showRecordingHud(false);
    micBtn.classList.remove("recording");
    liveVoiceBtn.classList.remove("active");
    audioChunks = [];
    mediaRecorder.stop();
  }

  function handleFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    uploadAudioBlob(file, file.name);
    audioFileInput.value = "";
  }

  async function uploadAudioBlob(fileOrBlob, filename) {
    isBusy = true;
    hideError();
    stopAudio();

    const assistantBubble = appendLoadingMessage("Listening & transcribing your voice…");

    const formData = new FormData();
    formData.append("file", fileOrBlob, filename);

    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data.error && data.error.message) || "Voice processing failed");
      }

      // Prepend user message bubble with transcribed text
      insertUserMessageBefore(assistantBubble, data.transcript);
      updateAssistantMessage(assistantBubble, data.answer, data.audio_url);
      saveChatTurn(data.transcript, data.answer, data.audio_url);

      // Auto-play speech when asked by voice, and attach the stop toggle button
      if (data.audio_url) {
        const playBtn = assistantBubble.querySelector(".play-audio-btn");
        playAudio(data.audio_url, playBtn);
      }
    } catch (err) {
      removeLoadingMessage(assistantBubble);
      showError(err.message || "Voice request failed");
    } finally {
      isBusy = false;
    }
  }

  // Audio Playback & Stop Voice Control
  function playAudio(url, btnElement = null) {
    if (!url) return;

    // Reset previous button state if any
    if (activeAudioBtn && activeAudioBtn !== btnElement) {
      activeAudioBtn.innerHTML = "🔊 Listen";
      activeAudioBtn.classList.remove("playing");
    }

    audioPlayer.src = url;
    audioPlayer.play().then(() => {
      activeAudioBtn = btnElement;
      if (activeAudioBtn) {
        activeAudioBtn.innerHTML = "⏹️ Stop voice";
        activeAudioBtn.classList.add("playing");
      }
      liveVoiceBtn.classList.add("active");
    }).catch(() => {
      onAudioFinished();
    });
  }

  function stopAudio() {
    if (audioPlayer) {
      audioPlayer.pause();
      audioPlayer.currentTime = 0;
    }
    onAudioFinished();
  }

  function onAudioFinished() {
    if (activeAudioBtn) {
      activeAudioBtn.innerHTML = "🔊 Listen";
      activeAudioBtn.classList.remove("playing");
      activeAudioBtn = null;
    }
    if (!isRecording) {
      liveVoiceBtn.classList.remove("active");
    }
  }

  // Chat UI Rendering
  function appendMessage(role, text) {
    welcomeHero.classList.add("hidden");
    messagesThread.classList.remove("hidden");

    const row = document.createElement("div");
    row.className = `message-row ${role}`;
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
    messagesThread.appendChild(row);
    scrollToBottom();
    return row;
  }

  function appendLoadingMessage(text = "Thinking…") {
    welcomeHero.classList.add("hidden");
    messagesThread.classList.remove("hidden");

    const row = document.createElement("div");
    row.className = "message-row assistant";
    row.innerHTML = `
      <div class="message-bubble">
        <div class="assistant-header">
          <img class="assistant-avatar" src="/static/img/kp_air_logo.png" alt="K P Air" />
          <span>K P Air</span>
        </div>
        <p class="assistant-text" style="color: var(--text-muted); font-style: italic;">${escapeHtml(text)}</p>
      </div>`;
    messagesThread.appendChild(row);
    scrollToBottom();
    return row;
  }

  function updateAssistantMessage(row, text, audioUrl) {
    const bubble = row.querySelector(".message-bubble");
    const formattedHtml = renderMarkdown(text);

    bubble.innerHTML = `
      <div class="assistant-header">
        <img class="assistant-avatar" src="/static/img/kp_air_logo.png" alt="K P Air" />
        <span>K P Air</span>
      </div>
      <div class="assistant-text">${formattedHtml}</div>
      <div class="assistant-actions">
        ${audioUrl ? `<button class="action-btn play-audio-btn" data-url="${escapeHtml(audioUrl)}" type="button">🔊 Listen</button>` : ""}
        <button class="action-btn copy-btn" type="button">📋 Copy</button>
      </div>`;

    // Copy action
    const copyBtn = bubble.querySelector(".copy-btn");
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = "✓ Copied";
        setTimeout(() => (copyBtn.textContent = "📋 Copy"), 1800);
      });
    });

    // Listen / Stop Voice toggle action
    const playBtn = bubble.querySelector(".play-audio-btn");
    if (playBtn) {
      playBtn.addEventListener("click", () => {
        if (!audioPlayer.paused && audioPlayer.src.includes(audioUrl)) {
          stopAudio();
        } else {
          playAudio(audioUrl, playBtn);
        }
      });
    }

    scrollToBottom();
  }

  function insertUserMessageBefore(referenceNode, text) {
    const row = document.createElement("div");
    row.className = "message-row user";
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
    messagesThread.insertBefore(row, referenceNode);
  }

  function removeLoadingMessage(row) {
    if (row && row.parentNode) {
      row.parentNode.removeChild(row);
    }
  }

  function renderHistory() {
    if (!chatHistory.length) return;
    welcomeHero.classList.add("hidden");
    messagesThread.classList.remove("hidden");
    chatHistory.forEach((turn) => {
      appendMessage("user", turn.user);
      const assistantRow = appendLoadingMessage();
      updateAssistantMessage(assistantRow, turn.assistant, turn.audio_url);
    });
  }

  function saveChatTurn(user, assistant, audioUrl) {
    chatHistory.push({ user, assistant, audio_url: audioUrl });
    sessionStorage.setItem("chatHistory", JSON.stringify(chatHistory.slice(-25)));
  }

  function clearConversation() {
    stopAudio();
    chatHistory.length = 0;
    sessionStorage.removeItem("chatHistory");
    messagesThread.innerHTML = "";
    messagesThread.classList.add("hidden");
    welcomeHero.classList.remove("hidden");
    audioPlayer.removeAttribute("src");
    audioPlayer.load();
    hideError();
  }

  function scrollToBottom() {
    window.requestAnimationFrame(() => {
      const container = document.querySelector(".chat-container");
      container.scrollTop = container.scrollHeight;
    });
  }

  function showRecordingHud(show) {
    recordingHud.classList.toggle("hidden", !show);
  }

  function showError(msg) {
    errorMessage.textContent = msg;
    errorToast.classList.remove("hidden");
  }

  function hideError() {
    errorToast.classList.add("hidden");
    errorMessage.textContent = "";
  }

  function pickSupportedMimeType() {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  // Full Markdown Renderer: converts bold **text**, headings, code blocks, lists
  function renderMarkdown(rawText) {
    if (!rawText) return "";

    // 1. Code blocks ```lang ... ```
    let text = rawText.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<div class="code-box"><div class="code-header"><span>${escapeHtml(lang || "code")}</span><button class="copy-code-btn" type="button" onclick="navigator.clipboard.writeText(this.closest('.code-box').querySelector('code').innerText); this.textContent='✓ Copied'; setTimeout(()=>this.textContent='Copy', 1500);">Copy</button></div><pre><code>${escapeHtml(code.trim())}</code></pre></div>`;
    });

    // 2. Inline code `code`
    text = text.replace(/`([^`\n]+)`/g, (match, code) => `<code class="inline-code">${escapeHtml(code)}</code>`);

    // 3. Headings ###, ##, #
    text = text.replace(/^### (.*$)/gim, '<h3 class="md-h3">$1</h3>');
    text = text.replace(/^## (.*$)/gim, '<h2 class="md-h2">$1</h2>');
    text = text.replace(/^# (.*$)/gim, '<h1 class="md-h1">$1</h1>');

    // 4. Bold text **text** and __text__
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong class="md-bold">$1</strong>');
    text = text.replace(/__(.*?)__/g, '<strong class="md-bold">$1</strong>');

    // 5. Italic text *text* and _text_
    text = text.replace(/\*([^*\n]+)\*/g, '<em class="md-italic">$1</em>');
    text = text.replace(/_([^_\n]+)_/g, '<em class="md-italic">$1</em>');

    // 6. Bullet lists (- or *)
    text = text.replace(/^\s*[-*]\s+(.*)$/gim, '<li class="md-li">$1</li>');

    // 7. Numbered lists (1. or 2.)
    text = text.replace(/^\s*\d+\.\s+(.*)$/gim, '<li class="md-oli">$1</li>');

    // 8. Paragraphs and line handling
    const rawLines = text.split("\n");
    const formatted = [];
    let inList = false;

    for (let rawLine of rawLines) {
      const line = rawLine.trim();
      if (!line) {
        if (inList) {
          formatted.push("</ul>");
          inList = false;
        }
        formatted.push('<div class="md-spacer"></div>');
      } else if (line.startsWith('<li class="md-li">') || line.startsWith('<li class="md-oli">')) {
        if (!inList) {
          formatted.push('<ul class="md-ul">');
          inList = true;
        }
        formatted.push(line);
      } else {
        if (inList) {
          formatted.push("</ul>");
          inList = false;
        }
        if (
          line.startsWith('<div class="code-box"') ||
          line.startsWith("<h1") ||
          line.startsWith("<h2") ||
          line.startsWith("<h3")
        ) {
          formatted.push(line);
        } else {
          formatted.push(`<p class="md-p">${line}</p>`);
        }
      }
    }
    if (inList) {
      formatted.push("</ul>");
    }

    return formatted.join("");
  }
})();
