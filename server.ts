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

dotenv.config();

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
  emma:   `Emma is enthusiastic and eager. She asks lots of questions, sometimes jumps ahead and makes overconfident guesses that turn out wrong. She gets visibly excited when things click.`,
  marcus: `Marcus is a natural skeptic. He challenges every claim, asks for evidence and edge cases, and pushes back when something feels hand-wavy. Politely but firmly demanding.`,
  lily:   `Lily gets lost easily and needs things broken down step by step. She often circles back to earlier points and asks for concrete examples before she can move on.`,
  priya:  `Priya is a deep thinker who makes unexpected connections between concepts. She asks profound follow-up questions and occasionally goes on interesting intellectual tangents.`,
  tyler:  `Tyler is barely paying attention. He gives distracted, half-hearted responses and asks obvious questions, but occasionally surprises everyone with an unexpectedly sharp observation.`,
  zoe:    `Zoe thinks she already knows everything. She frequently tries to answer before the teacher finishes, is sometimes right and sometimes embarrassingly wrong, and needs gentle correction.`,
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

// ── Prompt builders ──────────────────────────────────────────────────────────

const GESTURE_INSTRUCTION = `
## Visual awareness
You receive a live image stream from the teacher — their camera (face, gestures, paper they hold up) and/or an on-screen whiteboard they draw on. When the teacher has the camera on, you are receiving the feed and you can see them. Never say the camera is off or that you cannot see the teacher when they have the camera on. Pay close attention to what they write, draw, point at, or hold up. Occasionally — but not every turn — reference what you see naturally, the way a real student would: "Oh I can see you're pointing at that part — does that mean...?" or "So the diagram on the board shows... right?" Don't narrate everything visually. Only mention what they're showing when it's relevant to the explanation. If it's camera-only, body language matters (uncertainty, pauses). If it's whiteboard-heavy, treat it like a classroom board: read labels and follow arrows and diagrams.

**Non-verbal cues (video):** Treat the teacher's head nods as agreement or "yes" and head shakes as disagreement or "no". These count as full responses — if you see a clear nod, respond as if they said "yes"; if you see a clear shake, respond as if they said "no". You do not need them to say the words out loud. Watch the video for these gestures every time you respond.`;

const GESTURE_INSTRUCTION_VOICE_ONLY = `
## Senses
This is a voice-only session. You can only hear the teacher.

**Non-verbal sounds:** Treat "mhm", "mm-hmm", "uh-huh" and similar back-channel sounds as agreement or acknowledgment — the same as "yes" or "I'm following". Respond accordingly without requiring the teacher to say full sentences.`;

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

  // Heuristic fix for split words in Latin-script sessions, e.g. "star s" -> "stars".
  if (['English', 'Spanish', 'French', 'German', 'Portuguese'].includes(language)) {
    out = out.replace(/\b([A-Za-zÀ-ÖØ-öø-ÿ]{2,})\s+([A-Za-zÀ-ÖØ-öø-ÿ])\b/g, '$1$2');
  }
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

  const materialsSection = materials.trim()
    ? `The students have the following notes/documents (PDFs, slides, etc.) as reference. They didn't fully understand them:\n\n---\n${materials.trim()}\n---\n\nThey should reference this naturally as their notes/handouts, not recite verbatim.`
    : `The students have general background knowledge but haven't formally studied this topic.`;

  return `You are playing ${studentIds.length} students in a live classroom session. The human is the teacher explaining "${topic}".

## The students
${studentList}

## Prior knowledge
${materialsSection}

## Live in-class materials
The teacher may share files during the lesson (handouts, images, slides). When you receive a message that the teacher has shared a study material file, look at it immediately and treat it as live class material: reference it in your questions, ask for clarification about it, or connect it to what the teacher is saying. Treat dropped-in files as "in-class work" or handouts just shared with the class.

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
- Sound like real people: use "wait", "hold on", "so basically", "hmm". Treat teacher "mhm" / "mm-hmm" as agreement. Have genuine reactions.
- Never explain the topic yourself. Never be sycophantic.

**If the teacher interrupts:** If the teacher speaks while a student is talking, that student **stops immediately.** Listen to the teacher's full point. When resuming, start with a brief acknowledgment ("Oh, I see," "Got it, let me adjust") and incorporate their feedback into the next thought.

## Starting the session
One student must greet the teacher out loud as the very first response (e.g. "Hi, we're ready when you are"). Do not say you cannot see or hear the teacher—greet them and indicate the class is ready.`;
}

