# Dasko

**Learn by teaching.** Dasko turns the best way to reinforce understanding—teaching someone else—into a live, voice-and-vision experience. You're the teacher. AI students are your audience. They ask the questions real students would ask. Your job is to explain clearly and correctly.

Built for the **Gemini Live Agent Challenge**: real-time, multimodal, interruptible agents using the Gemini Live API, hosted on Google Cloud.

---

## The idea

Learning stacks today cover:

| Level | What it is | Examples |
|-------|------------|----------|
| **Memorization** | Flashcards, recall | Quizlet, Anki |
| **Practice** | Exercises, drills | IXL, Khan Academy |
| **Reinforcement** | Teaching others | ❌ *missing* |

The strongest signal that you understand something is being able to **teach it**. Dasko fills that gap:

1. **You pick a topic** (e.g. photosynthesis, quadratic equations, supply and demand).
2. **You teach** — out loud, and optionally share your screen or whiteboard.
3. **AI “students”** listen and watch. They ask questions a real student would ask: “Why does that happen?” “Can you give an example?” “What if…?”
4. **You answer.** Explaining to them reinforces your own understanding; gaps show up when you can’t explain well.

The agent uses **audio** (your voice) and **vision** (optional: screen/webcam) so the “students” can refer to what you’re showing, not just what you say.

---

## How it fits the Gemini Live challenge

- **Real-time interaction with audio and vision** — You speak; the agent responds with voice. Optional video so the agent “sees” your board/screen.
- **Natural conversation, interruptible** — Barge-in supported; you can cut in when the student is talking.
- **Mandatory tech** — Gemini Live API (or ADK); agents suitable for hosting on Google Cloud.
- **Beyond text-in, text-out** — Multimodal: voice in, voice out, plus optional video in.
- **Category** — Vision-enabled, customized “tutor” flipped: the human is the tutor, the agent is the curious student.

---

## Tech stack

- **Backend**: Node.js + TypeScript (Hono + `ws`) — WebSocket proxy to Gemini Live API, per-client sessions, topic handling.
- **Frontend**: Vanilla JS web app — mic capture, audio playback, topic selection, transcript display.
- **Model**: `gemini-2.5-flash-native-audio-latest` via Google AI Studio API key.
- **Hosting**: Google Cloud (Cloud Run).

---

## Project structure

```
Dasko/
├── README.md
├── GETTING_STARTED.md
├── server.ts               # Node.js backend — Hono HTTP + WebSocket proxy to Gemini Live
├── package.json
├── .env                    # GEMINI_API_KEY (never commit)
├── frontend/
│   ├── index.html          # Teacher UI: topic picker, mic controls, transcript
│   └── app.js              # Mic capture, PCM streaming, audio playback
├── backend/                # Legacy Python backend (not used)
└── docs/
```

---

## Roadmap

1. **Phase 1 — Minimum viable** ✅
   - [x] Node.js WebSocket proxy to Gemini Live with student system instruction
   - [x] Frontend: always-on mic, play student audio, topic selection
   - [x] User chooses a topic; system instruction scopes the student to that topic
   - [x] Student greets first, then listens and asks questions

2. **Phase 2 — Vision**
   - [ ] Send video (1 FPS JPEG) from frontend so the student can reference the screen
   - [ ] Optional webcam or screen share

3. **Phase 3 — Polish & challenge**
   - [ ] Session history / transcript export
   - [ ] Deploy on Google Cloud per challenge rules
   - [ ] Demo script and submission

---

## Running locally

1. Add your API key to `.env`:
   ```
   GEMINI_API_KEY=your_key_here
   ```
   Get one at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).

2. Install and run:
   ```bash
   npm install
   npm run dev
   ```

3. Open [http://localhost:8000](http://localhost:8000), pick a topic, and click **Start teaching**.

---

## How it works

- Browser captures mic audio as 16-bit PCM at 16 kHz and streams it as binary WebSocket frames to the server.
- Server forwards audio to the Gemini Live API via `sendRealtimeInput`. The API handles VAD (voice activity detection) — no push-to-talk needed.
- On connect, the server triggers the student’s greeting via `sendRealtimeInput({ text: “...” })` (same mode as mic audio — mixing `sendClientContent` and `sendRealtimeInput` in one session causes issues).
- Student audio responses stream back as base64 PCM at 24 kHz and are played in the browser via the Web Audio API.

---

## Troubleshooting

- **Model never replies / session closes immediately** — Check the terminal for the close code. Code `1008` means the model name is wrong or not available for your API key. The correct model is `gemini-2.5-flash-native-audio-latest`.
- **Student audio not playing** — Ensure the browser tab is not muted. Check the browser console (F12) for Web Audio errors. The playback AudioContext is created on the “Start teaching” click to satisfy browser autoplay policy.
- **Mic toggles on/off** — Never mix `sendClientContent` and `sendRealtimeInput` in the same session. Use `sendRealtimeInput({ text: “...” })` for any text triggers in audio sessions.
- **Port 8000 already in use** — A previous server process is still running. Find and kill it: `lsof -i :8000` then `kill <PID>`.

---

## License

TBD (hackathon submission).
