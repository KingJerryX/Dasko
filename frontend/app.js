/**
 * Dasko — mic/camera capture, WebSocket proxy, audio playback, orb state engine.
 */

// ── DOM refs ───────────────────────────────────────────────────────────────────
const landingScreen     = document.getElementById("landing-screen");
const setupScreen       = document.getElementById("setup-screen");
const sessionScreen     = document.getElementById("session-screen");
const reflectionScreen  = document.getElementById("reflection-screen");
const getStartedBtn     = document.getElementById("getStartedBtn");
const topicSelect       = document.getElementById("topic");
const customTopic       = document.getElementById("customTopic");
const materialsEl         = document.getElementById("materials");
const materialsDropzone   = document.getElementById("materialsDropzone");
const materialsFileInput  = document.getElementById("materialsFileInput");
const materialsStatusEl   = document.getElementById("materialsStatus");
const useCameraEl       = document.getElementById("useCamera");
const useWhiteboardEl   = document.getElementById("useWhiteboard");
const whiteboardCanvas  = document.getElementById("whiteboardCanvas");
const wbPen             = document.getElementById("wbPen");
const wbEraser          = document.getElementById("wbEraser");
const wbText            = document.getElementById("wbText");
const wbClear           = document.getElementById("wbClear");
const wbColorsEl        = document.getElementById("wbColors");
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

// Panels
const transcriptBody    = document.getElementById("transcriptBody");
const coachingBody      = document.getElementById("coachingBody");
const coachingEmpty     = document.getElementById("coachingEmpty");

// Reflection
const reflLoading           = document.getElementById("reflLoading");
const reflContent           = document.getElementById("reflContent");
const reflTopicBadge        = document.getElementById("reflTopicBadge");
const reflSummary           = document.getElementById("reflSummary");
const reflStrengths         = document.getElementById("reflStrengths");
const reflGaps              = document.getElementById("reflGaps");
const reflQuestions         = document.getElementById("reflQuestions");
const reflImprovements      = document.getElementById("reflImprovements");
const reflTeachAgainBtn     = document.getElementById("reflTeachAgainBtn");
const reflNewTopicBtn       = document.getElementById("reflNewTopicBtn");

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

// ── Startup tone & button sounds ───────────────────────────────────────────────
let _startupAudioContext = null;
let _startupTonePlayed   = false;

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
      const baseFreq  = 196;
      const gainNode  = ctx.createGain();
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.38, ctx.currentTime + 0.04);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      gainNode.connect(ctx.destination);
      const o1 = ctx.createOscillator(); o1.type = "sine";
      o1.frequency.setValueAtTime(baseFreq, ctx.currentTime);
      o1.frequency.linearRampToValueAtTime(baseFreq * 1.02, ctx.currentTime + duration * 0.5);
      o1.connect(gainNode); o1.start(ctx.currentTime); o1.stop(ctx.currentTime + duration);
      const o2 = ctx.createOscillator(); o2.type = "sine";
      o2.frequency.setValueAtTime(baseFreq * 1.006, ctx.currentTime);
      o2.frequency.linearRampToValueAtTime(baseFreq * 1.024, ctx.currentTime + duration * 0.5);
      o2.connect(gainNode); o2.start(ctx.currentTime); o2.stop(ctx.currentTime + duration);
      const o3 = ctx.createOscillator(); o3.type = "sine";
      o3.frequency.setValueAtTime(baseFreq * 2.48, ctx.currentTime);
      const g3 = ctx.createGain();
      g3.gain.setValueAtTime(0.22, ctx.currentTime);
      g3.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration * 0.6);
      o3.connect(g3); g3.connect(gainNode); o3.start(ctx.currentTime); o3.stop(ctx.currentTime + duration);
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
      const o1 = ctx.createOscillator(); o1.type = "sine";
      o1.frequency.setValueAtTime(320, t); o1.frequency.linearRampToValueAtTime(400, t + 0.12);
      o1.connect(gainNode); o1.start(t); o1.stop(t + 0.28);
      const o2 = ctx.createOscillator(); o2.type = "sine";
      o2.frequency.setValueAtTime(324, t); o2.frequency.linearRampToValueAtTime(404, t + 0.12);
      o2.connect(gainNode); o2.start(t); o2.stop(t + 0.28);
    } else {
      gainNode.gain.setValueAtTime(0, t);
      gainNode.gain.linearRampToValueAtTime(0.15, t + 0.015);
      gainNode.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      const o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.22);
      o.connect(gainNode); o.start(t); o.stop(t + 0.22);
    }
  } catch (_) {}
}

