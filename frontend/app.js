/**
 * Dasko — Frontend: mic/camera, WebSocket, whiteboard, transcript, coaching, playback.
 */

// ── DOM refs ─────────────────────────────────────────────────────────────────
const landingScreen   = document.getElementById("landing-screen");
const setupScreen     = document.getElementById("setup-screen");
const sessionScreen   = document.getElementById("session-screen");
const reflectionScreen = document.getElementById("reflection-screen");
const getStartedBtn   = document.getElementById("getStartedBtn");
const topicSelect     = document.getElementById("topic");
const customTopic     = document.getElementById("customTopic");
const materialsEl     = document.getElementById("materials");
const useCameraEl     = document.getElementById("useCamera");
const useWhiteboardEl = document.getElementById("useWhiteboard");
const startBtn        = document.getElementById("startBtn");
const stopBtn         = document.getElementById("stopBtn");
const muteBtn         = document.getElementById("muteBtn");
const doneSpeakingBtn = document.getElementById("doneSpeakingBtn");
const camToggleBtn    = document.getElementById("camToggleBtn");
const wbToggleBtn     = document.getElementById("wbToggleBtn");
const sessionTopicLabel = document.getElementById("sessionTopicLabel");
const sessionTimer    = document.getElementById("sessionTimer");
const statusDot       = document.getElementById("statusDot");
const statusText      = document.getElementById("statusText");
const modeTabSolo     = document.getElementById("modeTabSolo");
const modeTabClassroom = document.getElementById("modeTabClassroom");
const soloSection     = document.getElementById("soloSection");
const classroomSection = document.getElementById("classroomSection");
const studentHint     = document.getElementById("studentHint");
const orb             = document.getElementById("orb");
const orbWrap         = document.getElementById("orbWrap");
const orbLabel        = document.getElementById("orbLabel");
const speakerLabel    = document.getElementById("speakerLabel");
const orbArea         = document.getElementById("orbArea");
const orbPill         = document.getElementById("orbPill");
const orbPillDot      = document.getElementById("orbPillDot");
const orbPillLabel    = document.getElementById("orbPillLabel");
const micDot          = document.getElementById("micDot");
const micLabel        = document.getElementById("micLabel");
const chatInput       = document.getElementById("chatInput");
const chatSendBtn     = document.getElementById("chatSendBtn");
const mediaContainer  = document.getElementById("mediaContainer");
const whiteboardCanvas = document.getElementById("whiteboardCanvas");
const cameraFeed      = document.getElementById("cameraFeed");
const cameraContainer = document.getElementById("cameraContainer");
const cameraPipFeed   = document.getElementById("cameraPipFeed");
const screenContainer = document.getElementById("screenContainer");
const screenFeed      = document.getElementById("screenFeed");
const screenToggleBtn = document.getElementById("screenToggleBtn");
const wbToolbar       = document.getElementById("wbToolbar");
const transcriptBody  = document.getElementById("transcriptBody");
const coachingBody    = document.getElementById("coachingBody");
const reflectionSummary    = document.getElementById("reflectionSummary");
const reflectionStrengths  = document.getElementById("reflectionStrengths");
const reflectionGaps       = document.getElementById("reflectionGaps");
const reflectionQuestions  = document.getElementById("reflectionQuestions");
const reflectionImprovements = document.getElementById("reflectionImprovements");
const teachAgainBtn   = document.getElementById("teachAgainBtn");
const changeTopicBtn  = document.getElementById("changeTopicBtn");

// ── Student roster ───────────────────────────────────────────────────────────
const STUDENTS = {
  emma:   { name: "Emma",   color: "#93C5FD", glow: "rgba(147,197,253,0.5)" },
  marcus: { name: "Marcus", color: "#FDA4AF", glow: "rgba(253,164,175,0.5)" },
  lily:   { name: "Lily",   color: "#C4B5FD", glow: "rgba(196,181,253,0.5)" },
  priya:  { name: "Priya",  color: "#6EE7B7", glow: "rgba(110,231,183,0.5)" },
  tyler:  { name: "Tyler",  color: "#D1D5DB", glow: "rgba(209,213,219,0.5)" },
  zoe:    { name: "Zoe",    color: "#FBBF24", glow: "rgba(251,191,36,0.5)"  },
};

const ORB_STATES = {
  idle:      { color: "#9CA3AF", glow: "rgba(156,163,175,0.4)", speed: "3.5s",  rings: false, label: "" },
  listening: { color: "#93C5FD", glow: "rgba(147,197,253,0.45)", speed: "2.2s",  rings: false, label: "Listening\u2026" },
  thinking:  { color: "#C4B5FD", glow: "rgba(196,181,253,0.5)",  speed: "2.6s",  rings: false, label: "Thinking\u2026" },
  speaking:  { color: "#FF7355", glow: "rgba(255,115,85,0.5)",   speed: "0.85s", rings: true,  label: "Speaking\u2026" },
  curious:   { color: "#FBBF24", glow: "rgba(251,191,36,0.45)",  speed: "1.6s",  rings: false, label: "Curious!" },
  confused:  { color: "#FDA4AF", glow: "rgba(253,164,175,0.45)", speed: "2.9s",  rings: false, label: "Hmm\u2026" },
  excited:   { color: "#FF7355", glow: "rgba(255,115,85,0.65)",  speed: "0.65s", rings: true,  label: "Excited!" },
};

