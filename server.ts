import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { GoogleGenAI, Modality } from '@google/genai';
import * as types from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import { readFile } from 'fs/promises';
import { IncomingMessage } from 'http';
import dotenv from 'dotenv';
import { extractFromBuffer } from './server/materials-extract';
import {
  createMaterialsSession,
  saveMaterialsNotes,
  uploadMaterialFile,
  listMaterialFiles,
  removeMaterialFile,
  resolveMaterialsContext,
} from './server/materials-store';
import {
  analyzePdfWithVision,
  analyzeImageWithVision,
  formatForContext,
} from './server/materials-vision';
import {
  processVideoMaterial,
  formatVideoForContext,
  isVideoMime,
} from './server/materials-video';

dotenv.config();

// ── Cloud Run crash prevention: catch unhandled errors so the process stays alive ──
process.on('uncaughtException', (err) => {
  console.error('[Dasko] UNCAUGHT EXCEPTION (process kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Dasko] UNHANDLED REJECTION (process kept alive):', reason);
});

// ── Server log capture (ring buffer for /api/logs) ──────────────────────────
const LOG_RING_MAX = 500;
const logRing: { ts: number; level: string; msg: string }[] = [];
function pushLog(level: string, ...args: any[]) {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  logRing.push({ ts: Date.now(), level, msg });
  if (logRing.length > LOG_RING_MAX) logRing.splice(0, logRing.length - LOG_RING_MAX);
}
const origLog = console.log.bind(console);
const origError = console.error.bind(console);
const origWarn = console.warn.bind(console);
console.log = (...args: any[]) => { origLog(...args); pushLog('info', ...args); };
console.error = (...args: any[]) => { origError(...args); pushLog('error', ...args); };
console.warn = (...args: any[]) => { origWarn(...args); pushLog('warn', ...args); };

const GOOGLE_API_KEY = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
if (!GOOGLE_API_KEY) {
  console.error('Missing GEMINI_API_KEY in .env');
  process.exit(1);
}

const AUDIO_MODEL    = 'gemini-2.5-flash-native-audio-latest';
const VIDEO_MODEL    = 'gemini-2.5-flash-native-audio-latest';
const FAST_MODEL     = 'gemini-2.5-flash';
// Heavier model for transcript cleanup only (accuracy over latency).
const CLEANUP_MODEL  = process.env.CLEANUP_MODEL || 'gemini-2.5-pro';
const IMAGE_MODEL    = 'gemini-2.5-flash-image';

// ── Anti-hallucination: silence guard ────────────────────────────────────────
// The Live API can interpret incoming video frames as "user is active" and
// generate unprompted responses.  We track the last time the teacher actually
// spoke (via speech_end) and refuse to relay video frames if the teacher has
// been silent for more than this window.  This prevents the model from
// hallucinating teacher input based solely on a webcam/whiteboard feed.
const SILENCE_FRAME_GATE_MS = 8000; // only send frames within 8s of last speech

const VALID_EMOTIONS = new Set(['curious', 'confused', 'excited', 'listening', 'thinking']);

const TOPICS = [
  'Photosynthesis',
  'Quadratic equations',
  'Supply and demand',
  "Newton's laws of motion",
  'The water cycle',
  'Cell division (mitosis/meiosis)',
];

const STUDENT_PROFILES: Record<string, string> = {
  emma:   `Emma is enthusiastic and eager. She asks lots of questions, sometimes jumps ahead and makes overconfident guesses that turn out wrong. She gets visibly excited when things click. Mistake pattern: over-generalizes — she applies a rule confidently to a case where it has an important exception.`,
  marcus: `Marcus is a natural skeptic. He challenges every claim, asks for evidence and edge cases, and pushes back when something feels hand-wavy. Politely but firmly demanding. Mistake pattern: states a plausible but wrong boundary condition with complete conviction ("that only applies when…").`,
  lily:   `Lily gets lost easily and needs things broken down step by step. She often circles back to earlier points and asks for concrete examples before she can move on. Mistake pattern: reverses a relationship or confuses cause and effect ("so X causes Y" when it's actually Y causes X).`,
  priya:  `Priya is a deep thinker who makes unexpected connections between concepts. She asks profound follow-up questions and occasionally goes on interesting intellectual tangents. Mistake pattern: makes a sophisticated-sounding but subtly wrong cross-domain connection (links the topic to another field using a faulty analogy that sounds compelling but breaks down under scrutiny).`,
  tyler:  `Tyler is barely paying attention. He gives distracted, half-hearted responses and asks obvious questions, but occasionally surprises everyone with an unexpectedly sharp observation. Mistake pattern: states a sloppy over-simplification as if it's obviously true and everyone knows it.`,
  zoe:    `Zoe thinks she already knows everything. She frequently tries to answer before the teacher finishes, is sometimes right and sometimes embarrassingly wrong, and needs gentle correction. Mistake pattern: confidently declares there's an important condition the teacher missed — but the condition itself is wrong.`,
};

const STUDENT_VOICES: Record<string, string> = {
  emma:   'Aoede',
  marcus: 'Charon',
  lily:   'Kore',
  priya:  'Puck',
  tyler:  'Fenrir',
  zoe:    'Zephyr',
};

type SessionEntry = { role: 'teacher' | 'student'; name: string; text: string; time: number };
const SHARED_URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;

// ── Prompt builders ──────────────────────────────────────────────────────────

const GESTURE_INSTRUCTION = `
## Visual awareness
You may receive a live image stream from the teacher — their camera (face, gestures, paper they hold up), an on-screen whiteboard, or a screen share. Pay close attention to what they write, draw, point at, or hold up. Only mention visible details when they are directly relevant to the explanation. Never narrate your perception process (do not say you are analyzing/looking at images, frames, feeds, or video). If it's camera-only, body language matters (uncertainty, pauses). If it's whiteboard-heavy, treat it like a classroom board: read labels and follow arrows and diagrams.

**HONESTY ABOUT WHAT YOU CAN SEE:** You will receive system messages like "[MEDIA] Camera ON", "[MEDIA] Camera OFF", "[MEDIA] Whiteboard ON", etc. These tell you the current state. ONLY claim to see something if you are actually receiving image frames AND the corresponding media is marked ON. If a media source is OFF or you haven't received any images, you MUST say "I can't see that right now" when asked. NEVER fabricate or hallucinate visual content you haven't actually received. If the teacher asks "can you see my screen/whiteboard/camera?" and you haven't received any recent images, be honest and say no.

**Non-verbal cues (video):** When camera is ON and you are receiving frames, treat the teacher's head nods as agreement or "yes" and head shakes as disagreement or "no". These count as full responses — if you see a clear nod, respond as if they said "yes"; if you see a clear shake, respond as if they said "no". You do not need them to say the words out loud.`;

const GESTURE_INSTRUCTION_VOICE_ONLY = `
## Senses
This is a voice-only session. You can only hear the teacher.`;

const ALLOWED_SESSION_LANGUAGES = new Set([
  'English',
  'Spanish',
  'French',
  'German',
  'Portuguese',
  'Hindi',
  'Arabic',
  'Mandarin Chinese',
]);

function normalizeSessionLanguage(raw: string | null): string {
  const value = (raw || '').trim();
  return ALLOWED_SESSION_LANGUAGES.has(value) ? value : 'English';
}

function isAllowedCharForLanguage(ch: string, language: string): boolean {
  // Whitespace and common punctuation/symbols
  if (/\s/u.test(ch) || /\p{Script=Common}/u.test(ch) || /\p{Script=Inherited}/u.test(ch)) return true;
  if (/\p{Number}/u.test(ch)) return true;

  if (language === 'Mandarin Chinese') return /\p{Script=Han}/u.test(ch);
  if (language === 'Hindi') return /\p{Script=Devanagari}/u.test(ch);
  if (language === 'Arabic') return /\p{Script=Arabic}/u.test(ch);

  // English/Spanish/French/German/Portuguese are Latin-script sessions.
  return /\p{Script=Latin}/u.test(ch);
}