function onFirstInteraction() {
  if (_startupTonePlayed) return;
  playStartupTone();
}
["click", "touchstart", "keydown"].forEach(ev =>
  document.addEventListener(ev, onFirstInteraction, { once: true, capture: true })
);

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
  modeTabSolo.classList.add("active"); modeTabClassroom.classList.remove("active");
  soloSection.style.display = "block"; classroomSection.style.display = "none";
  updateStartButton();
});
modeTabClassroom.addEventListener("click", () => {
  classroomMode = true;
  modeTabClassroom.classList.add("active"); modeTabSolo.classList.remove("active");
  soloSection.style.display = "none"; classroomSection.style.display = "block";
  updateStartButton();
});

// ── Persona selection ──────────────────────────────────────────────────────────
document.querySelectorAll(".persona-card").forEach(card => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".persona-card").forEach(c => c.classList.remove("selected"));
    card.classList.add("selected");
    selectedPersona = card.dataset.persona;
  });
});

// ── Student selection ──────────────────────────────────────────────────────────
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
  if      (n === 0) { startBtn.textContent = "Select 2–4 students";            studentHint.textContent = "Select 2–4"; }
  else if (n === 1) { startBtn.textContent = "Select 1 more student";           studentHint.textContent = "1 selected — need 1 more"; }
  else              { startBtn.textContent = `Start teaching (${n} students)`;  studentHint.textContent = `${n} selected`; }
}

// ── Topic loading ──────────────────────────────────────────────────────────────
function escapeHtml(s) {
  const d = document.createElement("div"); d.textContent = s; return d.innerHTML;
}