const SERVER_EMOTION_STATES = new Set(["curious", "confused", "excited", "listening", "thinking"]);

// ── State ────────────────────────────────────────────────────────────────────
let classroomMode    = false;
let selectedPersona  = "eager";
let selectedStudents = new Set();

let ws               = null;
let lastError        = null;
let micStream        = null;
let micContext       = null;
let micProcessor     = null;
let micMuted         = false;
let cameraStream     = null;
let cameraEnabled    = false;
let screenStream     = null;
let screenEnabled    = false;
let whiteboardEnabled = false;
let whiteboardInited = false;
let playbackContext  = null;
let playbackGainNode = null;
let nextPlayTime     = 0;
let audioChunksReceived = 0;
let currentOrbState  = "idle";
let activeSpeakerName = "";
let awaitingReflection = false;

// Audio config
const SEND_SAMPLE_RATE        = 16000;
const RECV_SAMPLE_RATE        = 24000;
const BUFFER_SIZE             = 2048;
const SILENCE_BUFFERS_BEFORE_END = 18;
const SPEECH_ENERGY_THRESHOLD = 0.006;

let vadInSpeech     = false;
let vadSilenceCount = 0;
let teacherSpeechEnded = false;

// Whiteboard
let currentTool  = "pen";
let currentColor = "#000000";
let canvasDirty  = false;
let wbDrawing    = false;
let wbLastX = 0, wbLastY = 0;

// Frame sending
let frameInterval   = null;
const compositeCanvas = document.createElement("canvas");
compositeCanvas.width = 640;
compositeCanvas.height = 360;

// Transcript
let transcriptEntryId = 0;
let currentTeacherEntry = null;
let currentStudentEntry = null;

// Session state
let sessionTopic     = "";
let sessionMaterials = "";
let sessionStartTime = 0;
let sessionDuration  = 0;
let timerInterval    = null;

// File uploads
const fileDropZone = document.getElementById("fileDropZone");
const fileInput    = document.getElementById("fileInput");
let uploadedFiles  = []; // { name, mimeType, base64, size }

// Firebase
let db = null;

// ── Startup tone & sounds ────────────────────────────────────────────────────
let _audioCtx = null;
let _startupPlayed = false;

function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function playStartupTone() {
  if (_startupPlayed) return;
  const ctx = getAudioCtx();
  const run = () => {
    if (_startupPlayed) return;
    if (ctx.state !== "running") return;
    _startupPlayed = true;
    const dur = 1.7, freq = 196, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.38, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    g.connect(ctx.destination);
    [1, 1.006, 2.48].forEach((mult, i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(freq * mult, t);
      if (i < 2) {
        o.frequency.linearRampToValueAtTime(freq * mult * 1.02, t + dur * 0.5);
        o.connect(g);
      } else {
        const g3 = ctx.createGain();
        g3.gain.setValueAtTime(0.22, t);
        g3.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.6);
        o.connect(g3); g3.connect(g);
      }
      o.start(t); o.stop(t + dur);
    });
  };
  if (ctx.state === "suspended") ctx.resume().then(run); else run();
}

function playButtonSound(type) {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.connect(ctx.destination);
    if (type === "confirm") {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.2, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      [320, 324].forEach(f => {
        const o = ctx.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(f, t);
        o.frequency.linearRampToValueAtTime(f + 80, t + 0.12);
        o.connect(g); o.start(t); o.stop(t + 0.28);
      });
    } else {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.15, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      const o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(180, t + 0.22);
      o.connect(g); o.start(t); o.stop(t + 0.22);
    }
  } catch (_) {}
}

["click", "touchstart", "keydown"].forEach(ev => {
  document.addEventListener(ev, () => { if (!_startupPlayed) playStartupTone(); }, { once: true, capture: true });
});

// ── Landing → Setup ──────────────────────────────────────────────────────────
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

// ── Mode tabs ────────────────────────────────────────────────────────────────
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

// ── Persona selection ────────────────────────────────────────────────────────
document.querySelectorAll(".persona-card").forEach(card => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".persona-card").forEach(c => c.classList.remove("selected"));
    card.classList.add("selected");
    selectedPersona = card.dataset.persona;
  });
});

