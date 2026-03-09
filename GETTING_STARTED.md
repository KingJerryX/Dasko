# Getting started with Dasko

Step-by-step guide to run Dasko using the Gemini Live API for the hackathon.

---

## 1. Prerequisites

- **Google Cloud account** (for Vertex AI + Live API, or use Google AI with API key)
- **Python 3.10+** (for backend)
- **Node.js** optional (only if you use a Node frontend; vanilla JS is fine)
- **Browser** with mic (and later, optional screen share)

---

## 2. Google Cloud setup (Vertex AI path)

The challenge requires hosting on Google Cloud. Using **Vertex AI** keeps everything in one place.

### 2.1 Create / select a project

```bash
# Install gcloud if needed: https://cloud.google.com/sdk/docs/install
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

### 2.2 Enable APIs

- [Vertex AI API](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com)
- Billing must be enabled on the project (Live API may have free tier; check current docs)

### 2.3 Authentication for local dev

```bash
gcloud auth application-default login
```

This sets Application Default Credentials (ADC) so your Python backend can call Vertex AI without hardcoding keys.

### 2.4 Region

Live API is available in specific regions. Check [Vertex AI locations](https://cloud.google.com/vertex-ai/docs/generative-ai/learn/locations). Often `us-central1` or your nearest supported region.

---

## 3. Gemini Live API — what you need

- **Endpoint**: Stateful **WebSocket** to Gemini (not a simple REST call).
- **Input**: Real-time stream of:
  - **Audio**: 16-bit PCM, 16 kHz, mono (from user mic).
  - **Video** (optional): JPEG frames, up to ~1 FPS (e.g. 768×768) for “student sees your screen”.
- **Output**: Real-time stream of:
  - **Audio**: 16-bit PCM, 24 kHz (play back to user).
  - **Text**: Transcripts (optional, for debugging or display).
- **Config**: `system_instruction` defines the “student” persona and topic.

### 3.1 System instruction for Dasko (student persona)

The agent should act as a **curious student**, not a tutor. Example:

```text
You are a curious student in a "learn by teaching" session. The human is the teacher; you are the student.

Your role:
- Ask questions that a real student would ask: "Why?", "Can you give an example?", "What if X happens?", "I don't get the part about Y."
- Base your questions on what the teacher just said and, if you have access to it, what you see (e.g. diagrams, equations on screen).
- Keep a natural, conversational tone. You can express confusion, ask for one more example, or ask for a simpler explanation.
- Do NOT explain the topic yourself. Your job is to test the teacher's understanding by asking questions. If the teacher asks you something, redirect: "I'm the one who's supposed to be learning—can you explain it to me?"
- Stay on the topic the teacher chose for this session.
```

When you add **topic** (e.g. "photosynthesis"), prepend:

```text
The topic for this session is: [TOPIC]. The teacher will explain it; you are the student learning it.
```

---

## 4. Architecture (minimal)

```
[Browser]  <-- WebSocket (audio ± video) -->  [Your backend]  <-- WebSocket -->  [Gemini Live API]
   mic/speaker                                    proxy                          Vertex AI / Google AI
```

- **Backend** holds the Live API WebSocket and credentials; the browser never talks to Gemini directly (so you don’t expose API keys).
- **Frontend** sends raw audio (and optionally video frames) to your backend; backend forwards to Live API and streams responses back.

---

## 5. Backend (Python) — first steps

### 5.1 Dependencies

```bash
mkdir -p backend
cd backend
```

Create `requirements.txt`:

```text
fastapi
uvicorn[standard]
websockets
google-genai   # or vertexai SDK per latest Gemini Live docs
```

Install:

```bash
pip install -r requirements.txt
```

### 5.2 Connect to Live API

Official docs to follow:

- [Get started with Live API | Gemini API](https://ai.google.dev/gemini-api/docs/live)
- [Get started with Gemini Live API using WebSockets | Vertex AI](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/get-started-websocket)

Use the **Python SDK** (`google-genai` or Vertex AI client) and the **async Live connection** (e.g. `client.aio.live.connect`). In the session config, set:

- `response_modalities`: include `"AUDIO"` (and optionally `"TEXT"` for transcripts).
- `system_instruction`: the “student” prompt above (plus topic).

### 5.3 WebSocket proxy

- Open one WebSocket from **browser ↔ your backend**.
- Your backend opens another WebSocket to **Gemini Live API**.
- When the browser sends audio (and optionally video), forward it to Gemini; when Gemini sends audio (and text), forward to the browser.
- Handle reconnects and cleanup (close both sides when the user leaves).

---

## 6. Frontend — first steps

- **Audio**: Use `getUserMedia()` for mic, `AudioWorklet` or `ScriptProcessorNode` to get raw PCM (then resample to 16 kHz mono if needed), send chunks over your WebSocket.
- **Playback**: Receive PCM from backend (24 kHz), play via `AudioContext` and an `AudioBuffer` or `MediaStream`.
- **UI**: “Select topic” → “Start teaching” → show “Student is listening…” and a way to mute/unmute or push-to-talk.

Optional later: capture canvas or video (e.g. from screen share), encode as JPEG, send at ~1 FPS to backend → Live API.

---

## 7. Challenge checklist

- [ ] Use **Gemini Live API** (or ADK as specified).
- [ ] **Real-time** voice (and optionally vision); natural, **interruptible** conversation.
- [ ] **Multimodal**: at least audio in/out; add video for “student sees teacher”.
- [ ] **Host on Google Cloud** (e.g. Cloud Run for backend + static frontend).
- [ ] Clear **demo**: “User teaches topic X; AI student asks questions; user explains.”

---

## 8. Useful links

- [Gemini Live API overview (Google AI)](https://ai.google.dev/gemini-api/docs/live)
- [Gemini Live API (Vertex AI)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api)
- [Live API WebSocket get-started (Vertex)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/get-started-websocket)
- [google-gemini/gemini-live-api-examples](https://github.com/google-gemini/gemini-live-api-examples) — reference implementations
- [Send audio and video streams (Vertex)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/send-audio-video-streams)

---

## 9. Next step

1. Create the GCP project and enable Vertex AI + billing.
2. Run `gcloud auth application-default login`.
3. Clone or copy a minimal **Gemini Live WebSocket example** (e.g. from `gemini-live-api-examples`) and run it locally to confirm you get voice-in → voice-out.
4. Replace the default system instruction with the **Dasko student** prompt and add a **topic** parameter.
5. Build the Dasko UI (topic picker + “Start teaching”) and wire it to your backend proxy.

Once one full loop works (you speak → agent responds as a student with voice), add topic selection, then optional video, then deploy to Google Cloud.
