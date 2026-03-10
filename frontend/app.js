/**
 * Dasko — mic/camera capture, WebSocket proxy, audio playback, orb state engine.
 */

// ── DOM refs ───────────────────────────────────────────────────────────────────
const landingScreen     = document.getElementById("landing-screen");
const setupScreen       = document.getElementById("setup-screen");
const sessionScreen     = document.getElementById("session-screen");
const getStartedBtn     = document.getElementById("getStartedBtn");
const topicSelect       = document.getElementById("topic");
const customTopic       = document.getElementById("customTopic");
const materialsEl       = document.getElementById("materials");
const useCameraEl       = document.getElementById("useCamera");
const startBtn          = document.getElementById("startBtn");
const stopBtn           = document.getElementById("stopBtn");
const muteBtn           = document.getElementById("muteBtn");
const doneSpeakingBtn   = document.getElementById("doneSpeakingBtn");
const statusEl          = document.getElementById("status");
const sessionTopicLabel = document.getElementById("sessionTopicLabel");
const modeTabSolo       = document.getElementById("modeTabSolo");
const modeTabClassroom  = document.getElementById("modeTabClassroom");
const soloSection       = document.getElementById("soloSection");
const classroomSection  = document.getElementById("classroomSection");
const studentHint       = document.getElementById("studentHint");
const orb               = document.getElementById("orb");
const orbWrap           = document.getElementById("orbWrap");
const orbLabel          = document.getElementById("orbLabel");
const speakerLabel      = document.getElementById("speakerLabel");
const orbPillDot        = document.getElementById("orbPillDot");
const orbPillLabel      = document.getElementById("orbPillLabel");
const micDot            = document.getElementById("micDot");
const micLabel          = document.getElementById("micLabel");
const chatInput         = document.getElementById("chatInput");
const chatSendBtn       = document.getElementById("chatSendBtn");
const cameraFeed        = document.getElementById("cameraFeed");

// ── Student roster ─────────────────────────────────────────────────────────────
const STUDENTS = {
  emma:   { name: "Emma",   color: "#93C5FD", glow: "rgba(147,197,253,0.5)" },
  marcus: { name: "Marcus", color: "#FDA4AF", glow: "rgba(253,164,175,0.5)" },
  lily:   { name: "Lily",   color: "#C4B5FD", glow: "rgba(196,181,253,0.5)" },
  priya:  { name: "Priya",  color: "#6EE7B7", glow: "rgba(110,231,183,0.5)" },
  tyler:  { name: "Tyler",  color: "#D1D5DB", glow: "rgba(209,213,219,0.5)" },
  zoe:    { name: "Zoe",    color: "#FBBF24", glow: "rgba(251,191,36,0.5)"  },
};

// ── Mode & selection state ─────────────────────────────────────────────────────
let classroomMode    = false;
let selectedPersona  = "eager";
let selectedStudents = new Set();

// ── Startup tone & button sounds (shared AudioContext) ──
let _startupAudioContext = null;
let _startupTonePlayed = false;

function getAudioContext() {
  if (!_startupAudioContext) _startupAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  return _startupAudioContext;
}

function playStartupTone() {
  if (_startupTonePlayed) return;
  const ctx = getAudioContext();
  const run = () => {
    if (_startupTonePlayed) return;
    try {
      if (ctx.state !== "running") return;
      _startupTonePlayed = true;
      const duration = 1.7;
      const baseFreq = 196;
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.38, ctx.currentTime + 0.04);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      gainNode.connect(ctx.destination);

      const o1 = ctx.createOscillator();
      o1.type = "sine";
      o1.frequency.setValueAtTime(baseFreq, ctx.currentTime);
      o1.frequency.linearRampToValueAtTime(baseFreq * 1.02, ctx.currentTime + duration * 0.5);
      o1.connect(gainNode);
      o1.start(ctx.currentTime);
      o1.stop(ctx.currentTime + duration);

      const o2 = ctx.createOscillator();
      o2.type = "sine";
      o2.frequency.setValueAtTime(baseFreq * 1.006, ctx.currentTime);
      o2.frequency.linearRampToValueAtTime(baseFreq * 1.024, ctx.currentTime + duration * 0.5);
      o2.connect(gainNode);
      o2.start(ctx.currentTime);
      o2.stop(ctx.currentTime + duration);

      const o3 = ctx.createOscillator();
      o3.type = "sine";
      o3.frequency.setValueAtTime(baseFreq * 2.48, ctx.currentTime);
      const g3 = ctx.createGain();
      g3.gain.setValueAtTime(0.22, ctx.currentTime);
      g3.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration * 0.6);
      o3.connect(g3);
      g3.connect(gainNode);
      o3.start(ctx.currentTime);
      o3.stop(ctx.currentTime + duration);
    } catch (_) {}
  };
  if (ctx.state === "suspended") ctx.resume().then(run).catch(() => {});
  else run();
}