function enforceTranscriptLanguage(text: string, language: string): string {
  if (!text) return text;
  let out = '';
  for (const ch of text) {
    if (isAllowedCharForLanguage(ch, language)) out += ch;
  }
  out = out
    .replace(/\u200B|\u200C|\u200D|\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return out;
}

function languageInstruction(language: string): string {
  return `## Language
Use ${language} for your spoken responses in this session.
Keep terminology natural for ${language}.`;
}

function getClassroomInstruction(topic: string, studentIds: string[], materials: string, video: boolean, language: string): string {
  const studentList = studentIds
    .filter(id => STUDENT_PROFILES[id])
    .map(id => `- **${id.charAt(0).toUpperCase() + id.slice(1)}**: ${STUDENT_PROFILES[id]}`)
    .join('\n');

  const hasVisualElements = materials.includes('### Visual Elements') || materials.includes('### Visual Summary');
  const materialsSection = materials.trim()
    ? `The students have the following notes/documents (PDFs, slides, videos, etc.) as reference. They didn't fully understand them:\n\n---\n${materials.trim()}\n---\n\nThey should reference this naturally as their notes/handouts, not recite verbatim.${hasVisualElements ? '\nWhen referencing visual elements from the materials, use the exact labels (e.g., "Figure 3 on page 5", "the chart showing...") so the teacher knows what you\'re referring to.' : ''}`
    : `The students have general background knowledge but haven't formally studied this topic.`;

  return `You are playing ${studentIds.length} students in a live classroom session. The human is the teacher explaining "${topic}".

## CRITICAL RULES (never violate)
1. NEVER use stage directions, brackets, or narrate inner states (e.g. "[listens intently]", "[nods]", "[thinking]", "[analyzing image]"). Only speak actual words out loud.
2. NEVER speak unless the teacher has said something new via audio/speech. If the teacher is silent, stay COMPLETELY silent — produce NO audio output at all. Seeing a video frame or whiteboard image is NOT the teacher saying something. Only SPOKEN words from the teacher count as new input.
3. NEVER hallucinate or invent teacher messages. If the teacher did not speak, do NOT generate a response. Do NOT imagine what the teacher might say or simulate their speech. If you are uncertain whether the teacher spoke, stay silent.
4. NEVER say you are "analyzing", "looking at", or "examining" any image, video, feed, or file.
5. Wait for the teacher to finish their full thought before responding. Do not jump in after a single sentence — wait for a clear pause.
6. After your initial greeting, do NOT speak again until the teacher speaks first. Stay completely silent and wait.

## The students
${studentList}

## Prior knowledge
${materialsSection}

## Live in-class materials
The teacher may share files during the lesson (handouts, images, slides). When you receive a message that the teacher has shared a study material file, look at it immediately and treat it as live class material: reference it in your questions, ask for clarification about it, or connect it to what the teacher is saying. Treat dropped-in files as "in-class work" or handouts just shared with the class.
If a shared file/link seems unrelated, unclear, or contradictory to the current topic, do not force a connection. Acknowledge uncertainty briefly and ask how the teacher wants to use it.

## Senses
${video ? GESTURE_INSTRUCTION.trim() : GESTURE_INSTRUCTION_VOICE_ONLY.trim()}

${languageInstruction(language)}

## Transcription language lock
Assume the teacher is speaking ${language}. If a phrase is ambiguous, prefer the ${language} interpretation over other languages.

## CRITICAL: Formatting rule
You MUST begin every single response with the speaking student's name followed by a colon and space.
Example: "Emma: I think I get it, but..." or "Marcus: Wait, why would that be true?"
Never skip this prefix — the interface depends on it to show who is speaking.

## Classroom dynamics
- Only one student speaks per turn. Choose who based on what was just said and who it would naturally draw out.
- Vary who speaks — don't default to the same student every time.
- Students are aware of each other and can build on, disagree with, or react to what others said.
- Keep it realistic: not every student responds every turn.
- Students direct questions at the teacher. One question per turn, maximum.
- Sound like real people and have genuine reactions.
- Never use stage directions or bracketed actions (e.g. "[listens intently]" or "[nods]"). Speak only the actual words the student says aloud.
- Do not hallucinate teacher messages, agreement, or follow-up prompts. If the teacher has not provided new information, stay quiet.
- Never explain the topic yourself. Never be sycophantic.
- **Making mistakes:** ~30% of student summaries should contain a confident, topic-specific error (wrong cause/effect, reversed relationship, missed condition, confused concepts). The student states it as fact. When corrected, pushes back once before conceding. Wrong analogies alone are insufficient — the error must be in the substance of the topic. If the teacher does NOT correct the error after 1-2 exchanges (accepts it as true or moves on), the student who made the error must surface and correct it themselves.


## Starting the session
One student must greet the teacher out loud as the very first response (e.g. "Hi, we're ready when you are"). Do not say you cannot see or hear the teacher—greet them and indicate the class is ready.`;
}

const MISTAKE_INSTRUCTION = `\n\n**Confident mistakes:** About 30% of your summary statements should contain a real error — wrong cause/effect, reversed relationship, missed condition, or confused concepts. State errors confidently; never hedge. When corrected, push back once naturally ("wait, but I thought that meant…") before conceding. Do NOT make a mistake every turn — vary: some turns genuine questions, some correct summaries, ~30% have a real error. Self-correction safety net: if you stated something wrong and the teacher has NOT corrected it after 1-2 exchanges (they accepted it, moved on, or built on it), surface it yourself: "Wait, actually I think I got that wrong earlier — didn't you say it was actually…?"`;

const PERSONA_TRAITS: Record<string, string> = {
  eager: `You are enthusiastic and eager to learn. You sometimes jump ahead and make confident guesses — which are occasionally wrong. You get excited when things click ("Oh! So that's like...!") and ask "but what about...?" a lot. You might over-simplify things in your head and need the teacher to correct you.` + MISTAKE_INSTRUCTION,

  skeptic: `You are naturally skeptical and need to be convinced. You question assumptions ("but why is that true?"), ask about edge cases and exceptions, and push back when something feels hand-wavy. You're not rude — just intellectually demanding. You want evidence and logic, not just assertions.` + MISTAKE_INSTRUCTION,

  confused: `You get lost easily and need things broken down step by step. You often circle back to earlier points, ask "wait, can you say that differently?", and need concrete real-world examples before abstract ideas land. You're not slow — you just have high standards for your own understanding.` + MISTAKE_INSTRUCTION,
};

function getStudentInstruction(topic: string, persona: string, materials: string, video: boolean, language: string): string {
  const personaTrait = PERSONA_TRAITS[persona] || PERSONA_TRAITS.eager;

  const hasVisualElements = materials.includes('### Visual Elements') || materials.includes('### Visual Summary');
  const materialsSection = materials.trim()
    ? `You have the teacher's notes and documents below (PDFs, slides, videos, etc. — kept as reference). You've gone through them but didn't fully understand everything — some parts confused you or didn't stick:\n\n---\n${materials.trim()}\n---\n\nRefer to these naturally as **your notes**: "In the handout it said… but I didn't get…" or "The slide about X — is that the same as what you're saying?" Do not recite long passages; treat them as something you half-understood and want the teacher to clarify.${hasVisualElements ? '\nWhen referencing visual elements from the materials, use the exact labels (e.g., "Figure 3 on page 5", "the chart showing...") so the teacher knows what you\'re referring to.' : ''}`
    : `You have general background knowledge from school and everyday life, but you haven't formally studied this topic. You may have vague familiarity with some terms or ideas, but your understanding is patchy and you have real gaps.`;

  return `You are a student in a "learn by teaching" session. The human is your teacher. They are going to explain "${topic}" to you.

## CRITICAL RULES (never violate)
1. NEVER use stage directions, brackets, or narrate inner states (e.g. "[listens intently]", "[nods]", "[thinking]", "[analyzing image]"). Only speak actual words out loud.
2. NEVER speak unless the teacher has said something new via audio/speech. If the teacher is silent, stay COMPLETELY silent — produce NO audio output at all. Seeing a video frame or whiteboard image is NOT the teacher saying something. Only SPOKEN words from the teacher count as new input.
3. NEVER hallucinate or invent teacher messages. If the teacher did not speak, do NOT generate a response. Do NOT imagine what the teacher might say or simulate their speech. If you are uncertain whether the teacher spoke, stay silent.
4. NEVER say you are "analyzing", "looking at", or "examining" any image, video, feed, or file.
5. Wait for the teacher to finish their full thought before responding. Do not jump in after a single sentence — wait for a clear pause.
6. After your initial greeting, do NOT speak again until the teacher speaks first. Stay completely silent and wait.

## Your persona
${personaTrait}

## Your prior knowledge
${materialsSection}

## Live in-class materials
The teacher may share files during the lesson (handouts, images, slides). When you receive a message that the teacher has shared a study material file, look at it immediately and treat it as live class material for discussion: reference it in your questions or ask for clarification. Treat dropped-in files as "in-class work" or handouts just shared with you.
If a shared file/link seems unrelated, unclear, or contradictory to the current topic, do not force a connection. Briefly flag the mismatch and ask what part to focus on.

## How to behave like a real student

You are NOT a blank slate. You come in with partial knowledge, possible misconceptions, and specific gaps. This is crucial — a real student has encountered ideas before; they just don't fully understand them yet.

**Sound like a real person:**
- Use natural, conversational speech.
- Never use stage directions or bracketed actions (e.g. "[listens intently]" or "[nods]"). Speak only what you say aloud.
- Vary your reactions — don't ask a question every single turn. Sometimes just react ("okay that actually makes sense") and let the teacher continue.
- Show specific confusion: not "I don't understand" but "I'm following you up until the part about X — what happens there?"
- Have genuine "aha!" moments: "Oh — so that's WHY it works like that. I was thinking it was just..."
- Make wrong connections and let the teacher correct you: "Is this kind of like how [wrong analogy]?"
- Do not invent teacher responses or pretend the teacher said something they did not.

**Ask good questions:**
- One question per turn, maximum. Pick the most important thing you don't understand.
- Make your questions specific to what the teacher just said, not generic.
- Sometimes summarise what you think you understood and check: "Okay so if I'm getting this right, it basically means... right?"
- Reference things from prior reading if materials were provided.

**Make confident, substantive mistakes:**
- ~30% of your summary statements should contain a real error — wrong cause/effect, reversed relationship, missing a key condition, confused concepts.
- State errors confidently. Never hedge ("I might be wrong but…").
- When corrected, push back once naturally before conceding ("wait but I thought you said…").
- Do NOT make mistakes every turn. Vary: some turns genuine questions, some correct summaries, ~30% have a real error.
- **Self-correction safety net:** If you stated something wrong and the teacher has NOT corrected it after 1-2 exchanges — e.g. they accepted it as true, moved on, or built on it — you must gently surface it yourself: "Wait, actually I think I got that wrong earlier when I said X — didn't you say it was actually Y?" This prevents wrong information from going uncorrected.

**Stay in your role:**
- Never explain the topic yourself or give away the answer.
- If the teacher asks you a question back, redirect naturally: "I mean, I have a guess, but I'd rather hear you explain it properly."
- Don't be sycophantic. "Great explanation!" is not something a real student says — they just nod and ask the next question.
- Stay on topic. If you drift, the teacher will redirect you.


${video ? GESTURE_INSTRUCTION.trim() : GESTURE_INSTRUCTION_VOICE_ONLY.trim()}

${languageInstruction(language)}

## Transcription language lock
Assume the teacher is speaking ${language}. If a phrase is ambiguous, prefer the ${language} interpretation over other languages.

## Starting the session
Your very first response must be a short spoken greeting (e.g. "Hi, ready when you are"). Do not say you cannot see or hear the teacher—greet them and indicate you're ready to listen.`;
}

function getClassroomStudentInstruction(topic: string, studentId: string, allStudentIds: string[], materials: string, video: boolean, language: string): string {
  const name    = studentId.charAt(0).toUpperCase() + studentId.slice(1);
  const profile = STUDENT_PROFILES[studentId] || '';

  const otherStudents = allStudentIds
    .filter(id => id !== studentId && STUDENT_PROFILES[id])
    .map(id => `- **${id.charAt(0).toUpperCase() + id.slice(1)}**: ${STUDENT_PROFILES[id]}`)
    .join('\n');

  const hasVisualElements = materials.includes('### Visual Elements') || materials.includes('### Visual Summary');
  const materialsSection = materials.trim()
    ? `You have the following notes/documents as reference (from the teacher). You've read through but didn't fully understand:\n\n---\n${materials.trim()}\n---\n\nReference naturally as your notes — "In the handout…" / "On the slide…" — not verbatim recital.${hasVisualElements ? '\nWhen referencing visual elements, use exact labels (e.g., "Figure 3 on page 5") so the teacher knows what you mean.' : ''}`
    : `You have general background knowledge from school and everyday life, but you haven't formally studied this topic. Your understanding is patchy and you have real gaps.`;

  return `You are ${name}, a student in a live classroom session. The human is the teacher explaining "${topic}".

## CRITICAL RULES (never violate)
1. NEVER use stage directions, brackets, or narrate inner states (e.g. "[listens intently]", "[nods]", "[thinking]", "[analyzing image]"). Only speak actual words out loud.
2. NEVER speak unless the teacher has said something new via audio/speech. If the teacher is silent, stay COMPLETELY silent — produce NO audio output at all. Seeing a video frame or whiteboard image is NOT the teacher saying something. Only SPOKEN words from the teacher count as new input.
3. NEVER hallucinate or invent teacher messages. If the teacher did not speak, do NOT generate a response. Do NOT imagine what the teacher might say or simulate their speech. If you are uncertain whether the teacher spoke, stay silent.
4. NEVER say you are "analyzing", "looking at", or "examining" any image, video, feed, or file.
5. Wait for the teacher to finish their full thought before responding. Do not jump in after a single sentence — wait for a clear pause.
6. After your initial greeting, do NOT speak again until the teacher speaks first. Stay completely silent and wait.

## Your persona
${profile}

## Your classmates
${otherStudents}

You are aware your classmates are in the room.

## Hearing your classmates
During the session you'll occasionally receive a message formatted as:
  [Classroom] Name: "what they said"

This means that classmate just spoke. **Memorize these lines** — treat them as part of the ongoing conversation. You may:
- Agree, build on it, or express the same confusion ("yeah I was wondering that too")
- Politely push back or correct them if they're wrong
- **Reference the peer by name** when it's natural: e.g. "Like Marcus just asked, why does...?" or "I had the same question as Lily."
- Stay quiet if you have nothing to add — **not every classmate message requires a response from you**

You must **never speak AS another student** or invent their words. Remember the context of what the teacher and other students have said so you can build on it.

## Your prior knowledge
${materialsSection}

## Live in-class materials
The teacher may share files during the lesson. When you receive a message that the teacher has shared a study material file, look at it immediately and treat it as live class material: reference it in your questions or connect it to what the teacher is saying. Treat dropped-in files as "in-class work" or handouts just shared with the class.
If a shared file/link seems unrelated, unclear, or contradictory to the current topic, do not force a connection. Briefly flag the mismatch and ask what part to focus on.

## How to behave

**Sound like a real person:**
- Use natural speech.
- Never use stage directions or bracketed actions (e.g. "[listens intently]" or "[nods]"). Speak only what you say aloud.
- Vary your reactions — sometimes just react and stay quiet, sometimes jump in. Not every turn requires a question.
- Show specific confusion: not "I don't understand" but "I'm following you until the part about X"
- Have genuine "aha!" moments
- Make wrong connections and let the teacher correct you
- Do not invent teacher responses or pretend the teacher said something they did not.

**Make confident, substantive mistakes:**
- ~30% of your summary statements should contain a real error — wrong cause/effect, reversed relationship, missing a key condition, confused concepts.
- State errors confidently. Never hedge.
- When corrected, push back once naturally before conceding ("wait but I thought you said…").
- Do NOT make mistakes every turn. Vary: some turns genuine questions, some correct summaries, ~30% have a real error.
- **Self-correction safety net:** If you stated something wrong and the teacher has NOT corrected it after 1-2 exchanges — e.g. they accepted it, moved on, or built on it — you must gently surface it yourself: "Wait, actually I think I got that wrong earlier — didn't you say it was actually…?" This prevents wrong information from going uncorrected.

**Questions:**
- One question per turn, maximum. Pick the most pressing thing.
- Sometimes summarise what you understood and check: "Okay so if I'm getting this right..."

**Stay in your role:**
- Never explain the topic yourself.
- Don't be sycophantic.
- Stay on topic.


${video ? GESTURE_INSTRUCTION.trim() : GESTURE_INSTRUCTION_VOICE_ONLY.trim()}

${languageInstruction(language)}

## Transcription language lock
Assume the teacher is speaking ${language}. If a phrase is ambiguous, prefer the ${language} interpretation over other languages.

## Starting
Your very first response must be a short spoken greeting. Do not say you cannot see or hear the teacher—greet them and indicate you're ready to listen.`;
}

// ── Gemini helper calls ──────────────────────────────────────────────────────

async function classifyEmotion(ai: GoogleGenAI, transcript: string): Promise<string | null> {
  if (!transcript.trim()) return null;
  try {
    const result = await ai.models.generateContent({
      model: FAST_MODEL,
      contents: [{
        role: 'user',
        parts: [{ text:
          `You are classifying the emotional state of a student in a tutoring session based on their response.\n\n` +
          `Student said: "${transcript}"\n\n` +
          `Pick exactly one emotion that best describes their state:\n` +
          `- curious: engaged, asking questions, making connections, wanting to know more\n` +
          `- confused: lost, struggling to follow, asking for clarification or repetition\n` +
          `- excited: a concept just clicked, enthusiastic, having an aha moment\n` +
          `- thinking: processing, quiet acknowledgment, absorbing what was said\n` +
          `- listening: neutral, receptive, waiting for more\n\n` +
          `Respond with only the single emotion word. Nothing else.`
        }]
      }],
    });
    const emotion = result.text?.trim().toLowerCase() ?? '';
    return VALID_EMOTIONS.has(emotion) ? emotion : null;
  } catch {
    return null;
  }
}

async function generateCoachingTip(
  ai: GoogleGenAI,
  topic: string,
  teacherSpeech: string,
  media?: { camera?: boolean; whiteboard?: boolean; screen?: boolean },
): Promise<string | null> {
  if (teacherSpeech.split(/\s+/).length < 12) return null;
  const hasVideo = media?.camera || media?.whiteboard || media?.screen;
  const mediaNote = hasVideo
    ? ` The teacher may have camera (${media?.camera ? 'on' : 'off'}), whiteboard (${media?.whiteboard ? 'on' : 'off'}), or screen share (${media?.screen ? 'on' : 'off'}) active. If they have visuals available, comment on whether they are using them effectively (e.g. pointing at the board, using the screen to illustrate). Suggest using the whiteboard or screen if it could clarify the point.`
    : '';
  try {
    const result = await ai.models.generateContent({
      model: FAST_MODEL,
      contents: [{
        role: 'user',
        parts: [{ text:
          `A teacher is explaining "${topic}". Here is what they just said:\n\n"${teacherSpeech}"\n\n` +
          `Write ONE coaching tip — a single sentence, max 15 words. Alternate between two styles:\n\n` +
          `Style A — ENCOURAGEMENT: Call out something the teacher is doing well right now. Be specific.\n` +
          `Style B — DIRECTIVE: Tell the teacher one concrete thing to do next.\n\n` +
          `Pick whichever style is more useful for this moment. If the teacher is doing well, encourage. If they could improve, give a directive.\n\n` +
          `Rules:\n` +
          `- Be hyper-specific to what was just said — not generic advice\n` +
          `- Wrap the single most critical keyword or phrase in **double asterisks**\n` +
          `- No label, no bullet, no "Tip:", no second sentence\n` +
          `- NEVER be negative or critical. Frame everything positively.\n\n` +
          `Examples (do NOT copy these):\n` +
          `- "Great use of a **concrete example** to anchor that concept."\n` +
          `- "Ask Emma: **what breaks** when this assumption fails?"\n` +
          `- "Nice **pacing** — you gave them time to absorb that."\n` +
          `- "Give a **real-world example** before going deeper."\n` +
          (hasVideo ? `- Teacher has visuals active (camera: ${media?.camera}, whiteboard: ${media?.whiteboard}, screen: ${media?.screen}) — praise good visual use or suggest using them.\n` : '') +
          `\nOutput only the single sentence.`
        }]
      }],
    });
    return result.text?.trim() ?? null;
  } catch {
    return null;
  }
}

async function generateReflection(
  ai: GoogleGenAI,
  topic: string,
  sessionLog: SessionEntry[],
): Promise<object> {
  if (sessionLog.length < 2) {
    return {
      summary: 'The session was too short to generate a meaningful reflection.',
      strengths: [],
      gaps: [],
      topQuestions: [],
      improvements: ['Try a longer session — aim for at least 5 minutes of explanation.'],
      presentationSkills: { visualsAndGestures: '', explanations: '', mediaUsage: '' },
    };
  }

  const transcript = sessionLog
    .map(e => `${e.role === 'teacher' ? 'Teacher' : e.name}: ${e.text}`)
    .join('\n');

  try {
    const result = await ai.models.generateContent({
      model: FAST_MODEL,
      contents: [{
        role: 'user',
        parts: [{ text:
          `You are analyzing a "learn by teaching" session where a human taught "${topic}" to AI students.\n\n` +
          `Full transcript:\n${transcript}\n\n` +
          `Return a JSON object (no markdown, no code block) with exactly these keys:\n` +
          `- "summary": string — 2-3 sentences summarising what was covered\n` +
          `- "strengths": string[] — 2-3 specific things the teacher did well. Wrap the key phrase in **asterisks** (e.g. "**Clear examples** made the concept stick.")\n` +
          `- "gaps": string[] — 2-3 concepts that were missed, skipped, or explained unclearly (empty array if none). Wrap the key problem in **asterisks** (e.g. "**The second step** was unclear.")\n` +
          `- "topQuestions": string[] — the 3 most insightful student questions verbatim (fewer if session was short)\n` +
          `- "improvements": string[] — 2-3 concrete, actionable suggestions. Wrap the key action in **asterisks** (e.g. "**Use the whiteboard** for the diagram.")\n` +
          `- "presentationSkills": object with exactly these three keys, each a single short sentence (or empty string if not applicable):\n` +
          `  - "visualsAndGestures": Did the teacher use the camera, hands, or whiteboard effectively to demonstrate points?\n` +
          `  - "explanations": Were the explanations concise and clear, or rambling?\n` +
          `  - "mediaUsage": How effectively were screen sharing or shared files/materials utilized?\n\n` +
          `Keep every bullet and presentationSkills value to at most one short sentence. Be explicit and useful. Return ONLY valid JSON. No extra text.`
        }]
      }],
    });

    const raw = result.text?.trim() ?? '';
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
    const parsed = JSON.parse(cleaned);
    const ps = parsed.presentationSkills;
    if (Array.isArray(ps)) {
      parsed.presentationSkills = {
        visualsAndGestures: ps[0] ?? '',
        explanations: ps[1] ?? '',
        mediaUsage: ps[2] ?? '',
      };
    } else if (ps && typeof ps === 'object' && !Array.isArray(ps)) {
      parsed.presentationSkills = {
        visualsAndGestures: typeof ps.visualsAndGestures === 'string' ? ps.visualsAndGestures : '',
        explanations: typeof ps.explanations === 'string' ? ps.explanations : '',
        mediaUsage: typeof ps.mediaUsage === 'string' ? ps.mediaUsage : '',
      };
    } else {
      parsed.presentationSkills = { visualsAndGestures: '', explanations: '', mediaUsage: '' };
    }
    return parsed;
  } catch {
    return {
      summary: `You taught "${topic}". A detailed reflection could not be generated.`,
      strengths: [],
      gaps: [],
      topQuestions: [],
      improvements: [],
      presentationSkills: { visualsAndGestures: '', explanations: '', mediaUsage: '' },
    };
  }
}

// ── Diagram generation ───────────────────────────────────────────────────────

function extractImageFromResult(result: any): { base64: string; mimeType: string } | null {
  // Strategy 1: standard candidates shape
  const candidates = result?.candidates ?? [];
  for (const cand of candidates) {
    for (const part of (cand?.content?.parts ?? [])) {
      if (part?.inlineData?.data) return { base64: part.inlineData.data, mimeType: part.inlineData.mimeType ?? 'image/png' };
    }
  }
  // Strategy 2: result.response wrapper
  const respCandidates = result?.response?.candidates ?? [];
  for (const cand of respCandidates) {
    for (const part of (cand?.content?.parts ?? [])) {
      if (part?.inlineData?.data) return { base64: part.inlineData.data, mimeType: part.inlineData.mimeType ?? 'image/png' };
    }
  }
  // Strategy 3: top-level parts (newer SDK)
  for (const part of (result?.parts ?? [])) {
    if (part?.inlineData?.data) return { base64: part.inlineData.data, mimeType: part.inlineData.mimeType ?? 'image/png' };
  }
  // Strategy 4: image property (some SDK versions)
  if (result?.image?.imageBytes) {
    const b64 = typeof result.image.imageBytes === 'string'
      ? result.image.imageBytes
      : Buffer.from(result.image.imageBytes).toString('base64');
    return { base64: b64, mimeType: result.image.mimeType ?? 'image/png' };
  }
  return null;
}

async function generateStudentDiagram(
  ai: GoogleGenAI,
  topic: string,
  studentText: string,
  studentName: string,
  onDemand: boolean = false,
): Promise<{ base64: string; mimeType: string; hasMistake: boolean } | null> {
  const wordCount = studentText.trim().split(/\s+/).length;
  if (!onDemand && wordCount < 15) return null;

  const hasMistake = onDemand ? false : Math.random() < 0.25;

  const mistakeClause = hasMistake
    ? `\n\nIMPORTANT: Embed exactly ONE deliberate factual error in the diagram — a wrong arrow direction, an incorrect label, or a reversed relationship. Do NOT mark or highlight the error in any way.`
    : '';

  const contextText = onDemand
    ? `The teacher asked: "${studentText.slice(0, 400)}"`
    : `Student said: "${studentText.slice(0, 400)}"`;

  const prompt =
    `Generate an image: a quick, messy whiteboard doodle (black marker on white) about "${topic}".\n\n` +
    `${contextText}\n\n` +
    `Style rules:\n` +
    `- Maximum 3-5 short labels (1-3 words each, NO sentences)\n` +
    `- Big simple shapes (circles, boxes, arrows) — like a student's quick doodle\n` +
    `- Lots of white space — do NOT fill the image\n` +
    `- Hand-drawn, imperfect, slightly crooked lines\n` +
    `- NO paragraphs, NO bullet points, NO detailed text\n` +
    `- Think: what a student scribbles in 15 seconds on a whiteboard` +
    mistakeClause;

  const timeoutPromise = new Promise<null>(resolve => setTimeout(() => {
    console.log(`[Dasko] generateStudentDiagram: TIMEOUT for ${studentName}`);
    resolve(null);
  }, 30000));

  const genPromise = (async () => {
    console.log(`[Dasko] generateStudentDiagram: starting for ${studentName}`);
    const result = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseModalities: [Modality.TEXT, Modality.IMAGE] },
    });

    // Log the full shape of the result for debugging
    const topKeys = Object.keys(result || {});
    console.log(`[Dasko] generateStudentDiagram: result keys = [${topKeys.join(', ')}]`);

    const img = extractImageFromResult(result);
    if (img) {
      console.log(`[Dasko] generateStudentDiagram: got image (${img.mimeType}, ${img.base64.length} chars)`);
      return { ...img, hasMistake };
    }

    // Log what we actually got
    console.log(`[Dasko] generateStudentDiagram: no image found. text=${(result?.text || '').slice(0, 200)}`);
    return null;
  })();

  try {
    return await Promise.race([genPromise, timeoutPromise]);
  } catch (err) {
    console.error(`[Dasko] generateStudentDiagram error for ${studentName}:`, err);
    return null;
  }
}