// ── Student selection (classroom) ────────────────────────────────────────────
document.querySelectorAll(".student-card").forEach(card => {
  card.addEventListener("click", () => {
    const id = card.dataset.student, color = card.dataset.color;
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
  if (!classroomMode) { startBtn.disabled = false; startBtn.textContent = "Start teaching"; return; }
  const n = selectedStudents.size;
  startBtn.disabled = n < 2;
  if      (n === 0) { startBtn.textContent = "Select 2\u20134 students";        studentHint.textContent = "Select 2\u20134"; }
  else if (n === 1) { startBtn.textContent = "Select 1 more student";           studentHint.textContent = "1 selected"; }
  else              { startBtn.textContent = `Start teaching (${n} students)`;   studentHint.textContent = `${n} selected`; }
}

// ── Topic loading ────────────────────────────────────────────────────────────
function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

async function loadTopics() {
  try {
    const res = await fetch(`${location.origin}/api/topics`);
    const data = await res.json();
    topicSelect.innerHTML = data.topics.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  } catch { topicSelect.innerHTML = '<option value="">Could not load topics</option>'; }
}

function getSelectedTopic() {
  return customTopic.value.trim() || topicSelect.value || "the topic";
}

// ── File upload handling ──────────────────────────────────────────────────────
const ACCEPTED_TYPES = new Set([
  "application/pdf",
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "text/plain", "text/markdown", "text/csv",
]);
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

function getFileIcon(mimeType) {
  if (mimeType === "application/pdf") return "\u{1F4C4}";
  if (mimeType.startsWith("image/"))  return "\u{1F5BC}";
  return "\u{1F4DD}";
}

function formatFileSize(bytes) {
  if (bytes < 1024)           return bytes + " B";
  if (bytes < 1024 * 1024)    return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function renderFileList() {
  const zone = fileDropZone;
  const existing = zone.querySelector(".file-list");
  if (existing) existing.remove();
  const existingIcon  = zone.querySelector(".file-drop-icon");
  const existingLabel = zone.querySelector(".file-drop-label");
  const existingAdd   = zone.querySelector(".file-drop-add-more");
  if (existingAdd) existingAdd.remove();

  if (uploadedFiles.length === 0) {
    zone.classList.remove("has-files");
    if (existingIcon)  existingIcon.style.display = "";
    if (existingLabel) existingLabel.style.display = "";
    return;
  }

  zone.classList.add("has-files");
  if (existingIcon)  existingIcon.style.display = "none";
  if (existingLabel) existingLabel.style.display = "none";

  const list = document.createElement("div");
  list.className = "file-list";

  uploadedFiles.forEach((file, idx) => {
    const item = document.createElement("div");
    item.className = "file-item";
    item.innerHTML = `
      <span class="file-item-icon">${getFileIcon(file.mimeType)}</span>
      <span class="file-item-name">${escapeHtml(file.name)}</span>
      <span class="file-item-size">${formatFileSize(file.size)}</span>
    `;
    const removeBtn = document.createElement("button");
    removeBtn.className = "file-item-remove";
    removeBtn.textContent = "\u2715";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      uploadedFiles.splice(idx, 1);
      renderFileList();
    });
    item.appendChild(removeBtn);
    list.appendChild(item);
  });

  zone.appendChild(list);

  const addMore = document.createElement("button");
  addMore.className = "file-drop-add-more";
  addMore.textContent = "+ Add more files";
  addMore.addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
  zone.appendChild(addMore);
}

async function processFiles(files) {
  for (const file of files) {
    // Determine mime type (handle common extensions for unknown types)
    let mimeType = file.type;
    if (!mimeType) {
      const ext = file.name.split(".").pop().toLowerCase();
      if (ext === "md") mimeType = "text/markdown";
      else if (ext === "txt") mimeType = "text/plain";
      else if (ext === "csv") mimeType = "text/csv";
      else if (ext === "pdf") mimeType = "application/pdf";
    }

    if (!ACCEPTED_TYPES.has(mimeType)) {
      // Try to handle docx/doc as text extraction
      if (file.name.match(/\.(doc|docx)$/i)) {
        // Read as text best-effort
        try {
          const text = await file.text();
          uploadedFiles.push({ name: file.name, mimeType: "text/plain", base64: btoa(unescape(encodeURIComponent(text))), size: file.size });
        } catch (_) {}
        continue;
      }
      continue; // Skip unsupported types
    }

    if (file.size > MAX_FILE_SIZE) continue;

    // Prevent duplicates
    if (uploadedFiles.some(f => f.name === file.name && f.size === file.size)) continue;

    const base64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.readAsDataURL(file);
    });

    uploadedFiles.push({ name: file.name, mimeType, base64, size: file.size });
  }
  renderFileList();
}

// Drop zone events
fileDropZone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  if (fileInput.files.length) processFiles(Array.from(fileInput.files));
  fileInput.value = ""; // Reset so same file can be re-added
});

fileDropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.stopPropagation();
  fileDropZone.classList.add("drag-over");
});

fileDropZone.addEventListener("dragleave", (e) => {
  e.preventDefault();
  e.stopPropagation();
  fileDropZone.classList.remove("drag-over");
});

fileDropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  e.stopPropagation();
  fileDropZone.classList.remove("drag-over");
  if (e.dataTransfer.files.length) processFiles(Array.from(e.dataTransfer.files));
});

// ── Orb state machine ────────────────────────────────────────────────────────
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
  if (!classroomMode || name === "idle") applyOrbColor(s.color, s.glow);
  orb.style.setProperty("--orb-speed", s.speed);
  orbPillDot.style.setProperty("--orb-speed", s.speed);
  orb.style.animation = "none"; void orb.offsetWidth; orb.style.animation = "";
  orbWrap.classList.toggle("rings-on", s.rings);
  orbLabel.textContent = s.label;
  orbPillLabel.textContent = s.label;
}

function setSpeaker(name) {
  const student = STUDENTS[name.toLowerCase()];
  if (!student) return;
  applyOrbColor(student.color, student.glow);
  speakerLabel.textContent = student.name;
  speakerLabel.style.color = student.color;
}