const PERSONA_TRAITS: Record<string, string> = {
  eager: `You are enthusiastic and eager to learn. You sometimes jump ahead and make confident guesses — which are occasionally wrong. You get excited when things click ("Oh! So that's like...!") and ask "but what about...?" a lot. You might over-simplify things in your head and need the teacher to correct you.`,
  skeptic: `You are naturally skeptical and need to be convinced. You question assumptions ("but why is that true?"), ask about edge cases and exceptions, and push back when something feels hand-wavy. You're not rude — just intellectually demanding. You want evidence and logic, not just assertions.`,
  confused: `You get lost easily and need things broken down step by step. You often circle back to earlier points, ask "wait, can you say that differently?", and need concrete real-world examples before abstract ideas land. You're not slow — you just have high standards for your own understanding.`,
};

function getStudentInstruction(topic: string, persona: string, materials: string, video: boolean, language: string): string {
  const personaTrait = PERSONA_TRAITS[persona] || PERSONA_TRAITS.eager;

  const materialsSection = materials.trim()
    ? `You have the teacher's notes and documents below (PDFs, slides, etc. — kept as reference). You've gone through them but didn't fully understand everything — some parts confused you or didn't stick:\n\n---\n${materials.trim()}\n---\n\nRefer to these naturally as **your notes**: "In the handout it said… but I didn't get…" or "The slide about X — is that the same as what you're saying?" Do not recite long passages; treat them as something you half-understood and want the teacher to clarify.`
    : `You have general background knowledge from school and everyday life, but you haven't formally studied this topic. You may have vague familiarity with some terms or ideas, but your understanding is patchy and you have real gaps.`;

  return `You are a student in a "learn by teaching" session. The human is your teacher. They are going to explain "${topic}" to you.

## Your persona
${personaTrait}

## Your prior knowledge
${materialsSection}

## Live in-class materials
The teacher may share files during the lesson (handouts, images, slides). When you receive a message that the teacher has shared a study material file, look at it immediately and treat it as live class material for discussion: reference it in your questions or ask for clarification. Treat dropped-in files as "in-class work" or handouts just shared with you.

## How to behave like a real student

You are NOT a blank slate. You come in with partial knowledge, possible misconceptions, and specific gaps. This is crucial — a real student has encountered ideas before; they just don't fully understand them yet.

**Sound like a real person:**
- Use natural, conversational speech: "wait", "so basically", "hold on", "oh okay", "hmm"
- Treat "mhm", "mm-hmm", "uh-huh" as agreement or acknowledgment — same as "yes" or "I'm following". Respond accordingly.
- Vary your reactions — don't ask a question every single turn. Sometimes just react ("okay that actually makes sense") and let the teacher continue.
- Show specific confusion: not "I don't understand" but "I'm following you up until the part about X — what happens there?"
- Have genuine "aha!" moments: "Oh — so that's WHY it works like that. I was thinking it was just..."
- Make wrong connections and let the teacher correct you: "Is this kind of like how [wrong analogy]?"

**Ask good questions:**
- One question per turn, maximum. Pick the most important thing you don't understand.
- Make your questions specific to what the teacher just said, not generic.
- Sometimes summarise what you think you understood and check: "Okay so if I'm getting this right, it basically means... right?"
- Reference things from prior reading if materials were provided.

**Stay in your role:**
- Never explain the topic yourself or give away the answer.
- If the teacher asks you a question back, redirect naturally: "I mean, I have a guess, but I'd rather hear you explain it properly."
- Don't be sycophantic. "Great explanation!" is not something a real student says — they just nod and ask the next question.
- Stay on topic. If you drift, the teacher will redirect you.

**If the teacher interrupts you:** If the teacher speaks while you are talking, **stop immediately.** Listen to their full point. When you resume, start with a brief acknowledgment like "Oh, I see," or "Got it, let me adjust," and incorporate their feedback directly into your next thought.

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

  const materialsSection = materials.trim()
    ? `You have the following notes/documents as reference (from the teacher). You've read through but didn't fully understand:\n\n---\n${materials.trim()}\n---\n\nReference naturally as your notes — "In the handout…" / "On the slide…" — not verbatim recital.`
    : `You have general background knowledge from school and everyday life, but you haven't formally studied this topic. Your understanding is patchy and you have real gaps.`;

  return `You are ${name}, a student in a live classroom session. The human is the teacher explaining "${topic}".

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

## How to behave

**Sound like a real person:**
- Use natural speech: "wait", "so basically", "hold on", "oh okay", "hmm"
- Treat "mhm", "mm-hmm", "uh-huh" as agreement or acknowledgment — respond accordingly.
- Vary your reactions — sometimes just react and stay quiet, sometimes jump in. Not every turn requires a question.
- Show specific confusion: not "I don't understand" but "I'm following you until the part about X"
- Have genuine "aha!" moments
- Make wrong connections and let the teacher correct you

**Questions:**
- One question per turn, maximum. Pick the most pressing thing.
- Sometimes summarise what you understood and check: "Okay so if I'm getting this right..."

**Stay in your role:**
- Never explain the topic yourself.
- Don't be sycophantic.
- Stay on topic.

**If the teacher interrupts you:** If the teacher speaks while you are talking, **stop immediately.** Listen to their full point. When you resume, start with a brief acknowledgment like "Oh, I see," or "Got it, let me adjust," and incorporate their feedback directly into your next thought.

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
          `A person is teaching "${topic}". Below is a transcript of what they just said (speech-to-text; it may have errors or miss words):\n\n` +
          `"${teacherSpeech}"\n\n` +
          `Give ONE short coaching hint (1-2 sentences max). Do not assume the transcript is exact — focus on teaching clarity and delivery. Decide which is most useful:\n\n` +
          `PRIMARILY focus on teaching clarity and delivery:\n` +
          `- Are they being clear, or is the explanation vague/hard to follow?\n` +
          `- Are they using concrete examples or staying too abstract?\n` +
          `- Could a specific analogy make this click for a student?\n` +
          `- Are they speaking confidently, or does the explanation feel uncertain?\n\n` +
          `If the teacher has camera, whiteboard, or screen share active, comment on use of visuals: are they pointing, drawing, or showing something that helps? Could they use the board or screen more?\n` +
          mediaNote + '\n\n' +
          `ALSO flag subject-matter issues if they arise:\n` +
          `- If the explanation is so generic it could apply to anything, point out the specific part of "${topic}" that needs more depth\n` +
          `- If a student likely just asked something and this response didn't really address it, note what was missed\n\n` +
          `Wrap the single most important word or phrase in **double asterisks**.\n` +
          `Write the tip directly — no label, no bullet, no "Tip:".`
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

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const ai = new GoogleGenAI({ vertexai: false, apiKey: GOOGLE_API_KEY });

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

  // Image generation disabled — was stalling Live when combined with video_frame bursts; revisit with NotebookLM/export workflow.
  app.post('/api/diagram', (c) =>
    c.json(
      {
        error: 'Image generation disabled',
        hint: 'Use whiteboard + NotebookLM/PDF notes pasted into Study materials, or re-enable later.',
      },
      503,
    ),
  );

  app.post('/api/cleanup-transcript', async (c) => {
    let text = '';
    let fallback = '';
    try {
      const body = await c.req.json<{ text: string; topic: string; language?: string; mode?: 'live' | 'final'; speaker?: string; context?: string }>();
      fallback = body?.text || '';
      text = (body?.text || '').trim();
      const topic = body?.topic || '';
      const language = normalizeSessionLanguage(body?.language || 'English');
      const mode = body?.mode === 'live' ? 'live' : 'final';
      const speaker = (body?.speaker || 'Speaker').trim() || 'Speaker';
      const context = (body?.context || '').trim().slice(0, 2000);
      if (!text) return c.json({ cleaned: body?.text || '' });
      let result;
      try {
        result = await ai.models.generateContent({
          model: CLEANUP_MODEL,
        contents: [{
          role: 'user',
          parts: [{ text:
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
            `Transcription:\n${text}`
          }]
        }],
        });
      } catch {
        result = await ai.models.generateContent({
          model: FAST_MODEL,
          contents: [{
            role: 'user',
            parts: [{ text:
              `Fix this speech transcript for topic "${topic}" in ${language}. Speaker: ${speaker}. Insert missing spaces and obvious word errors, using this context when helpful:\n${context || '(no prior context)'}\n\nKeep original meaning. Plain text only.\n\n${text}`
            }]
          }],
        });
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
  const server = serve({ fetch: app.fetch, port });

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
        const resolved = await resolveMaterialsContext(materialsId);
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

    // Deferred session start: client sends material_file(s) then ready_to_start; we merge file content into materials before creating Live session.
    const pendingMaterialFiles: { name: string; base64: string; mimeType: string }[] = [];
    let sessionReady = false;
    const MAX_MATERIALS_CHARS = 80_000;

    function sendJson(data: object) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
      }
    }

    /** Process material_file: extract text server-side and send as text only (no raw PDF/media) to avoid Live API "invalid argument" crash. */
    async function processMaterialFile(name: string, base64: string, mimeType: string): Promise<string> {
      const buf = Buffer.from(base64, 'base64');
      const { text, error } = await extractFromBuffer(buf, mimeType, name);
      const maxChars = 25_000; // single realtime message size safety
      const content = text.trim().slice(0, maxChars) + (text.trim().length > maxChars ? '\n\n[… truncated …]' : '');
      if (content) {
        return `[The teacher has shared a study material: "${name}".]\n\nContent:\n${content}`;
      }
      return `[The teacher has shared a file: "${name}".]${error ? ` (${error})` : ''}`;
    }

    async function onTeacherSpeechEnd(media?: { camera?: boolean; whiteboard?: boolean; screen?: boolean }) {
      const text = teacherTranscriptBuf.trim();
      teacherTranscriptBuf = '';

      if (!text) return;

      sessionLog.push({ role: 'teacher', name: 'Teacher', text, time: Date.now() });

      // Coaching tip (rate-limited to one per 20s)
      const now = Date.now();
      if (now > coachingCooldown) {
        coachingCooldown = now + 20_000;
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
    const MAX_STUDENT_EXCHANGES = 2;
    const audioBuffers = new Map<string, string[]>(studentIds.map(id => [id, []]));
    const MAX_BUFFER_CHUNKS = 25;
    function clearAllBuffers() {
      audioBuffers.forEach((_, k) => audioBuffers.set(k, []));
    }
    let studentTranscriptBuf = '';

    /** Build full materials string (URL materials + extracted text from pending files), then create Live session(s) and send session_ready from onopen. */
    async function startSessionWithMaterials() {
      let fullMaterials = materials;
      for (const f of pendingMaterialFiles) {
        try {
          const buf = Buffer.from(f.base64, 'base64');
          const { text } = await extractFromBuffer(buf, f.mimeType, f.name);
          if (text && text.trim()) {
            const chunk = text.trim().slice(0, MAX_MATERIALS_CHARS);
            fullMaterials += '\n\n---\n[From file: ' + f.name + ']\n' + chunk;
          }
        } catch (_) {}
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
        const entries = await Promise.all(studentIds.map(async id => {
          let transcriptBuf = '';
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
                if (id === studentIds[0]) {
                  sendJson({ type: 'session_ready' });
                  sendJson({ type: 'info', message: `Your classroom is ready. Start explaining: ${topic}` });
                  setTimeout(() => {
                    try {
                      sess.sendRealtimeInput({
                        text: `The teacher has just walked in. Say a short greeting out loud in ${language} right now (e.g. "Hi, we're ready when you are"). Your first response must be this greeting—do not skip it.`,
                      });
                    } catch (_) {}
                  }, 400);
                }
              },
              onmessage: (msg: types.LiveServerMessage) => {
                // Teacher input transcription (only log once, from first student's session)
                if (msg.serverContent?.inputTranscription?.text && id === studentIds[0]) {
                  const chunk = enforceTranscriptLanguage(msg.serverContent.inputTranscription.text, language);
                  if (chunk) {
                    teacherTranscriptBuf += ' ' + chunk;
                    sendJson({ type: 'teacher_transcript', text: chunk });
                  }
                }

                // Student output transcription — only stream if this student is active
                if (msg.serverContent?.outputTranscription?.text) {
                  const chunk = enforceTranscriptLanguage(msg.serverContent.outputTranscription.text, language);
                  if (chunk) {
                    transcriptBuf += ' ' + chunk;
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

                    if (activeSpeaker === null) {
                      if (now > cooldownUntil) {
                        // Cooldown expired: claim the mic and flush any buffered audio first
                        activeSpeaker = id;
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
                  if (activeSpeaker === id) {
                    const full = transcriptBuf.trim();
                    transcriptBuf = '';
                    activeSpeaker = null;
                    cooldownUntil = Date.now() + SPEAKER_GAP_MS;
                    consecutiveStudentTurns++;
                    clearAllBuffers(); // stale buffered audio from the previous gap is now irrelevant

                    sendJson({ type: 'student_turn_complete', studentId: id });
                    if (full) onStudentSpeech(id.charAt(0).toUpperCase() + id.slice(1), full);

                    if (consecutiveStudentTurns >= MAX_STUDENT_EXCHANGES) {
                      // Hit the limit — silence all students until teacher speaks
                      studentsAllowed = false;
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
                    transcriptBuf = '';
                  }
                }
              },
              onerror: (e: ErrorEvent) => console.error(`[Dasko] ${id} error:`, e.message ?? JSON.stringify(e)),
              onclose: (e: CloseEvent) => console.log(`[Dasko] ${id} closed:`, e.code),
            },
          });

          return [id, sess] as const;
        }));

        sessionMap = new Map(entries);
        sessionReady = true;
      } catch (e: any) {
        console.error('[Dasko] Failed to create classroom sessions:', e);
        sendJson({ type: 'error', message: `Failed to connect: ${e.message}` });
        socket.close();
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
              sendJson({ type: 'session_ready' });
              sendJson({ type: 'info', message: `Your student is ready. Start explaining: ${topic}` });
              setTimeout(() => {
                try {
                  session!.sendRealtimeInput({
                    text: `The teacher has joined. Say a short greeting out loud in ${language} right now (e.g. "Hi, ready when you are" or "Hey!"), then ask them to start explaining: ${topic}. Your first response must be this greeting—do not skip it.`,
                  });
                } catch (_) {}
              }, 400);
            },
            onmessage: (message: types.LiveServerMessage) => {
              if (message.serverContent?.inputTranscription?.text) {
                const chunk = enforceTranscriptLanguage(message.serverContent.inputTranscription.text, language);
                if (chunk) {
                  teacherTranscriptBuf += ' ' + chunk;
                  sendJson({ type: 'teacher_transcript', text: chunk });
                }
              }
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
              sendJson({ type: 'error', message: e.message ?? 'Session error' });
            },
            onclose: (e: CloseEvent) => {
              console.log('[Dasko] Live session closed:', e.code, e.reason || '');
              if (socket.readyState === WebSocket.OPEN) socket.close();
            },
          },
        });
        sessionReady = true;
      } catch (e: any) {
        console.error('[Dasko] Failed to connect to Live API:', e);
        sendJson({ type: 'error', message: `Failed to connect: ${e.message}` });
        socket.close();
        return;
      }
    }
    }

    socket.on('message', (data: Buffer, isBinary: boolean) => {
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
          const b64 = data.toString('base64');
          studentsAllowed = true;
          consecutiveStudentTurns = 0;
          clearAllBuffers();
          sessionMap.forEach(sess => {
            try { sess.sendRealtimeInput({ media: { data: b64, mimeType: 'audio/pcm;rate=16000' } }); } catch (_) {}
          });
          return;
        }
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'speech_start') {
            sendJson({ type: 'interrupted', interrupted: true });
            sessionMap.forEach(sess => {
              try { sess.sendRealtimeInput({ text: '[The teacher is speaking. Stop talking and listen. Do not respond until they finish.]' }); } catch (_) {}
            });
            return;
          }
          if (parsed.type === 'speech_end') { onTeacherSpeechEnd(parsed.media); return; }
          if (parsed.type === 'request_reflection') {
            if (reflectionRequested) return;
            reflectionRequested = true;
            generateReflection(ai, topic, sessionLog).then(data => { sendJson({ type: 'reflection', data }); });
            return;
          }
          if (parsed.type === 'text_input' && typeof parsed.text === 'string' && parsed.text.trim()) {
            sessionMap.forEach(sess => { try { sess.sendRealtimeInput({ text: parsed.text.trim() }); } catch (_) {} });
          }
          if (parsed.type === 'video_frame' && typeof parsed.base64 === 'string') {
            sessionMap.forEach(sess => { try { sess.sendRealtimeInput({ media: { data: parsed.base64, mimeType: 'image/jpeg' } }); } catch (_) {} });
          }
          if (parsed.type === 'screen_share_started') {
            sessionMap.forEach(sess => {
              try { sess.sendRealtimeInput({ text: '[The teacher is now sharing their screen. Pay attention to what they show on screen.]' }); } catch (_) {}
            });
          }
          if (parsed.type === 'camera_feed_started') {
            sessionMap.forEach(sess => {
              try { sess.sendRealtimeInput({ text: '[You are receiving the teacher\'s live camera feed. You can see them.]' }); } catch (_) {}
            });
          }
          if (parsed.type === 'whiteboard_opened') {
            sessionMap.forEach(sess => {
              try { sess.sendRealtimeInput({ text: '[The teacher has the whiteboard open. You can see it; it may be blank or have content.]' }); } catch (_) {}
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
          const base64 = data.toString('base64');
          try { session.sendRealtimeInput({ media: { data: base64, mimeType: 'audio/pcm;rate=16000' } }); } catch (e) {
            console.error('[Dasko] sendRealtimeInput failed:', e);
          }
          return;
        }
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'speech_start') {
            sendJson({ type: 'interrupted', interrupted: true });
            try { session.sendRealtimeInput({ text: '[The teacher is speaking. Stop talking and listen. Do not respond until they finish.]' }); } catch (_) {}
            return;
          }
          if (msg.type === 'speech_end') { onTeacherSpeechEnd(msg.media); return; }
          if (msg.type === 'request_reflection') {
            if (reflectionRequested) return;
            reflectionRequested = true;
            generateReflection(ai, topic, sessionLog).then(reflData => { sendJson({ type: 'reflection', data: reflData }); });
            return;
          }
          if (msg.type === 'text_input' && typeof msg.text === 'string' && msg.text.trim()) {
            try { session.sendRealtimeInput({ text: msg.text.trim() }); } catch (_) {}
          }
          if (msg.type === 'video_frame' && typeof msg.base64 === 'string') {
            try { session.sendRealtimeInput({ media: { data: msg.base64, mimeType: 'image/jpeg' } }); } catch (_) {}
          }
          if (msg.type === 'screen_share_started') {
            try { session.sendRealtimeInput({ text: '[The teacher is now sharing their screen. Pay attention to what they show on screen.]' }); } catch (_) {}
          }
          if (msg.type === 'camera_feed_started') {
            try { session.sendRealtimeInput({ text: '[You are receiving the teacher\'s live camera feed. You can see them.]' }); } catch (_) {}
          }
          if (msg.type === 'whiteboard_opened') {
            try { session.sendRealtimeInput({ text: '[The teacher has the whiteboard open. You can see it; it may be blank or have content.]' }); } catch (_) {}
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
    });

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

  console.log(`Dasko running on http://localhost:${port}`);
}

main();