// ── On-demand diagram detection ─────────────────────────────────────────────

// Only trigger diagram generation on EXPLICIT teacher requests — not incidental
// words like "draw a conclusion" or "illustrate my point". Requires a clear
// action verb + visual noun directed at the student.
const DIAGRAM_REQUEST_PATTERNS = [
  /\b(draw|sketch|make|create|generate)\s+(me\s+)?(a\s+)?(diagram|picture|image|drawing|sketch|chart|graph|flowchart|figure|illustration)\b/i,
  /\bshow\s+(me\s+)?(a\s+)?(diagram|picture|sketch|drawing|chart|graph|flowchart|figure|illustration)\b/i,
  /\bcan\s+you\s+(draw|sketch|make|create|generate)\b/i,
  /\b(put|write|draw)\s+(it|that|this)\s+(on|on the)\s+(the\s+)?(board|whiteboard)\b/i,
  /\bshow\s+(me\s+|us\s+)?(your\s+)?work\b/i,
  /\bvisuali[sz]e\s+(it|this|that)\b/i,
];

function isDiagramRequest(text: string): boolean {
  return DIAGRAM_REQUEST_PATTERNS.some(p => p.test(text));
}

// ── Vision refresh detection ────────────────────────────────────────────────
const VISION_REFRESH_PATTERN = /\b(can you see|do you see|what do you see|look at this|are you seeing|are you looking|what am i showing)\b/i;

