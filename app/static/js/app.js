(() => {
  const maxDuration = 120;
  const micButton = document.getElementById("micButton");
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const askBtn = document.getElementById("askBtn");
  const fileInput = document.getElementById("fileInput");
  const timerEl = document.getElementById("timer");
  const statusText = document.getElementById("statusText");
  const stageLabel = document.getElementById("stageLabel");
  const progress = document.getElementById("progress");
  const progressText = document.getElementById("progressText");
  const transcriptEl = document.getElementById("transcript");
  const answerEl = document.getElementById("answer");
  const player = document.getElementById("player");
  const replayBtn = document.getElementById("replayBtn");
  const clearBtn = document.getElementById("clearBtn");
  const copyTranscript = document.getElementById("copyTranscript");
  const copyAnswer = document.getElementById("copyAnswer");
  const errorBanner = document.getElementById("errorBanner");
  const historyEl = document.getElementById("history");
  const connectionStatus = document.getElementById("connectionStatus");

  let mediaRecorder = null;
  let chunks = [];
  let recordedBlob = null;
  let uploadedFile = null;
  let seconds = 0;
  let timerId = null;
  let busy = false;
  const history = JSON.parse(sessionStorage.getItem("voiceHistory") || "[]");

  const stages = {
    ready: "Ready",
    listening: "Listening",
    transcribing: "Transcribing",
    thinking: "Thinking",
    speaking: "Generating Speech",
    completed: "Completed",
  };

  renderHistory();
  checkHealth();

  startBtn.addEventListener("click", startRecording);
  micButton.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      stopRecording();
    } else {
      startRecording();
    }
  });
  stopBtn.addEventListener("click", stopRecording);
  askBtn.addEventListener("click", submitAudio);
  fileInput.addEventListener("change", handleUpload);
  replayBtn.addEventListener("click", () => {
    if (player.src) {
      player.currentTime = 0;
      player.play();
    }
  });
  clearBtn.addEventListener("click", clearConversation);
  copyTranscript.addEventListener("click", () => copyText(transcriptEl.textContent));
  copyAnswer.addEventListener("click", () => copyText(answerEl.textContent));

  async function checkHealth() {
    try {
      const response = await fetch("/api/health");
      const data = await response.json();
      const notes = (data.notes || []).join(" ");
      connectionStatus.textContent = notes
        ? `Online · ${data.llm_provider} / ${data.transcription_provider}`
        : "Online";
      if (notes) {
        connectionStatus.title = notes;
      }
    } catch (error) {
      connectionStatus.textContent = "Backend unreachable";
      connectionStatus.classList.add("warn");
    }
  }

  async function startRecording() {
    hideError();
    if (busy) {
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError("This browser does not support microphone recording. Use the upload option.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunks = [];
      recordedBlob = null;
      uploadedFile = null;
      fileInput.value = "";
      mediaRecorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      });
      mediaRecorder.addEventListener("stop", () => {
        recordedBlob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        askBtn.disabled = recordedBlob.size === 0;
        setStage("ready");
        statusText.textContent = "Recording captured. Click Ask Assistant to send it.";
      });
      mediaRecorder.start();
      setRecordingUi(true);
      setStage("listening");
      statusText.textContent = "Listening… speak clearly, then stop recording.";
    } catch (error) {
      showError("Microphone permission was denied or the device is unavailable.");
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
    setRecordingUi(false);
  }

  function handleUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }
    uploadedFile = file;
    recordedBlob = null;
    askBtn.disabled = false;
    statusText.textContent = `Selected ${file.name}. Click Ask Assistant to send it.`;
  }

  async function submitAudio() {
    if (busy) {
      return;
    }
    const payload = buildPayload();
    if (!payload) {
      showError("Record or choose an audio file first.");
      return;
    }
    busy = true;
    askBtn.disabled = true;
    startBtn.disabled = true;
    micButton.disabled = true;
    progress.classList.remove("hidden");
    hideError();
    setStage("transcribing");
    progressText.textContent = "Transcribing";

    const stageTimer = window.setTimeout(() => {
      setStage("thinking");
      progressText.textContent = "Thinking";
    }, 900);
    const speakTimer = window.setTimeout(() => {
      setStage("speaking");
      progressText.textContent = "Generating speech";
    }, 1800);

    try {
      const response = await fetch("/api/voice", {
        method: "POST",
        body: payload,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error((data.error && data.error.message) || "The request failed.");
      }
      transcriptEl.textContent = data.transcript;
      answerEl.textContent = data.answer;
      player.src = data.audio_url;
      replayBtn.disabled = false;
      player.play().catch(() => {});
      history.unshift({
        transcript: data.transcript,
        answer: data.answer,
        audio_url: data.audio_url,
        at: new Date().toLocaleTimeString(),
      });
      sessionStorage.setItem("voiceHistory", JSON.stringify(history.slice(0, 20)));
      renderHistory();
      setStage("completed");
      statusText.textContent = "Completed. You can replay the answer or ask another question.";
    } catch (error) {
      showError(error.message || "The voice request failed.");
      setStage("ready");
    } finally {
      window.clearTimeout(stageTimer);
      window.clearTimeout(speakTimer);
      busy = false;
      askBtn.disabled = false;
      startBtn.disabled = false;
      micButton.disabled = false;
      progress.classList.add("hidden");
    }
  }

  function buildPayload() {
    const form = new FormData();
    if (uploadedFile) {
      form.append("file", uploadedFile, uploadedFile.name);
      return form;
    }
    if (recordedBlob) {
      const extension = extensionFor(recordedBlob.type);
      form.append("file", recordedBlob, `recording.${extension}`);
      return form;
    }
    return null;
  }

  function pickMimeType() {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) {
      return "";
    }
    return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  function extensionFor(mimeType) {
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("ogg")) return "ogg";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    return "webm";
  }

  function setRecordingUi(isRecording) {
    startBtn.disabled = isRecording;
    stopBtn.disabled = !isRecording;
    micButton.classList.toggle("recording", isRecording);
    if (isRecording) {
      seconds = 0;
      timerEl.textContent = "00:00";
      timerId = window.setInterval(() => {
        seconds += 1;
        timerEl.textContent = formatTime(seconds);
        if (seconds >= maxDuration) {
          stopRecording();
          statusText.textContent = "Maximum recording length reached.";
        }
      }, 1000);
    } else if (timerId) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  function setStage(name) {
    stageLabel.textContent = stages[name] || name;
  }

  function formatTime(total) {
    const mins = String(Math.floor(total / 60)).padStart(2, "0");
    const secs = String(total % 60).padStart(2, "0");
    return `${mins}:${secs}`;
  }

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.classList.remove("hidden");
  }

  function hideError() {
    errorBanner.classList.add("hidden");
    errorBanner.textContent = "";
  }

  function copyText(value) {
    navigator.clipboard.writeText(value || "").catch(() => {
      showError("Copy failed. Select the text manually.");
    });
  }

  function clearConversation() {
    history.length = 0;
    sessionStorage.removeItem("voiceHistory");
    transcriptEl.textContent = "Your spoken question will appear here.";
    answerEl.textContent = "The assistant answer will appear here.";
    player.removeAttribute("src");
    player.load();
    replayBtn.disabled = true;
    recordedBlob = null;
    uploadedFile = null;
    fileInput.value = "";
    askBtn.disabled = true;
    renderHistory();
    setStage("ready");
    statusText.textContent = "Conversation cleared for this session.";
  }

  function renderHistory() {
    if (!history.length) {
      historyEl.innerHTML = "<p class='hint'>No questions yet in this session.</p>";
      return;
    }
    historyEl.innerHTML = history
      .map(
        (item) => `
        <div class="history-item">
          <strong>${escapeHtml(item.at)} · You</strong>
          <p>${escapeHtml(item.transcript)}</p>
          <strong>Assistant</strong>
          <p>${escapeHtml(item.answer)}</p>
        </div>`
      )
      .join("");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }
})();
