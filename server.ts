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

const MODEL = 'gemini-2.5-flash-native-audio-latest';

const TOPICS = [
  'Photosynthesis',
  'Quadratic equations',
  'Supply and demand',
  "Newton's laws of motion",
  'The water cycle',
  'Cell division (mitosis/meiosis)',
];

function getStudentInstruction(topic: string): string {
  return `You are a curious student in a "learn by teaching" session. The human is the teacher; you are the student.

The topic for this session is: ${topic}. The teacher will explain it to you.

Your role:
- When the session starts, greet the teacher briefly and ask them to start explaining the topic. Then listen.
- Ask questions a real student would ask: "Why does that happen?", "Can you give an example?", "What if X happens?", "I don't understand the part about Y."
- Base your questions on what the teacher just said.
- Keep a natural, conversational tone. Express confusion, ask for examples, ask for simpler explanations.
- Do NOT explain the topic yourself. If the teacher asks you something, redirect: "I'm the one learning here — can you explain it to me?"
- Stay on topic.`;
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

  app.get('/api/topics', (c) => {
    return c.json({ topics: TOPICS });
  });

  const port = 8000;
  const server = serve({ fetch: app.fetch, port });

  const wss = new WebSocketServer({ server });

  wss.on('connection', async (socket: WebSocket, request: IncomingMessage) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);

    if (url.pathname !== '/ws/live') {
      socket.close();
      return;
    }

    const topic = url.searchParams.get('topic') || 'the topic the teacher will explain';
    console.log('[Dasko] New session, topic:', topic);

    function sendJson(data: object) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
      }
    }

    const config: types.LiveConnectConfig = {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Zephyr' },
        },
      },
      systemInstruction: getStudentInstruction(topic),
    };

    let session!: Awaited<ReturnType<typeof ai.live.connect>>;

    try {
      session = await ai.live.connect({
        model: MODEL,
        config,
        callbacks: {
          onopen: () => {
            console.log('[Dasko] Live session opened, topic:', topic);
            sendJson({ type: 'info', message: `Your student is ready. Start explaining: ${topic}` });
          },
          onmessage: (message: types.LiveServerMessage) => {
            // Transcription of what the student said
            if (message.serverContent?.outputTranscription?.text) {
              sendJson({ type: 'transcript', text: message.serverContent.outputTranscription.text });
            }
            // Audio chunks
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  sendJson({ type: 'audio', base64: part.inlineData.data });
                }
              }
            }
            // Signal when student finishes speaking
            if (message.serverContent?.turnComplete) {
              console.log('[Dasko] Student turn complete');
              sendJson({ type: 'turn_complete' });
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
    // Trigger the student's greeting via realtime input (same mode as mic audio)
    session.sendRealtimeInput({ text: `The teacher has joined. Greet them briefly and ask them to start explaining: ${topic}.` });

    } catch (e: any) {
      console.error('[Dasko] Failed to connect to Live API:', e);
      sendJson({ type: 'error', message: `Failed to connect: ${e.message}` });
      socket.close();
      return;
    }

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        // JSON control messages (speech_start, speech_end) — Live API handles VAD automatically
        return;
      }
      // Binary audio: raw PCM 16kHz Int16 from the browser mic
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
