# Diagram / image generation — **disabled**

In-app **image generation is turned off** so Gemini Live stays responsive (bursting `video_frame` after slow image calls was stalling sessions).

## Current workflow: NotebookLM + PDFs

1. **Upload PDFs** (or other sources) in **NotebookLM**.
2. Use summaries, chat, or audio overview to **extract** what you want students to have seen.
3. **Paste** the relevant text into Dasko **Study materials** before starting a session — the AI student personas already reference that field.
4. **Draw on the whiteboard** or use **camera** to show anything visual; no server-side image generation.

## Re-enabling later

The old implementation lived in `server.ts` (`POST /api/diagram` via Interactions API) and the frontend whiteboard/camera overlay. To bring it back, restore from git history and keep **light** frame sends only (no tight loops).

See **`docs/NOTEBOOKLM_VS_DIAGRAMS.md`** for rationale.
