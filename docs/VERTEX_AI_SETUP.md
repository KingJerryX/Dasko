# Using Vertex AI with Dasko

Follow these steps to run Dasko with **Vertex AI** instead of the Google AI Studio API key. Vertex often has better support for Live API options (e.g. explicit turn control).

---

## 1. Install Google Cloud CLI (if needed)

- **macOS (Homebrew):** `brew install google-cloud-sdk`
- **Or download:** https://cloud.google.com/sdk/docs/install

---

## 2. Create or select a Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one. Note the **Project ID** (e.g. `my-dasko-project`).
3. **Enable billing** on the project (required for Vertex AI; there may be free tier).

---

## 3. Enable the Vertex AI API

1. Open: [Vertex AI API](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com)
2. Select your project at the top.
3. Click **Enable**.

---

## 4. Log in and set Application Default Credentials

In a terminal:

```bash
# Log in to Google Cloud (opens browser)
gcloud auth login

# Set your project
gcloud config set project YOUR_PROJECT_ID

# This is what the backend uses to call Vertex (no API key in .env)
gcloud auth application-default login
```

Use your actual project ID instead of `YOUR_PROJECT_ID`.

---

## 5. Configure Dasko to use Vertex

Edit **`backend/.env`**:

1. **Turn off the API key** — leave `GEMINI_API_KEY` empty or remove the line:
   ```bash
   GEMINI_API_KEY=
   ```

2. **Set Vertex project and location:**
   ```bash
   GOOGLE_CLOUD_PROJECT=your-project-id
   GOOGLE_CLOUD_LOCATION=us-central1
   ```

Example full `.env` for Vertex:

```bash
# Vertex AI — no API key
GEMINI_API_KEY=
GOOGLE_CLOUD_PROJECT=my-dasko-project
GOOGLE_CLOUD_LOCATION=us-central1
```

**Region:** If `us-central1` doesn’t work for the Live model, try e.g. `us-east4` or check [Vertex AI locations](https://cloud.google.com/vertex-ai/docs/generative-ai/learn/locations).

---

## 6. Run the app

From the **backend** folder:

```bash
cd backend
source .venv/bin/activate   # or: .venv\Scripts\Activate.ps1 on Windows
uvicorn server:app --reload
```

Open http://127.0.0.1:8000 and click **Start teaching**. The backend will use Vertex AI and the Live model `gemini-2.0-flash-live-preview-04-09` (see `backend/live_session.py`).

---

## Quick check

- If you see **"connection open"** in the backend logs and the student greets you, Vertex is working.
- If you get **project/location or permission errors**, run `gcloud auth application-default login` again and confirm `GOOGLE_CLOUD_PROJECT` matches `gcloud config get-value project`.