// ── Classroom orbs ───────────────────────────────────────────────────────────
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
    const active = sid === id;
    circle.classList.toggle("speaking", active); circle.classList.toggle("idle", !active);
    name.classList.toggle("speaking", active);   name.classList.toggle("idle", !active);
    rings.classList.toggle("speaking", active);
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

// ── Mic & status ─────────────────────────────────────────────────────────────
function setMicActive(active) {
  micDot.classList.toggle("active", active);
  micLabel.classList.toggle("active", active);
  micLabel.textContent = active ? "mic on" : "mic off";
}

function setStatus(msg, type) {
  statusText.textContent = msg;
  statusDot.className = "status-dot" + (type === "connected" ? " connected" : type === "error" ? " error" : "");
}

// ── PCM helpers ──────────────────────────────────────────────────────────────
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
  for (let i = 0; i < pcm16.length; i++) f32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
  return f32;
}

// ── Audio playback ───────────────────────────────────────────────────────────
async function playPcm24k(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength === 0) return;
  try {
    audioChunksReceived++;
    if (audioChunksReceived === 1) setOrbState("speaking");
    if (!playbackContext) playbackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: RECV_SAMPLE_RATE });
    if (playbackContext.state === "suspended") await playbackContext.resume();

    const pcm16 = new Int16Array(arrayBuffer);
    const f32 = pcm16ToFloat32(pcm16);
    const buf = playbackContext.createBuffer(1, f32.length, RECV_SAMPLE_RATE);
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
  } catch (err) { console.error("playPcm24k:", err); }
}

function stopPlayback() {
  playbackGainNode = null;
  if (playbackContext) { try { playbackContext.close(); } catch (_) {} playbackContext = null; }
  nextPlayTime = 0;
}

// ── Transcript management ────────────────────────────────────────────────────
function addTranscriptEntry(speaker, type) {
  const id = ++transcriptEntryId;
  const div = document.createElement("div");
  div.className = "t-entry";

  const sp = document.createElement("div");
  sp.className = `t-speaker ${type}`;
  sp.textContent = speaker;

  const txt = document.createElement("div");
  txt.className = "t-text";

  div.appendChild(sp);
  div.appendChild(txt);
  transcriptBody.appendChild(div);
  transcriptBody.scrollTop = transcriptBody.scrollHeight;

  return { id, el: div, textEl: txt, rawText: "" };
}

function appendToEntry(entry, chunk) {
  if (!entry) return;
  const t = entry.rawText;
  if (t && !t.endsWith(" ") && !chunk.startsWith(" ") && !/^[.,!?;:]/.test(chunk)) {
    entry.rawText += " ";
  }
  entry.rawText += chunk;
  entry.textEl.textContent = entry.rawText;
  transcriptBody.scrollTop = transcriptBody.scrollHeight;
}

async function cleanupEntry(entry) {
  if (!entry || !entry.rawText.trim()) return;
  entry.textEl.classList.add("cleaning");
  try {
    const res = await fetch("/api/cleanup-transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: entry.rawText,
        topic: sessionTopic,
        materials: (sessionMaterials || "").substring(0, 2000),
      }),
    });
    const { cleaned } = await res.json();
    if (cleaned && cleaned.trim()) {
      entry.rawText = cleaned;
      entry.textEl.textContent = cleaned;
    }
  } catch (_) {}
  entry.textEl.classList.remove("cleaning");
}

// ── Coaching tips ────────────────────────────────────────────────────────────
function addCoachingTip(tipText) {
  const empty = coachingBody.querySelector(".coaching-empty");
  if (empty) empty.remove();

  const div = document.createElement("div");
  div.className = "coaching-tip";
  div.innerHTML = tipText.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  coachingBody.appendChild(div);
  coachingBody.scrollTop = coachingBody.scrollHeight;

  while (coachingBody.children.length > 8) coachingBody.removeChild(coachingBody.firstChild);
}

// ── Whiteboard ───────────────────────────────────────────────────────────────
function initWhiteboard() {
  if (whiteboardInited) return;
  whiteboardInited = true;
  const ctx = whiteboardCanvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, whiteboardCanvas.width, whiteboardCanvas.height);
  setupWhiteboardEvents();
}

function setupWhiteboardEvents() {
  const canvas = whiteboardCanvas;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
  }

  function onStart(e) {
    e.preventDefault();
    if (currentTool === "text") {
      const pos = getPos(e);
      const text = prompt("Enter text:");
      if (text) {
        const ctx = canvas.getContext("2d");
        ctx.font = "bold 24px Inter, system-ui, sans-serif";
        ctx.fillStyle = currentColor;
        ctx.fillText(text, pos.x, pos.y);
        canvasDirty = true;
      }
      return;
    }
    wbDrawing = true;
    const pos = getPos(e);
    wbLastX = pos.x; wbLastY = pos.y;
  }

  function onMove(e) {
    if (!wbDrawing) return;
    e.preventDefault();
    const pos = getPos(e);
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = currentTool === "eraser" ? 30 : 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = currentTool === "eraser" ? "#ffffff" : currentColor;
    ctx.beginPath();
    ctx.moveTo(wbLastX, wbLastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    wbLastX = pos.x; wbLastY = pos.y;
    canvasDirty = true;
  }

  function onEnd() { wbDrawing = false; }

  canvas.addEventListener("mousedown", onStart);
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseup", onEnd);
  canvas.addEventListener("mouseleave", onEnd);
  canvas.addEventListener("touchstart", onStart, { passive: false });
  canvas.addEventListener("touchmove", onMove, { passive: false });
  canvas.addEventListener("touchend", onEnd);
}

