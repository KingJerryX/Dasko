"""
Dasko backend — HTTP API + WebSocket proxy to Gemini Live API.

Run from backend/: uvicorn server:app --reload
Then open http://127.0.0.1:8000
"""
import asyncio
import base64
import logging
import os
import time
import warnings
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("dasko")

# Unmistakable banner so you can confirm the server restarted with latest code
import datetime
logger.info("=== Dasko backend started at %s === (restart to pick up code changes)", datetime.datetime.now().isoformat())


class SuppressGenaiInlineDataWarning(logging.Filter):
    """Suppress SDK warning about non-text parts (inline_data) — we handle audio explicitly."""

    def filter(self, record):
        try:
            msg = record.getMessage()
        except Exception:
            msg = (record.msg % record.args) if record.args else str(record.msg)
        s = str(msg)
        if "inline_data" in s and ("non-text parts" in s or "non text parts" in s):
            return False
        return True


_inline_filter = SuppressGenaiInlineDataWarning()
logging.getLogger().addFilter(_inline_filter)
for _name in (
    "google",
    "google.genai",
    "google.genai.live",
    "google.genai.types",
    "google_genai",
    "google_genai.types",
    "uvicorn",
    "uvicorn.error",
):
    logging.getLogger(_name).addFilter(_inline_filter)
warnings.filterwarnings("ignore", message=".*non-text parts.*inline_data.*", category=UserWarning)
warnings.filterwarnings("ignore", message=".*inline_data.*", category=UserWarning)
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Load env (GEMINI_API_KEY or GOOGLE_CLOUD_PROJECT) before importing live_session
import config  # noqa: F401

# Relax WebSocket timeouts for Gemini Live API: longer open_timeout (handshake can be slow to Vertex),
# longer ping_timeout/ping_interval so the connection isn't closed while the model is generating.
try:
    import websockets.asyncio.client as _ws_client
    _orig_connect = _ws_client.connect

    def _connect(*args, open_timeout=60, ping_timeout=90, ping_interval=45, **kwargs):
        kwargs.setdefault("open_timeout", 60)
        kwargs.setdefault("ping_timeout", 90)
        kwargs.setdefault("ping_interval", 45)
        return _orig_connect(*args, **kwargs)

    _ws_client.connect = _connect
except Exception:  # noqa: S110
    pass

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

app = FastAPI(title="Dasko", description="Learn by teaching — AI students powered by Gemini Live")


@app.get("/")
async def root():
    """Serve the teacher UI."""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.isfile(index_path):
        return FileResponse(index_path)
    return {"app": "Dasko", "status": "ok", "ws": "/ws/live"}


@app.get("/app.js")
async def serve_app_js():
    """Serve the frontend script."""
    path = os.path.join(FRONTEND_DIR, "app.js")
    if os.path.isfile(path):
        return FileResponse(path, media_type="application/javascript")
    from fastapi.responses import JSONResponse
    return JSONResponse({"error": "Not found"}, status_code=404)


@app.get("/favicon.ico")
async def favicon():
    """Avoid 404 in logs; no icon yet."""
    from fastapi.responses import Response
    return Response(status_code=204)


@app.get("/api/topics")
async def list_topics():
    """Preset topics for the student agent (can add custom later)."""
    return {
        "topics": [
            "Photosynthesis",
            "Quadratic equations",
            "Supply and demand",
            "Newton's laws of motion",
            "The water cycle",
            "Cell division (mitosis/meiosis)",
        ]
    }


