/**
 * Gladia Real-Time Speech-to-Text session helper.
 *
 * Creates a WebSocket connection to Gladia's live STT API and exposes
 * a simple send/close interface with partial + final transcript callbacks.
 */

import WebSocket from 'ws';

// ── Language mapping ──────────────────────────────────────────────────────────

const LANG_MAP: Record<string, string> = {
  English:            'en',
  Spanish:            'es',
  French:             'fr',
  German:             'de',
  Portuguese:         'pt',
  Hindi:              'hi',
  Arabic:             'ar',
  'Simplified Chinese': 'zh',
};

export function mapLanguageCode(sessionLanguage: string): string | undefined {
  return LANG_MAP[sessionLanguage];
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GladiaSession {
  /** Send a raw PCM16 audio buffer to Gladia for transcription. */
  sendAudio(pcm16Buffer: Buffer): void;
  /** Gracefully close the session (sends stop_recording, then closes WS). */
  close(): void;
}

export interface GladiaSessionOptions {
  apiKey:     string;
  sampleRate: number;            // 16000
  language?:  string;            // e.g. 'en', 'es' — omit for auto-detect
  onPartial:  (text: string) => void;
  onFinal:    (text: string) => void;
  onError:    (err: Error)   => void;
}

// ── Session factory ───────────────────────────────────────────────────────────

const GLADIA_INIT_URL = 'https://api.gladia.io/v2/live';
const MAX_RETRIES     = 1;

export async function createGladiaSession(opts: GladiaSessionOptions): Promise<GladiaSession> {
  const { apiKey, sampleRate, language, onPartial, onFinal, onError } = opts;

  // 1. POST to initiate a session and get a WebSocket URL
  const body: Record<string, any> = {
    encoding:    'wav/pcm',
    sample_rate: sampleRate,
    bit_depth:   16,
    channels:    1,
    model:       'solaria-1',
    messages_config: { receive_partial_transcripts: true },
  };
  if (language) {
    body.language_config = { languages: [language] };
  }

  const initRes = await fetch(GLADIA_INIT_URL, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-gladia-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!initRes.ok) {
    const text = await initRes.text().catch(() => '');
    throw new Error(`Gladia init failed (${initRes.status}): ${text}`);
  }

  const { url: wsUrl } = (await initRes.json()) as { id: string; url: string };
  if (!wsUrl) throw new Error('Gladia init response missing WebSocket URL');

  // 2. Connect to the WebSocket
  let ws: WebSocket | null = null;
  let closed = false;
  let retries = 0;

  function connectWs(url: string): WebSocket {
    const socket = new WebSocket(url);

    socket.on('open', () => {
      console.log('[Gladia] WebSocket connected');
    });

    socket.on('message', (raw: WebSocket.Data) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'transcript' && msg.data?.utterance?.text) {
          const text = msg.data.utterance.text;
          if (msg.data.is_final) {
            onFinal(text);
          } else {
            onPartial(text);
          }
        }
      } catch (_) {
        // Ignore non-JSON or malformed messages
      }
    });

    socket.on('error', (err: Error) => {
      console.error('[Gladia] WebSocket error:', err.message);
      onError(err);
    });

    socket.on('close', (code: number, reason: Buffer) => {
      console.log(`[Gladia] WebSocket closed: ${code} ${reason.toString()}`);
      if (!closed && retries < MAX_RETRIES) {
        retries++;
        console.log(`[Gladia] Attempting reconnect (${retries}/${MAX_RETRIES})…`);
        // Re-initiate the full flow (POST + WS) after a short delay
        setTimeout(async () => {
          try {
            const res = await fetch(GLADIA_INIT_URL, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json', 'x-gladia-key': apiKey },
              body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`Re-init failed: ${res.status}`);
            const { url: newUrl } = (await res.json()) as { id: string; url: string };
            ws = connectWs(newUrl);
          } catch (e: any) {
            console.error('[Gladia] Reconnect failed:', e.message);
          }
        }, 1000 * retries);
      }
    });

    return socket;
  }

  ws = connectWs(wsUrl);

  // 3. Return the session interface
  return {
    sendAudio(pcm16Buffer: Buffer) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(pcm16Buffer);
      }
    },
    close() {
      closed = true;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'stop_recording' }));
        } catch (_) {}
        ws.close();
      }
      ws = null;
    },
  };
}