async function loadTopics() {
  try {
    const res  = await fetch(`${window.location.origin}/api/topics`);
    const data = await res.json();
    topicSelect.innerHTML = data.topics.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
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
  if (!classroomMode || name === "idle") applyOrbColor(s.color, s.glow);
  orb.style.setProperty("--orb-speed", s.speed);
  orbPillDot.style.setProperty("--orb-speed", s.speed);
  orb.style.animation = "none"; void orb.offsetWidth; orb.style.animation = "";
  orbWrap.classList.toggle("rings-on", s.rings);
  orbLabel.textContent     = s.label;
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

// ── Transcript panel ───────────────────────────────────────────────────────────
let transcriptInitialised = false;
let currentTeacherEntry   = null; // accumulate teacher speech chunks
let currentStudentEntry   = null;

function ensureTranscriptReady() {
  if (!transcriptInitialised) {
    transcriptBody.innerHTML = "";
    transcriptInitialised = true;
  }
}

function addTranscriptEntry(role, label, color, text) {
  ensureTranscriptReady();
  const entry = document.createElement("div");
  entry.className = `tx-entry tx-${role}`;
  const labelEl = document.createElement("div");
  labelEl.className = "tx-label";
  if (color) labelEl.style.color = color;
  labelEl.textContent = label;
  const textEl = document.createElement("div");
  textEl.className = "tx-text";
  textEl.textContent = text;
  entry.appendChild(labelEl);
  entry.appendChild(textEl);
  transcriptBody.appendChild(entry);
  transcriptBody.scrollTop = transcriptBody.scrollHeight;
  return textEl;
}

/** Join ASR chunks without double spaces or missing spaces between words. */
function joinTranscriptChunk(existing, chunk) {
  if (!chunk) return existing || "";
  const c = String(chunk).replace(/\s+/g, " ").trim();
  if (!c) return existing || "";
  if (!existing) return c;
  const last = existing.slice(-1);
  const first = c[0];
  // No space before punctuation; space after word before word
  if (/^[,;:.!?]/.test(c)) return existing + c;
  if (last === " " || first === " ") return existing + c;
  if (/[\s\-—]$/.test(last)) return existing + c;
  return existing + " " + c;
}

/** When true, browser SpeechRecognition drives the teacher line; ignore Live ASR chunks (often garbled). */
let browserTranscriptActive = false;
let speechRecognition     = null;

function appendTeacherTranscript(chunk) {
  if (browserTranscriptActive) return; // Web Speech API is authoritative when available
  ensureTranscriptReady();
  if (!currentTeacherEntry) {
    currentTeacherEntry = addTranscriptEntry("teacher", "You", null, joinTranscriptChunk("", chunk));
  } else {
    currentTeacherEntry.textContent = joinTranscriptChunk(currentTeacherEntry.textContent, chunk);
    transcriptBody.scrollTop = transcriptBody.scrollHeight;
  }
}

// Fix raw ASR output: capitalize first letter, ensure ending punctuation.
function normalizeTranscript(text) {
  if (!text) return text;
  text = text.trim();
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (text.length > 0 && !/[.!?…]$/.test(text)) text += '.';
  return text;
}

// Async: calls server to fix ASR errors using topic context, then patches the DOM node.
async function cleanupTranscriptEntry(el) {
  if (!el || !el.isConnected) return;
  const raw = el.textContent;
  if (!raw || raw.length < 8) return;
  try {
    const res = await fetch('/api/cleanup-transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: raw, topic: getSelectedTopic() }),
    });
    if (!res.ok) return;
    const { cleaned } = await res.json();
    if (cleaned && cleaned.length > 2 && el.isConnected) {
      el.textContent = cleaned;
    }
  } catch (_) {}
}

function appendTeacherTranscriptFromBrowser(chunk) {
  if (!chunk || !String(chunk).trim()) return;
  ensureTranscriptReady();
  if (!currentTeacherEntry) {
    currentTeacherEntry = addTranscriptEntry("teacher", "You", null, String(chunk).trim());
  } else {
    currentTeacherEntry.textContent = joinTranscriptChunk(currentTeacherEntry.textContent, chunk);
    transcriptBody.scrollTop = transcriptBody.scrollHeight;
  }
}

function startBrowserSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || speechRecognition) return;
  try {
    speechRecognition = new SR();
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    speechRecognition.lang = navigator.language || "en-US";
    speechRecognition.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          const t = e.results[i][0].transcript;
          if (t && t.trim()) appendTeacherTranscriptFromBrowser(t);
        }
      }
    };
    speechRecognition.onerror = () => { /* ignore transient errors */ };
    speechRecognition.onend = () => {
      if (ws && ws.readyState === WebSocket.OPEN && speechRecognition) {
        try { speechRecognition.start(); } catch (_) {}
      }
    };
    speechRecognition.start();
    browserTranscriptActive = true;
  } catch (_) {
    speechRecognition = null;
    browserTranscriptActive = false;
  }
}

function stopBrowserSpeechRecognition() {
  browserTranscriptActive = false;
  if (speechRecognition) {
    try { speechRecognition.stop(); } catch (_) {}
    speechRecognition = null;
  }
}

function finalizeTeacherTranscript() {
  const el = currentTeacherEntry;
  currentTeacherEntry = null;
  if (el) {
    el.textContent = normalizeTranscript(el.textContent.replace(/\s+/g, " ").trim());
    cleanupTranscriptEntry(el);
  }
}

function appendStudentTranscript(chunk, name, color) {
  ensureTranscriptReady();
  if (!currentStudentEntry) {
    currentStudentEntry = addTranscriptEntry("student", name, color, chunk);
  } else {
    currentStudentEntry.textContent = joinTranscriptChunk(currentStudentEntry.textContent, chunk);
    transcriptBody.scrollTop = transcriptBody.scrollHeight;
  }
}

function finalizeStudentTranscript() {
  const el = currentStudentEntry;
  currentStudentEntry = null;
  if (el) {
    el.textContent = normalizeTranscript(el.textContent);
    cleanupTranscriptEntry(el); // async background fix
  }
}

function resetTranscript() {
  transcriptBody.innerHTML = '<p class="panel-empty">Transcript will appear here as you speak…</p>';
  transcriptInitialised = false;
  currentTeacherEntry   = null;
  currentStudentEntry   = null;
}

