"""
Dasko — Gemini Live API session for "student" agent.

Uses cookbook-style config (speech_config, context_window_compression) for stability.
Ref: https://github.com/google-gemini/cookbook/blob/main/quickstarts/Get_started_LiveAPI.py
"""
from google import genai
from google.genai import types

from config import (
    GEMINI_API_KEY,
    GOOGLE_CLOUD_LOCATION,
    GOOGLE_CLOUD_PROJECT,
    LIVE_MODEL_OVERRIDE,
    use_vertex,
)

# Model (cookbook uses "models/" prefix for API key path).
if LIVE_MODEL_OVERRIDE:
    LIVE_MODEL = LIVE_MODEL_OVERRIDE
elif use_vertex():
    LIVE_MODEL = "gemini-2.0-flash-live-preview-04-09"
else:
    LIVE_MODEL = "models/gemini-2.5-flash-native-audio-preview-12-2025"

STUDENT_SYSTEM_INSTRUCTION = """You are a curious student in a "learn by teaching" session. The human is the teacher; you are the student.

The topic for this session is: {topic}. The teacher will explain it; you are the student learning it.

Your role:
- When the session starts, greet the teacher briefly and ask them to start explaining the topic. Then listen and ask questions.
- Ask questions that a real student would ask: "Why?", "Can you give an example?", "What if X happens?", "I don't get the part about Y."
- Base your questions on what the teacher just said and, if you have access to it, what you see (e.g. diagrams, equations on screen).
- Keep a natural, conversational tone. You can express confusion, ask for one more example, or ask for a simpler explanation.
- Do NOT explain the topic yourself. Your job is to test the teacher's understanding by asking questions. If the teacher asks you something, redirect: "I'm the one who's supposed to be learning—can you explain it to me?"
- Stay on the topic the teacher chose for this session."""


def get_student_instruction(topic: str) -> str:
    """Return system instruction for the Live API with topic filled in."""
    return STUDENT_SYSTEM_INSTRUCTION.format(topic=topic or "whatever the teacher chooses")


def get_client() -> genai.Client:
    """Return a configured genai Client (API key or Vertex). Cookbook uses api_version v1beta."""
    if use_vertex():
        return genai.Client(
            vertexai=True,
            project=GOOGLE_CLOUD_PROJECT,
            location=GOOGLE_CLOUD_LOCATION,
        )
    return genai.Client(
        api_key=GEMINI_API_KEY,
        http_options={"api_version": "v1beta"},
    )


def get_live_config(instruction: str, use_vertex: bool = False):
    """Build LiveConnectConfig in cookbook style: speech_config (voice), context_window_compression.
    Server-side VAD is enabled for both API key and Vertex so the model detects when the user
    starts/stops speaking and responds automatically (no ActivityStart/ActivityEnd/audio_stream_end).
    """
    realtime_input_config = types.RealtimeInputConfig(
        automatic_activity_detection=types.AutomaticActivityDetection(
            disabled=False,  # Server detects speech start/end; no client-side activity signals
        ),
    )
    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=instruction,
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Zephyr"),
            ),
        ),
        context_window_compression=types.ContextWindowCompressionConfig(
            trigger_tokens=25600,
            sliding_window=types.SlidingWindow(target_tokens=12800),
        ),
        realtime_input_config=realtime_input_config,
    )
