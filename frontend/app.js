/**
 * Dasko — mic capture, WebSocket proxy, audio playback, orb state engine.
 * Live API: send 16-bit PCM 16 kHz mono; receive 16-bit PCM 24 kHz mono.
 */

// ── DOM refs ──────────────────────────────────────────────────────────────────
const setupScreen     = document.getElementById("setup-screen");
const sessionScreen   = document.getElementById("session-screen");
const topicSelect     = document.getElementById("topic");
const customTopic     = document.getElementById("customTopic");
const startBtn        = document.getElementById("startBtn");
const stopBtn         = document.getElementById("stopBtn");
const muteBtn         = document.getElementById("muteBtn");
const doneSpeakingBtn = document.getElementById("doneSpeakingBtn");
const statusEl        = document.getElementById("status");
const sessionTopicLabel = document.getElementById("sessionTopicLabel");

// Orb
const orb      = document.getElementById("orb");
const orbWrap  = document.getElementById("orbWrap");
const orbLabel = document.getElementById("orbLabel");

// Mic indicator
const micDot   = document.getElementById("micDot");
const micLabel = document.getElementById("micLabel");

// ── Persona selection ─────────────────────────────────────────────────────────
let selectedPersona = "eager";
document.querySelectorAll(".persona-card").forEach(card => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".persona-card").forEach(c => c.classList.remove("selected"));
    card.classList.add("selected");
    selectedPersona = card.dataset.persona;
  });
});

// ── Topic loading ─────────────────────────────────────────────────────────────
function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function loadTopics() {
  try {
    const res  = await fetch(`${window.location.origin}/api/topics`);
    const data = await res.json();
    topicSelect.innerHTML = data.topics
      .map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
      .join("");
  } catch {
    topicSelect.innerHTML = '<option value="">Could not load topics</option>';
  }
}

function getSelectedTopic() {
  return customTopic.value.trim() || topicSelect.value || "the topic the teacher will explain";
}

// ── Orb state machine ─────────────────────────────────────────────────────────
//
// Each state sets CSS custom properties on the orb + optional ripple rings.
// Transitions between colors/glow are handled by CSS `transition`.
//
const ORB_STATES = {
  idle: {
    color: "#EBEBEB",
    glow:  "rgba(235,235,235,0.5)",
    speed: "3.5s",
    rings: false,
    label: "",
  },
  listening: {          // student attentive, teacher's turn
    color: "#93C5FD",
    glow:  "rgba(147,197,253,0.45)",
    speed: "2.2s",
    rings: false,
    label: "Listening…",
  },
  thinking: {           // teacher stopped, model processing
    color: "#C4B5FD",
    glow:  "rgba(196,181,253,0.5)",
    speed: "2.6s",
    rings: false,
    label: "Thinking…",
  },
  speaking: {           // student audio is playing
    color: "#FF7355",
    glow:  "rgba(255,115,85,0.5)",
    speed: "0.85s",
    rings: true,
    label: "Speaking…",
  },
  curious: {
    color: "#FBBF24",
    glow:  "rgba(251,191,36,0.45)",
    speed: "1.6s",
    rings: false,
    label: "Curious!",
  },
  confused: {
    color: "#FDA4AF",
    glow:  "rgba(253,164,175,0.45)",
    speed: "2.9s",
    rings: false,
    label: "Hmm…",
  },
  excited: {
    color: "#FF7355",
    glow:  "rgba(255,115,85,0.65)",
    speed: "0.65s",
    rings: true,
    label: "Excited!",
  },
};

let currentOrbState = "idle";

function setOrbState(name) {
  if (name === currentOrbState) return;
  currentOrbState = name;
  const s = ORB_STATES[name] || ORB_STATES.idle;

  orb.style.setProperty("--orb-color", s.color);
  orb.style.setProperty("--orb-glow",  s.glow);
  orb.style.setProperty("--orb-speed", s.speed);
  // Ripple rings need the color too
  orbWrap.style.setProperty("--orb-color", s.color);

  // Restart animation so speed change kicks in immediately
  orb.style.animation = "none";
  void orb.offsetWidth;
  orb.style.animation = "";

  orbWrap.classList.toggle("rings-on", s.rings);
  orbLabel.textContent = s.label;
}

