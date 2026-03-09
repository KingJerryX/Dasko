# Minimal Gemini Live API test

Bare-minimum script to verify **back-and-forth voice** with the Gemini Live API. No web server, no browser — just your mic and speakers.

If this works, the API and your key are fine; we can then fix Dasko’s web path. If it doesn’t, the issue is environment/API/key.

## 1. Setup

```bash
cd live-api-minimal-test
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

**macOS:** Install PortAudio for PyAudio:

```bash
brew install portaudio
```

## 2. API key

Create `.env` with your Gemini API key (same as Dasko):

```bash
cp .env.example .env
# Edit .env and set GEMINI_API_KEY=your_key
```

Or copy from `../backend/.env` if you already have it there.

## 3. Run

```bash
python main.py
```

You should see: **"Connected to Gemini. Speak — you should hear a reply. Ctrl+C to quit."**

- Speak into your mic. Gemini should reply with voice.
- Use headphones to avoid feedback.

## 4. What this tells you

- **You hear Gemini reply** → Live API and key work. The problem is in Dasko’s web/WebSocket path.
- **No reply / error** → Check key, network, or try a different machine. Share the exact error message.

Based on: [google-gemini/gemini-live-api-examples](https://github.com/google-gemini/gemini-live-api-examples) (command-line Python).
