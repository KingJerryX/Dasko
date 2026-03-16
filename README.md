# Dasko

**Learn by teaching.** Dasko is a real-time, voice-and-vision platform where you teach AI students who listen, watch, ask questions, and push back — just like a real classroom. If you can explain it clearly enough for them to understand, you truly know it.

Built for the **Gemini Live Agent Hackathon** by two MIT students.

---

## The Problem

Learning has three levels:

| Level | What it is | Existing Tools |
|-------|------------|----------------|
| **Memorize** | Flashcards, recall | Quizlet, Anki |
| **Practice** | Exercises, drills | Khan Academy, IXL |
| **Teach** | Explain to others | **Nothing — until Dasko** |

The protégé effect is real: students who teach material score 28% higher on later recall. Dasko gives you a student to teach — anytime, anywhere.

---

## Features

### Real-Time Bidirectional Audio
Speak naturally. The AI student responds with voice instantly. No turn-taking, no buttons — a live conversation powered by Gemini Live API.

### Multimodal Vision
The AI student sees what you see:
- **Camera** — hold up fingers, show objects, gesture naturally
- **Screen share** — reference slides, diagrams, articles
- **Whiteboard** — draw and explain concepts visually
- All sources composited and sent as frames at full resolution (1280×720)

### Natural Barge-In
Interrupt the student mid-sentence — they stop and listen, just like a real student. True real-time interruptibility, not turn-based.

### Classroom Mode
Teach 2–4 AI students simultaneously. Each has a unique personality and voice. They ask different questions, build on each other's ideas, and sometimes disagree. Practice managing a live discussion.

### On-Demand Diagram Generation
Ask the student to "draw a diagram" and they sketch a whiteboard-style doodle. Open it in a popup, annotate it, and the student sees your annotations in real-time.

### Multilingual Support
Switch languages mid-session. Teach in English, then say "vamos a hablar en español" or "现在我们用中文" — the student follows seamlessly.

### Study Materials Upload
Drag-and-drop PDFs, PowerPoint files, images, or videos. Paste notes from NotebookLM or anywhere. The AI student has full context before the session starts.

### Session Reflection
After each session, receive a detailed breakdown:
- What went well / Concepts to revisit
- Key vocabulary extracted
- Student questions that were asked
- Presentation & mechanics scores (Clarity, Visuals, Pacing, Tools)
- Downloadable PDF summary

### AI Coaching Tips
Real-time coaching suggestions appear during your session — helping you improve your teaching technique as you go.

### Anti-Hallucination System
Multiple safeguards prevent the AI student from fabricating teacher speech:
- Voice Activity Detection (VAD) gating
- `teacherHasSpoken` flag
- Audio blackout window on session start
- Strengthened system prompts

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **Backend** | Node.js + TypeScript + Hono + WebSocket |
| **Frontend** | Vanilla JS + Web Audio API + Canvas |
| **Real-time Audio + Vision** | Gemini Live API (`gemini-2.5-flash-native-audio-latest`) |
| **Diagram Generation** | Gemini Image Gen (`gemini-2.5-flash-image`) |
| **Coaching + Reflection** | Gemini Flash (`gemini-2.5-flash`) + Gemini Pro (`gemini-2.5-pro`) |
| **Hosting** | Google Cloud Run (Docker, session affinity, auto-scale) |
| **CI/CD** | Google Cloud Build (`cloudbuild.yaml`) |
| **Secrets** | Google Secret Manager |

---

## Project Structure

```
Dasko/
├── server.ts               # Backend — Hono HTTP + WebSocket proxy to Gemini Live
├── package.json
├── Dockerfile              # Docker config for Cloud Run
├── cloudbuild.yaml         # CI/CD pipeline
├── .env.example            # Copy to .env and add your API key
├── frontend/
│   ├── index.html          # Teacher UI
│   └── app.js              # Mic/camera/canvas/audio playback/VAD
└── server/
    └── (server modules)
```

---

## Running Locally

### Prerequisites
- Node.js 20+
- A Gemini API key from [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)

### Steps

1. Clone the repo:
   ```bash
   git clone https://github.com/hossenaima/Dasko.git
   cd Dasko
   ```

2. Create your `.env` file:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and add your Gemini API key:
   ```
   GEMINI_API_KEY=your-api-key-here
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Start the dev server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:8000](http://localhost:8000) in Chrome or Edge (required for Web Audio API).

6. Pick a topic, enable your camera/whiteboard, and click **Start Teaching**.

---

## Deploying to Google Cloud Run

### Prerequisites
- Google Cloud account with billing enabled
- `gcloud` CLI installed and authenticated
- API key stored in Secret Manager as `gemini-api-key`

### Deploy

```bash
gcloud builds submit --config cloudbuild.yaml
```

This builds the Docker image, pushes it to Container Registry, and deploys to Cloud Run with session affinity and WebSocket support.

### Manual Deploy (Alternative)

```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/dasko
gcloud run deploy dasko \
  --image gcr.io/YOUR_PROJECT_ID/dasko \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=3 \
  --memory=512Mi \
  --timeout=900 \
  --session-affinity \
  --set-secrets=GEMINI_API_KEY=gemini-api-key:latest
```

---

## How It Works

1. **Browser** captures mic audio as 16-bit PCM at 16 kHz and streams it over WebSocket.
2. **Server** forwards audio to Gemini Live API sessions. In classroom mode, audio goes to all student sessions simultaneously.
3. **Camera/screen/whiteboard** frames are composited into a single 1280×720 JPEG and sent to Gemini Live for vision understanding.
4. **Gemini Live API** processes audio + vision, generates student responses as audio + transcription, and streams them back.
5. **VAD** on the frontend detects speech start/end, enabling barge-in interruption — the student stops speaking when you cut in.
6. **Diagram requests** are detected via keyword matching in teacher speech and routed to Gemini Image Gen for on-demand sketch generation.
7. **Post-session**, the full transcript is cleaned and analyzed by Gemini Flash + Pro to produce a detailed teaching reflection.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Student never responds | Check terminal for Live API close code. Code `1008` = wrong model or invalid API key. |
| No audio playback | Ensure browser tab isn't muted. Check console (F12) for Web Audio errors. |
| Camera not working | Grant camera permission in browser. Chrome/Edge required. |
| Diagram not generating | Check terminal logs for `[DiagramGen]` messages. Model may be rate-limited. |
| Cloud Run disconnects immediately | Ensure `--session-affinity` and `--timeout=900` are set. Check that container binds to `0.0.0.0`. |

---

## License

MIT