// ── Coaching tips panel ────────────────────────────────────────────────────────
let tipCount = 0;

// Convert **text** markdown bold to <strong> tags (no other HTML allowed).
function parseBoldMarkdown(text) {
  // Escape any existing HTML first
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Then convert **...** to <strong>...</strong>
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function addCoachingTip(tip) {
  const emptyEl = document.getElementById("coachingEmpty");
  if (emptyEl) emptyEl.remove();
  tipCount++;

  // Fade existing tips
  coachingBody.querySelectorAll(".tip-card").forEach(c => {
    if (!c.classList.contains("tip-stale")) c.classList.add("tip-stale");
  });

  // Add new tip at top
  const card = document.createElement("div");
  card.className = "tip-card";
  card.innerHTML = parseBoldMarkdown(tip);
  coachingBody.insertBefore(card, coachingBody.firstChild);

  // Keep max 5 tips
  const all = coachingBody.querySelectorAll(".tip-card");
  if (all.length > 5) all[all.length - 1].remove();
}

function resetCoachingPanel() {
  tipCount = 0;
  coachingBody.innerHTML = '<p class="panel-empty" id="coachingEmpty">Feedback will appear as you teach…</p>';
}

// ── Reflection screen ──────────────────────────────────────────────────────────
function showReflection(topic, data) {
  sessionScreen.style.display = "none";

  reflTopicBadge.textContent = topic;
  reflSummary.textContent    = data.summary || "";

  function fillList(el, items, fallback) {
    el.innerHTML = "";
    if (!items || items.length === 0) {
      const p = document.createElement("p"); p.className = "refl-none"; p.textContent = fallback;
      el.appendChild(p);
      return;
    }
    items.forEach(item => {
      const li = document.createElement("li"); li.textContent = item;
      el.appendChild(li);
    });
  }

  fillList(reflStrengths,    data.strengths,    "Nothing noted.");
  fillList(reflGaps,         data.gaps,         "No obvious gaps — well covered!");
  fillList(reflQuestions,    data.topQuestions, "No notable questions recorded.");
  fillList(reflImprovements, data.improvements, "Keep it up!");

  reflLoading.style.display  = "none";
  reflContent.style.display  = "flex";
  reflectionScreen.style.display = "block";
}

function showReflectionLoading(topic) {
  reflTopicBadge.textContent    = topic;
  reflLoading.style.display     = "flex";
  reflContent.style.display     = "none";
  reflectionScreen.style.display = "block";
  sessionScreen.style.display   = "none";
}

reflTeachAgainBtn.addEventListener("click", () => {
  reflectionScreen.style.display = "none";
  // Keep topic, go straight to session
  startBtn.click();
});

reflNewTopicBtn.addEventListener("click", () => {
  reflectionScreen.style.display = "none";
  setupScreen.style.display = "flex";
});

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

// ── Camera / video / whiteboard state ─────────────────────────────────────────
let cameraStream  = null;
let frameInterval = null;
const frameCanvas = document.createElement("canvas");
frameCanvas.width  = 640;
frameCanvas.height = 360;

const WB_COLORS = ["#111827", "#DC2626", "#2563EB", "#16A34A", "#CA8A04"];
let wbTool = "pen"; // pen | eraser | text
let wbColor = WB_COLORS[0];
let wbDrawing = false;
let wbLastX = 0, wbLastY = 0;

function wbCanvasCoords(e) {
  const rect = whiteboardCanvas.getBoundingClientRect();
  const x = ((e.clientX ?? e.touches?.[0]?.clientX) - rect.left) / rect.width * whiteboardCanvas.width;
  const y = ((e.clientY ?? e.touches?.[0]?.clientY) - rect.top) / rect.height * whiteboardCanvas.height;
  return { x, y };
}

function wbEnsureCtx() {
  const ctx = whiteboardCanvas.getContext("2d");
  if (!ctx._wbInited) {
    ctx._wbInited = true;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, whiteboardCanvas.width, whiteboardCanvas.height);
  }
  return ctx;
}

function resetWhiteboard() {
  const ctx = whiteboardCanvas.getContext("2d");
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, whiteboardCanvas.width, whiteboardCanvas.height);
}

