(() => {
  // DOM Elements
  const welcomeHero = document.getElementById("welcomeHero");
  const messagesThread = document.getElementById("messagesThread");
  const textInput = document.getElementById("textInput");
  const micBtn = document.getElementById("micBtn");
  const liveVoiceBtn = document.getElementById("liveVoiceBtn");
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
  const themeToggle = document.getElementById("themeToggle");
  const themeIcon = document.getElementById("themeIcon");
  const themeText = document.getElementById("themeText");
  const scrollBottomBtn = document.getElementById("scrollBottomBtn");
  const chatContainer = document.querySelector(".chat-container");

  // Dedicated Live Voice Page DOM Elements
  const liveVoicePage = document.getElementById("liveVoicePage");
  const liveVoiceExitBtn = document.getElementById("liveVoiceExitBtn");
  const liveVoiceTimer = document.getElementById("liveVoiceTimer");
  const liveVoiceStatusPill = document.getElementById("liveVoiceStatusPill");
  const liveVoiceStatusText = document.getElementById("liveVoiceStatusText");
  const liveVoiceWaveCanvas = document.getElementById("liveVoiceWaveCanvas");
  const liveSubtitleContainer = document.getElementById("liveSubtitleContainer");
  const liveSubtitleText = document.getElementById("liveSubtitleText");
  const liveMainMicBtn = document.getElementById("liveMainMicBtn");
  const liveMicHint = document.getElementById("liveMicHint");

  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;
  let timerInterval = null;
  let recordSeconds = 0;
  let isBusy = false;
  let activeAudioBtn = null;
  let isLiveVoiceMode = false;

  // Live Voice Page States
  let liveVoiceActive = false;
  let liveSessionTimer = null;
  let liveSessionSeconds = 0;
  let waveAnimId = null;
  let audioContext = null;
  let analyser = null;
  let audioDataArray = null;

  // Session Chat History
  const chatHistory = JSON.parse(sessionStorage.getItem("chatHistory") || "[]");

  // Initialize
  init();

  function init() {
    initTheme();
    renderHistory();
    checkHealth();

    // Event Listeners
    textInput.addEventListener("keydown", handleTextKeydown);
    textInput.addEventListener("input", autoResizeTextarea);
    micBtn.addEventListener("click", toggleRecording);
    liveVoiceBtn.addEventListener("click", openLiveVoicePage);
    if (liveVoiceExitBtn) {
      liveVoiceExitBtn.addEventListener("click", closeLiveVoicePage);
    }
    if (liveMainMicBtn) {
      liveMainMicBtn.addEventListener("click", toggleLiveMic);
    }

    cancelRecordingBtn.addEventListener("click", cancelRecording);
    finishRecordingBtn.addEventListener("click", finishRecording);
    audioFileInput.addEventListener("change", handleFileSelected);
    toastClose.addEventListener("click", hideError);
    clearChatChip.addEventListener("click", clearConversation);
    themeToggle.addEventListener("click", toggleDayNightTheme);

    // Escape key closes live voice
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && liveVoiceActive) {
        closeLiveVoicePage();
      }
    });

    // Browser navigation / URL route support (/live)
    window.addEventListener("popstate", () => {
      if (window.location.pathname === "/live") {
        if (!liveVoiceActive) openLiveVoicePage();
      } else {
        if (liveVoiceActive) closeLiveVoicePage();
      }
    });

    if (window.location.pathname === "/live" || window.location.hash === "#live") {
      openLiveVoicePage();
    }

    // Scroll to bottom button
    if (chatContainer && scrollBottomBtn) {
      chatContainer.addEventListener("scroll", () => {
        const distanceToBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
        if (distanceToBottom > 100) {
          scrollBottomBtn.classList.remove("hidden");
        } else {
          scrollBottomBtn.classList.add("hidden");
        }
      });
      scrollBottomBtn.addEventListener("click", () => {
        chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: "smooth" });
      });
    }

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

  // Day Type & Night Type Theme Management
  function initTheme() {
    const savedTheme = localStorage.getItem("chatTheme") || "night";
    applyTheme(savedTheme);
  }

  function toggleDayNightTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "night";
    const nextTheme = current === "night" ? "day" : "night";
    applyTheme(nextTheme);
    localStorage.setItem("chatTheme", nextTheme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    if (theme === "day") {
      themeIcon.textContent = "☀️";
      themeText.textContent = "Day";
      document.querySelector('meta[name="theme-color"]').setAttribute("content", "#fce4ec");
    } else {
      themeIcon.textContent = "🌙";
      themeText.textContent = "Night";
      document.querySelector('meta[name="theme-color"]').setAttribute("content", "#18181b");
    }
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

  // Format current time for speech bubbles (e.g. 13:56 or 10:45 PM)
  function getCurrentTime() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
    const time = getCurrentTime();
    appendMessage("user", message, time);
    const assistantBubble = appendLoadingMessage();

    try {
      const fullPrompt = message;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: fullPrompt, voice: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data.error && data.error.message) || "Request failed");
      }

      updateAssistantMessage(assistantBubble, data.answer, data.audio_url, time, message);
      saveChatTurn(message, data.answer, data.audio_url, time);

      if (isLiveVoiceMode && data.audio_url) {
        playAudio(data.audio_url, assistantBubble.querySelector(".listen-btn"));
      }
    } catch (err) {
      removeLoadingMessage(assistantBubble);
      showError(err.message || "Failed to get response");
    } finally {
      isBusy = false;
    }
  }

  // Dedicated Live Voice Mode Page Controller (Matching Screenshot)
  function openLiveVoicePage() {
    liveVoiceActive = true;
    liveVoicePage.classList.remove("hidden");
    if (window.location.pathname !== "/live") {
      history.pushState({ page: "live" }, "", "/live");
    }
    startLiveSessionTimer();
    initWaveCanvas();
    updateLiveStatus("ready", "Ready");
    setLiveSubtitle("Tap the microphone to speak with K P Air");
    if (liveMainMicBtn) liveMainMicBtn.classList.remove("recording");
    if (liveMicHint) liveMicHint.textContent = "Tap to speak";

    // Auto-start recording for natural voice interaction
    setTimeout(() => {
      if (liveVoiceActive && !isRecording && !isBusy) {
        startRecording();
      }
    }, 450);
  }

  function closeLiveVoicePage() {
    liveVoiceActive = false;
    liveVoicePage.classList.add("hidden");
    if (waveAnimId) {
      cancelAnimationFrame(waveAnimId);
      waveAnimId = null;
    }
    stopLiveSessionTimer();
    if (isRecording) {
      finishRecording();
    }
    stopAudio();
    if (window.location.pathname === "/live") {
      history.pushState(null, "", "/");
    }
  }

  function startLiveSessionTimer() {
    liveSessionSeconds = 0;
    updateLiveTimerDisplay();
    if (liveSessionTimer) clearInterval(liveSessionTimer);
    liveSessionTimer = setInterval(() => {
      liveSessionSeconds++;
      updateLiveTimerDisplay();
    }, 1000);
  }

  function updateLiveTimerDisplay() {
    const hrs = String(Math.floor(liveSessionSeconds / 3600)).padStart(2, "0");
    const mins = String(Math.floor((liveSessionSeconds % 3600) / 60)).padStart(2, "0");
    const secs = String(liveSessionSeconds % 60).padStart(2, "0");
    if (liveVoiceTimer) {
      liveVoiceTimer.textContent = `${hrs}:${mins}:${secs}`;
    }
  }

  function stopLiveSessionTimer() {
    if (liveSessionTimer) {
      clearInterval(liveSessionTimer);
      liveSessionTimer = null;
    }
  }

  function updateLiveStatus(state, text) {
    if (!liveVoiceStatusPill || !liveVoiceStatusText) return;
    liveVoiceStatusPill.className = "live-voice-status-pill";
    if (state === "recording") {
      liveVoiceStatusPill.classList.add("recording");
    } else if (state === "speaking") {
      liveVoiceStatusPill.classList.add("speaking");
    }
    liveVoiceStatusText.textContent = text;
  }

  function setLiveSubtitle(text) {
    if (liveSubtitleText) {
      liveSubtitleText.textContent = text;
    }
  }

  function toggleLiveMic() {
    if (isBusy) return;
    if (!audioPlayer.paused && audioPlayer.src) {
      stopAudio();
      setLiveSubtitle("Playback paused. Tap to speak.");
      updateLiveStatus("ready", "Ready");
      if (liveMicHint) liveMicHint.textContent = "Tap to speak";
      return;
    }

    if (isRecording) {
      finishRecording();
    } else {
      startRecording();
    }
  }

  // Real-Time Neon Sine Wave Canvas Animation (Matching Screenshot)
  function initWaveCanvas() {
    if (!liveVoiceWaveCanvas) return;
    const ctx = liveVoiceWaveCanvas.getContext("2d");
    let width = (liveVoiceWaveCanvas.width = liveVoiceWaveCanvas.parentElement.clientWidth || 800);
    let height = (liveVoiceWaveCanvas.height = liveVoiceWaveCanvas.parentElement.clientHeight || 320);

    const onResize = () => {
      if (liveVoiceWaveCanvas && liveVoiceWaveCanvas.parentElement) {
        width = liveVoiceWaveCanvas.width = liveVoiceWaveCanvas.parentElement.clientWidth || 800;
        height = liveVoiceWaveCanvas.height = liveVoiceWaveCanvas.parentElement.clientHeight || 320;
      }
    };
    window.addEventListener("resize", onResize);

    let currentAmp = 0;
    let phaseCyan = 0;
    let phasePink = 1.2;
    let phasePurple = 2.4;

    function drawSineWave(color, shadowColor, lineWidth, amplitude, freq, phase, verticalOffset = 0) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = amplitude > 0 ? 18 : 10;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();

      const centerY = height / 2 + verticalOffset;
      const step = 3;

      for (let x = 0; x <= width; x += step) {
        // Tapered envelope at borders
        const envelope = Math.sin((x / width) * Math.PI);
        const y = centerY + Math.sin(x * freq + phase) * amplitude * envelope;
        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();
      ctx.restore();
    }

    function renderLoop() {
      if (!liveVoiceActive) return;
      ctx.clearRect(0, 0, width, height);

      let targetAmp = 0;
      let isSpeakingNow = false;

      // 1. Check microphone voice volume (when user is speaking)
      if (isRecording && analyser && audioDataArray) {
        try {
          analyser.getByteFrequencyData(audioDataArray);
          let maxVal = 0;
          for (let i = 0; i < audioDataArray.length; i++) {
            if (audioDataArray[i] > maxVal) maxVal = audioDataArray[i];
          }
          // Ambient background noise floor threshold
          const noiseThreshold = 18;
          if (maxVal > noiseThreshold) {
            const normalized = Math.min(1.0, (maxVal - noiseThreshold) / 75);
            targetAmp = 22 + normalized * 85;
            isSpeakingNow = true;
          }
        } catch (e) {}
      }

      // 2. Check assistant speech output (when K P Air speaks audio)
      if (!audioPlayer.paused && audioPlayer.src) {
        let playEnergy = 0;
        if (analyser && audioDataArray) {
          try {
            analyser.getByteFrequencyData(audioDataArray);
            let maxVal = 0;
            for (let i = 0; i < audioDataArray.length; i++) {
              if (audioDataArray[i] > maxVal) maxVal = audioDataArray[i];
            }
            if (maxVal > 15) {
              playEnergy = Math.min(1.0, (maxVal - 15) / 75);
            }
          } catch (e) {}
        }
        if (playEnergy > 0) {
          targetAmp = 24 + playEnergy * 78;
          isSpeakingNow = true;
        } else {
          // Dynamic vocal pulse cadence while speech audio is playing
          const cadence = Math.abs(Math.sin(Date.now() / 150)) * 0.6 + Math.abs(Math.cos(Date.now() / 270)) * 0.4;
          targetAmp = 24 + cadence * 56;
          isSpeakingNow = true;
        }
      }

      // 3. Smooth transition (fast attack on speech, smooth decay on silence)
      if (targetAmp > currentAmp) {
        currentAmp += (targetAmp - currentAmp) * 0.35;
      } else {
        currentAmp += (targetAmp - currentAmp) * 0.12;
      }

      // Snap cleanly to 0 on silence so wave stops vibrating completely
      if (currentAmp < 0.6) {
        currentAmp = 0;
      }

      // Toggle speaking-active class on live page for bottom button ripples
      if (liveVoicePage) {
        liveVoicePage.classList.toggle("speaking-active", isSpeakingNow || currentAmp > 1);
      }

      // Wave motion / momentum: ONLY moves if currentAmp > 0; otherwise 0 movement
      if (currentAmp > 0) {
        const speed = 0.035 + (currentAmp / 100) * 0.05;
        phaseCyan += speed * 1.05;
        phasePink += speed * 1.35;
        phasePurple += speed * 0.85;
      }

      // Vertical separation between the 3 colored beams (collapses to 0 when flat!)
      const sep = Math.min(1.0, currentAmp / 12);
      const offsetTop = -6 * sep;
      const offsetBottom = 6 * sep;

      // 1. Neon Cyan / Blue Wave (Matching Screenshot upper flow)
      drawSineWave("#00f5ff", "rgba(0, 245, 255, 0.9)", 3.8, currentAmp * 1.15, 0.017, phaseCyan, offsetTop);

      // 2. Neon Magenta / Pink Wave (Matching Screenshot lower intersecting)
      drawSineWave("#ec4899", "rgba(236, 72, 153, 0.9)", 3.8, currentAmp * 1.05, 0.021, phasePink, offsetBottom);

      // 3. Neon Purple / Violet Wave (Harmonic center)
      drawSineWave("#a855f7", "rgba(168, 85, 247, 0.75)", 2.8, currentAmp * 0.8, 0.026, phasePurple, 0);

      waveAnimId = requestAnimationFrame(renderLoop);
    }

    if (waveAnimId) cancelAnimationFrame(waveAnimId);
    waveAnimId = requestAnimationFrame(renderLoop);
  }

  let audioPlayerConnected = false;
  function ensureAudioPlayerAnalyser() {
    if (audioPlayerConnected || !audioPlayer) return;
    try {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioContext.state === "suspended") {
        audioContext.resume();
      }
      if (!analyser) {
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
        audioDataArray = new Uint8Array(analyser.frequencyBinCount);
      }
      const playerSrcNode = audioContext.createMediaElementSource(audioPlayer);
      playerSrcNode.connect(analyser);
      playerSrcNode.connect(audioContext.destination);
      audioPlayerConnected = true;
    } catch (e) {
      audioPlayerConnected = true;
    }
  }

  function attachStreamToAnalyser(stream) {
    try {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioContext.state === "suspended") {
        audioContext.resume();
      }
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      audioDataArray = new Uint8Array(analyser.frequencyBinCount);
      const src = audioContext.createMediaStreamSource(stream);
      src.connect(analyser);
    } catch (e) {
      console.warn("AudioContext Analyser not available:", e);
    }
  }

  // Voice Recording Logic
  async function toggleRecording() {
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
      attachStreamToAnalyser(stream);

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

      if (!liveVoiceActive) {
        showRecordingHud(true);
      } else {
        if (liveMainMicBtn) liveMainMicBtn.classList.add("recording");
        updateLiveStatus("recording", "Listening…");
        setLiveSubtitle("Listening to you… Speak now");
        if (liveMicHint) liveMicHint.textContent = "Tap to finish";
      }

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
      if (liveVoiceActive) {
        setLiveSubtitle("Microphone permission required.");
        updateLiveStatus("ready", "Error");
      }
    }
  }

  function finishRecording() {
    if (!mediaRecorder || !isRecording) return;
    isRecording = false;
    clearInterval(timerInterval);
    showRecordingHud(false);
    micBtn.classList.remove("recording");
    liveVoiceBtn.classList.remove("active");

    if (liveVoiceActive) {
      if (liveMainMicBtn) liveMainMicBtn.classList.remove("recording");
      updateLiveStatus("thinking", "Thinking…");
      setLiveSubtitle("Thinking… Reason step-by-step");
      if (liveMicHint) liveMicHint.textContent = "Processing…";
    }

    mediaRecorder.addEventListener("stop", async () => {
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      if (blob.size === 0) {
        showError("The recording was empty.");
        if (liveVoiceActive) {
          setLiveSubtitle("Empty recording. Tap to speak again.");
          updateLiveStatus("ready", "Ready");
        }
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
    if (liveVoiceActive) {
      if (liveMainMicBtn) liveMainMicBtn.classList.remove("recording");
      updateLiveStatus("ready", "Ready");
      setLiveSubtitle("Recording canceled.");
      if (liveMicHint) liveMicHint.textContent = "Tap to speak";
    }
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

    const time = getCurrentTime();
    const assistantBubble = appendLoadingMessage("Listening & answering…");

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

      insertUserMessageBefore(assistantBubble, data.transcript, time);
      updateAssistantMessage(assistantBubble, data.answer, data.audio_url, time, data.transcript);
      saveChatTurn(data.transcript, data.answer, data.audio_url, time);

      if (liveVoiceActive) {
        setLiveSubtitle(data.transcript ? `"${data.transcript}"` : data.answer.slice(0, 100));
        updateLiveStatus("speaking", "K P Air Speaking");
        if (liveMicHint) liveMicHint.textContent = "Playing response";
      }

      if (data.audio_url) {
        const playBtn = assistantBubble.querySelector(".listen-btn");
        playAudio(data.audio_url, playBtn);
      }
    } catch (err) {
      removeLoadingMessage(assistantBubble);
      showError(err.message || "Voice request failed");
      if (liveVoiceActive) {
        setLiveSubtitle(err.message || "Voice request failed");
        updateLiveStatus("ready", "Ready");
      }
    } finally {
      isBusy = false;
    }
  }

  // Audio Playback & Stop Voice Control
  function setButtonPlaying(btn, playing) {
    if (!btn) return;
    btn.classList.toggle("playing", playing);
    const listenSvg = btn.querySelector(".listen-svg");
    const stopSvg = btn.querySelector(".stop-svg");
    const tooltip = btn.querySelector(".btn-tooltip");
    if (listenSvg && stopSvg) {
      listenSvg.classList.toggle("hidden", playing);
      stopSvg.classList.toggle("hidden", !playing);
    }
    if (tooltip) {
      tooltip.textContent = playing ? "Stop voice" : "Read aloud";
    }
  }

  function playAudio(url, btnElement = null) {
    if (!url) return;

    if (activeAudioBtn && activeAudioBtn !== btnElement) {
      setButtonPlaying(activeAudioBtn, false);
    }

    ensureAudioPlayerAnalyser();
    audioPlayer.src = url;
    audioPlayer.play().then(() => {
      activeAudioBtn = btnElement;
      if (activeAudioBtn) {
        setButtonPlaying(activeAudioBtn, true);
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
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    onAudioFinished();
  }

  function onAudioFinished() {
    if (activeAudioBtn) {
      setButtonPlaying(activeAudioBtn, false);
      activeAudioBtn = null;
    }
    if (!isRecording) {
      liveVoiceBtn.classList.remove("active");
    }
    if (liveVoiceActive) {
      updateLiveStatus("ready", "Ready");
      if (liveMicHint) liveMicHint.textContent = "Tap to speak";
      setLiveSubtitle("Tap the microphone to speak with K P Air");
    }
  }

  // Chat UI Rendering (Messenger style without image avatars)
  function appendMessage(role, text, time = "") {
    welcomeHero.classList.add("hidden");
    messagesThread.classList.remove("hidden");

    const row = document.createElement("div");
    row.className = `message-row ${role}`;
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.innerHTML = `${escapeHtml(text)} ${time ? `<span class="message-time">${escapeHtml(time)}</span>` : ""}`;
    row.appendChild(bubble);
    messagesThread.appendChild(row);
    scrollToBottom();
    return row;
  }

  function getHumanWaitingHtml(statusText = "Thinking…") {
    return `
      <div class="message-bubble thinking-bubble">
        <div class="human-waiting-card">
          <div class="human-avatar-wrapper">
            <div class="human-pulse-glow"></div>
            <svg class="human-motion-svg" viewBox="0 0 64 64" width="46" height="46" aria-hidden="true">
              <!-- Floating animated thought bubbles -->
              <g class="thought-bubbles-group">
                <circle class="thought-bubble tb-1" cx="44" cy="18" r="2.2" />
                <circle class="thought-bubble tb-2" cx="50" cy="11" r="3.2" />
                <circle class="thought-bubble tb-3" cx="56" cy="4" r="4.2" />
              </g>
              <!-- Human Figure with animated breathing & thinking gesture -->
              <g class="human-figure-group">
                <!-- Torso & Shoulders -->
                <path class="human-body" d="M16 54 C16 43, 24 38, 32 38 C40 38, 48 43, 48 54 Z" />
                <!-- Neck -->
                <rect class="human-neck" x="29" y="31" width="6" height="8" rx="2" />
                <!-- Head with subtle pondering tilt -->
                <g class="human-head-anim">
                  <circle class="human-head" cx="32" cy="23" r="10.5" />
                  <path class="human-hair" d="M22 21 C22 14, 27 12, 34 12 C41 12, 43 15, 43 21 C40 17, 36 16, 28 18 Z" />
                  <!-- Eye gazing upward in thought -->
                  <circle class="human-eye" cx="35.5" cy="21.5" r="1.4" />
                  <!-- Pondering mouth -->
                  <path class="human-mouth" d="M33 27 Q36 28, 38 26" fill="none" stroke-width="1.2" stroke-linecap="round" />
                </g>
                <!-- Arm in classic 'The Thinker' pose resting hand on chin -->
                <g class="human-arm-anim">
                  <path class="human-arm" d="M22 45 C23 37, 30 35, 36 30" fill="none" stroke-width="3.2" stroke-linecap="round" />
                  <circle class="human-hand" cx="36" cy="29" r="2.8" />
                </g>
              </g>
            </svg>
          </div>
          <div class="human-waiting-content">
            <div class="human-waiting-header">
              <span class="human-waiting-name">K P Air</span>
              <span class="human-thinking-badge">
                <span class="badge-pulse-dot"></span>
                <span class="badge-label-text">${escapeHtml(statusText)}</span>
              </span>
              <span class="human-waiting-timer">0s</span>
            </div>
            <div class="human-waiting-status">
              <span class="human-status-subtext">Reasoning step-by-step for you</span>
              <span class="human-typing-dots">
                <span></span><span></span><span></span>
              </span>
            </div>
          </div>
        </div>
      </div>`;
  }

  function startThinkingTimer(row) {
    if (row._thinkingTimerInterval) {
      clearInterval(row._thinkingTimerInterval);
    }
    const startTime = Date.now();
    const timerEl = row.querySelector(".human-waiting-timer");
    row._thinkingTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (timerEl) {
        timerEl.textContent = `${elapsed}s`;
      }
    }, 1000);
  }

  function appendLoadingMessage(statusText = "Thinking…") {
    welcomeHero.classList.add("hidden");
    messagesThread.classList.remove("hidden");

    const row = document.createElement("div");
    row.className = "message-row assistant thinking-row";
    row.innerHTML = getHumanWaitingHtml(statusText);
    startThinkingTimer(row);

    messagesThread.appendChild(row);
    scrollToBottom();
    return row;
  }

  function showButtonTooltipTemporarily(btn, message) {
    if (!btn) return;
    const tooltip = btn.querySelector(".btn-tooltip");
    if (!tooltip) return;
    const oldText = tooltip.textContent;
    tooltip.textContent = message;
    btn.classList.add("show-tooltip");
    setTimeout(() => {
      btn.classList.remove("show-tooltip");
      setTimeout(() => {
        tooltip.textContent = oldText;
      }, 200);
    }, 1800);
  }

  function attachAssistantActions(bubble, row, text, audioUrl, promptText = "") {
    if (promptText) {
      row._userPrompt = promptText;
    }

    const actionsContainer = document.createElement("div");
    actionsContainer.className = "assistant-actions";
    actionsContainer.innerHTML = `
      <button class="action-icon-btn like-btn" type="button" aria-label="Good response">
        <svg viewBox="0 0 24 24"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3Z"/></svg>
        <span class="btn-tooltip">Good response</span>
      </button>

      <button class="action-icon-btn dislike-btn" type="button" aria-label="Bad response">
        <svg viewBox="0 0 24 24"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3Z"/></svg>
        <span class="btn-tooltip">Bad response</span>
      </button>

      <button class="action-icon-btn retry-btn" type="button" aria-label="Regenerate answer">
        <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
        <span class="btn-tooltip">Regenerate</span>
      </button>

      <button class="action-icon-btn copy-btn" type="button" aria-label="Copy">
        <svg class="copy-svg" viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
        <svg class="check-svg hidden" viewBox="0 0 24 24" stroke="#22c55e"><polyline points="20 6 9 17 4 12"/></svg>
        <span class="btn-tooltip">Copy</span>
      </button>

      <button class="action-icon-btn listen-btn" type="button" aria-label="Read aloud" data-url="${escapeHtml(audioUrl || "")}">
        <svg class="listen-svg" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
        <svg class="stop-svg hidden" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
        <span class="btn-tooltip">Read aloud</span>
      </button>

      <div style="position: relative; display: inline-flex;">
        <button class="action-icon-btn more-btn" type="button" aria-label="More options">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/></svg>
          <span class="btn-tooltip">More options</span>
        </button>
        <div class="more-menu-popover hidden">
          <button class="more-menu-item export-pdf-item" type="button">
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            Export as PDF
          </button>
          <button class="more-menu-item share-item" type="button">
            <svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            Share Chat
          </button>
          <button class="more-menu-item copy-md-item" type="button">
            <svg viewBox="0 0 24 24"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
            Copy Markdown
          </button>
        </div>
      </div>
    `;

    bubble.appendChild(actionsContainer);

    // 1. Like button
    const likeBtn = actionsContainer.querySelector(".like-btn");
    const dislikeBtn = actionsContainer.querySelector(".dislike-btn");

    likeBtn.addEventListener("click", () => {
      const isLiked = likeBtn.classList.toggle("active");
      if (isLiked) {
        dislikeBtn.classList.remove("active");
        showButtonTooltipTemporarily(likeBtn, "Liked!");
      }
    });

    // 2. Dislike button
    dislikeBtn.addEventListener("click", () => {
      const isDisliked = dislikeBtn.classList.toggle("active");
      if (isDisliked) {
        likeBtn.classList.remove("active");
        showButtonTooltipTemporarily(dislikeBtn, "Disliked");
      }
    });

    // 3. Retry / Regenerate button
    const retryBtn = actionsContainer.querySelector(".retry-btn");
    retryBtn.addEventListener("click", async () => {
      if (isBusy) return;
      let promptToRegenerate = row._userPrompt || "";
      if (!promptToRegenerate) {
        let prev = row.previousElementSibling;
        while (prev) {
          if (prev.classList.contains("user")) {
            const userBubble = prev.querySelector(".message-bubble");
            if (userBubble) {
              promptToRegenerate = userBubble.innerText.replace(/\d{1,2}:\d{2}(\s*[ap]m)?/i, "").trim();
            }
            break;
          }
          prev = prev.previousElementSibling;
        }
      }
      if (!promptToRegenerate) {
        promptToRegenerate = "Explain step-by-step with examples";
      }

      // Transition row into thinking state
      isBusy = true;
      hideError();
      stopAudio();
      row.classList.add("thinking-row");
      row.innerHTML = getHumanWaitingHtml("Regenerating answer…");
      startThinkingTimer(row);

      try {
        const fullPrompt = promptToRegenerate;
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: fullPrompt, voice: true }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error((data.error && data.error.message) || "Regeneration failed");
        }
        updateAssistantMessage(row, data.answer, data.audio_url, getCurrentTime(), promptToRegenerate);
        saveChatTurn(promptToRegenerate, data.answer, data.audio_url);
      } catch (err) {
        removeLoadingMessage(row);
        showError(err.message || "Failed to regenerate answer");
      } finally {
        isBusy = false;
      }
    });

    // 4. Copy button
    const copyBtn = actionsContainer.querySelector(".copy-btn");
    const copySvg = copyBtn.querySelector(".copy-svg");
    const checkSvg = copyBtn.querySelector(".check-svg");
    copyBtn.addEventListener("click", () => {
      const cleanText = text || (bubble.querySelector(".assistant-text") ? bubble.querySelector(".assistant-text").innerText : "");
      navigator.clipboard.writeText(cleanText).then(() => {
        copySvg.classList.add("hidden");
        checkSvg.classList.remove("hidden");
        copyBtn.classList.add("copied");
        showButtonTooltipTemporarily(copyBtn, "Copied!");
        setTimeout(() => {
          copySvg.classList.remove("hidden");
          checkSvg.classList.add("hidden");
          copyBtn.classList.remove("copied");
        }, 2000);
      });
    });

    // 5. Listen / Read Aloud button
    const listenBtn = actionsContainer.querySelector(".listen-btn");
    listenBtn.addEventListener("click", () => {
      const isCurrentlyPlaying = listenBtn.classList.contains("playing");
      if (isCurrentlyPlaying) {
        stopAudio();
        if (window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
        setButtonPlaying(listenBtn, false);
        return;
      }

      stopAudio();
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      const audioSrc = listenBtn.getAttribute("data-url") || audioUrl;
      if (audioSrc) {
        playAudio(audioSrc, listenBtn);
      } else if (window.speechSynthesis) {
        const utterance = new SpeechSynthesisUtterance(text.replace(/[#*`_~○]/g, " "));
        utterance.onend = () => {
          setButtonPlaying(listenBtn, false);
        };
        utterance.onerror = () => {
          setButtonPlaying(listenBtn, false);
        };
        setButtonPlaying(listenBtn, true);
        window.speechSynthesis.speak(utterance);
      }
    });

    // 6. More menu button (•••)
    const moreBtn = actionsContainer.querySelector(".more-btn");
    const popover = actionsContainer.querySelector(".more-menu-popover");
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".more-menu-popover").forEach((p) => {
        if (p !== popover) p.classList.add("hidden");
      });
      popover.classList.toggle("hidden");
    });

    // Export PDF
    const exportPdfItem = popover.querySelector(".export-pdf-item");
    exportPdfItem.addEventListener("click", () => {
      popover.classList.add("hidden");
      window.print();
    });

    // Share chat
    const shareItem = popover.querySelector(".share-item");
    shareItem.addEventListener("click", () => {
      popover.classList.add("hidden");
      if (navigator.share) {
        navigator.share({
          title: "K P Air Assistant Response",
          text: text
        }).catch(() => {});
      } else {
        navigator.clipboard.writeText(text).then(() => {
          showButtonTooltipTemporarily(moreBtn, "Shared text copied!");
        });
      }
    });

    // Copy markdown
    const copyMdItem = popover.querySelector(".copy-md-item");
    copyMdItem.addEventListener("click", () => {
      popover.classList.add("hidden");
      navigator.clipboard.writeText(text).then(() => {
        showButtonTooltipTemporarily(moreBtn, "Markdown copied!");
      });
    });
  }

  // Dismiss popovers when clicking outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".more-menu-popover") && !e.target.closest(".more-btn")) {
      document.querySelectorAll(".more-menu-popover").forEach((p) => p.classList.add("hidden"));
    }
  });

  function updateAssistantMessage(row, text, audioUrl, time = "", promptText = "") {
    if (!row) return;
    if (row._thinkingTimerInterval) {
      clearInterval(row._thinkingTimerInterval);
      row._thinkingTimerInterval = null;
    }
    row.classList.remove("thinking-row");

    row.innerHTML = `<div class="message-bubble"></div>`;
    const bubble = row.querySelector(".message-bubble");
    const formattedHtml = renderMarkdown(text);
    const displayTime = time || getCurrentTime();

    bubble.innerHTML = `
      <div class="assistant-sender-title">
        <span>K P Air</span>
        <span class="message-time">${escapeHtml(displayTime)}</span>
      </div>
      <div class="assistant-text">${formattedHtml}</div>`;

    attachAssistantActions(bubble, row, text, audioUrl, promptText);
    scrollToBottom();
  }

  function insertUserMessageBefore(referenceNode, text, time = "") {
    const row = document.createElement("div");
    row.className = "message-row user";
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.innerHTML = `${escapeHtml(text)} ${time ? `<span class="message-time">${escapeHtml(time)}</span>` : ""}`;
    row.appendChild(bubble);
    messagesThread.insertBefore(row, referenceNode);
  }

  function removeLoadingMessage(row) {
    if (!row) return;
    if (row._thinkingTimerInterval) {
      clearInterval(row._thinkingTimerInterval);
      row._thinkingTimerInterval = null;
    }
    if (row.parentNode) {
      row.parentNode.removeChild(row);
    }
  }

  function appendAssistantMessage(text, audioUrl, time = "", promptText = "") {
    welcomeHero.classList.add("hidden");
    messagesThread.classList.remove("hidden");

    const row = document.createElement("div");
    row.className = "message-row assistant";
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    const formattedHtml = renderMarkdown(text);
    const displayTime = time || getCurrentTime();

    bubble.innerHTML = `
      <div class="assistant-sender-title">
        <span>K P Air</span>
        <span class="message-time">${escapeHtml(displayTime)}</span>
      </div>
      <div class="assistant-text">${formattedHtml}</div>`;

    attachAssistantActions(bubble, row, text, audioUrl, promptText);

    row.appendChild(bubble);
    messagesThread.appendChild(row);
    scrollToBottom();
    return row;
  }

  function renderHistory() {
    if (!chatHistory.length) return;
    welcomeHero.classList.add("hidden");
    messagesThread.classList.remove("hidden");
    chatHistory.forEach((turn) => {
      appendMessage("user", turn.user, turn.time || "");
      appendAssistantMessage(turn.assistant, turn.audio_url, turn.time || "", turn.user);
    });
  }

  function saveChatTurn(user, assistant, audioUrl, time) {
    chatHistory.push({ user, assistant, audio_url: audioUrl, time: time || getCurrentTime() });
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
      if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
      if (scrollBottomBtn) {
        scrollBottomBtn.classList.add("hidden");
      }
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

    // Numbered headings like "1. **Title**" or "**1. Title**"
    text = text.replace(/^(\d+\.)\s+\*\*(.*?)\*\*/gim, '<h3 class="md-h3">$1 $2</h3>');
    text = text.replace(/^\*\*(\d+\..*?)\*\*/gim, '<h3 class="md-h3">$1</h3>');

    // 4. Bold text **text** and __text__
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong class="md-bold">$1</strong>');
    text = text.replace(/__(.*?)__/g, '<strong class="md-bold">$1</strong>');

    // 5. Italic text *text* and _text_
    text = text.replace(/\*([^*\n]+)\*/g, '<em class="md-italic">$1</em>');
    text = text.replace(/_([^_\n]+)_/g, '<em class="md-italic">$1</em>');

    // 6. Bullet lists (- or * or • or o)
    text = text.replace(/^\s*[-*•o]\s+(.*)$/gim, '<li class="md-li">$1</li>');

    // 7. Numbered lists (1. or 2.)
    text = text.replace(/^\s*(\d+)\.\s+(.*)$/gim, '<li class="md-oli"><strong class="md-bold">$1.</strong> $2</li>');

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