function playButtonSound(type) {
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") return;
    const t = ctx.currentTime;
    const gainNode = ctx.createGain();
    gainNode.connect(ctx.destination);
    if (type === "confirm") {
      gainNode.gain.setValueAtTime(0, t);
      gainNode.gain.linearRampToValueAtTime(0.2, t + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      const o1 = ctx.createOscillator();
      o1.type = "sine";
      o1.frequency.setValueAtTime(320, t);
      o1.frequency.linearRampToValueAtTime(400, t + 0.12);
      o1.connect(gainNode);
      o1.start(t);
      o1.stop(t + 0.28);
      const o2 = ctx.createOscillator();
      o2.type = "sine";
      o2.frequency.setValueAtTime(324, t);
      o2.frequency.linearRampToValueAtTime(404, t + 0.12);
      o2.connect(gainNode);
      o2.start(t);
      o2.stop(t + 0.28);
    } else {
      gainNode.gain.setValueAtTime(0, t);
      gainNode.gain.linearRampToValueAtTime(0.15, t + 0.015);
      gainNode.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(180, t + 0.22);
      o.connect(gainNode);
      o.start(t);
      o.stop(t + 0.22);
    }
  } catch (_) {}
}

function onFirstInteraction() {
  if (_startupTonePlayed) return;
  playStartupTone();
}

// Browsers block audio until the user interacts. First tap/click/key anywhere on the page plays the startup tone.
["click", "touchstart", "keydown"].forEach((ev) => {
  document.addEventListener(ev, onFirstInteraction, { once: true, capture: true });
});

// ── Landing → Setup ────────────────────────────────────────────────────────────
getStartedBtn.addEventListener("click", () => {
  playButtonSound("confirm");
  landingScreen.classList.add("fade-out");
  setTimeout(() => {
    landingScreen.style.display = "none";
    landingScreen.classList.remove("fade-out");
    setupScreen.style.display = "flex";
    setupScreen.classList.add("fade-in");
    setTimeout(() => setupScreen.classList.remove("fade-in"), 300);
  }, 280);
});

// ── Mode tabs ──────────────────────────────────────────────────────────────────
modeTabSolo.addEventListener("click", () => {
  classroomMode = false;
  modeTabSolo.classList.add("active");
  modeTabClassroom.classList.remove("active");
  soloSection.style.display = "block";
  classroomSection.style.display = "none";
  updateStartButton();
});

modeTabClassroom.addEventListener("click", () => {
  classroomMode = true;
  modeTabClassroom.classList.add("active");
  modeTabSolo.classList.remove("active");
  soloSection.style.display = "none";
  classroomSection.style.display = "block";
  updateStartButton();
});

// ── Persona selection (solo) ───────────────────────────────────────────────────
document.querySelectorAll(".persona-card").forEach(card => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".persona-card").forEach(c => c.classList.remove("selected"));
    card.classList.add("selected");
    selectedPersona = card.dataset.persona;
  });
});

// ── Student selection (classroom) ──────────────────────────────────────────────
document.querySelectorAll(".student-card").forEach(card => {
  card.addEventListener("click", () => {
    const id    = card.dataset.student;
    const color = card.dataset.color;
    if (selectedStudents.has(id)) {
      selectedStudents.delete(id);
      card.classList.remove("selected");
      card.style.borderColor = "";
    } else if (selectedStudents.size < 4) {
      selectedStudents.add(id);
      card.classList.add("selected");
      card.style.borderColor = color;
    }
    updateStartButton();
  });
});

function updateStartButton() {
  if (!classroomMode) {
    startBtn.disabled = false;
    startBtn.textContent = "Start teaching";
    return;
  }
  const n = selectedStudents.size;
  startBtn.disabled = n < 2;
  if      (n === 0) { startBtn.textContent = "Select 2–4 students";       studentHint.textContent = "Select 2–4"; }
  else if (n === 1) { startBtn.textContent = "Select 1 more student";      studentHint.textContent = "1 selected — need 1 more"; }
  else              { startBtn.textContent = `Start teaching (${n} students)`; studentHint.textContent = `${n} selected`; }
}