let whiteboardUIInited = false;
function initWhiteboardUI() {
  if (whiteboardUIInited) return;
  whiteboardUIInited = true;
  wbColorsEl.innerHTML = "";
  WB_COLORS.forEach((c, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "wb-color" + (i === 0 ? " selected" : "");
    b.style.background = c;
    b.title = c;
    b.addEventListener("click", () => {
      wbColor = c;
      wbColorsEl.querySelectorAll(".wb-color").forEach(el => el.classList.remove("selected"));
      b.classList.add("selected");
      wbTool = "pen";
      wbPen.classList.add("active");
      wbEraser.classList.remove("active");
      wbText.classList.remove("active");
    });
    wbColorsEl.appendChild(b);
  });

  function setTool(tool) {
    wbTool = tool;
    wbPen.classList.toggle("active", tool === "pen");
    wbEraser.classList.toggle("active", tool === "eraser");
    wbText.classList.toggle("active", tool === "text");
    whiteboardCanvas.style.cursor = tool === "text" ? "text" : "crosshair";
  }
  wbPen.addEventListener("click", () => setTool("pen"));
  wbEraser.addEventListener("click", () => setTool("eraser"));
  wbText.addEventListener("click", () => setTool("text"));
  wbClear.addEventListener("click", () => {
    const ctx = wbEnsureCtx();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, whiteboardCanvas.width, whiteboardCanvas.height);
  });

  function wbDown(e) {
    e.preventDefault();
    const { x, y } = wbCanvasCoords(e);
    if (wbTool === "text") {
      const text = window.prompt("Text to place on board:", "");
      if (text && text.trim()) {
        const ctx = wbEnsureCtx();
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = wbColor;
        ctx.font = "bold 20px Inter, system-ui, sans-serif";
        ctx.fillText(text.trim(), x, y);
      }
      return;
    }
    wbDrawing = true;
    wbLastX = x;
    wbLastY = y;
  }
  function wbMove(e) {
    if (!wbDrawing || wbTool === "text") return;
    e.preventDefault();
    const { x, y } = wbCanvasCoords(e);
    const ctx = wbEnsureCtx();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (wbTool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.lineWidth = 24;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = wbColor;
      ctx.lineWidth = 3;
    }
    ctx.beginPath();
    ctx.moveTo(wbLastX, wbLastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    wbLastX = x;
    wbLastY = y;
  }
  function wbUp(e) {
    e.preventDefault();
    wbDrawing = false;
  }

  whiteboardCanvas.addEventListener("mousedown", wbDown);
  whiteboardCanvas.addEventListener("mousemove", wbMove);
  whiteboardCanvas.addEventListener("mouseup", wbUp);
  whiteboardCanvas.addEventListener("mouseleave", wbUp);
  whiteboardCanvas.addEventListener("touchstart", wbDown, { passive: false });
  whiteboardCanvas.addEventListener("touchmove", wbMove, { passive: false });
  whiteboardCanvas.addEventListener("touchend", wbUp);
}

/** Send JPEG frames from whiteboard canvas (same pipeline as camera). */
function startWhiteboardFrameSender() {
  if (frameInterval) clearInterval(frameInterval);
  const ctx = frameCanvas.getContext("2d");
  frameInterval = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN || micMuted) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, frameCanvas.width, frameCanvas.height);
    ctx.drawImage(whiteboardCanvas, 0, 0, frameCanvas.width, frameCanvas.height);
    const base64 = frameCanvas.toDataURL("image/jpeg", 0.72).split(",")[1];
    try { ws.send(JSON.stringify({ type: "video_frame", base64 })); } catch (_) {}
  }, 1000);
}

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
  cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360, frameRate: 30 }, audio: true });
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
        // Notify server so it can finalize teacher transcript + generate coaching tip
        try { ws.send(JSON.stringify({ type: "speech_end" })); } catch (_) {}
        finalizeTeacherTranscript();
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
  const useWb = useWhiteboardEl && useWhiteboardEl.checked;
  const useCam = useCameraEl.checked;
  sessionScreen.classList.toggle("video-mode",      useCam && !useWb);
  sessionScreen.classList.toggle("whiteboard-mode",  useWb);
  sessionScreen.classList.toggle("classroom-mode",   classroomMode);
  sessionTopicLabel.textContent = topic;
  speakerLabel.textContent      = "";
  speakerLabel.style.color      = "";
  setOrbState("idle");
  setStatus("Connecting…");
  resetTranscript();
  resetCoachingPanel();
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

