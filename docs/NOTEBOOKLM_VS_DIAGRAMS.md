# NotebookLM + PDFs with Dasko

## Why we disabled in-app image generation

- Preview image calls are **slow** and don’t fit real-time teaching.
- Sending many **video_frame** JPEGs afterward **overloaded** Gemini Live and caused **long delays** before the student replied again.

## Recommended workflow

| Step | Where | What |
|------|--------|------|
| 1 | **NotebookLM** | Upload **PDFs** (lecture notes, papers, slides exported as PDF). |
| 2 | NotebookLM | Generate summaries, ask questions, or use audio overview to **distill** what matters. |
| 3 | **Dasko setup** | Paste that distilled text (or key excerpts) into **Study materials**. |
| 4 | Dasko session | Student personas **reference** materials naturally; you **teach** with voice + whiteboard/camera. |

NotebookLM doesn’t plug into the Live WebSocket, but **Study materials** is the right bridge: same API key flow, no extra latency during the session.

## Optional: PDF text without NotebookLM

If you only need raw text from a PDF, you can paste extracted text into **Study materials** manually (macOS Preview / Acrobat / any PDF-to-text tool). NotebookLM adds **grounding** and **summarization** on top.

## Whiteboard + camera

- **Whiteboard**: instant diagrams — no API wait.
- **Camera**: show printed pages or a second screen; student sees via existing vision pipeline.

## If you re-enable image generation later

Keep **frame rate** low (e.g. 1 fps only, no burst loops) and call the image API **before** the session or only when the student isn’t mid-turn.
