# Where to Get the API — Step-by-Step

Two ways to get API access for Dasko. **Path A** is the fastest if you’re new. **Path B** is what you’ll want for hosting on Google Cloud for the hackathon.

---

## Path A: Google AI Studio (easiest — get an API key in a few minutes)

Use this to start building and testing quickly. You get a single **API key** string.

### 1. Open Google AI Studio

- In your browser go to: **https://aistudio.google.com**
- Sign in with your Google account if asked.

### 2. Get an API key

- On the AI Studio page, look at the **left sidebar** or the **top of the page** for **“Get API key”** or **“Create API key”**.
- Or go directly to the API keys page: **https://aistudio.google.com/app/apikey**
- Click **“Create API key”**.
- Choose one of:
  - **“Create API key in new project”** — Google creates a new Cloud project for you, or  
  - **“Create API key in existing project”** — pick a project you already have.
- Click **Create**.
- **Copy the API key** and save it somewhere safe (e.g. a password manager or a local `.env` file). You won’t see the full key again.

### 3. Plug it into Dasko (do not paste your key in chat or commit it)

1. In the **backend** folder, copy the example env file and add your key:
   ```bash
   cd backend
   cp .env.example .env
   ```
2. Open **backend/.env** and set:
   ```bash
   GEMINI_API_KEY=your_actual_key_here
   ```
3. Save the file. The app reads this at startup. **Do not** commit `.env` or paste your key anywhere public.

**Note:** The Live API may be available with this key depending on the current product; if the official docs say “use Vertex AI for Live API,” use Path B below.

---

## Path B: Google Cloud Console (Vertex AI — for hackathon and hosting)

Use this for the **Gemini Live API** and for **hosting on Google Cloud** as required by the challenge. You use a **Google Cloud project** and sign in with the `gcloud` CLI (no API key in the code).

### 1. Open Google Cloud Console

- Go to: **https://console.cloud.google.com**
- Sign in with your Google account.

### 2. Create or select a project

- At the top of the page, click the **project dropdown** (it shows the current project name).
- Click **“New project”** (or pick an existing project).
- Enter a name (e.g. **Dasko**) and click **Create**.
- Switch to that project using the same dropdown.

### 3. Enable billing (required for Vertex AI)

- In the left menu, go to: **Billing** (or open **https://console.cloud.google.com/billing**).
- Link a billing account to this project (you may need to add a payment method; there is often free tier / credits for new accounts).

### 4. Enable the Vertex AI API

- Go to: **https://console.cloud.google.com/apis/library**
- In the search box, type: **Vertex AI API**.
- Click **“Vertex AI API”** in the results.
- Click the blue **“Enable”** button.
- Wait until it says the API is enabled.

**Shortcut link** (with your project selected):  
**https://console.cloud.google.com/flows/enableapi?apiid=aiplatform.googleapis.com**

### 5. Enable the Gemini / Generative AI API (if listed)

- In the same **APIs & Services → Library** page (**https://console.cloud.google.com/apis/library**), search for **Generative Language API** or **Gemini**.
- If you see an API that’s clearly for Gemini/Vertex AI generative features, open it and click **Enable**.

### 6. Set up authentication on your computer (for local dev)

You don’t get an “API key” in the UI here. Instead, you use **Application Default Credentials** so the Gemini client can run as “you” on your machine:

- Install the **Google Cloud CLI** if you haven’t: **https://cloud.google.com/sdk/docs/install**
- Open a terminal and run:
  ```bash
  gcloud auth application-default login
  ```
- A browser window opens; sign in with the **same Google account** that owns the Cloud project.
- After you approve, your machine is set up. Your Dasko backend (when using the Vertex AI client) will use these credentials automatically.

### 7. Set your project and region (in terminal)

```bash
gcloud config set project YOUR_PROJECT_ID
```

Replace `YOUR_PROJECT_ID` with the **Project ID** (not the project name). You can see it in the Cloud Console dashboard or in the project dropdown.

- For **Vertex AI / Live API**, set the region if your code or docs ask for it (e.g. `us-central1`):
  ```bash
  export GOOGLE_CLOUD_LOCATION=us-central1
  ```

### 8. Use it in Dasko

- In the backend, use the **Vertex AI** client and **do not** set an API key.
- Set the project (and optionally region) via environment variables, for example:
  ```bash
  export GOOGLE_CLOUD_PROJECT=your-project-id
  export GOOGLE_CLOUD_LOCATION=us-central1
  ```
- When you run the backend on your computer, `gcloud auth application-default login` will provide credentials.

---

## Quick reference: important URLs

| What you need              | URL |
|----------------------------|-----|
| Google AI Studio (API key) | https://aistudio.google.com |
| API keys page              | https://aistudio.google.com/app/apikey |
| Google Cloud Console       | https://console.cloud.google.com |
| Enable Vertex AI API       | https://console.cloud.google.com/flows/enableapi?apiid=aiplatform.googleapis.com |
| APIs library (search more) | https://console.cloud.google.com/apis/library |
| Billing                   | https://console.cloud.google.com/billing |

---

## Which path should I use?

- **Just starting / learning:** Use **Path A** (Google AI Studio) to get an API key and run basic Gemini requests. If the Live API is available there, you can try it first.
- **Hackathon / “hosted on Google Cloud”:** Use **Path B** (Google Cloud + Vertex AI). Enable Vertex AI, turn on billing, run `gcloud auth application-default login`, and build the Live API integration in the backend using the Vertex AI client and your project ID.

If you tell me whether you’re on Path A or Path B, I can point you to the exact file in Dasko where to put the key or the project ID next.