function isVisionRefreshRequest(text: string): boolean {
  return VISION_REFRESH_PATTERN.test(text);
}

function triggerOnDemandDiagram(
  ai: GoogleGenAI,
  topic: string,
  teacherText: string,
  studentName: string,
  liveSession: any,
  socket: WebSocket,
  sendJson: (data: object) => void,
) {
  // Tell the student to acknowledge the request verbally
  try {
    liveSession.sendRealtimeInput({
      text: `[The teacher asked you to draw a diagram. Say something like "Sure, let me sketch that out!" or "Okay, give me a sec to draw this." Keep it short and natural. A diagram image will appear for the teacher automatically — do NOT describe what you're drawing.]`,
    });
  } catch (_) {}

  // Fire-and-forget diagram generation (on-demand = true to bypass word count check)
  generateStudentDiagram(ai, topic, teacherText, studentName, true).then(result => {
    if (!result || socket.readyState !== WebSocket.OPEN) return;
    sendJson({ type: 'student_diagram', studentId: studentName === 'Student' ? 'solo' : studentName, base64: result.base64, mimeType: result.mimeType });
    console.log(`[Dasko] On-demand diagram generated for ${studentName}`);

    // Send the diagram image to the Live session so the student can "see" its own diagram
    try {
      liveSession.sendRealtimeInput({ media: { data: result.base64, mimeType: result.mimeType } });
      liveSession.sendRealtimeInput({ text: '[You just drew this diagram on the whiteboard. The teacher can see it and may draw on it or point at parts of it.]' });
    } catch (_) {}
  }).catch(err => {
    console.error(`[Dasko] On-demand diagram failed:`, err);
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const ai = new GoogleGenAI({ vertexai: false, apiKey: GOOGLE_API_KEY });

  function isImageLikeFile(mimeType: string, filename: string): boolean {
    const lower = filename.toLowerCase();
    if (mimeType.startsWith('image/')) return true;
    return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.gif') || lower.endsWith('.webp');
  }

  async function extractImageTextWithAi(buf: Buffer, mimeType: string): Promise<string> {
    if (buf.length >= 4 * 1024 * 1024) return '';
    try {
      const b64 = buf.toString('base64');
      const imageMime = mimeType || 'image/jpeg';
      const gen = await ai.models.generateContent({
        model: FAST_MODEL,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: imageMime, data: b64 } },
            {
              text:
                'Transcribe every readable word in this image (slides, handwriting, diagrams with labels). ' +
                'Output plain text only, preserve line breaks where helpful. If no text, say [no text].',
            },
          ],
        }],
      });
      const text = (gen.text || '').trim();
      if (!text || text === '[no text]') return '';
      return text;
    } catch {
      return '';
    }
  }

  async function extractMaterialTextWithFallback(name: string, base64: string, mimeType: string, maxChars: number): Promise<{ content: string; error?: string }> {
    const buf = Buffer.from(base64, 'base64');
    const lower = name.toLowerCase();
    const isPdf = mimeType === 'application/pdf' || lower.endsWith('.pdf');
    const isImage = isImageLikeFile(mimeType, name);
    const isVideo = isVideoMime(mimeType);

    // ── Vision path for PDFs, images, and videos ──
    if (isPdf || isImage || isVideo) {
      try {
        if (isVideo) {
          const videoResult = await processVideoMaterial(ai, buf, name, mimeType);
          const formatted = formatVideoForContext(videoResult);
          return { content: formatted.slice(0, maxChars) };
        }
        if (isPdf) {
          const pdfResult = await analyzePdfWithVision(ai, buf, name);
          const formatted = formatForContext(pdfResult);
          return { content: formatted.slice(0, maxChars) };
        }
        if (isImage) {
          const imageResult = await analyzeImageWithVision(ai, buf, mimeType, name);
          const formatted = formatForContext(imageResult);
          return { content: formatted.slice(0, maxChars) };
        }
      } catch (e: any) {
        console.error(`[Dasko] Vision analysis failed for ${name}, falling back to text:`, e.message);
        // Fall through to legacy extraction
      }
    }

    // ── Legacy text extraction path ──
    let { text, error } = await extractFromBuffer(buf, mimeType, name);
    if (!text.trim() && isImage) {
      const ocrText = await extractImageTextWithAi(buf, mimeType || 'image/jpeg');
      if (ocrText.trim()) {
        text = ocrText;
        error = undefined;
      }
    }
    const trimmed = text.trim();
    if (!trimmed) return { content: '', error };
    const content = trimmed.slice(0, maxChars) + (trimmed.length > maxChars ? '\n\n[… truncated …]' : '');
    return { content };
  }

  function extractSharedUrls(text: string): string[] {
    if (!text) return [];
    const matches = text.match(SHARED_URL_REGEX) || [];
    const unique = Array.from(new Set(matches.map(u => u.trim())));
    return unique.slice(0, 2);
  }

  function htmlToReadableText(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#39;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function fetchUrlContextNote(url: string): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'Dasko/1.0 (session-link-reader)' },
      });
      clearTimeout(timeout);
      if (!res.ok) return null;
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) return null;
      const raw = await res.text();
      const plain = htmlToReadableText(raw).slice(0, 6000);
      if (!plain) return null;
      return `[The teacher shared a link: ${url}]\nPage context:\n${plain}`;
    } catch {
      return null;
    }
  }

  const app = new Hono();
  app.use('/*', cors());

  app.get('/', async (c) => {
    const html = await readFile('./frontend/index.html', 'utf-8');
    return c.html(html);
  });

  app.get('/app.js', async (c) => {
    const js = await readFile('./frontend/app.js', 'utf-8');
    return c.body(js, 200, { 'Content-Type': 'application/javascript' });
  });

  app.get('/logo.svg', async (c) => {
    const svg = await readFile('./frontend/logo.svg', 'utf-8');
    return c.body(svg, 200, { 'Content-Type': 'image/svg+xml' });
  });

  app.get('/api/topics', (c) => {
    return c.json({ topics: TOPICS });
  });

  app.get('/api/logs', (c) => {
    const since = Number(c.req.query('since')) || 0;
    const filtered = since ? logRing.filter(l => l.ts > since) : logRing.slice();
    return c.json({ logs: filtered });
  });

  // ── Study materials as stored context (files kept server-side; text resolved at session start) ──
  app.post('/api/materials/session', async (c) => {
    try {
      const { materialsId } = await createMaterialsSession();
      return c.json({ materialsId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg }, 500);
    }
  });

  app.post('/api/materials/upload', async (c) => {
    try {
      const formData = await c.req.formData();
      const materialsId = String(formData.get('materialsId') || '').trim();
      const file = formData.get('file');
      if (!materialsId) return c.json({ error: 'Missing materialsId' }, 400);
      if (!file || typeof file === 'string' || !(file instanceof File)) {
        return c.json({ error: 'Missing file' }, 400);
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const mime = file.type || 'application/octet-stream';
      const { filename } = await uploadMaterialFile(materialsId, buf, file.name, mime);
      const files = await listMaterialFiles(materialsId);
      return c.json({ filename, files });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg }, 500);
    }
  });

  app.get('/api/materials/:id', async (c) => {
    const id = c.req.param('id');
    const files = await listMaterialFiles(id);
    return c.json({ files });
  });

  app.delete('/api/materials/:id/file/:storedName', async (c) => {
    const id = c.req.param('id');
    const storedName = c.req.param('storedName');
    await removeMaterialFile(id, storedName);
    const files = await listMaterialFiles(id);
    return c.json({ files });
  });

  app.put('/api/materials/:id/notes', async (c) => {
    try {
      const id = c.req.param('id');
      const body = await c.req.json<{ notes?: string }>();
      await saveMaterialsNotes(id, body?.notes || '');
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // Legacy: extract-only (no storage) — still used if something calls it directly.
  app.post('/api/materials/extract', async (c) => {
    try {
      const formData = await c.req.formData();
      const file = formData.get('file');
      if (!file || typeof file === 'string' || !(file instanceof File)) {
        return c.json({ error: 'Missing file field' }, 400);
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const mime = file.type || 'application/octet-stream';
      let result = await extractFromBuffer(buf, mime, file.name);

      // Images: OCR-ish via Gemini when extractFromBuffer returns unsupported
      if (!result.text && mime.startsWith('image/') && buf.length < 4 * 1024 * 1024) {
        try {
          const b64 = buf.toString('base64');
          const mimeType = mime || 'image/png';
          const gen = await ai.models.generateContent({
            model: FAST_MODEL,
            contents: [{
              role: 'user',
              parts: [
                {
                  inlineData: { mimeType, data: b64 },
                },
                {
                  text:
                    'Transcribe every readable word in this image (slides, handwriting, diagrams with labels). ' +
                    'Output plain text only, preserve line breaks where helpful. If no text, say [no text].',
                },
              ],
            }],
          });
          const text = (gen.text || '').trim();
          if (text && text !== '[no text]') result = { text: text.slice(0, 120_000) };
          else result = { text: '', error: 'No text detected in image.' };
        } catch (e) {
          result = {
            text: '',
            error: e instanceof Error ? e.message : 'Image text extraction failed.',
          };
        }
      }

      if (result.error && !result.text) return c.json({ error: result.error }, 422);
      return c.json({ text: result.text, filename: file.name });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[Dasko] /api/materials/extract', msg);
      return c.json({ error: msg }, 500);
    }
  });

  // Test diagram generation directly (useful for debugging)
  app.post('/api/diagram/test', async (c) => {
    try {
      const body = await c.req.json<{ topic?: string; text?: string }>();
      const topic = body?.topic || 'Photosynthesis';
      const text = body?.text || 'So the plant takes in sunlight and carbon dioxide through its leaves, and then through chloroplasts it converts that energy into glucose and oxygen. The chlorophyll in the leaves is what makes them green and captures the light energy.';
      console.log(`[Dasko] /api/diagram/test: starting generation for topic="${topic}"`);
      const result = await generateStudentDiagram(ai, topic, text, 'Test');
      if (!result) return c.json({ error: 'No image generated — check server logs for details' }, 500);
      return c.json({ ok: true, mimeType: result.mimeType, base64Length: result.base64.length, hasMistake: result.hasMistake, base64: result.base64 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[Dasko] /api/diagram/test error:', msg);
      return c.json({ error: msg }, 500);
    }
  });

  app.post('/api/cleanup-transcript', async (c) => {
    let text = '';
    let fallback = '';
    let language = 'English';
    try {
      const body = await c.req.json<{ text: string; topic: string; language?: string; mode?: 'live' | 'final'; speaker?: string; context?: string }>();
      fallback = body?.text || '';
      text = (body?.text || '').trim();
      const topic = body?.topic || '';
      language = normalizeSessionLanguage(body?.language || 'English');
      const mode = body?.mode === 'live' ? 'live' : 'final';
      const speaker = (body?.speaker || 'Speaker').trim() || 'Speaker';
      const context = (body?.context || '').trim().slice(0, 2000);
      if (!text) return c.json({ cleaned: body?.text || '' });
      const cleanupPrompt =
        `Raw speech-to-text (may have missing spaces, merged words, or wrong words). Topic: "${topic}". Language: "${language}".\n\n` +
        `Task: produce a single readable transcript that matches what ${speaker} likely said.\n` +
        `- Insert spaces between words where ASR merged them (e.g. "thewater" → "the water").\n` +
        `- Fix homophones and technical terms using topic context and ${language} spelling conventions.\n` +
        `- Use prior conversation context to disambiguate words, names, and phrasing.\n` +
        `- Keep the same order and meaning; do not summarize or add ideas.\n` +
        (mode === 'live'
          ? `- This is a live partial stream. Make spacing and grammar readable immediately, but preserve unfinished wording.\n`
          : `- This is a final transcript. Use complete punctuation and capitalization.\n`) +
        `- Output plain text only, no quotes or markdown.\n\n` +
        (context ? `Prior conversation:\n${context}\n\n` : '') +
        `Transcription:\n${text}`;
      const chosenModel = mode === 'live' ? FAST_MODEL : CLEANUP_MODEL;
      let result;
      try {
        result = await ai.models.generateContent({
          model: chosenModel,
          contents: [{ role: 'user', parts: [{ text: cleanupPrompt }] }],
        });
      } catch {
        if (chosenModel !== FAST_MODEL) {
          result = await ai.models.generateContent({
            model: FAST_MODEL,
            contents: [{ role: 'user', parts: [{ text: cleanupPrompt }] }],
          });
        } else {
          throw new Error('Cleanup failed');
        }
      }
      const cleanedRaw = (result.text?.trim() || text).replace(/\s+/g, ' ').trim();
      const cleaned = enforceTranscriptLanguage(cleanedRaw, language);
      return c.json({ cleaned: cleaned || text });
    } catch {
      const fallbackCleaned = enforceTranscriptLanguage(text || fallback, language);
      return c.json({ cleaned: fallbackCleaned || text || fallback }, 500);
    }
  });

  const port = Number(process.env.PORT) || 8000;
  const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });

  const wss = new WebSocketServer({ server });

  wss.on('connection', async (socket: WebSocket, request: IncomingMessage) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);

    if (url.pathname !== '/ws/live') {
      socket.close();
      return;
    }

    const topic      = url.searchParams.get('topic')     || 'the topic the teacher will explain';
    const persona    = url.searchParams.get('persona')   || 'eager';
    const language   = normalizeSessionLanguage(url.searchParams.get('language'));
    let materials  = url.searchParams.get('materials') || '';
    const materialsId = url.searchParams.get('materialsId') || '';
    if (materialsId) {
      try {
        const resolved = await resolveMaterialsContext(materialsId, ai);
        if (resolved.trim()) materials = resolved;
      } catch (e) {
        console.error('[Dasko] resolveMaterialsContext', e);
      }
    }
    const video      = url.searchParams.get('video')     === '1';
    const classroom  = url.searchParams.get('classroom') === '1';
    const studentIds = (url.searchParams.get('students') || '')
      .split(',').map(s => s.trim()).filter(s => STUDENT_PROFILES[s]);
    const model      = video ? VIDEO_MODEL : AUDIO_MODEL;

    console.log('[Dasko] New session | topic:', topic, '| persona:', persona, '| language:', language, '| video:', video, '| classroom:', classroom, studentIds);

    // ── Per-session state ──────────────────────────────────────────────────
    const sessionLog: SessionEntry[] = [];
    let teacherTranscriptBuf = '';
    let coachingCooldown     = 0;
    let reflectionRequested  = false;
    let lastTeacherSpeechAt  = Date.now();   // timestamp of last speech_start or speech_end; init to now so initial frames aren't gated
    let teacherIsSpeaking    = false;       // true between speech_start and speech_end
    let teacherHasSpoken     = false;       // anti-hallucination: ignore inputTranscription until first real speech_start
    let   sessionStartedAt   = Date.now();  // anti-hallucination: discard audio for first N seconds; reset in onopen so Cloud Run latency doesn't eat the window

    // Deferred session start: client sends material_file(s) then ready_to_start; we merge file content into materials before creating Live session.
    const pendingMaterialFiles: { name: string; base64: string; mimeType: string }[] = [];
    let sessionReady = false;
    const MAX_MATERIALS_CHARS = 30_000;

    function sendJson(data: object) {
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(data));
        }
      } catch (e) {
        console.error('[Dasko] sendJson failed (socket may be closing):', e);
      }
    }

    function sendDebug(level: 'info' | 'warn' | 'error', message: string) {
      sendJson({ type: 'debug', level, message });
    }

    /** Process material_file: use Gemini Vision to analyze content, then send as text to Live API. */
    async function processMaterialFile(name: string, base64: string, mimeType: string): Promise<string> {
      const maxChars = 20_000; // increased for vision-rich output
      sendJson({ type: 'material_processing', filename: name });
      try {
        const { content, error } = await extractMaterialTextWithFallback(name, base64, mimeType, maxChars);
        sendJson({ type: 'material_processed', filename: name });
        if (content) {
          return `[The teacher has shared a study material: "${name}".]\n\nContent:\n${content}`;
        }
        return `[The teacher has shared a file: "${name}".]${error ? ` (${error})` : ''}`;
      } catch (e: any) {
        sendJson({ type: 'material_processed', filename: name });
        return `[The teacher has shared a file: "${name}".] (analysis failed: ${e.message})`;
      }
    }

    async function onTeacherSpeechEnd(media?: { camera?: boolean; whiteboard?: boolean; screen?: boolean }) {
      const text = teacherTranscriptBuf.trim();
      teacherTranscriptBuf = '';

      if (!text) return;

      sessionLog.push({ role: 'teacher', name: 'Teacher', text, time: Date.now() });

      // Addressed-student priority: if teacher mentioned a student by name, lock the mic for that student
      if (sessionMap && studentIds.length >= 2) {
        const lower = text.toLowerCase();
        const addressedId = studentIds.find(id => {
          const name = id.toLowerCase();
          const re = new RegExp(`\\b${name}\\b`, 'i');
          return re.test(lower);
        });
        if (addressedId) {
          addressedStudent = addressedId;
          console.log(`[Dasko] Teacher addressed ${addressedId} — locking first turn for them`);
          const addressedSess = sessionMap.get(addressedId);
          if (addressedSess) {
            try {
              addressedSess.sendRealtimeInput({
                text: `[The teacher just called on you by name. You MUST respond. Speak up now.]`,
              });
            } catch (_) {}
          }
          // Tell other students to stay silent
          sessionMap.forEach((sess, otherId) => {
            if (otherId !== addressedId) {
              try {
                sess.sendRealtimeInput({
                  text: `[The teacher called on ${addressedId.charAt(0).toUpperCase() + addressedId.slice(1)} specifically. Do NOT speak. Stay completely silent and wait.]`,
                });
              } catch (_) {}
            }
          });
          // Safety timeout: if addressed student hasn't spoken in 5s, clear the lock
          const lockedId = addressedId;
          setTimeout(() => {
            if (addressedStudent === lockedId) {
              console.log(`[Dasko] Addressed student ${lockedId} didn't respond in 5s — clearing lock`);
              addressedStudent = null;
            }
          }, 5000);
        }
      }

      // On-demand diagram: detect diagram request from teacher's speech
      if (isDiagramRequest(text)) {
        console.log('[Dasko] On-demand diagram requested via speech:', text.slice(0, 80));
        if (session) {
          triggerOnDemandDiagram(ai, topic, text, 'Student', session, socket, sendJson);
        } else if (sessionMap) {
          const firstId = studentIds[0];
          const firstSess = sessionMap.get(firstId);
          if (firstSess) {
            triggerOnDemandDiagram(ai, topic, text, firstId, firstSess, socket, sendJson);
          }
        }
      }

      // Vision refresh: detect "can you see..." requests
      if (isVisionRefreshRequest(text)) {
        console.log('[Dasko] Vision refresh requested via speech:', text.slice(0, 80));
        sendJson({ type: 'request_screenshot' });
      }

      // Coaching tip (rate-limited to one per 10s)
      const now = Date.now();
      if (now > coachingCooldown) {
        coachingCooldown = now + 10_000;
        generateCoachingTip(ai, topic, text, media).then(tip => {
          if (tip) sendJson({ type: 'coaching_tip', tip });
        });
      }
    }

    async function onStudentSpeech(name: string, text: string) {
      if (!text) return;
      sessionLog.push({ role: 'student', name, text, time: Date.now() });
      const emotion = await classifyEmotion(ai, text);
      if (emotion) sendJson({ type: 'emotion', state: emotion });
    }

    // Session refs (set when Live session(s) are created after ready_to_start)
    let session: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
    let sessionMap: Map<string, Awaited<ReturnType<typeof ai.live.connect>>> | null = null;
    // Classroom-only state (set when creating classroom in ready_to_start)
    let activeSpeaker: string | null = null;
    let cooldownUntil = 0;
    const SPEAKER_GAP_MS = 500;
    let studentsAllowed = true;
    let consecutiveStudentTurns = 0;
    const MAX_STUDENT_EXCHANGES = 3;
    let currentMaxExchanges = 1 + Math.floor(Math.random() * MAX_STUDENT_EXCHANGES); // random 1-3 per teacher turn
    let addressedStudent: string | null = null; // when teacher names a student, only that student may speak first
    const audioBuffers = new Map<string, string[]>(studentIds.map(id => [id, []]));
    const MAX_BUFFER_CHUNKS = 25;
    function clearAllBuffers() {
      audioBuffers.forEach((_, k) => audioBuffers.set(k, []));
    }
    let studentTranscriptBuf = '';
    // Shared transcript buffers for classroom students (accessible outside closure for interruption handling)
    const transcriptBuffers = new Map<string, string>(studentIds.map(id => [id, '']));
    let interruptedStudent: string | null = null;

    // (Diagram generation is on-demand only — no auto-generation state needed)
    let diagramPopupOpen = false; // when true, skip regular video frames (diagram frames take priority)

    /** Build full materials string (URL materials + vision-analyzed pending files), then create Live session(s). */
    async function startSessionWithMaterials() {
      let fullMaterials = materials;
      const total = pendingMaterialFiles.length;

      // Process files in parallel with vision analysis
      if (total > 0) {
        sendJson({ type: 'info', message: `Analyzing ${total} file${total > 1 ? 's' : ''} with AI vision...` });
        const results = await Promise.allSettled(
          pendingMaterialFiles.map(async (f, idx) => {
            sendJson({ type: 'material_progress', filename: f.name, status: 'processing', current: idx + 1, total });
            const { content } = await extractMaterialTextWithFallback(f.name, f.base64, f.mimeType, MAX_MATERIALS_CHARS);
            sendJson({ type: 'material_progress', filename: f.name, status: 'done', current: idx + 1, total });
            return { name: f.name, content };
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value.content) {
            const chunk = r.value.content.slice(0, MAX_MATERIALS_CHARS);
            fullMaterials += '\n\n---\n[From file: ' + r.value.name + ']\n' + chunk;
          }
        }
      }

      if (fullMaterials.length > MAX_MATERIALS_CHARS * 2) {
        fullMaterials = fullMaterials.slice(0, MAX_MATERIALS_CHARS * 2) + '\n\n[… truncated …]';
      }

      if (classroom && studentIds.length >= 2) {
        // ── CLASSROOM: create sessions with fullMaterials ─────────────────────
        activeSpeaker = null;
        cooldownUntil = 0;
        studentsAllowed = true;
        consecutiveStudentTurns = 0;
        clearAllBuffers();

      try {
        // Stagger session creation to avoid hitting Gemini rate limits
        const entries: [string, any][] = [];
        for (const id of studentIds) {
          if (entries.length > 0) await new Promise(r => setTimeout(r, 800)); // 800ms delay between sessions
          const voice = STUDENT_VOICES[id] || 'Zephyr';
          const cfg: types.LiveConnectConfig = {
            responseModalities: [Modality.AUDIO],
            outputAudioTranscription: {},
            inputAudioTranscription: {},
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            systemInstruction: getClassroomStudentInstruction(topic, id, studentIds, fullMaterials, video, language),
          };

          const sess = await ai.live.connect({
            model,
            config: cfg,
            callbacks: {
              onopen:  () => {
                console.log(`[Dasko] ${id} session opened`);
                sendDebug('info', `Gemini session opened for ${id}`);
                if (id === studentIds[0]) {
                  sessionStartedAt = Date.now(); // reset once — audio blackout window starts from first Live session ready
                  sendJson({ type: 'session_ready' });
                  sendJson({ type: 'info', message: `Your classroom is ready. Start explaining: ${topic}` });
                  setTimeout(() => {
                    try {
                      sess.sendRealtimeInput({
                        text: `Say a short greeting out loud in ${language} right now (e.g. "Hi, we're ready when you are!"). Say ONLY this greeting — nothing else. Do NOT ask a question. Do NOT mention the topic. Just greet and wait silently.`,
                      });
                    } catch (_) {}
                  }, 400);
                }
              },
              onmessage: (msg: types.LiveServerMessage) => {
                // Teacher input transcription (only log once, from first student's session)
                // Anti-hallucination: ignore inputTranscription until teacher has actually spoken
                if (msg.serverContent?.inputTranscription?.text && id === studentIds[0] && teacherHasSpoken) {
                  const chunk = enforceTranscriptLanguage(msg.serverContent.inputTranscription.text, language);
                  if (chunk) {
                    teacherTranscriptBuf += ' ' + chunk;
                    sendJson({ type: 'teacher_transcript', text: chunk });

                    // Graceful interruption: real teacher speech arrived while a student is talking
                    // teacherIsSpeaking guard prevents late-arriving transcript chunks
                    // (from after the teacher stopped) from falsely triggering interruption
                    if (activeSpeaker !== null && interruptedStudent === null && teacherIsSpeaking) {
                      const interrupted = activeSpeaker;
                      interruptedStudent = interrupted;
                      console.log(`[Dasko] Teacher interrupted ${interrupted} (confirmed by transcript: "${chunk.slice(0, 40)}")`);
                      const partialTranscript = (transcriptBuffers.get(interrupted) || '').trim();
                      transcriptBuffers.set(interrupted, '');
                      activeSpeaker = null;
                      clearAllBuffers();
                      cooldownUntil = 0;
                      sendJson({ type: 'student_interrupted', studentId: interrupted });
                      if (partialTranscript) {
                        onStudentSpeech(interrupted.charAt(0).toUpperCase() + interrupted.slice(1), partialTranscript);
                      }
                    }
                  }
                }

                // Student output transcription — claim mic if not yet claimed, then stream
                if (msg.serverContent?.outputTranscription?.text) {
                  let chunk = enforceTranscriptLanguage(msg.serverContent.outputTranscription.text, language);
                  if (chunk) chunk = chunk.replace(/\([\w\s.,!?'-]*\)/g, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([,!?.;:])([A-Za-z])/g, '$1 $2').trim();
                  if (chunk) {
                    transcriptBuffers.set(id, (transcriptBuffers.get(id) || '') + ' ' + chunk);
                    // If transcript arrives before audio claims the mic, claim it now
                    // But respect addressed-student lock: only the addressed student can claim first turn
                    const blockedByAddress = addressedStudent && addressedStudent !== id && activeSpeaker === null && consecutiveStudentTurns === 0;
                    if (!blockedByAddress && activeSpeaker === null && studentsAllowed && Date.now() > cooldownUntil) {
                      activeSpeaker = id;
                      if (addressedStudent === id) addressedStudent = null;
                      sendJson({ type: 'student_speaking', name: id });
                    }
                    if (activeSpeaker === id) sendJson({ type: 'transcript', text: chunk, name: id });
                  }
                }

                // Student audio
                if (msg.serverContent?.modelTurn?.parts) {
                  for (const part of msg.serverContent.modelTurn.parts) {
                    if (!part.inlineData?.data) continue;
                    const chunk = part.inlineData.data;
                    const now   = Date.now();

                    if (!studentsAllowed) {
                      // Hard-suppressed after too many consecutive exchanges — discard
                      continue;
                    }

                    // Addressed-student enforcement: if teacher called on someone, only they can claim the first turn
                    if (addressedStudent && addressedStudent !== id && activeSpeaker === null && consecutiveStudentTurns === 0) {
                      // Not the addressed student and no one has spoken yet — buffer silently but don't claim mic
                      const buf = audioBuffers.get(id) ?? [];
                      if (buf.length < MAX_BUFFER_CHUNKS) buf.push(chunk);
                      audioBuffers.set(id, buf);
                      continue;
                    }

                    if (activeSpeaker === null) {
                      if (now > cooldownUntil) {
                        // Cooldown expired: claim the mic and flush any buffered audio first
                        activeSpeaker = id;
                        if (addressedStudent === id) addressedStudent = null; // addressed student claimed, clear lock
                        sendJson({ type: 'student_speaking', name: id });
                        const buffered = audioBuffers.get(id) ?? [];
                        for (const b of buffered) sendJson({ type: 'classroom_audio', studentId: id, base64: b });
                        audioBuffers.set(id, []);
                        sendJson({ type: 'classroom_audio', studentId: id, base64: chunk });
                      } else {
                        // Still in cooldown gap — buffer this chunk so the beginning isn't clipped
                        const buf = audioBuffers.get(id) ?? [];
                        if (buf.length < MAX_BUFFER_CHUNKS) buf.push(chunk);
                        audioBuffers.set(id, buf);
                      }
                    } else if (activeSpeaker === id) {
                      sendJson({ type: 'classroom_audio', studentId: id, base64: chunk });
                    }
                    // Different student is active — discard
                  }
                }

                if (msg.serverContent?.turnComplete) {
                  // If this student was interrupted, just clean up — don't double-process
                  if (interruptedStudent === id) {
                    transcriptBuffers.set(id, '');
                    interruptedStudent = null;
                    return;
                  }
                  if (activeSpeaker === id) {
                    const full = (transcriptBuffers.get(id) || '').trim();
                    transcriptBuffers.set(id, '');
                    activeSpeaker = null;
                    cooldownUntil = Date.now() + SPEAKER_GAP_MS;
                    consecutiveStudentTurns++;
                    clearAllBuffers(); // stale buffered audio from the previous gap is now irrelevant

                    sendJson({ type: 'student_turn_complete', studentId: id });
                    if (full) onStudentSpeech(id.charAt(0).toUpperCase() + id.slice(1), full);

                    if (consecutiveStudentTurns >= currentMaxExchanges) {
                      // Hit the limit — silence all students until teacher speaks
                      studentsAllowed = false;
                      sendJson({ type: 'teacher_turn' });
                      sendJson({ type: 'info', message: 'Students are waiting for your response.' });
                    } else if (full) {
                      // Still within limit — let peers hear what was said
                      const speakerName = id.charAt(0).toUpperCase() + id.slice(1);
                      sessionMap.forEach((sess, otherId) => {
                        if (otherId !== id) {
                          try {
                            sess.sendRealtimeInput({ text: `[Classroom] ${speakerName}: "${full}"` });
                          } catch (_) {}
                        }
                      });
                    }
                  } else {
                    transcriptBuffers.set(id, '');
                  }
                }
              },
              onerror: (e: ErrorEvent) => {
                console.error(`[Dasko] ${id} error:`, e.message ?? JSON.stringify(e));
                sendDebug('error', `Gemini session error for ${id}: ${e.message ?? JSON.stringify(e)}`);
                sendJson({ type: 'error', message: `${id} session error: ${e.message ?? 'unknown'}` });
              },
              onclose: (e: CloseEvent) => {
                console.log(`[Dasko] ${id} closed:`, e.code, e.reason || '');
                sendDebug('error', `Gemini session closed for ${id}: code ${e.code}${e.reason ? ', reason: ' + e.reason : ''}`);
                sendJson({ type: 'error', message: `${id} session ended (code ${e.code}${e.reason ? ': ' + e.reason : ''})` });
                // Remove the dead session from the map instead of killing the whole WebSocket
                if (sessionMap) {
                  sessionMap.delete(id);
                  if (activeSpeaker === id) { activeSpeaker = null; }
                  // Only close the WebSocket if ALL sessions are gone
                  if (sessionMap.size === 0) {
                    setTimeout(() => { if (socket.readyState === WebSocket.OPEN) socket.close(); }, 500);
                  }
                }
              },
            },
          });

          entries.push([id, sess] as const);
        }

        sessionMap = new Map(entries);
        sessionReady = true;
      } catch (e: any) {
        console.error('[Dasko] Failed to create classroom sessions:', e);
        sendDebug('error', `Failed to create classroom sessions: ${e.message}`);
        sendJson({ type: 'error', message: `Failed to connect: ${e.message}` });
        // Give the error message time to reach the client before closing
        setTimeout(() => { if (socket.readyState === WebSocket.OPEN) socket.close(); }, 500);
        return;
      }
    } else {
      // ── SOLO: create session with fullMaterials ─────────────────────────────
      const config: types.LiveConnectConfig = {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
        systemInstruction: getStudentInstruction(topic, persona, fullMaterials, video, language),
      };
      try {
        session = await ai.live.connect({
          model,
          config,
          callbacks: {
            onopen: () => {
              console.log('[Dasko] Live session opened, topic:', topic);
              sendDebug('info', 'Gemini Live session opened (solo)');
              sessionStartedAt = Date.now(); // reset so audio blackout window starts from Live session ready
              sendJson({ type: 'session_ready' });
              sendJson({ type: 'info', message: `Your student is ready. Start explaining: ${topic}` });
              setTimeout(() => {
                try {
                  session!.sendRealtimeInput({
                    text: `Say a short greeting out loud in ${language} right now (e.g. "Hi, ready when you are!" or "Hey there!"). Say ONLY this greeting — nothing else. Do NOT ask a question. Do NOT mention the topic. Just greet and wait silently.`,
                  });
                } catch (_) {}
              }, 400);
            },
            onmessage: (message: types.LiveServerMessage) => {
              // Anti-hallucination: ignore inputTranscription until teacher has actually spoken
              if (message.serverContent?.inputTranscription?.text && teacherHasSpoken) {
                const chunk = enforceTranscriptLanguage(message.serverContent.inputTranscription.text, language);
                if (chunk) {
                  teacherTranscriptBuf += ' ' + chunk;
                  sendJson({ type: 'teacher_transcript', text: chunk });
                }
              }
              // Solo mode: when teacher is speaking, suppress student audio at
              // the server level to prevent in-flight chunks from reaching the
              // frontend. Gemini's native barge-in stops generation, but chunks
              // already in the pipeline still arrive. Transcript is still
              // forwarded so the partial text is preserved.
              if (message.serverContent?.outputTranscription?.text) {
                const chunk = enforceTranscriptLanguage(message.serverContent.outputTranscription.text, language);
                if (chunk) {
                  studentTranscriptBuf += ' ' + chunk;
                  sendJson({ type: 'transcript', text: chunk });
                }
              }
              if (message.serverContent?.modelTurn?.parts) {
                for (const part of message.serverContent.modelTurn.parts) {
                  if (part.inlineData?.data) sendJson({ type: 'audio', base64: part.inlineData.data });
                }
              }
              if (message.serverContent?.turnComplete) {
                sendJson({ type: 'turn_complete' });
                const full = studentTranscriptBuf.trim();
                studentTranscriptBuf = '';
                if (full) onStudentSpeech('Student', full);
              }
            },
            onerror: (e: ErrorEvent) => {
              console.error('[Dasko] Session error:', e.message ?? JSON.stringify(e));
              sendDebug('error', `Gemini session error: ${e.message ?? JSON.stringify(e)}`);
              sendJson({ type: 'error', message: e.message ?? 'Session error' });
            },
            onclose: (e: CloseEvent) => {
              console.log('[Dasko] Live session closed:', e.code, e.reason || '');
              sendDebug('error', `Gemini session closed: code ${e.code}${e.reason ? ', reason: ' + e.reason : ''}`);
              sendJson({ type: 'error', message: `Live session ended (code ${e.code}${e.reason ? ': ' + e.reason : ''})` });
              // Give the error message time to reach the client before closing
              setTimeout(() => { if (socket.readyState === WebSocket.OPEN) socket.close(); }, 500);
            },
          },
        });
        sessionReady = true;
      } catch (e: any) {
        console.error('[Dasko] Failed to connect to Live API:', e);
        sendDebug('error', `Failed to connect to Gemini Live API: ${e.message}`);
        sendJson({ type: 'error', message: `Failed to connect: ${e.message}` });
        // Give the error message time to reach the client before closing
        setTimeout(() => { if (socket.readyState === WebSocket.OPEN) socket.close(); }, 500);
        return;
      }
    }
    }

    socket.on('message', (data: Buffer, isBinary: boolean) => { try {
      // Init phase: collect material_file(s), then on ready_to_start create session(s) with merged materials
      if (!sessionReady) {
        if (isBinary) return;
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'material_file' && parsed.base64 && parsed.name) {
            pendingMaterialFiles.push({
              name: parsed.name,
              base64: parsed.base64,
              mimeType: parsed.mimeType || 'application/octet-stream',
            });
            return;
          }
          if (parsed.type === 'ready_to_start') {
            startSessionWithMaterials();
            return;
          }
        } catch (_) {}
        return;
      }

      // Session ready: route to classroom or solo
      if (sessionMap) {
        if (isBinary) {
          // Anti-hallucination: discard audio in first 1.5s after Live session ready
          if (Date.now() - sessionStartedAt < 1500) { sendDebug('info', `Audio discarded (blackout: ${(1500 - (Date.now() - sessionStartedAt))}ms left)`); return; }
          // Binary audio only arrives when frontend VAD detected speech — reliable teacher-speaking signal
          if (!teacherHasSpoken) sendDebug('info', 'Teacher speech detected (first audio)');
          teacherHasSpoken = true;
          const b64 = data.toString('base64');
          studentsAllowed = true;
          consecutiveStudentTurns = 0;
          currentMaxExchanges = 1 + Math.floor(Math.random() * MAX_STUDENT_EXCHANGES); // random 1-3
          addressedStudent = null; // reset — will be set in onTeacherSpeechEnd if a name is detected
          interruptedStudent = null;
          clearAllBuffers();
          sessionMap.forEach(sess => {
            try { sess.sendRealtimeInput({ media: { data: b64, mimeType: 'audio/pcm;rate=16000' } }); } catch (_) {}
          });
          return;
        }
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'speech_start') {
            teacherIsSpeaking = true;
            teacherHasSpoken = true;
            lastTeacherSpeechAt = Date.now();
            // Note: interruption is NOT triggered here — speech_start fires on any noise.
            // Real interruption is triggered in the inputTranscription handler when actual
            // teacher words are transcribed while a student is speaking.
            return;
          }
          if (parsed.type === 'speech_end') {
            teacherIsSpeaking = false;
            lastTeacherSpeechAt = Date.now();
            onTeacherSpeechEnd(parsed.media);
            return;
          }
          if (parsed.type === 'request_reflection') {
            if (reflectionRequested) return;
            reflectionRequested = true;

            generateReflection(ai, topic, sessionLog).then(data => { sendJson({ type: 'reflection', data }); });
            return;
          }
          if (parsed.type === 'text_input' && typeof parsed.text === 'string' && parsed.text.trim()) {
            const userText = parsed.text.trim();
            teacherHasSpoken = true; // text input counts as teacher speaking
            sessionMap.forEach(sess => { try { sess.sendRealtimeInput({ text: userText }); } catch (_) {} });

            // On-demand diagram: detect diagram request from teacher
            if (isDiagramRequest(userText)) {
              console.log('[Dasko] On-demand diagram requested via text_input (classroom)');
              const firstId = studentIds[0];
              const firstSess = sessionMap.get(firstId);
              if (firstSess) {
                triggerOnDemandDiagram(ai, topic, userText, firstId, firstSess, socket, sendJson);
              }
            }

            // Vision refresh: detect "can you see..." requests
            if (isVisionRefreshRequest(userText)) {
              console.log('[Dasko] Vision refresh requested via text_input (classroom)');
              sendJson({ type: 'request_screenshot' });
            }

            const urls = extractSharedUrls(userText);
            if (urls.length) {
              (async () => {
                for (const url of urls) {
                  const note = await fetchUrlContextNote(url);
                  if (!note) continue;
                  sessionMap!.forEach(sess => { try { sess.sendRealtimeInput({ text: note }); } catch (_) {} });
                }
              })();
            }
          }
          // Notify Gemini sessions when media sources are toggled
          if (parsed.type === 'media_state') {
            const parts: string[] = [];
            if (typeof parsed.camera === 'boolean')     parts.push(`[MEDIA] Camera ${parsed.camera ? 'ON' : 'OFF'}`);
            if (typeof parsed.whiteboard === 'boolean')  parts.push(`[MEDIA] Whiteboard ${parsed.whiteboard ? 'ON' : 'OFF'}`);
            if (typeof parsed.screen === 'boolean')      parts.push(`[MEDIA] Screen share ${parsed.screen ? 'ON' : 'OFF'}`);
            if (parts.length) {
              // Update tracked media state
              if (typeof parsed.camera === 'boolean')    media.camera = parsed.camera;
              if (typeof parsed.whiteboard === 'boolean') media.whiteboard = parsed.whiteboard;
              if (typeof parsed.screen === 'boolean')    media.screen = parsed.screen;
              const cue = parts.join('. ') + '. Only claim to see content from sources that are ON.';
              sessionMap.forEach(sess => { try { sess.sendRealtimeInput({ text: cue }); } catch (_) {} });
            }
          }
          if (parsed.type === 'video_frame' && typeof parsed.base64 === 'string') {
            // Skip regular video frames when diagram popup is open (diagram frames take priority)
            if (diagramPopupOpen) return;
            // Only relay video frames if the teacher is speaking or recently spoke
            const frameAge = Date.now() - lastTeacherSpeechAt;
            if (teacherIsSpeaking || frameAge < SILENCE_FRAME_GATE_MS) {
              sessionMap.forEach(sess => { try { sess.sendRealtimeInput({ media: { data: parsed.base64, mimeType: 'image/jpeg' } }); } catch (_) {} });
            }
          }
          // Diagram annotation frames — no speech gating (teacher is actively drawing)
          if (parsed.type === 'diagram_frame' && typeof parsed.base64 === 'string') {
            sessionMap.forEach(sess => {
              try { sess.sendRealtimeInput({ media: { data: parsed.base64, mimeType: 'image/jpeg' } }); } catch (_) {}
            });
          }
          // Diagram popup open/close state
          if (parsed.type === 'diagram_popup_open')   { diagramPopupOpen = true; }
          if (parsed.type === 'diagram_popup_closed')  { diagramPopupOpen = false; }
          // Vision refresh screenshot — bypasses all gating, additive to session context
          if (parsed.type === 'vision_screenshot' && typeof parsed.base64 === 'string') {
            const note = '[The teacher asked if you can see something. Here is a fresh screenshot of everything visible on screen right now. Look at it carefully and describe what you see. You still remember everything from the conversation so far.]';
            sessionMap.forEach(sess => {
              try {
                sess.sendRealtimeInput({ media: { data: parsed.base64, mimeType: 'image/jpeg' } });
                sess.sendRealtimeInput({ text: note });
              } catch (_) {}
            });
          }
          if (parsed.type === 'material_file' && parsed.base64 && parsed.name) {
            const name = parsed.name || 'file';
            const mimeType = parsed.mimeType || 'application/octet-stream';
            console.log(`[Dasko] Received study material: ${name} (${mimeType}) — extracting text to avoid Live API crash`);
            (async () => {
              try {
                const message = await processMaterialFile(name, parsed.base64, mimeType);
                sessionMap!.forEach(sess => { try { sess.sendRealtimeInput({ text: message }); } catch (_) {} });
              } catch (e) {
                console.error('[Dasko] material_file extract failed', e);
                sessionMap!.forEach(sess => { try { sess.sendRealtimeInput({ text: `[The teacher has shared a file: "${name}".]` }); } catch (_) {} });
              }
            })();
          }
        } catch (_) {}
        return;
      }

      if (session) {
        if (isBinary) {
          // Anti-hallucination: discard audio in first 1.5s after Live session ready
          if (Date.now() - sessionStartedAt < 1500) { sendDebug('info', `Audio discarded (blackout: ${(1500 - (Date.now() - sessionStartedAt))}ms left)`); return; }
          // Binary audio only arrives when frontend VAD detected speech — reliable teacher-speaking signal
          if (!teacherHasSpoken) sendDebug('info', 'Teacher speech detected (first audio)');
          teacherHasSpoken = true;
          const base64 = data.toString('base64');
          try { session.sendRealtimeInput({ media: { data: base64, mimeType: 'audio/pcm;rate=16000' } }); } catch (e: any) {
            console.error('[Dasko] sendRealtimeInput failed:', e);
            sendDebug('warn', `Failed to send audio to Gemini: ${e.message ?? e}`);
          }
          return;
        }
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'speech_start') {
            teacherIsSpeaking = true;
            teacherHasSpoken = true;
            lastTeacherSpeechAt = Date.now();
            // Note: interruption is NOT triggered here — speech_start fires on any noise.
            // Real interruption is triggered in the inputTranscription handler.
            return;
          }
          if (msg.type === 'speech_end') {
            teacherIsSpeaking = false;
            lastTeacherSpeechAt = Date.now();
            onTeacherSpeechEnd(msg.media);
            return;
          }
          if (msg.type === 'request_reflection') {
            if (reflectionRequested) return;
            reflectionRequested = true;

            generateReflection(ai, topic, sessionLog).then(reflData => { sendJson({ type: 'reflection', data: reflData }); });
            return;
          }
          if (msg.type === 'text_input' && typeof msg.text === 'string' && msg.text.trim()) {
            const userText = msg.text.trim();
            teacherHasSpoken = true; // text input counts as teacher speaking
            try { session.sendRealtimeInput({ text: userText }); } catch (_) {}

            // On-demand diagram: detect diagram request from teacher
            if (isDiagramRequest(userText)) {
              console.log('[Dasko] On-demand diagram requested via text_input');
              triggerOnDemandDiagram(ai, topic, userText, 'Student', session, socket, sendJson);
            }

            // Vision refresh: detect "can you see..." requests
            if (isVisionRefreshRequest(userText)) {
              console.log('[Dasko] Vision refresh requested via text_input');
              sendJson({ type: 'request_screenshot' });
            }

            const urls = extractSharedUrls(userText);
            if (urls.length) {
              (async () => {
                for (const url of urls) {
                  const note = await fetchUrlContextNote(url);
                  if (!note) continue;
                  try { session!.sendRealtimeInput({ text: note }); } catch (_) {}
                }
              })();
            }
          }
          // Notify Gemini session when media sources are toggled
          if (msg.type === 'media_state') {
            const parts: string[] = [];
            if (typeof msg.camera === 'boolean')     parts.push(`[MEDIA] Camera ${msg.camera ? 'ON' : 'OFF'}`);
            if (typeof msg.whiteboard === 'boolean')  parts.push(`[MEDIA] Whiteboard ${msg.whiteboard ? 'ON' : 'OFF'}`);
            if (typeof msg.screen === 'boolean')      parts.push(`[MEDIA] Screen share ${msg.screen ? 'ON' : 'OFF'}`);
            if (parts.length) {
              if (typeof msg.camera === 'boolean')    media.camera = msg.camera;
              if (typeof msg.whiteboard === 'boolean') media.whiteboard = msg.whiteboard;
              if (typeof msg.screen === 'boolean')    media.screen = msg.screen;
              const cue = parts.join('. ') + '. Only claim to see content from sources that are ON.';
              try { session!.sendRealtimeInput({ text: cue }); } catch (_) {}
            }
          }
          if (msg.type === 'video_frame' && typeof msg.base64 === 'string') {
            // Skip regular video frames when diagram popup is open (diagram frames take priority)
            if (diagramPopupOpen) return;
            // Only relay video frames if the teacher is speaking or recently spoke
            const frameAge = Date.now() - lastTeacherSpeechAt;
            if (teacherIsSpeaking || frameAge < SILENCE_FRAME_GATE_MS) {
              try { session.sendRealtimeInput({ media: { data: msg.base64, mimeType: 'image/jpeg' } }); } catch (_) {}
            }
          }
          // Diagram annotation frames — no speech gating
          if (msg.type === 'diagram_frame' && typeof msg.base64 === 'string') {
            try { session.sendRealtimeInput({ media: { data: msg.base64, mimeType: 'image/jpeg' } }); } catch (_) {}
          }
          // Diagram popup open/close state
          if (msg.type === 'diagram_popup_open')   { diagramPopupOpen = true; }
          if (msg.type === 'diagram_popup_closed')  { diagramPopupOpen = false; }
          // Vision refresh screenshot — bypasses all gating, additive to session context
          if (msg.type === 'vision_screenshot' && typeof msg.base64 === 'string') {
            const note = '[The teacher asked if you can see something. Here is a fresh screenshot of everything visible on screen right now. Look at it carefully and describe what you see. You still remember everything from the conversation so far.]';
            try {
              session.sendRealtimeInput({ media: { data: msg.base64, mimeType: 'image/jpeg' } });
              session.sendRealtimeInput({ text: note });
            } catch (_) {}
          }
          if (msg.type === 'material_file' && msg.base64 && msg.name) {
            const name = msg.name || 'file';
            const mimeType = msg.mimeType || 'application/octet-stream';
            console.log(`[Dasko] Received study material: ${name} (${mimeType}) — extracting text to avoid Live API crash`);
            (async () => {
              try {
                const message = await processMaterialFile(name, msg.base64, mimeType);
                try { session!.sendRealtimeInput({ text: message }); } catch (e) {
                  console.error('[Dasko] sendRealtimeInput(text) failed after material extract', e);
                }
              } catch (e) {
                console.error('[Dasko] material_file extract failed', e);
                try { session!.sendRealtimeInput({ text: `[The teacher has shared a file: "${name}".]` }); } catch (_) {}
              }
            })();
          }
        } catch (_) {}
      }
    } catch (err: any) { console.error('[Dasko] Message handler error (connection kept alive):', err); sendDebug('error', `Server message handler error: ${err?.message ?? err}`); } });

    socket.on('close', () => {
      console.log('[Dasko] Client disconnected');
      if (sessionMap) sessionMap.forEach(sess => { try { sess.close(); } catch (_) {} });
      else if (session) try { session.close(); } catch (_) {}
    });

    socket.on('error', (e) => {
      console.error('[Dasko] WebSocket error:', e);
      if (sessionMap) sessionMap.forEach(sess => { try { sess.close(); } catch (_) {} });
      else if (session) try { session.close(); } catch (_) {}
    });
  });

  console.log(`Dasko running on http://0.0.0.0:${port}`);
}

main();