// ── Topic loading ──────────────────────────────────────────────────────────────
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

// ── Orb state machine ──────────────────────────────────────────────────────────
const ORB_STATES = {
  idle:      { color: "#EBEBEB", glow: "rgba(235,235,235,0.5)",  speed: "3.5s",  rings: false, label: "" },
  listening: { color: "#93C5FD", glow: "rgba(147,197,253,0.45)", speed: "2.2s",  rings: false, label: "Listening…" },
  thinking:  { color: "#C4B5FD", glow: "rgba(196,181,253,0.5)",  speed: "2.6s",  rings: false, label: "Thinking…" },
  speaking:  { color: "#FF7355", glow: "rgba(255,115,85,0.5)",   speed: "0.85s", rings: true,  label: "Speaking…" },
  curious:   { color: "#FBBF24", glow: "rgba(251,191,36,0.45)",  speed: "1.6s",  rings: false, label: "Curious!" },
  confused:  { color: "#FDA4AF", glow: "rgba(253,164,175,0.45)", speed: "2.9s",  rings: false, label: "Hmm…" },
  excited:   { color: "#FF7355", glow: "rgba(255,115,85,0.65)",  speed: "0.65s", rings: true,  label: "Excited!" },
};

let currentOrbState = "idle";

function applyOrbColor(color, glow) {
  orb.style.setProperty("--orb-color", color);
  orb.style.setProperty("--orb-glow",  glow);
  orbWrap.style.setProperty("--orb-color", color);
  orbPillDot.style.setProperty("--orb-color", color);
  orbPillDot.style.setProperty("--orb-glow",  glow);
}

function setOrbState(name) {
  if (name === currentOrbState) return;
  currentOrbState = name;
  const s = ORB_STATES[name] || ORB_STATES.idle;

  // In classroom mode only apply color on idle — student color owns it otherwise
  if (!classroomMode || name === "idle") applyOrbColor(s.color, s.glow);

  orb.style.setProperty("--orb-speed", s.speed);
  orbPillDot.style.setProperty("--orb-speed", s.speed);
  orb.style.animation = "none";
  void orb.offsetWidth;
  orb.style.animation = "";

  orbWrap.classList.toggle("rings-on", s.rings);
  orbLabel.textContent    = s.label;
  orbPillLabel.textContent = s.label;
}

function setSpeaker(name) {
  const student = STUDENTS[name.toLowerCase()];
  if (!student) return;
  applyOrbColor(student.color, student.glow);
  speakerLabel.textContent = student.name;
  speakerLabel.style.color = student.color;
}

// ── Classroom orb management ───────────────────────────────────────────────────
function createClassroomOrbs() {
  const container = document.getElementById("classroomOrbs");
  container.innerHTML = "";
  for (const id of selectedStudents) {
    const s = STUDENTS[id];
    const wrap = document.createElement("div");
    wrap.className = "student-orb-wrap";
    wrap.id = `orb-wrap-${id}`;
    wrap.innerHTML = `
      <div class="student-orb-rings" id="orb-rings-${id}" style="--s-color:${s.color}">
        <div class="s-ring"></div><div class="s-ring"></div><div class="s-ring"></div>
      </div>
      <div class="student-orb-circle idle" id="orb-circle-${id}" style="--s-color:${s.color};--s-glow:${s.glow}"></div>
      <div class="student-orb-name idle" id="orb-name-${id}" style="color:${s.color}">${s.name}</div>
    `;
    container.appendChild(wrap);
  }
}

function activateStudentOrb(id) {
  for (const sid of selectedStudents) {
    const circle = document.getElementById(`orb-circle-${sid}`);
    const name   = document.getElementById(`orb-name-${sid}`);
    const rings  = document.getElementById(`orb-rings-${sid}`);
    if (!circle) continue;
    if (sid === id) {
      circle.classList.remove("idle"); circle.classList.add("speaking");
      name.classList.remove("idle");   name.classList.add("speaking");
      rings.classList.add("speaking");
    } else {
      circle.classList.remove("speaking"); circle.classList.add("idle");
      name.classList.remove("speaking");   name.classList.add("idle");
      rings.classList.remove("speaking");
    }
  }
}