// Tracks last speaking student/name for transcript colouring
let _lastStudentName  = "Student";
let _lastStudentColor = null;

function disconnect(requestReflection = false) {
  if (requestReflection && ws && ws.readyState === WebSocket.OPEN) {
    // Ask server for reflection — it will reply and we'll show it then close
    try { ws.send(JSON.stringify({ type: "request_reflection" })); } catch (_) {}
    return; // Don't disconnect yet; wait for reflection message
  }

  if (ws) { try { ws.close(); } catch (_) {} ws = null; }
  if (micProcessor) { try { micProcessor.disconnect(); } catch (_) {} micProcessor = null; }
  if (micStream)    { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (micContext)   { try { micContext.close(); } catch (_) {} micContext = null; }
  if (frameInterval){ clearInterval(frameInterval); frameInterval = null; }
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  cameraFeed.srcObject = null;
  stopBrowserSpeechRecognition();
  stopPlayback();

  audioChunksReceived = 0;
  vadInSpeech    = false;
  vadSilenceCount = 0;
  micMuted = false;
  muteBtn.textContent = "Mute";
  muteBtn.classList.remove("muted");
  setMicActive(false);
}

async function connect() {
  lastError = null;
  const topic         = getSelectedTopic();
  const materials     = materialsEl.value.trim();
  const useVideo      = useCameraEl.checked || (useWhiteboardEl && useWhiteboardEl.checked);
  const studentsParam = classroomMode ? Array.from(selectedStudents).join(",") : "";

  showSession(topic);
  if (useWhiteboardEl && useWhiteboardEl.checked) resetWhiteboard();

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
    startBrowserSpeechRecognition();
    try {
      const useWb = useWhiteboardEl && useWhiteboardEl.checked;
      if (useVideo && useWb && !useCameraEl.checked) {
        // Whiteboard only: mic without camera video
        wbEnsureCtx();
        startWhiteboardFrameSender();
        await startMic();
      } else if (useVideo && useWb && useCameraEl.checked) {
        // Both: send whiteboard frames; camera optional for teacher (hidden in UI)
        wbEnsureCtx();
        startWhiteboardFrameSender();
        await startMic();
      } else if (useVideo) {
        const stream = await startCamera();
        await startMic(stream);
      } else {
        await startMic();
      }
    } catch (e) {
      setStatus("Camera/mic access failed: " + e.message, "error");
    }
  };

  ws.onclose = () => {
    // Natural close (e.g. server-side) — just go back to setup
    disconnect();
    if (lastError) setStatus(lastError, "error");
    else           setStatus("Session ended.");
    setTimeout(showSetup, 1200);
  };

  ws.onerror = () => { lastError = "Connection error."; setStatus("Connection error.", "error"); };

  ws.onmessage = async event => {
    if (event.data instanceof ArrayBuffer) { await playPcm24k(event.data); return; }
    if (event.data instanceof Blob)        { await playPcm24k(await event.data.arrayBuffer()); return; }

    try {
      const msg = JSON.parse(event.data);

      if (msg.type === "info")  setStatus(msg.message || "", "connected");
      if (msg.type === "error") { lastError = msg.message; setStatus(msg.message, "error"); }

      // ── Teacher transcript (left panel) ──
      if (msg.type === "teacher_transcript" && msg.text) {
        appendTeacherTranscript(msg.text); // no-op when browserTranscriptActive
      }

      // ── Student transcript ──
      if (msg.type === "transcript" && msg.text) {
        appendStudentTranscript(msg.text, _lastStudentName, _lastStudentColor);
      }

      // ── Coaching tip (right panel) ──
      if (msg.type === "coaching_tip" && msg.tip) {
        addCoachingTip(msg.tip);
      }

      // ── Reflection ──
      if (msg.type === "reflection" && msg.data) {
        const topic = getSelectedTopic();
        // Hard disconnect before showing reflection
        if (ws) { try { ws.close(); } catch (_) {} ws = null; }
        if (micProcessor) { try { micProcessor.disconnect(); } catch (_) {} micProcessor = null; }
        if (micStream)    { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
        if (micContext)   { try { micContext.close(); } catch (_) {} micContext = null; }
        if (frameInterval){ clearInterval(frameInterval); frameInterval = null; }
        if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
        cameraFeed.srcObject = null;
        stopBrowserSpeechRecognition();
        stopPlayback();
        audioChunksReceived = 0; vadInSpeech = false; vadSilenceCount = 0;
        micMuted = false; muteBtn.textContent = "Mute"; muteBtn.classList.remove("muted");
        setMicActive(false);
        showReflection(topic, msg.data);
        return;
      }

      if (msg.type === "turn_complete") {
        audioChunksReceived = 0;
        finalizeStudentTranscript();
        setOrbState("listening");
        setStatus("Your turn — speak and pause when done.", "connected");
      }

      if (msg.type === "emotion" && SERVER_EMOTION_STATES.has(msg.state)) {
        if (!classroomMode) setOrbState(msg.state);
      }

      if (msg.type === "student_speaking" && msg.name) {
        const s = STUDENTS[msg.name.toLowerCase()];
        _lastStudentName  = s ? s.name : msg.name;
        _lastStudentColor = s ? s.color : null;
        if (classroomMode) {
          activateStudentOrb(msg.name.toLowerCase());
          setStatus(`${_lastStudentName} is speaking…`, "connected");
        } else {
          setSpeaker(msg.name);
        }
      }

      if (msg.type === "student_turn_complete" && msg.studentId) {
        deactivateStudentOrb(msg.studentId);
        finalizeStudentTranscript();
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
  // Show reflection loading immediately, then request it from server
  const topic = getSelectedTopic();
  showReflectionLoading(topic);
  // Send reflection request — ws.onmessage will handle the response
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ type: "request_reflection" })); } catch (_) {}
  } else {
    // No WS — just go to setup
    reflectionScreen.style.display = "none";
    showSetup();
  }
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
    finalizeTeacherTranscript();
  } catch (_) {}
});