@app.websocket("/ws/live")
async def websocket_live(websocket: WebSocket):
    """
    WebSocket proxy: browser <-> this server <-> Gemini Live API.
    Query param: topic — used in system instruction for the "student" agent.
    """
    await websocket.accept()
    topic = websocket.query_params.get("topic", "").strip() or "whatever the teacher chooses"

    async def send_error(msg: str):
        try:
            await websocket.send_json({"type": "error", "message": msg})
        except Exception:
            pass

    if not config.has_credentials():
        await send_error("No API credentials. Add GEMINI_API_KEY or GOOGLE_CLOUD_PROJECT to backend/.env (see .env.example).")
        return

    try:
        from live_session import get_client, get_student_instruction, get_live_config, LIVE_MODEL
        instruction = get_student_instruction(topic)
        client = get_client()
        # Cookbook-style config: speech_config (voice Zephyr), context_window_compression, realtime_input_config.
        live_config = get_live_config(instruction, use_vertex=config.use_vertex())
    except Exception as e:
        logger.exception("Live session setup failed")
        await send_error(f"Setup failed: {e}")
        return

    try:
        # Log which backend and model we're using (Vertex vs API key can behave differently).
        backend = "Vertex AI" if config.use_vertex() else "Google AI (API key)"
        logger.info("Live session: %s, model=%s", backend, LIVE_MODEL)
        if config.use_vertex():
            logger.info("If you get no reply from the student, try API key: set GEMINI_API_KEY in .env and unset GOOGLE_CLOUD_PROJECT")
        await websocket.send_json({
            "type": "info",
            "message": f"Connecting your student for topic: {topic}…",
        })

        async with client.aio.live.connect(model=LIVE_MODEL, config=live_config) as session:
            await websocket.send_json({
                "type": "info",
                "message": "Your student is listening. Start explaining out loud.",
            })

            use_vertex = config.use_vertex()
            # Start with mic allowed so we definitely send user audio; only block when model is speaking (server_content).
            model_generating = [False]
            session_dead = [False]
            GREETING_MIC_DELAY = 3  # fallback: allow mic after this if turn_complete never arrives

            # Use send_realtime_input only (no send_client_content) so we stay in one mode for the whole session.
            try:
                greeting = f"The teacher has joined. Greet them briefly and ask them to start explaining: {topic}."
                await session.send_realtime_input(text=greeting)
                await session.send_realtime_input(audio_stream_end=True)
                logger.info("sent initial greeting via send_realtime_input (text + audio_stream_end)")
            except Exception as e:
                logger.warning("Initial greeting failed: %s", e)

            async def _allow_mic_after_greeting():
                await asyncio.sleep(GREETING_MIC_DELAY)
                if model_generating[0]:
                    model_generating[0] = False
                    logger.info("Live API: allowing mic (greeting window ended)")

            def _get(obj, key, default=None):
                """Get key from obj whether it's dict-like or attribute-like."""
                if obj is None:
                    return default
                try:
                    if hasattr(obj, "get") and callable(getattr(obj, "get")):
                        return obj.get(key, default)
                    return getattr(obj, key, default)
                except Exception:
                    return default

            _live_msg_count = [0]
            _diagnostic_cap = 10  # log first N messages only

            async def forward_session_to_ws():
                """Read from Live session; forward audio and transcript (cookbook-style: msg.data, msg.text)."""
                try:
                    async for msg in session.receive():
                        _live_msg_count[0] += 1
                        server_content = _get(msg, "server_content")
                        if server_content is not None:
                            model_generating[0] = True
                            if _live_msg_count[0] <= _diagnostic_cap:
                                _tc = _get(server_content, "turn_complete")
                                logger.info(
                                    "Live recv #%d: server_content=True turn_complete=%s",
                                    _live_msg_count[0], _tc,
                                )
                            turn_complete = _get(server_content, "turn_complete")
                            if turn_complete:
                                model_generating[0] = False
                                logger.info("Live API: turn_complete (model finished; your turn)")
                                await websocket.send_json({"type": "turn_complete"})
                        # Cookbook-style: use SDK msg.data (audio bytes) and msg.text (transcript).
                        if getattr(msg, "data", None) and msg.data:
                            if _forwarded_count[0] > 0 and not _logged_second_reply[0]:
                                _logged_second_reply[0] = True
                                logger.info(">>> MODEL REPLIED (AUDIO RECEIVED) — back-and-forth is working <<<")
                            try:
                                b64 = base64.b64encode(msg.data).decode("ascii")
                                await websocket.send_json({"type": "audio", "base64": b64})
                            except Exception as e:
                                logger.warning("audio forward failed: %s", e)
                        if getattr(msg, "text", None) and msg.text:
                            await websocket.send_json({"type": "transcript", "text": msg.text})
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    try:
                        await websocket.send_json({"type": "error", "message": str(e)})
                    except Exception:
                        pass

            def _is_live_connection_error(e: Exception) -> bool:
                s = str(e).lower()
                return "1011" in s or "keepalive" in s or "connectionclosed" in s or "close frame" in s

            # Debug: rate-limited mic activity log (chunks + bytes per second)
            _mic_chunks = [0]
            _mic_bytes = [0]
            _mic_log_time = [None]
            _forwarded_count = [0]  # chunks we actually sent to Live API
            _first_forward_logged = [False]  # so we log "USER AUDIO SENT" only once
            _first_bytes_from_browser = [False]  # log once when browser sends first mic chunk
            _logged_second_reply = [False]  # log "MODEL REPLIED" only once when model answers after you speak
            _dropped_count = [0]  # chunks dropped because model_generating or cooldown
            _dropped_log_time = [None]
            # After speech_end, stop sending mic for this many seconds so the model gets a clear "user done" window.
            SPEECH_END_COOLDOWN = 2.0
            _mic_cooldown_until = [0.0]  # time.monotonic() until we resume sending mic after speech_end

            async def forward_ws_to_session():
                """Read from browser; stream mic PCM to Live API, send text as turns.

                Audio-only: stream mic via send_realtime_input; speech_end sends audio_stream_end.
                """
                try:
                    while True:
                        if session_dead[0]:
                            break
                        message = await websocket.receive()
                        if message.get("type") == "websocket.disconnect":
                            break
                        if "bytes" in message:
                            chunk = message["bytes"]
                            if chunk:
                                if not _first_bytes_from_browser[0]:
                                    _first_bytes_from_browser[0] = True
                                    logger.info(">>> BROWSER SENT MIC (first chunk) <<<")
                                _mic_chunks[0] += 1
                                _mic_bytes[0] += len(chunk)
                                now = time.monotonic()
                                if _mic_log_time[0] is None or (now - _mic_log_time[0]) >= 1.0:
                                    logger.info("mic: received %d chunks, %d bytes (total this period)", _mic_chunks[0], _mic_bytes[0])
                                    _mic_chunks[0] = 0
                                    _mic_bytes[0] = 0
                                    _mic_log_time[0] = now
                            # Only send mic when: not dead, model not speaking (pause-to-listen), and past speech_end cooldown.
                            now_ts = time.monotonic()
                            allow_mic = (
                                not session_dead[0]
                                and not model_generating[0]
                                and now_ts >= _mic_cooldown_until[0]
                            )
                            if chunk and not allow_mic:
                                _dropped_count[0] += 1
                                # Only log when blocking due to model speaking (not cooldown), to avoid spam
                                if model_generating[0] and (_dropped_log_time[0] is None or (now_ts - _dropped_log_time[0]) >= 1.0):
                                    logger.info("mic: dropping chunks while model speaks — dropped %d so far", _dropped_count[0])
                                    _dropped_log_time[0] = now_ts
                            if chunk and allow_mic:
                                try:
                                    from google.genai import types
                                    await session.send_realtime_input(
                                        audio=types.Blob(data=chunk, mime_type="audio/pcm;rate=16000"),
                                    )
                                    _forwarded_count[0] += 1
                                    if not _first_forward_logged[0]:
                                        _first_forward_logged[0] = True
                                        logger.info(">>> USER AUDIO IS NOW BEING SENT TO THE MODEL <<< (say something, then pause)")
                                    if _forwarded_count[0] == 1 or _forwarded_count[0] % 50 == 0:
                                        logger.info("Live API: forwarded mic to model (chunk #%d)", _forwarded_count[0])
                                except Exception as e:
                                    if _is_live_connection_error(e):
                                        session_dead[0] = True
                                        logger.warning("Live connection closed: %s", e)
                                        try:
                                            await websocket.send_json({"type": "error", "message": "Connection to student lost. Please start a new session."})
                                        except Exception:
                                            pass
                                        break
                                    logger.warning("send_realtime_input failed: %s", e)
                        if "text" in message:
                            text = (message.get("text") or "").strip()
                            if not text:
                                continue
                            try:
                                data = __import__("json").loads(text)
                                if data.get("type") in ("speech_start", "speech_end"):
                                    logger.info("mic: %s (frontend VAD)", data.get("type"))
                                    if data.get("type") == "speech_start":
                                        _mic_cooldown_until[0] = 0  # resume mic as soon as user speaks again
                                    elif data.get("type") == "speech_end":
                                        _mic_cooldown_until[0] = time.monotonic() + SPEECH_END_COOLDOWN
                                    # Server-side VAD: we do NOT send ActivityStart/ActivityEnd/audio_stream_end.
                                    # The Live API detects when you start/stop speaking and responds automatically.
                                    continue
                            except (ValueError, TypeError):
                                pass
                            # Audio-only: ignore any other text messages (no typing feature).
                except asyncio.CancelledError:
                    pass
                except WebSocketDisconnect:
                    pass
                except RuntimeError as e:
                    if "disconnect" not in str(e).lower():
                        raise
                    pass

            greeting_timer_task = asyncio.create_task(_allow_mic_after_greeting())
            recv_task = asyncio.create_task(forward_session_to_ws())
            send_task = asyncio.create_task(forward_ws_to_session())
            # Only end the session when the *client* disconnects (send_task completes).
            # Do not end when the model finishes a turn (recv_task may pause or complete).
            try:
                await send_task
            except (asyncio.CancelledError, WebSocketDisconnect, RuntimeError):
                pass
            greeting_timer_task.cancel()
            try:
                await greeting_timer_task
            except asyncio.CancelledError:
                pass
            recv_task.cancel()
            try:
                await recv_task
            except (asyncio.CancelledError, WebSocketDisconnect, RuntimeError):
                pass

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception("Live WebSocket error")
        await send_error(str(e))


if os.path.isdir(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