function deactivateStudentOrb(id) {
  const circle = document.getElementById(`orb-circle-${id}`);
  const name   = document.getElementById(`orb-name-${id}`);
  const rings  = document.getElementById(`orb-rings-${id}`);
  if (!circle) return;
  circle.classList.remove("speaking"); circle.classList.add("idle");
  name.classList.remove("speaking");   name.classList.add("idle");
  rings.classList.remove("speaking");
}

const SERVER_EMOTION_STATES = new Set(["curious", "confused", "excited", "listening", "thinking"]);

// ── Mic indicator ──────────────────────────────────────────────────────────────
function setMicActive(active) {
  micDot.classList.toggle("active", active);
  micLabel.classList.toggle("active", active);
  micLabel.textContent = active ? "mic on" : "mic off";
}

// ── Status ─────────────────────────────────────────────────────────────────────
function setStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className   = type;
}

// ── Audio / WebSocket state ────────────────────────────────────────────────────
let ws                = null;
let lastError         = null;
let micStream         = null;
let micContext        = null;
let micProcessor      = null;
let micMuted          = false;
let playbackContext   = null;
let playbackGainNode  = null;
let nextPlayTime      = 0;
let audioChunksReceived = 0;

const SEND_SAMPLE_RATE           = 16000;
const RECV_SAMPLE_RATE           = 24000;
const BUFFER_SIZE                = 2048;
const SILENCE_BUFFERS_BEFORE_END = 18;
const SPEECH_ENERGY_THRESHOLD    = 0.006;

let vadInSpeech    = false;
let vadSilenceCount = 0;

// ── Camera / video state ───────────────────────────────────────────────────────
let cameraStream  = null;
let frameInterval = null;
const frameCanvas = document.createElement("canvas");
frameCanvas.width  = 640;
frameCanvas.height = 360;

// ── PCM helpers ────────────────────────────────────────────────────────────────
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

// ── Camera capture ─────────────────────────────────────────────────────────────
async function startCamera() {
  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 360, frameRate: 30 },
    audio: true,
  });
  cameraFeed.srcObject = cameraStream;
  await cameraFeed.play().catch(() => {});

  const ctx = frameCanvas.getContext("2d");
  frameInterval = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN || micMuted) return;
    ctx.drawImage(cameraFeed, 0, 0, frameCanvas.width, frameCanvas.height);
    const base64 = frameCanvas.toDataURL("image/jpeg", 0.7).split(",")[1];
    try { ws.send(JSON.stringify({ type: "video_frame", base64 })); } catch (_) {}
  }, 1000);

  return cameraStream;
}

// ── Mic capture ────────────────────────────────────────────────────────────────
async function startMic(existingStream = null) {
  micStream  = existingStream || await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
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
  const gain = micContext.createGain();
  gain.gain.value = 0;
  micProcessor.connect(gain);
  gain.connect(micContext.destination);
  if (micContext.state === "suspended") await micContext.resume();
}

// ── Playback ───────────────────────────────────────────────────────────────────
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

// ── Session lifecycle ──────────────────────────────────────────────────────────
function showSession(topic) {
  setupScreen.style.display   = "none";
  sessionScreen.style.display = "flex";
  sessionScreen.classList.toggle("video-mode",    useCameraEl.checked);
  sessionScreen.classList.toggle("classroom-mode", classroomMode);
  sessionTopicLabel.textContent = topic;
  speakerLabel.textContent      = "";
  speakerLabel.style.color      = "";
  setOrbState("idle");
  setStatus("Connecting…");
  if (classroomMode) createClassroomOrbs();
}

function showSetup() {
  sessionScreen.style.display = "none";
  sessionScreen.classList.remove("classroom-mode");
  setupScreen.style.display   = "flex";
  speakerLabel.textContent    = "";
  speakerLabel.style.color    = "";
  setOrbState("idle");
}