// ── Study materials: drag-drop + extract ───────────────────────────────────────
function setMaterialsStatus(msg, isError) {
  if (!materialsStatusEl) return;
  materialsStatusEl.textContent = msg || "";
  materialsStatusEl.classList.toggle("error", !!isError);
}

async function extractFileToMaterials(file) {
  if (!file) return;
  setMaterialsStatus(`Extracting ${file.name}…`);
  try {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${window.location.origin}/api/materials/extract`, {
      method: "POST",
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) {
      setMaterialsStatus(data.error || "Extraction failed", true);
      return;
    }
    const block = data.text.trim()
      ? `\n\n--- ${data.filename} ---\n${data.text.trim()}\n`
      : "";
    if (block) {
      materialsEl.value = (materialsEl.value.trim() ? materialsEl.value.trim() + block : block.trim());
      setMaterialsStatus(`Added ${data.filename}`);
    } else {
      setMaterialsStatus("No text extracted.", true);
    }
  } catch (e) {
    setMaterialsStatus(e.message || "Upload failed", true);
  }
}

function initMaterialsDropzone() {
  if (!materialsDropzone || !materialsFileInput) return;
  const inner = materialsDropzone.querySelector(".materials-dropzone-inner");
  const openPicker = () => materialsFileInput.click();
  if (inner) {
    inner.addEventListener("click", (e) => {
      if (e.target === materialsEl) return;
      openPicker();
    });
  }
  materialsFileInput.addEventListener("change", () => {
    const files = materialsFileInput.files;
    if (!files || !files.length) return;
    Array.from(files).forEach(f => extractFileToMaterials(f));
    materialsFileInput.value = "";
  });
  ["dragenter", "dragover"].forEach((ev) => {
    materialsDropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      materialsDropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    materialsDropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      materialsDropzone.classList.remove("dragover");
    });
  });
  materialsDropzone.addEventListener("drop", (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) Array.from(files).forEach(f => extractFileToMaterials(f));
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────────
initWhiteboardUI();
initMaterialsDropzone();
loadTopics();
