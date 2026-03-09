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

## Tech stack (target)

- **Backend**: Python (FastAPI or similar) — WebSocket proxy to Gemini Live API, session and topic handling.
- **Frontend**: Web app — mic/speaker, optional screen share or webcam, simple “Choose topic → Start teaching” flow.
- **API**: [Gemini Live API](https://ai.google.dev/gemini-api/docs/live) (Vertex AI or Google AI) — stateful WebSocket, system instructions for “student” persona, native audio I/O.
- **Hosting**: Google Cloud (e.g. Cloud Run, or required challenge hosting).

---

## Project structure (planned)

```
Dasko/
├── README.md                 # This file
├── GETTING_STARTED.md        # Step-by-step: GCP, Live API, first run
├── backend/                  # Python WebSocket proxy + HTTP API
│   ├── server.py
│   ├── live_session.py       # Gemini Live session + system instructions
│   └── requirements.txt
├── frontend/                 # Web UI (teacher experience)
│   ├── index.html
│   ├── app.js                # Mic, playback, optional video
│   └── live-client.js        # WebSocket to backend → Live API
└── docs/                     # Design notes, prompts, challenge checklist
```

---

## Roadmap

1. **Phase 1 — Minimum viable**  
   - [ ] GCP project + Vertex AI (or Google AI) + Live API enabled  
   - [ ] Backend: WebSocket proxy to Gemini Live with a fixed “student” system instruction  
   - [ ] Frontend: push-to-talk or always-on mic, play agent audio, no video yet  
   - [ ] User chooses a topic (e.g. from a list); system instruction includes “You are a student learning [topic]…”

2. **Phase 2 — Vision**  
   - [ ] Send video (e.g. 1 FPS JPEG) from frontend to Live API so the “student” can reference what’s on screen  
   - [ ] Optional webcam or screen share so the agent can “see” the teacher

3. **Phase 3 — Polish & challenge**  
   - [ ] Topic presets and custom topic input  
   - [ ] Session history / replay (if allowed by API)  
   - [ ] Deploy on Google Cloud per challenge rules  
   - [ ] Demo script and submission

---

## Plug in your API key (do not paste it in chat)

1. **Copy** `backend/.env.example` to `backend/.env`.
2. **Edit** `backend/.env`: set `GEMINI_API_KEY=your_key` (from [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)) **or** set `GOOGLE_CLOUD_PROJECT` and use `gcloud auth application-default login` for Vertex.
3. **Run** the backend (use a venv if your system Python is externally managed):
   ```bash
   cd backend
   python3 -m venv .venv && source .venv/bin/activate   # or: .venv\Scripts\activate on Windows
   pip install -r requirements.txt
   uvicorn server:app --reload
   ```
   Then open http://127.0.0.1:8000.

See **[GETTING_STARTED.md](./GETTING_STARTED.md)** for:

- Google Cloud / Vertex AI setup  
- Enabling the Live API and getting credentials  
- Running the backend and frontend locally  
- Configuring the “student” system instruction for Dasko  

**Voice flow:** Mic audio is streamed to the Live API as raw 16 kHz PCM via `send_realtime_input`; the API handles turn-taking (VAD). With an **API key**, the app uses proactive audio so the student can greet first; with **Vertex**, an initial text turn triggers the greeting. Student replies are streamed back as audio and played in the browser. Config follows the [Gemini cookbook Live API quickstart](https://github.com/google-gemini/cookbook/blob/main/quickstarts/Get_started_LiveAPI.py) (speech_config with Zephyr voice, context_window_compression). **Tip:** If voice isn’t working, try the API key path first (set `GEMINI_API_KEY` in `.env`, leave `GOOGLE_CLOUD_PROJECT` unset).

---

## Troubleshooting

- **Model never replies** — Check the terminal when you start a session: it logs `Live session: Vertex AI` or `Live session: Google AI (API key)`. Try the other backend (see "Switching API key vs Vertex" below); one may work when the other does not.
- **Student audio not playing** — The backend receives and forwards audio from the Live API; playback is in the browser. If you see “Playing student audio…” but hear nothing: ensure the browser tab is not muted (right‑click tab → Unmute site), system volume is up, and try another browser or device. The app uses the Web Audio API and sends audio as JSON+base64; if you see “Playback error: …” in the status bar, check the browser console (F12) for details.
- **Session ends immediately / 1007 errors** — Use the correct auth for your setup: API key only (no Vertex env vars) for Google AI Studio; for Vertex, set `GOOGLE_CLOUD_PROJECT` and leave `GEMINI_API_KEY` empty, then run `gcloud auth application-default login`. See `docs/VERTEX_AI_SETUP.md` for Vertex steps.

**Switching API key vs Vertex:** When you start a session, the terminal logs `Live session: Vertex AI, model=...` or `Live session: Google AI (API key), model=...`. To use **API key**: set `GEMINI_API_KEY=your_key` in `backend/.env` and remove or comment out `GOOGLE_CLOUD_PROJECT`. To use **Vertex**: leave `GEMINI_API_KEY` empty, set `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`, run `gcloud auth application-default login`, restart backend. If the model replies on one but not the other, use the one that works.

---

## License

TBD (hackathon submission).
