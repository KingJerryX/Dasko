/**
 * Dasko frontend — topic selection, WebSocket, mic capture, and student voice playback.
 * Live API: send 16-bit PCM 16kHz mono; receive 16-bit PCM 24kHz mono.
 */

const statusEl = document.getElementById("status");
const topicSelect = document.getElementById("topic");
const customTopic = document.getElementById("customTopic");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const muteBtn = document.getElementById("muteBtn");
const doneSpeakingBtn = document.getElementById("doneSpeakingBtn");

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = "status " + type;
}

function appendTranscriptLine(lineText) {
  const transcriptEl = document.getElementById("transcript");
  if (!transcriptEl) return;
  const p = document.createElement("p");
  p.className = lineText.startsWith("Student:") ? "student-line" : "user-line";
  p.textContent = lineText;
  transcriptEl.appendChild(p);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

async function loadTopics() {
  try {
    const base = window.location.origin;
    const res = await fetch(`${base}/api/topics`);
    const data = await res.json();
    topicSelect.innerHTML = data.topics.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  } catch (e) {
    topicSelect.innerHTML = '<option value="">Could not load topics</option>';
    setStatus("Could not load topics: " + e.message, "error");
  }
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function getSelectedTopic() {
  const custom = customTopic.value.trim();
  if (custom) return custom;
  return topicSelect.value || "the topic the teacher will explain";
}

let ws = null;
let lastError = null;
let micStream = null;
let micContext = null;
let micProcessor = null;
let micMuted = false;
let playbackContext = null;
let playbackGainNode = null;
let nextPlayTime = 0;

const SEND_SAMPLE_RATE = 16000;
const RECV_SAMPLE_RATE = 24000;
const BUFFER_SIZE = 2048;
// Only send speech_end after this many silent buffers (avoid firing during pauses mid-sentence).
// 2048 samples @ 16kHz ≈ 128ms per buffer; 18 buffers ≈ 2.3s of silence.
const SILENCE_BUFFERS_BEFORE_END = 18;
const SPEECH_ENERGY_THRESHOLD = 0.006;
let vadInSpeech = false;
let vadSilenceCount = 0;

function float32ToPcm16(float32Array) {
  const pcm16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm16.buffer;
}

function pcm16ToFloat32(pcm16Array) {
  const float32 = new Float32Array(pcm16Array.length);
  for (let i = 0; i < pcm16Array.length; i++) {
    float32[i] = pcm16Array[i] / (pcm16Array[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

async function startMic(sendAudio) {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  micContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SEND_SAMPLE_RATE });
  const source = micContext.createMediaStreamSource(micStream);
  // ScriptProcessorNode is deprecated; use for broad compatibility (AudioWorklet needs a separate worklet file).
  micProcessor = micContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
  micProcessor.onaudioprocess = (e) => {
    if (micMuted || !ws || ws.readyState !== WebSocket.OPEN) return;
    const input = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    if (rms > SPEECH_ENERGY_THRESHOLD) {
      if (!vadInSpeech) {
        try { ws.send(JSON.stringify({ type: "speech_start" })); } catch (_) {}
      }
      vadInSpeech = true;
      vadSilenceCount = 0;
    } else if (vadInSpeech) {
      vadSilenceCount++;
      if (vadSilenceCount >= SILENCE_BUFFERS_BEFORE_END) {
        vadInSpeech = false;
        vadSilenceCount = 0;
        try {
          ws.send(JSON.stringify({ type: "speech_end" }));
        } catch (_) {}
      }
    }
    const pcm = float32ToPcm16(input);
    try {
      ws.send(pcm);
    } catch (_) {}
  };
  source.connect(micProcessor);
  const gain = micContext.createGain();
  gain.gain.value = 0;
  micProcessor.connect(gain);
  gain.connect(micContext.destination);
  if (micContext.state === "suspended") await micContext.resume();
  return () => {
    try {
      if (micProcessor) micProcessor.disconnect();
      if (micStream) micStream.getTracks().forEach((t) => t.stop());
      if (micContext) micContext.close();
    } catch (_) {}
    micProcessor = null;
    micStream = null;
    micContext = null;
  };
}

let audioChunksReceived = 0;

async function playPcm24k(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength === 0) return;
  try {
    audioChunksReceived++;
    const pcm16 = new Int16Array(arrayBuffer);
    const float32 = pcm16ToFloat32(pcm16);
    if (!playbackContext) {
      playbackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: RECV_SAMPLE_RATE });
    }
    const ctx = playbackContext;
    // Must await resume() — browsers keep AudioContext suspended until user gesture; without this, no sound plays.
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    const numSamples = float32.length;
    const buffer = ctx.createBuffer(1, numSamples, RECV_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (!playbackGainNode) {
      playbackGainNode = ctx.createGain();
      playbackGainNode.gain.value = 2.5;
      playbackGainNode.connect(ctx.destination);
    }
    source.connect(playbackGainNode);
    const now = ctx.currentTime;
    if (nextPlayTime < now) nextPlayTime = now;
    source.start(nextPlayTime);
    nextPlayTime += buffer.duration;
  } catch (err) {
    console.error("playPcm24k error:", err);
  }
}

function stopPlayback() {
  playbackGainNode = null;
  if (playbackContext) {
    try {
      playbackContext.close();
    } catch (_) {}
    playbackContext = null;
  }
  nextPlayTime = 0;
}

function disconnect() {
  if (ws) {
    ws.close();
    ws = null;
  }
  if (micProcessor) {
    try {
      micProcessor.disconnect();
    } catch (_) {}
    micProcessor = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (micContext) {
    try {
      micContext.close();
    } catch (_) {}
    micContext = null;
  }
  stopPlayback();
  audioChunksReceived = 0;
  vadInSpeech = false;
  vadSilenceCount = 0;
  startBtn.style.display = "block";
  stopBtn.style.display = "none";
  if (muteBtn) muteBtn.style.display = "none";
  if (doneSpeakingBtn) doneSpeakingBtn.style.display = "none";
  setStatus(
    lastError ? "Session ended. " + lastError : "Session ended. Choose a topic and start again when ready."
  );
  const transcriptEl = document.getElementById("transcript");
  if (transcriptEl) transcriptEl.innerHTML = "";
}

async function connect() {
  lastError = null;
  // Unlock playback AudioContext on this user gesture so first chunk can play (autoplay policy).
  // Use 24kHz to match Gemini Live API output; wrong rate causes wrong speed or failed playback.
  if (!playbackContext) {
    playbackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: RECV_SAMPLE_RATE });
  }
  if (playbackContext.state === "suspended") {
    await playbackContext.resume();
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const topic = encodeURIComponent(getSelectedTopic());
  const url = `${protocol}//${window.location.host}/ws/live?topic=${topic}`;
  ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  ws.onopen = async () => {
    setStatus("Connected. Requesting microphone…", "connected");
    try {
      await startMic();
      setStatus("Your student is listening — speak, then pause; they’ll respond when you stop. Use “Done speaking” if they don’t.", "connected");
      if (muteBtn) {
        muteBtn.style.display = "block";
        muteBtn.textContent = "Mute mic";
        muteBtn.dataset.muted = "false";
      }
      if (doneSpeakingBtn) doneSpeakingBtn.style.display = "block";
    } catch (e) {
      setStatus("Connected but mic failed: " + e.message + ". Check mic permission.", "error");
    }
  };

  ws.onclose = () => {
    if (lastError) setStatus("Session ended. " + lastError, "error");
    else setStatus("Session ended.");
    disconnect();
  };

  ws.onerror = () => setStatus("WebSocket error.", "error");

  ws.onmessage = async (event) => {
    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "info") setStatus(msg.message || "Connected.", "connected");
        if (msg.type === "turn_complete") {
          audioChunksReceived = 0;
          setStatus("Your student is done — speak now, then pause. They'll respond when you stop.", "connected");
        }
        if (msg.type === "error") {
          lastError = msg.message;
          setStatus("Error: " + msg.message, "error");
        }
        if (msg.type === "transcript" && msg.text) {
          appendTranscriptLine("Student: " + msg.text);
        }
        if (msg.type === "audio" && msg.base64) {
          console.log("Audio received: chunk #" + (audioChunksReceived + 1) + ", base64 length=" + (msg.base64 && msg.base64.length));
          if (audioChunksReceived === 0) {
            setStatus("Playing student audio…", "connected");
            appendTranscriptLine("Student: [speaking…]");
          }
          try {
            const binary = atob(msg.base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            await playPcm24k(bytes.buffer);
          } catch (e) {
            setStatus("Playback error: " + (e && e.message ? e.message : String(e)), "error");
            console.error("playPcm24k error:", e);
          }
          return;
        }
      } catch (_) {
        setStatus("Message: " + event.data);
      }
      return;
    }
    if (event.data instanceof ArrayBuffer) {
      if (audioChunksReceived === 0) {
        setStatus("Playing student audio…", "connected");
        appendTranscriptLine("Student: [speaking…]");
      }
      await playPcm24k(event.data);
      return;
    }
    if (event.data instanceof Blob) {
      if (audioChunksReceived === 0) {
        setStatus("Playing student audio…", "connected");
        appendTranscriptLine("Student: [speaking…]");
      }
      const buf = await event.data.arrayBuffer();
      await playPcm24k(buf);
    }
  };
}

startBtn.addEventListener("click", async () => {
  const topic = getSelectedTopic();
  if (!topic) {
    setStatus("Pick or type a topic first.", "error");
    return;
  }
  setStatus("Connecting…");
  connect();
  startBtn.style.display = "none";
  stopBtn.style.display = "block";
});

stopBtn.addEventListener("click", disconnect);

if (muteBtn) {
  muteBtn.addEventListener("click", () => {
    micMuted = !micMuted;
    muteBtn.textContent = micMuted ? "Unmute mic" : "Mute mic";
    muteBtn.dataset.muted = String(micMuted);
  });
}

function sendSpeechEnd() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ type: "speech_end" }));
    setStatus("Signaled done speaking — student should respond now.", "connected");
    setTimeout(() => {
      if (ws && ws.readyState === WebSocket.OPEN)
        setStatus("Your student is listening — speak or click Done speaking when finished.", "connected");
    }, 2000);
  } catch (e) {
    setStatus("Failed to send: " + e.message, "error");
  }
}

if (doneSpeakingBtn) {
  doneSpeakingBtn.addEventListener("click", sendSpeechEnd);
}

loadTopics();
