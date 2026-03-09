"""
Dasko — load config from environment. Never commit .env.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from backend folder or project root
_backend_dir = Path(__file__).resolve().parent
_root_dir = _backend_dir.parent
load_dotenv(_backend_dir / ".env")
load_dotenv(_root_dir / ".env")

# Google AI Studio (API key)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()

# Vertex AI (when not using API key)
GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
GOOGLE_CLOUD_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1").strip()

# Optional: override Live API model (default set in live_session.py)
LIVE_MODEL_OVERRIDE = os.getenv("LIVE_MODEL", "").strip()


def use_vertex() -> bool:
    """Use Vertex AI if project is set and we're not using an API key."""
    return bool(GOOGLE_CLOUD_PROJECT) and not bool(GEMINI_API_KEY)


def has_credentials() -> bool:
    """True if we have either an API key or Vertex project."""
    return bool(GEMINI_API_KEY) or bool(GOOGLE_CLOUD_PROJECT)