function clearWhiteboard() {
  const ctx = whiteboardCanvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, whiteboardCanvas.width, whiteboardCanvas.height);
  canvasDirty = true;
}

// Whiteboard toolbar events
document.querySelectorAll(".wb-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tool = btn.dataset.tool;
    if (tool === "clear") { clearWhiteboard(); return; }
    currentTool = tool;
    document.querySelectorAll(".wb-btn").forEach(b => b.classList.toggle("active", b.dataset.tool === tool));
  });
});

document.querySelectorAll(".wb-color").forEach(swatch => {
  swatch.addEventListener("click", () => {
    currentColor = swatch.dataset.color;
    document.querySelectorAll(".wb-color").forEach(s => s.classList.toggle("active", s === swatch));
    if (currentTool === "eraser") {
      currentTool = "pen";
      document.querySelectorAll(".wb-btn").forEach(b => b.classList.toggle("active", b.dataset.tool === "pen"));
    }
  });
});

// ── Camera management ────────────────────────────────────────────────────────
async function startCamera(withAudio = false) {
  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 360, frameRate: 30 },
    audio: withAudio,
  });
  cameraFeed.srcObject = cameraStream;
  cameraPipFeed.srcObject = cameraStream;
  await cameraFeed.play().catch(() => {});
  await cameraPipFeed.play().catch(() => {});
}

function stopCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  cameraFeed.srcObject = null;
  cameraPipFeed.srcObject = null;
}

// ── Screen share management ─────────────────────────────────────────────────
async function startScreenShare() {
  screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: { cursor: "always" },
  });
  screenFeed.srcObject = screenStream;
  await screenFeed.play().catch(() => {});

  // Handle browser's "Stop sharing" button
  screenStream.getVideoTracks()[0].onended = () => {
    screenEnabled = false;
    stopScreenShare();
    updateMediaLayout();
  };
}

function stopScreenShare() {
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  screenFeed.srcObject = null;
}

// ── Media layout ─────────────────────────────────────────────────────────────
const sessionCenter = document.querySelector(".session-center");

function updateMediaLayout() {
  const activeSources = [cameraEnabled, whiteboardEnabled, screenEnabled].filter(Boolean).length;
  const dualMedia   = activeSources === 2;
  const tripleMedia = activeSources === 3;

  // Whiteboard in media container (top of center)
  mediaContainer.classList.toggle("hidden", !whiteboardEnabled);
  whiteboardCanvas.style.display = whiteboardEnabled ? "block" : "none";
  cameraFeed.style.display = "none"; // Hidden — only used internally
  wbToolbar.classList.toggle("visible", whiteboardEnabled);
  orbPill.classList.toggle("visible", whiteboardEnabled);

  // Screen share container
  screenContainer.classList.toggle("visible", screenEnabled);

  // Camera self-view in center column
  cameraContainer.classList.toggle("visible", cameraEnabled);

  // Layout modes: dual-media when 2 sources, triple-media when all 3
  sessionCenter.classList.toggle("dual-media", dualMedia);
  sessionCenter.classList.toggle("triple-media", tripleMedia);

  // Orb: hide when any media is active (except classroom uses its own orbs)
  const hasMedia = cameraEnabled || whiteboardEnabled || screenEnabled;
  orbArea.classList.toggle("hidden", hasMedia || classroomMode);

  camToggleBtn.classList.toggle("active", cameraEnabled);
  wbToggleBtn.classList.toggle("active", whiteboardEnabled);
  screenToggleBtn.classList.toggle("active", screenEnabled);
}

// ── Frame sending (camera always, whiteboard only on changes) ────────────────
function startFrameSending() {
  if (frameInterval) clearInterval(frameInterval);
  frameInterval = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!cameraEnabled && !whiteboardEnabled && !screenEnabled) return;

    const ctx = compositeCanvas.getContext("2d");

    // Always send camera frame when camera is on
    if (cameraEnabled && cameraPipFeed.readyState >= 2) {
      ctx.drawImage(cameraPipFeed, 0, 0, 640, 360);
      const base64 = compositeCanvas.toDataURL("image/jpeg", 0.7).split(",")[1];
      try { ws.send(JSON.stringify({ type: "video_frame", base64 })); } catch (_) {}
    }

    // Only send whiteboard frame when something changed
    if (whiteboardEnabled && canvasDirty) {
      ctx.drawImage(whiteboardCanvas, 0, 0, 640, 360);
      const base64 = compositeCanvas.toDataURL("image/jpeg", 0.7).split(",")[1];
      try { ws.send(JSON.stringify({ type: "video_frame", base64 })); } catch (_) {}
      canvasDirty = false;
    }

    // Always send screen share frame when active
    if (screenEnabled && screenFeed.readyState >= 2) {
      ctx.drawImage(screenFeed, 0, 0, 640, 360);
      const base64 = compositeCanvas.toDataURL("image/jpeg", 0.7).split(",")[1];
      try { ws.send(JSON.stringify({ type: "video_frame", base64 })); } catch (_) {}
    }
  }, 1000);
}

