# Study materials — files & transcript

## Drag-and-drop (setup screen)

The **Study materials** area is now a **drop zone** plus textarea:

- **PDF** — Text is extracted server-side (`pdf-parse`) and appended under a `--- filename ---` header.
- **PowerPoint** — **`.pptx` only** (Open XML). Slide text is pulled from the deck; image-only slides may yield little text.
- **Text / Markdown** — `.txt`, `.md`, `.csv` read as UTF-8.
- **Images** — PNG/JPEG/WebP under ~4 MB: server calls **Gemini** to transcribe visible text (slides, labels, handwriting). No API key beyond your existing `GEMINI_API_KEY`.

Unsupported types show an error; you can still **paste** manually.

## Transcript accuracy

1. **Web Speech API** (Chrome/Edge): When a session starts, the app starts **browser speech recognition** in parallel with the mic stream to Live. The **left panel transcript** prefers this source and **ignores** Live ASR chunks while recognition is running — same pattern as many web apps that show clean captions.
2. **Safari / no API**: Falls back to Live transcription chunks + **server cleanup** after each turn.
3. **Cleanup model**: `/api/cleanup-transcript` uses **`gemini-2.5-pro`** by default (`CLEANUP_MODEL` in env) to fix merged words and homophones; falls back to Flash if Pro fails.

Grant **microphone** (and optionally **speech recognition** permission) when the browser asks.

## Limits

- Files **max 12 MB**; extracted text **truncated** at ~120k chars so the WebSocket URL stays usable.
- **`.ppt`** (legacy) is not supported — save as `.pptx` or export PDF.