// Detect an orb state from the student's transcript text
function stateFromTranscript(text) {
  const t = text.toLowerCase();
  if (/don'?t (get|understand)|confused|lost|unclear|not following|repeat that|huh\?/.test(t))
    return "confused";
  if (/wow|amazing|love (it|that)|brilliant|awesome|perfect|exactly right/.test(t))
    return "excited";
  if (/(why|how|what|when|where)\s+.{0,30}\?/.test(t) || (t.match(/\?/g) || []).length >= 2)
    return "curious";
  return null;
}

// ── Mic indicator ─────────────────────────────────────────────────────────────
function setMicActive(active) {
  micDot.classList.toggle("active", active);
  micLabel.classList.toggle("active", active);
  micLabel.textContent = active ? "mic on" : "mic off";
}

// ── Status ────────────────────────────────────────────────────────────────────
function setStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className   = type;
}

// ── Audio / WebSocket state ───────────────────────────────────────────────────
let ws               = null;
let lastError        = null;
let micStream        = null;
let micContext       = null;
let micProcessor     = null;
let micMuted         = false;
let playbackContext  = null;
let playbackGainNode = null;
let nextPlayTime     = 0;
let audioChunksReceived = 0;

const SEND_SAMPLE_RATE = 16000;
const RECV_SAMPLE_RATE = 24000;
const BUFFER_SIZE      = 2048;
// 2048 samples @ 16 kHz ≈ 128 ms/buffer; 18 buffers ≈ 2.3 s silence before speech_end
const SILENCE_BUFFERS_BEFORE_END = 18;
const SPEECH_ENERGY_THRESHOLD   = 0.006;

let vadInSpeech    = false;
let vadSilenceCount = 0;

// ── PCM helpers ───────────────────────────────────────────────────────────────
function float32ToPcm16(f32) {
  const pcm = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm.buffer;
}

function pcm16ToFloat32(pcm16) {
  const f32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++)
    f32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
  return f32;
}

// ── Mic capture ───────────────────────────────────────────────────────────────
async function startMic() {
  micStream  = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  micContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SEND_SAMPLE_RATE });
  const source = micContext.createMediaStreamSource(micStream);

  micProcessor = micContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
  micProcessor.onaudioprocess = e => {
    if (micMuted || !ws || ws.readyState !== WebSocket.OPEN) return;
    const input = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);

    if (rms > SPEECH_ENERGY_THRESHOLD) {
      if (!vadInSpeech) {
        setMicActive(true);
        // Only shift to listening if the student isn't currently speaking
        if (currentOrbState !== "speaking") setOrbState("listening");
        try { ws.send(JSON.stringify({ type: "speech_start" })); } catch (_) {}
      }
      vadInSpeech = true;
      vadSilenceCount = 0;
    } else if (vadInSpeech) {
      vadSilenceCount++;
      if (vadSilenceCount >= SILENCE_BUFFERS_BEFORE_END) {
        vadInSpeech = false;
        vadSilenceCount = 0;
        setMicActive(false);
        if (currentOrbState !== "speaking") setOrbState("thinking");
        try { ws.send(JSON.stringify({ type: "speech_end" })); } catch (_) {}
      }
    }

    try { ws.send(float32ToPcm16(input)); } catch (_) {}
  };

  source.connect(micProcessor);
  // Silent gain keeps ScriptProcessor alive in some browsers
  const gain = micContext.createGain();
  gain.gain.value = 0;
  micProcessor.connect(gain);
  gain.connect(micContext.destination);
  if (micContext.state === "suspended") await micContext.resume();
}

// ── Playback ──────────────────────────────────────────────────────────────────
async function playPcm24k(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength === 0) return;
  try {
    audioChunksReceived++;
    if (audioChunksReceived === 1) setOrbState("speaking");

    if (!playbackContext)
      playbackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: RECV_SAMPLE_RATE });
    if (playbackContext.state === "suspended") await playbackContext.resume();

    const pcm16 = new Int16Array(arrayBuffer);
    const f32   = pcm16ToFloat32(pcm16);
    const buf   = playbackContext.createBuffer(1, f32.length, RECV_SAMPLE_RATE);
    buf.getChannelData(0).set(f32);

    const src = playbackContext.createBufferSource();
    src.buffer = buf;
    if (!playbackGainNode) {
      playbackGainNode = playbackContext.createGain();
      playbackGainNode.gain.value = 2.5;
      playbackGainNode.connect(playbackContext.destination);
    }
    src.connect(playbackGainNode);

    const now = playbackContext.currentTime;
    if (nextPlayTime < now) nextPlayTime = now;
    src.start(nextPlayTime);
    nextPlayTime += buf.duration;
  } catch (err) {
    console.error("playPcm24k error:", err);
  }
}

