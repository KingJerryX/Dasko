# Study materials — stored context (not a text dump)

## Behavior

- **Files are stored** on the server under a `materialsId` session. The UI shows a **list of attached files** (remove optional). Nothing is pasted into one giant textarea.
- When you **Start teaching**, the server **reads stored files**, extracts text **only to build the student prompt** (invisible in the UI). Students are instructed to treat content as **their notes/documents** to reference.
- **Additional notes** textarea is optional; saved with the same session and merged into context at connect.

## API

- `POST /api/materials/session` → `{ materialsId }`
- `POST /api/materials/upload` — form fields `materialsId`, `file`
- `GET /api/materials/:id` — list attachments
- `DELETE /api/materials/:id/file/:storedName`
- `PUT /api/materials/:id/notes` — JSON `{ notes }`
- WebSocket connect includes `materialsId=...` instead of huge `materials=` when files are attached.

## File types

- **PDF** — stored; text extracted when session starts (`PDFParse`).
- **PPTX** — stored; slide text extracted at session start.
- **TXT / MD** — stored as-is.
- **Images** — stored; extraction at session start may be limited (placeholder if no text).

## Transcript (unchanged)

Web Speech API when available; otherwise Live ASR + cleanup. See README.

## Limits

- **12 MB** per file; combined context truncated ~100k chars server-side.
- **`uploads/`** is gitignored.
