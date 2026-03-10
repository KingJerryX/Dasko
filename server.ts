import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { GoogleGenAI, Modality } from '@google/genai';
import * as types from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import { readFile } from 'fs/promises';
import { IncomingMessage } from 'http';
import dotenv from 'dotenv';

dotenv.config();

const GOOGLE_API_KEY = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
if (!GOOGLE_API_KEY) {
  console.error('Missing GEMINI_API_KEY in .env');
  process.exit(1);
}

const AUDIO_MODEL      = 'gemini-2.5-flash-native-audio-latest';
const VIDEO_MODEL      = 'gemini-2.5-flash-native-audio-latest';
const EMOTION_MODEL    = 'gemini-2.5-flash';
const VALID_EMOTIONS   = new Set(['curious', 'confused', 'excited', 'listening', 'thinking']);

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

function getClassroomInstruction(topic: string, studentIds: string[], materials: string, video: boolean): string {
  const studentList = studentIds
    .filter(id => STUDENT_PROFILES[id])
    .map(id => `- **${id.charAt(0).toUpperCase() + id.slice(1)}**: ${STUDENT_PROFILES[id]}`)
    .join('\n');

  const materialsSection = materials.trim()
    ? `The students were all assigned to study the following material but didn't fully understand it:\n\n---\n${materials.trim()}\n---\n\nThey may reference it naturally in conversation.`
    : `The students have general background knowledge but haven't formally studied this topic.`;

  return `You are playing ${studentIds.length} students in a live classroom session. The human is the teacher explaining "${topic}".

## The students
${studentList}

## Prior knowledge
${materialsSection}

## Senses
${video ? `You can see the teacher through their camera. React naturally to what they show or point at.` : `This is a voice-only session.`}

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
- Sound like real people: use "wait", "hold on", "so basically", "hmm". Have genuine reactions.
- Never explain the topic yourself. Never be sycophantic.

## Starting the session
Have one student greet the teacher briefly and indicate the class is ready. Keep it short and natural.`;
}

const PERSONA_TRAITS: Record<string, string> = {
  eager: `You are enthusiastic and eager to learn. You sometimes jump ahead and make confident guesses — which are occasionally wrong. You get excited when things click ("Oh! So that's like...!") and ask "but what about...?" a lot. You might over-simplify things in your head and need the teacher to correct you.`,
  skeptic: `You are naturally skeptical and need to be convinced. You question assumptions ("but why is that true?"), ask about edge cases and exceptions, and push back when something feels hand-wavy. You're not rude — just intellectually demanding. You want evidence and logic, not just assertions.`,
  confused: `You get lost easily and need things broken down step by step. You often circle back to earlier points, ask "wait, can you say that differently?", and need concrete real-world examples before abstract ideas land. You're not slow — you just have high standards for your own understanding.`,
};

function getStudentInstruction(topic: string, persona: string, materials: string, video: boolean): string {
  const personaTrait = PERSONA_TRAITS[persona] || PERSONA_TRAITS.eager;

  const materialsSection = materials.trim()
    ? `You were assigned to study the following material before this session. You've read through it, but you didn't fully understand it — there are parts that confused you or didn't quite stick:

---
${materials.trim()}
---

Reference this material naturally in the conversation. Say things like "I read that... but I didn't get why" or "The material mentioned X — is that related to what you're saying?" Do not recite it back — treat it as something you half-understood and are hoping the teacher will clarify.`
    : `You have general background knowledge from school and everyday life, but you haven't formally studied this topic. You may have vague familiarity with some terms or ideas, but your understanding is patchy and you have real gaps.`;

  return `You are a student in a "learn by teaching" session. The human is your teacher. They are going to explain "${topic}" to you.

## Your persona
${personaTrait}

## Your prior knowledge
${materialsSection}

## How to behave like a real student

You are NOT a blank slate. You come in with partial knowledge, possible misconceptions, and specific gaps. This is crucial — a real student has encountered ideas before; they just don't fully understand them yet.

**Sound like a real person:**
- Use natural, conversational speech: "wait", "so basically", "hold on", "oh okay", "hmm"
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

## Senses
${video
  ? `You can see the teacher through their camera. React to what they show, point at, write, or display on screen. If they gesture at something or hold something up, acknowledge it naturally. Don't narrate what you see unprompted — only reference it when it's relevant to what they're explaining.`
  : `This is a voice-only session. You can only hear the teacher.`}