function disconnect() {
  if (ws) { try { ws.close(); } catch (_) {} ws = null; }
  if (micProcessor) { try { micProcessor.disconnect(); } catch (_) {} micProcessor = null; }
  if (micStream)    { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (micContext)   { try { micContext.close(); } catch (_) {} micContext = null; }
  if (frameInterval){ clearInterval(frameInterval); frameInterval = null; }
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  cameraFeed.srcObject = null;
  stopPlayback();

  audioChunksReceived = 0;
  vadInSpeech   = false;
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
  const topic         = getSelectedTopic();
  const materials     = materialsEl.value.trim();
  const useVideo      = useCameraEl.checked;
  const studentsParam = classroomMode ? Array.from(selectedStudents).join(",") : "";

  showSession(topic);

  if (!playbackContext)
    playbackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: RECV_SAMPLE_RATE });
  if (playbackContext.state === "suspended") await playbackContext.resume();

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/ws/live`
    + `?topic=${encodeURIComponent(topic)}`
    + `&persona=${encodeURIComponent(selectedPersona)}`
    + `&video=${useVideo ? "1" : "0"}`
    + `&classroom=${classroomMode ? "1" : "0"}`
    + (studentsParam ? `&students=${encodeURIComponent(studentsParam)}` : "")
    + (materials     ? `&materials=${encodeURIComponent(materials)}`    : "");

  ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  ws.onopen = async () => {
    setStatus("Your student is ready — start explaining.", "connected");
    try {
      if (useVideo) {
        const stream = await startCamera();
        await startMic(stream);
      } else {
        await startMic();
      }
    } catch (e) {
      setStatus("Camera/mic access failed: " + e.message, "error");
    }
  };

  ws.onclose = () => disconnect();
  ws.onerror = () => { lastError = "Connection error."; setStatus("Connection error.", "error"); };

  ws.onmessage = async event => {
    if (event.data instanceof ArrayBuffer) { await playPcm24k(event.data); return; }
    if (event.data instanceof Blob)        { await playPcm24k(await event.data.arrayBuffer()); return; }

    try {
      const msg = JSON.parse(event.data);

      if (msg.type === "info")  setStatus(msg.message || "", "connected");
      if (msg.type === "error") { lastError = msg.message; setStatus(msg.message, "error"); }

      if (msg.type === "turn_complete") {
        audioChunksReceived = 0;
        setOrbState("listening");
        setStatus("Your turn — speak and pause when done.", "connected");
      }

      if (msg.type === "emotion" && SERVER_EMOTION_STATES.has(msg.state)) {
        if (!classroomMode) setOrbState(msg.state);
      }

      if (msg.type === "student_speaking" && msg.name) {
        if (classroomMode) {
          activateStudentOrb(msg.name.toLowerCase());
          setStatus(`${STUDENTS[msg.name.toLowerCase()]?.name || msg.name} is speaking…`, "connected");
        } else {
          setSpeaker(msg.name);
        }
      }

      if (msg.type === "student_turn_complete" && msg.studentId) {
        deactivateStudentOrb(msg.studentId);
        audioChunksReceived = 0;
        setStatus("Your turn — speak and pause when done.", "connected");
      }

      if (msg.type === "audio" && msg.base64) {
        try {
          const binary = atob(msg.base64);
          const bytes  = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          await playPcm24k(bytes.buffer);
        } catch (e) { console.error("Audio decode error:", e); }
      }

      if (msg.type === "classroom_audio" && msg.base64) {
        try {
          const binary = atob(msg.base64);
          const bytes  = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          await playPcm24k(bytes.buffer);
        } catch (e) { console.error("Classroom audio decode error:", e); }
      }
    } catch (_) {}
  };
}

// ── Controls ───────────────────────────────────────────────────────────────────
startBtn.addEventListener("click", async () => {
  if (classroomMode && selectedStudents.size < 2) { setStatus("Select at least 2 students.", "error"); return; }
  if (!getSelectedTopic()) { setStatus("Pick a topic first.", "error"); return; }
  playButtonSound("confirm");
  startBtn.disabled = true;
  await connect();
  startBtn.disabled = false;
});

stopBtn.addEventListener("click", () => {
  playButtonSound("end");
  lastError = null;
  disconnect();
});

muteBtn.addEventListener("click", () => {
  micMuted = !micMuted;
  muteBtn.textContent = micMuted ? "Unmute" : "Mute";
  muteBtn.classList.toggle("muted", micMuted);
});

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ type: "text_input", text }));
    chatInput.value = "";
    setOrbState("thinking");
  } catch (_) {}
}

chatSendBtn.addEventListener("click", sendChatMessage);
chatInput.addEventListener("keydown", e => { if (e.key === "Enter") sendChatMessage(); });

doneSpeakingBtn.addEventListener("click", () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ type: "speech_end" }));
    setOrbState("thinking");
    setMicActive(false);
  } catch (_) {}
});

// ── Boot ───────────────────────────────────────────────────────────────────────
loadTopics();