// ── Mic capture ──────────────────────────────────────────────────────────────
async function startMic(existingStream = null) {
  micStream = existingStream || await navigator.mediaDevices.getUserMedia({ audio: true });
  // Use only the audio tracks to avoid re-stopping video tracks on disconnect
  const audioOnlyStream = new MediaStream(micStream.getAudioTracks());
  micContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SEND_SAMPLE_RATE });
  const source = micContext.createMediaStreamSource(audioOnlyStream);

  micProcessor = micContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
  micProcessor.onaudioprocess = e => {
    if (micMuted || !ws || ws.readyState !== WebSocket.OPEN) return;
    // Echo suppression: don't send audio while student is speaking
    // (mic picks up student playback from speakers, which would interrupt the student)
    if (currentOrbState === "speaking") return;
    const input = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);

    if (rms > SPEECH_ENERGY_THRESHOLD) {
      if (!vadInSpeech) {
        vadInSpeech = true;
        teacherSpeechEnded = false;
        setMicActive(true);
        if (currentOrbState !== "speaking") setOrbState("listening");
        try { ws.send(JSON.stringify({ type: "speech_start" })); } catch (_) {}
      }
      vadSilenceCount = 0;
    } else if (vadInSpeech) {
      vadSilenceCount++;
      if (vadSilenceCount >= SILENCE_BUFFERS_BEFORE_END) {
        vadInSpeech = false;
        vadSilenceCount = 0;
        teacherSpeechEnded = true;
        setMicActive(false);
        if (currentOrbState !== "speaking") setOrbState("thinking");
        try { ws.send(JSON.stringify({ type: "speech_end" })); } catch (_) {}

        // Cleanup teacher transcript
        if (currentTeacherEntry && currentTeacherEntry.rawText.trim()) {
          cleanupEntry(currentTeacherEntry);
        }
        currentTeacherEntry = null;
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

// ── Session timer ────────────────────────────────────────────────────────────
function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function startTimer() {
  sessionStartTime = Date.now();
  sessionDuration = 0;
  sessionTimer.textContent = "00:00";
  timerInterval = setInterval(() => {
    sessionDuration = Math.floor((Date.now() - sessionStartTime) / 1000);
    sessionTimer.textContent = formatTime(sessionDuration);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// ── Session lifecycle ────────────────────────────────────────────────────────
function showSession(topic) {
  setupScreen.style.display = "none";
  reflectionScreen.style.display = "none";
  sessionScreen.style.display = "flex";
  sessionScreen.classList.toggle("classroom-mode", classroomMode);

  sessionTopicLabel.textContent = topic;
  speakerLabel.textContent = "";
  speakerLabel.style.color = "";
  setOrbState("idle");
  setStatus("Connecting\u2026", "");

  // Clear transcript & coaching
  transcriptBody.innerHTML = "";
  coachingBody.innerHTML = '<div class="coaching-empty">Tips will appear as you teach\u2026</div>';
  transcriptEntryId = 0;
  currentTeacherEntry = null;
  currentStudentEntry = null;

  if (classroomMode) createClassroomOrbs();
  updateMediaLayout();
}

function showSetup() {
  sessionScreen.style.display = "none";
  reflectionScreen.style.display = "none";
  sessionScreen.classList.remove("classroom-mode");
  setupScreen.style.display = "flex";
  setOrbState("idle");
  stopBtn.disabled = false;
}

function showReflection(data) {
  sessionScreen.style.display = "none";
  reflectionScreen.style.display = "flex";

  reflectionSummary.textContent = data.summary || "";

  function fillList(el, items) {
    el.innerHTML = "";
    (items || []).forEach(item => {
      const li = document.createElement("li");
      li.textContent = item;
      el.appendChild(li);
    });
    if (!items || items.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No data";
      li.style.color = "#9CA3AF";
      el.appendChild(li);
    }
  }

  fillList(reflectionStrengths, data.strengths);
  fillList(reflectionGaps, data.gaps);
  fillList(reflectionQuestions, data.topQuestions);
  fillList(reflectionImprovements, data.improvements);

  // Save to Firebase
  saveSession({ topic: sessionTopic, reflection: data, duration: sessionDuration });
}

function disconnect(keepScreen = false) {
  if (ws) { try { ws.close(); } catch (_) {} ws = null; }
  if (micProcessor) { try { micProcessor.disconnect(); } catch (_) {} micProcessor = null; }
  if (micStream) { micStream.getAudioTracks().forEach(t => t.stop()); micStream = null; }
  if (micContext) { try { micContext.close(); } catch (_) {} micContext = null; }
  stopCamera();
  stopScreenShare();
  screenEnabled = false;
  if (frameInterval) { clearInterval(frameInterval); frameInterval = null; }
  stopTimer();
  stopPlayback();

  audioChunksReceived = 0;
  vadInSpeech = false;
  vadSilenceCount = 0;
  micMuted = false;
  teacherSpeechEnded = false;
  currentTeacherEntry = null;
  currentStudentEntry = null;
  activeSpeakerName = "";
  awaitingReflection = false;
  whiteboardInited = false;

  if (!keepScreen) {
    if (lastError) setStatus(lastError, "error");
    setTimeout(showSetup, 800);
  }
}

async function connect() {
  lastError = null;
  awaitingReflection = false;
  sessionTopic = getSelectedTopic();
  sessionMaterials = materialsEl.value.trim();
  cameraEnabled = useCameraEl.checked;
  whiteboardEnabled = useWhiteboardEl.checked;
  screenEnabled = false; // Screen share toggled on during session
  // Always enable video model — screen share can be toggled mid-session
  const useVideo = true;
  const studentsParam = classroomMode ? Array.from(selectedStudents).join(",") : "";

  showSession(sessionTopic);

  if (!playbackContext) playbackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: RECV_SAMPLE_RATE });
  if (playbackContext.state === "suspended") await playbackContext.resume();

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${location.host}/ws/live`
    + `?topic=${encodeURIComponent(sessionTopic)}`
    + `&persona=${encodeURIComponent(selectedPersona)}`
    + `&video=${useVideo ? "1" : "0"}`
    + `&classroom=${classroomMode ? "1" : "0"}`
    + (studentsParam ? `&students=${encodeURIComponent(studentsParam)}` : "")
    + (sessionMaterials ? `&materials=${encodeURIComponent(sessionMaterials)}` : "");

  ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  ws.onopen = async () => {
    setStatus("Connected", "connected");
    try {
      // Send uploaded study material files as initial context
      for (const file of uploadedFiles) {
        try {
          ws.send(JSON.stringify({
            type: "material_file",
            name: file.name,
            mimeType: file.mimeType,
            base64: file.base64,
          }));
        } catch (_) {}
      }

      if (cameraEnabled) {
        // Get audio+video together to avoid dual getUserMedia permission issues
        await startCamera(true);
        await startMic(cameraStream);
      } else {
        await startMic();
      }
      if (whiteboardEnabled) initWhiteboard();
      updateMediaLayout();
      startFrameSending();
      startTimer();
    } catch (e) {
      setStatus("Camera/mic failed: " + e.message, "error");
    }
  };

  ws.onclose = () => {
    if (!awaitingReflection) disconnect();
  };

  ws.onerror = () => {
    lastError = "Connection error.";
    setStatus("Connection error", "error");
  };

  ws.onmessage = async event => {
    // Binary audio
    if (event.data instanceof ArrayBuffer) { await playPcm24k(event.data); return; }
    if (event.data instanceof Blob) { await playPcm24k(await event.data.arrayBuffer()); return; }

    try {
      const msg = JSON.parse(event.data);

      // Status
      if (msg.type === "info") setStatus(msg.message || "", "connected");
      if (msg.type === "error") { lastError = msg.message; setStatus(msg.message, "error"); }

      // Teacher transcript (from Gemini inputAudioTranscription)
      if (msg.type === "teacher_transcript" && msg.text) {
        if (!currentTeacherEntry) {
          currentTeacherEntry = addTranscriptEntry("You", "teacher");
        }
        appendToEntry(currentTeacherEntry, msg.text);
      }

      // Student transcript
      if (msg.type === "transcript" && msg.text) {
        if (!currentStudentEntry) {
          const speaker = classroomMode ? (activeSpeakerName || "Student") : "Student";
          currentStudentEntry = addTranscriptEntry(speaker, "student");
        }
        appendToEntry(currentStudentEntry, msg.text);
      }

      // Solo turn complete
      if (msg.type === "turn_complete") {
        audioChunksReceived = 0;
        currentStudentEntry = null;
        setOrbState("listening");
        setStatus("Your turn \u2014 speak and pause when done.", "connected");
      }

      // Classroom student speaking
      if (msg.type === "student_speaking" && msg.name) {
        activeSpeakerName = STUDENTS[msg.name.toLowerCase()]?.name || msg.name;
        if (classroomMode) {
          activateStudentOrb(msg.name.toLowerCase());
          setStatus(`${activeSpeakerName} is speaking\u2026`, "connected");
        } else {
          setSpeaker(msg.name);
        }
      }

      // Classroom turn complete
      if (msg.type === "student_turn_complete" && msg.studentId) {
        deactivateStudentOrb(msg.studentId);
        audioChunksReceived = 0;
        currentStudentEntry = null;
        setStatus("Your turn \u2014 speak and pause when done.", "connected");
      }

      // Emotion
      if (msg.type === "emotion" && SERVER_EMOTION_STATES.has(msg.state)) {
        if (!classroomMode) setOrbState(msg.state);
      }

      // Audio (solo)
      if (msg.type === "audio" && msg.base64) {
        const binary = atob(msg.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        await playPcm24k(bytes.buffer);
      }

      // Audio (classroom)
      if (msg.type === "classroom_audio" && msg.base64) {
        const binary = atob(msg.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        await playPcm24k(bytes.buffer);
      }

      // Coaching tip
      if (msg.type === "coaching_tip" && msg.tip) {
        addCoachingTip(msg.tip);
      }

      // Reflection
      if (msg.type === "reflection" && msg.data) {
        awaitingReflection = false;
        disconnect(true);
        showReflection(msg.data);
      }
    } catch (_) {}
  };
}

// ── Controls ─────────────────────────────────────────────────────────────────
startBtn.addEventListener("click", async () => {
  if (classroomMode && selectedStudents.size < 2) return;
  if (!getSelectedTopic()) return;
  playButtonSound("confirm");
  startBtn.disabled = true;
  await connect();
  startBtn.disabled = false;
});

stopBtn.addEventListener("click", () => {
  playButtonSound("end");
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ type: "request_reflection" })); } catch (_) {}
    awaitingReflection = true;
    setStatus("Generating reflection\u2026", "connected");
    stopBtn.disabled = true;
  } else {
    disconnect();
  }
});

muteBtn.addEventListener("click", () => {
  micMuted = !micMuted;
  muteBtn.innerHTML = micMuted
    ? '<span class="icon">&#x1F507;</span> Unmute'
    : '<span class="icon">&#x1F3A4;</span> Mute';
  muteBtn.classList.toggle("muted", micMuted);
  // Always reset mic indicator (it'll re-activate when VAD detects speech after unmute)
  setMicActive(false);
  // Reset VAD state on mute so it doesn't get stuck
  if (micMuted) {
    vadInSpeech = false;
    vadSilenceCount = 0;
  }
});

doneSpeakingBtn.addEventListener("click", () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify({ type: "speech_end" })); } catch (_) {}
  teacherSpeechEnded = true;
  vadInSpeech = false;
  vadSilenceCount = 0;
  setOrbState("thinking");
  setMicActive(false);

  if (currentTeacherEntry && currentTeacherEntry.rawText.trim()) {
    cleanupEntry(currentTeacherEntry);
  }
  currentTeacherEntry = null;
});

camToggleBtn.addEventListener("click", async () => {
  if (cameraEnabled) {
    cameraEnabled = false;
    stopCamera();
    updateMediaLayout();
  } else {
    try {
      cameraEnabled = true;
      updateMediaLayout(); // Make PiP container visible BEFORE play()
      await startCamera();
    } catch (e) {
      cameraEnabled = false;
      updateMediaLayout();
      setStatus("Camera failed: " + e.message, "error");
      return;
    }
  }
});

wbToggleBtn.addEventListener("click", () => {
  whiteboardEnabled = !whiteboardEnabled;
  if (whiteboardEnabled && !whiteboardInited) initWhiteboard();
  updateMediaLayout();
});

screenToggleBtn.addEventListener("click", async () => {
  if (screenEnabled) {
    screenEnabled = false;
    stopScreenShare();
    updateMediaLayout();
  } else {
    try {
      screenEnabled = true;
      updateMediaLayout(); // Show container before stream starts
      await startScreenShare();
      // Re-start frame sending so it picks up screen share
      startFrameSending();
    } catch (e) {
      screenEnabled = false;
      updateMediaLayout();
      // User cancelled the share picker or error — silent fail
      if (e.name !== "NotAllowedError") {
        setStatus("Screen share failed: " + e.message, "error");
      }
    }
  }
});

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify({ type: "text_input", text })); } catch (_) {}
  // Show typed message in transcript
  const entry = addTranscriptEntry("You (typed)", "teacher");
  entry.rawText = text;
  entry.textEl.textContent = text;
  chatInput.value = "";
  setOrbState("thinking");
}

chatSendBtn.addEventListener("click", sendChatMessage);
chatInput.addEventListener("keydown", e => { if (e.key === "Enter") sendChatMessage(); });

// Keyboard shortcuts (when not typing)
document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (sessionScreen.style.display !== "flex") return;
  if (e.key === "m" || e.key === "M") { muteBtn.click(); e.preventDefault(); }
});

// ── Reflection screen controls ───────────────────────────────────────────────
teachAgainBtn.addEventListener("click", () => {
  reflectionScreen.style.display = "none";
  showSetup();
});

changeTopicBtn.addEventListener("click", () => {
  reflectionScreen.style.display = "none";
  showSetup();
});

// ── Firebase ─────────────────────────────────────────────────────────────────
function initFirebase() {
  if (!window.__FIREBASE_CONFIG || !window.__FIREBASE_CONFIG.apiKey) return;
  if (typeof firebase === "undefined") { setTimeout(initFirebase, 500); return; }
  try {
    if (!firebase.apps.length) firebase.initializeApp(window.__FIREBASE_CONFIG);
    firebase.auth().signInAnonymously().catch(e => console.warn("[Dasko] Firebase auth:", e));
    db = firebase.firestore();
    console.log("[Dasko] Firebase initialized");
  } catch (e) { console.warn("[Dasko] Firebase init:", e); }
}

async function saveSession(data) {
  if (!db) return;
  try {
    const user = firebase.auth().currentUser;
    await db.collection("sessions").add({
      ...data,
      userId: user?.uid || "anonymous",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    console.log("[Dasko] Session saved to Firebase");
  } catch (e) { console.warn("[Dasko] Firebase save:", e); }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
loadTopics();
initFirebase();