## Starting the session
Greet the teacher briefly and naturally — like you'd greet a tutor who just sat down. Keep it short. Then indicate you're ready to listen.`;
}

function getClassroomStudentInstruction(topic: string, studentId: string, allStudentIds: string[], materials: string, video: boolean): string {
  const name    = studentId.charAt(0).toUpperCase() + studentId.slice(1);
  const profile = STUDENT_PROFILES[studentId] || '';

  const otherStudents = allStudentIds
    .filter(id => id !== studentId && STUDENT_PROFILES[id])
    .map(id => `- **${id.charAt(0).toUpperCase() + id.slice(1)}**: ${STUDENT_PROFILES[id]}`)
    .join('\n');

  const materialsSection = materials.trim()
    ? `You were assigned to study the following material before this session. You've read through it but didn't fully understand it:\n\n---\n${materials.trim()}\n---\n\nReference it naturally — say things like "I read that... but I didn't get why" rather than reciting it.`
    : `You have general background knowledge from school and everyday life, but you haven't formally studied this topic. Your understanding is patchy and you have real gaps.`;

  return `You are ${name}, a student in a live classroom session. The human is the teacher explaining "${topic}".

## Your persona
${profile}

## Your classmates
${otherStudents}

You are aware your classmates are in the room. You may occasionally react to something they'd naturally say (e.g. "yeah I was wondering that too" or "wait, but Marcus said...") — but you must **never speak AS them** or invent their words.

## Your prior knowledge
${materialsSection}

## How to behave

**Sound like a real person:**
- Use natural speech: "wait", "so basically", "hold on", "oh okay", "hmm"
- Vary your reactions — don't ask a question every single turn. Sometimes just react and let the teacher continue.
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

## Senses
${video ? `You can see the teacher through their camera. React naturally to what they show.` : `This is a voice-only session.`}

## Starting
Greet the teacher briefly and naturally. Keep it short. Then indicate you're ready to listen.`;
}

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
    const materials  = url.searchParams.get('materials') || '';
    const video      = url.searchParams.get('video')     === '1';
    const classroom  = url.searchParams.get('classroom') === '1';
    const studentIds = (url.searchParams.get('students') || '')
      .split(',').map(s => s.trim()).filter(s => STUDENT_PROFILES[s]);
    const model      = video ? VIDEO_MODEL : AUDIO_MODEL;
    console.log('[Dasko] New session, topic:', topic, '| persona:', persona, '| video:', video, '| classroom:', classroom, studentIds);

    function sendJson(data: object) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
      }
    }

    async function classifyAndSendEmotion(transcript: string) {
      if (!transcript.trim()) return;
      try {
        const result = await ai.models.generateContent({
          model: EMOTION_MODEL,
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
        if (VALID_EMOTIONS.has(emotion)) {
          sendJson({ type: 'emotion', state: emotion });
        }
      } catch (e) {
        console.error('[Dasko] Emotion classification failed:', e);
      }
    }

    // ── CLASSROOM: one Live session per student, each with a distinct voice ──
    if (classroom && studentIds.length >= 2) {
      let activeSpeaker: string | null = null;
      let sessionMap: Map<string, Awaited<ReturnType<typeof ai.live.connect>>>;

      try {
        const entries = await Promise.all(studentIds.map(async id => {
          let transcriptBuf = '';
          const voice = STUDENT_VOICES[id] || 'Zephyr';
          const cfg: types.LiveConnectConfig = {
            responseModalities: [Modality.AUDIO],
            outputAudioTranscription: {},
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            systemInstruction: getClassroomStudentInstruction(topic, id, studentIds, materials, video),
          };

          const sess = await ai.live.connect({
            model,
            config: cfg,
            callbacks: {
              onopen:  () => console.log(`[Dasko] ${id} session opened`),
              onmessage: (msg: types.LiveServerMessage) => {
                if (msg.serverContent?.outputTranscription?.text) {
                  const chunk = msg.serverContent.outputTranscription.text;
                  transcriptBuf += ' ' + chunk;
                  if (activeSpeaker === id) sendJson({ type: 'transcript', text: chunk });
                }
                if (msg.serverContent?.modelTurn?.parts) {
                  for (const part of msg.serverContent.modelTurn.parts) {
                    if (part.inlineData?.data) {
                      if (activeSpeaker === null) {
                        activeSpeaker = id;
                        sendJson({ type: 'student_speaking', name: id });
                      }
                      if (activeSpeaker === id) {
                        sendJson({ type: 'classroom_audio', studentId: id, base64: part.inlineData.data });
                      }
                    }
                  }
                }
                if (msg.serverContent?.turnComplete) {
                  if (activeSpeaker === id) {
                    const full = transcriptBuf.trim();
                    transcriptBuf = '';
                    activeSpeaker = null;
                    sendJson({ type: 'student_turn_complete', studentId: id });
                    classifyAndSendEmotion(full);
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
      } catch (e: any) {
        console.error('[Dasko] Failed to create classroom sessions:', e);
        sendJson({ type: 'error', message: `Failed to connect: ${e.message}` });
        socket.close();
        return;
      }

      sendJson({ type: 'info', message: `Your classroom is ready. Start explaining: ${topic}` });
      // Trigger a greeting from the first student only
      const firstSess = sessionMap.get(studentIds[0]);
      if (firstSess) {
        firstSess.sendRealtimeInput({ text: `The teacher has just walked in. Greet them briefly and naturally.` });
      }

      socket.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          const b64 = data.toString('base64');
          sessionMap.forEach(sess => {
            try { sess.sendRealtimeInput({ media: { data: b64, mimeType: 'audio/pcm;rate=16000' } }); } catch (_) {}
          });
          return;
        }
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'text_input' && typeof parsed.text === 'string' && parsed.text.trim()) {
            sessionMap.forEach(sess => { try { sess.sendRealtimeInput({ text: parsed.text.trim() }); } catch (_) {} });
          }
          if (parsed.type === 'video_frame' && typeof parsed.base64 === 'string') {
            sessionMap.forEach(sess => { try { sess.sendRealtimeInput({ media: { data: parsed.base64, mimeType: 'image/jpeg' } }); } catch (_) {} });
          }
        } catch (_) {}
      });

      socket.on('close', () => {
        console.log('[Dasko] Client disconnected (classroom)');
        sessionMap.forEach(sess => { try { sess.close(); } catch (_) {} });
      });
      socket.on('error', e => {
        console.error('[Dasko] WebSocket error (classroom):', e);
        sessionMap.forEach(sess => { try { sess.close(); } catch (_) {} });
      });
      return;
    }

    // ── SOLO: single Live session ────────────────────────────────────────────
    let transcriptBuffer = '';

    const config: types.LiveConnectConfig = {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Zephyr' },
        },
      },
      systemInstruction: getStudentInstruction(topic, persona, materials, video),
    };

    let session!: Awaited<ReturnType<typeof ai.live.connect>>;

    try {
      session = await ai.live.connect({
        model,
        config,
        callbacks: {
          onopen: () => {
            console.log('[Dasko] Live session opened, topic:', topic);
            sendJson({ type: 'info', message: `Your student is ready. Start explaining: ${topic}` });
          },
          onmessage: (message: types.LiveServerMessage) => {
            if (message.serverContent?.outputTranscription?.text) {
              const chunk = message.serverContent.outputTranscription.text;
              transcriptBuffer += ' ' + chunk;
              sendJson({ type: 'transcript', text: chunk });
            }
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  sendJson({ type: 'audio', base64: part.inlineData.data });
                }
              }
            }
            if (message.serverContent?.turnComplete) {
              console.log('[Dasko] Student turn complete');
              sendJson({ type: 'turn_complete' });
              const fullTranscript = transcriptBuffer.trim();
              transcriptBuffer = '';
              classifyAndSendEmotion(fullTranscript);
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
      session.sendRealtimeInput({ text: `The teacher has joined. Greet them briefly and ask them to start explaining: ${topic}.` });
    } catch (e: any) {
      console.error('[Dasko] Failed to connect to Live API:', e);
      sendJson({ type: 'error', message: `Failed to connect: ${e.message}` });
      socket.close();
      return;
    }

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'text_input' && typeof msg.text === 'string' && msg.text.trim()) {
            session.sendRealtimeInput({ text: msg.text.trim() });
          }
          if (msg.type === 'video_frame' && typeof msg.base64 === 'string') {
            session.sendRealtimeInput({
              media: { data: msg.base64, mimeType: 'image/jpeg' },
            });
          }
        } catch (_) {}
        return;
      }
      const base64 = data.toString('base64');
      try {
        session.sendRealtimeInput({ media: { data: base64, mimeType: 'audio/pcm;rate=16000' } });
      } catch (e) {
        console.error('[Dasko] sendRealtimeInput failed:', e);
      }
    });

    socket.on('close', () => {
      console.log('[Dasko] Client disconnected');
      try { session.close(); } catch (_) {}
    });

    socket.on('error', (e) => {
      console.error('[Dasko] WebSocket error:', e);
      try { session.close(); } catch (_) {}
    });
  });

  console.log(`Dasko running on http://localhost:${port}`);
}

main();
