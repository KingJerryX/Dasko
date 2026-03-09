"""
Minimal test: back-and-forth voice with Gemini Live API.
No web server, no browser — just mic in, speaker out.

After first reply the model often won't respond again unless we signal "user finished".
We send audio_stream_end=True when local VAD detects silence after speech.

Usage:
  1. Copy .env.example to .env and set GEMINI_API_KEY (or use backend/.env).
  2. pip install -r requirements.txt
  3. On macOS: brew install portaudio
  4. python main.py

Speak, then pause; you should hear a reply. Speak again, pause again, etc. Ctrl+C to quit.
"""
import asyncio
import os
import struct
from pathlib import Path

from dotenv import load_dotenv

# Load .env from this folder, then from backend/ so one key works for both
_here = Path(__file__).resolve().parent
load_dotenv(_here / ".env")
load_dotenv(_here.parent / "backend" / ".env")

# Relax WebSocket keepalive so the Live API connection doesn't time out (default 20s is too short).
try:
    import websockets.asyncio.client as _ws_client
    _orig = _ws_client.connect
    def _patched_connect(*args, open_timeout=60, ping_timeout=90, ping_interval=45, **kwargs):
        kwargs.setdefault("open_timeout", 60)
        kwargs.setdefault("ping_timeout", 90)
        kwargs.setdefault("ping_interval", 45)
        return _orig(*args, **kwargs)
    _ws_client.connect = _patched_connect
except Exception:
    pass

from google import genai

try:
    import pyaudio
except ImportError:
    print("Install PyAudio: pip install pyaudio. On macOS: brew install portaudio")
    raise SystemExit(1)

# Use API key from env (same as Dasko backend)
api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
if not api_key:
    print("Error: GEMINI_API_KEY is not set.")
    print("  - Create live-api-minimal-test/.env with: GEMINI_API_KEY=your_key")
    print("  - Or ensure backend/.env has GEMINI_API_KEY=your_key (this script checks both).")
    raise SystemExit(1)

client = genai.Client(api_key=api_key)

# --- PyAudio config (must match Live API: 16kHz in, 24kHz out) ---
FORMAT = pyaudio.paInt16
CHANNELS = 1
SEND_SAMPLE_RATE = 16000
RECEIVE_SAMPLE_RATE = 24000
CHUNK_SIZE = 1024

pya = pyaudio.PyAudio()

MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"
CONFIG = {
    "response_modalities": ["AUDIO"],
    "system_instruction": "You are a helpful assistant. Reply briefly in voice. Say hello first, then respond to what the user says.",
}

audio_queue_output = asyncio.Queue()
audio_queue_mic = asyncio.Queue(maxsize=5)
audio_stream = None

# Only send audio_stream_end after this many silent chunks (avoid firing during pauses mid-sentence).
# 1024 samples @ 16kHz ≈ 64ms per chunk; 50 chunks ≈ 3.2s of silence.
SILENCE_CHUNKS_BEFORE_END = 50
SPEECH_RMS_THRESHOLD = 0.012


def rms_pcm16(data: bytes) -> float:
    """RMS of 16-bit little-endian PCM."""
    if len(data) < 2:
        return 0.0
    n = len(data) // 2
    samples = struct.unpack(f"<{n}h", data[: n * 2])
    return (sum(s * s for s in samples) / n) ** 0.5 / 32768.0


async def listen_audio():
    """Read from mic, put chunks into queue."""
    global audio_stream
    mic_info = pya.get_default_input_device_info()
    audio_stream = await asyncio.to_thread(
        pya.open,
        format=FORMAT,
        channels=CHANNELS,
        rate=SEND_SAMPLE_RATE,
        input=True,
        input_device_index=mic_info["index"],
        frames_per_buffer=CHUNK_SIZE,
    )
    kwargs = {"exception_on_overflow": False} if __debug__ else {}
    while True:
        data = await asyncio.to_thread(audio_stream.read, CHUNK_SIZE, **kwargs)
        await audio_queue_mic.put({"data": data, "mime_type": "audio/pcm;rate=16000"})


async def send_realtime(session):
    """Send mic chunks to Live API. When user stops speaking (VAD), send audio_stream_end so model replies."""
    in_speech = False
    silence_count = 0
    while True:
        msg = await audio_queue_mic.get()
        data = msg.get("data", b"")
        rms = rms_pcm16(data) if data else 0.0
        if rms > SPEECH_RMS_THRESHOLD:
            in_speech = True
            silence_count = 0
        elif in_speech:
            silence_count += 1
            if silence_count >= SILENCE_CHUNKS_BEFORE_END:
                in_speech = False
                silence_count = 0
                try:
                    await session.send_realtime_input(audio_stream_end=True)
                    print("[VAD] Sent audio_stream_end — model should reply.")
                except Exception as e:
                    print("[VAD] audio_stream_end failed:", e)
        await session.send_realtime_input(audio=msg)


async def receive_audio(session):
    """Receive model audio from Live API, put into playback queue."""
    async for response in session.receive():
        if response.server_content and response.server_content.model_turn:
            for part in response.server_content.model_turn.parts:
                if part.inline_data and isinstance(part.inline_data.data, bytes):
                    audio_queue_output.put_nowait(part.inline_data.data)


async def play_audio():
    """Play model audio to speaker."""
    stream = await asyncio.to_thread(
        pya.open,
        format=FORMAT,
        channels=CHANNELS,
        rate=RECEIVE_SAMPLE_RATE,
        output=True,
    )
    while True:
        bytestream = await audio_queue_output.get()
        await asyncio.to_thread(stream.write, bytestream)


async def run():
    try:
        async with client.aio.live.connect(model=MODEL, config=CONFIG) as live_session:
            print("Connected to Gemini. Speak — you should hear a reply. Ctrl+C to quit.")
            await asyncio.gather(
                send_realtime(live_session),
                listen_audio(),
                receive_audio(live_session),
                play_audio(),
            )
    except asyncio.CancelledError:
        pass
    except Exception as e:
        if "timeout" in str(e).lower() or "close" in str(e).lower() or "1011" in str(e):
            print("\nConnection closed or timed out (keepalive). Run again to reconnect.")
        else:
            raise
    finally:
        if audio_stream:
            try:
                audio_stream.close()
            except Exception:
                pass
        try:
            pya.terminate()
        except Exception:
            pass
        print("Connection closed.")


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("Interrupted by user.")
    except Exception as e:
        if "timeout" in str(e).lower() or "close" in str(e).lower():
            print("Connection timed out or closed. Exiting.")
        else:
            raise