function stopPlayback() {
  playbackGainNode = null;
  if (playbackContext) { try { playbackContext.close(); } catch (_) {} playbackContext = null; }
  nextPlayTime = 0;
}

// ── Session lifecycle ─────────────────────────────────────────────────────────
function showSession(topic) {
  setupScreen.style.display   = "none";
  sessionScreen.style.display = "flex";
  sessionTopicLabel.textContent = topic;
  setOrbState("idle");
  setStatus("Connecting…");
}

function showSetup() {
  sessionScreen.style.display = "none";
  setupScreen.style.display   = "flex";
  setOrbState("idle");
}

function disconnect() {
  if (ws) { try { ws.close(); } catch (_) {} ws = null; }
  if (micProcessor) { try { micProcessor.disconnect(); } catch (_) {} micProcessor = null; }
  if (micStream)  { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (micContext) { try { micContext.close(); } catch (_) {} micContext = null; }
  stopPlayback();

  audioChunksReceived = 0;
  vadInSpeech  = false;
  vadSilenceCount = 0;
  micMuted = false;
  muteBtn.textContent = "Mute";
  muteBtn.classList.remove("muted");
  setMicActive(false);

  if (lastError) setStatus(lastError, "error");
  else setStatus("Session ended.");
  setTimeout(showSetup, 1200);
}

async function connect() {
  lastError = null;
  const topic = getSelectedTopic();
  showSession(topic);

  // Unlock AudioContext on user gesture (browser autoplay policy)
  if (!playbackContext)
    playbackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: RECV_SAMPLE_RATE });
  if (playbackContext.state === "suspended") await playbackContext.resume();

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/ws/live`
    + `?topic=${encodeURIComponent(topic)}&persona=${encodeURIComponent(selectedPersona)}`;
  ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  ws.onopen = async () => {
    setStatus("Your student is ready — start explaining.", "connected");
    try {
      await startMic();
    } catch (e) {
      setStatus("Mic access failed: " + e.message, "error");
    }
  };

  ws.onclose = () => disconnect();
  ws.onerror = () => { lastError = "Connection error."; setStatus("Connection error.", "error"); };

  ws.onmessage = async event => {
    // Raw binary audio
    if (event.data instanceof ArrayBuffer) { await playPcm24k(event.data); return; }
    if (event.data instanceof Blob)        { await playPcm24k(await event.data.arrayBuffer()); return; }

    // JSON
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === "info")  setStatus(msg.message || "", "connected");
      if (msg.type === "error") { lastError = msg.message; setStatus(msg.message, "error"); }

      if (msg.type === "turn_complete") {
        audioChunksReceived = 0;
        // Student finished — return to listening state, waiting for teacher
        setOrbState("listening");
        setStatus("Your turn — speak and pause when done.", "connected");
      }

      if (msg.type === "transcript" && msg.text) {
        const detected = stateFromTranscript(msg.text);
        if (detected) setOrbState(detected);
      }

      if (msg.type === "audio" && msg.base64) {
        try {
          const binary = atob(msg.base64);
          const bytes  = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          await playPcm24k(bytes.buffer);
        } catch (e) { console.error("Audio decode error:", e); }
      }
    } catch (_) {}
  };
}

// ── Controls ──────────────────────────────────────────────────────────────────
startBtn.addEventListener("click", async () => {
  if (!getSelectedTopic()) { setStatus("Pick a topic first.", "error"); return; }
  startBtn.disabled = true;
  await connect();
  startBtn.disabled = false;
});

stopBtn.addEventListener("click", () => { lastError = null; disconnect(); });

muteBtn.addEventListener("click", () => {
  micMuted = !micMuted;
  muteBtn.textContent = micMuted ? "Unmute" : "Mute";
  muteBtn.classList.toggle("muted", micMuted);
});

doneSpeakingBtn.addEventListener("click", () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ type: "speech_end" }));
    setOrbState("thinking");
    setMicActive(false);
  } catch (_) {}
});

// ── Boot ──────────────────────────────────────────────────────────────────────
loadTopics();
