# Goal Description

The project needs several critical improvements specifically focused on transcript accuracy, session timeout handling, visual/UI bugs, and student AI behavior in classroom mode. This plan overrides the previous one and addresses these specific issues.

## Proposed Changes

### 1. Transcript Chronological Ordering
Currently, the transcript misorders speech if the teacher and students speak over or after one another, because transcript updates append to existing "bubbles" instead of creating new ones when the speaker changes.

#### [MODIFY] frontend/app.js
- In the WebSocket message handler (`ws.onmessage`), refactor how `currentTeacherEntry` and `currentStudentEntry` are handled.
- When processing a `teacher_transcript` message: 
  - If a student is currently speaking (or was the last speaker), "close" the student's entry (e.g., set `currentStudentEntry = null`) so that the teacher's new speech creates a brand new transcript bubble at the bottom.
- When processing a `transcript` message (student speaking):
  - If the teacher was the last speaker, "close" the teacher's entry (`currentTeacherEntry = null`) so the student's speech generates a new bubble chronologically below the teacher's.

### 2. UI Fixes: Classroom Orbs & Mic Status
In classroom mode, student orbs are getting cut off at the bottom of the screen, and the mic indicator incorrectly shows "off" when it is active.

#### [MODIFY] frontend/index.html & frontend/app.js
- **Orbs UI**: Adjust the CSS for `#classroomOrbs` or `.session-center` to allow scrolling (`overflow-y: auto`) or adjust flex layout so the orbs wrap and scale properly on smaller or shorter viewports without getting cropped.
- **Mic Status**: The mic UI indicator (#micDot / #micLabel) does not reflect the actual local audio stream status accurately. Ensure that when `audioTrack.enabled = true`, the UI displays the active state, and correctly initializes based on permissions instead of defaulting to off when passing audio to the WebSocket.

### 3. Idle Session Auto-Timeout
If the user walks away from the session, it should not run indefinitely.

#### [MODIFY] frontend/index.html & frontend/app.js
- Create a timeout modal inside `index.html` (e.g., `<div id="timeoutModal">`).
- Implement an idle timer variable (`idleTimer`) in `app.js`.
- Every time the user speaks (e.g., audio amplitude > threshold or `teacher_transcript` received), reset the timer.
- If 2 minutes pass with no user speech, display the timeout modal: "Are you still there? Session closing in 30... 29..."
- Start a 30-second countdown interval. If the user clicks "I'm here" or speaks, dismiss the modal and reset the timers.
- If the countdown hits 0, automatically call the function that ends the session and requests the reflection screen (`stopBtn.click()` or equivalent internal function).

### 4. Classroom Peer Memory
Students in classroom mode should acknowledge each other by name, remember what was said, and build upon it.

#### [MODIFY] server.ts
- In `getClassroomStudentInstruction`, enhance the prompt to explicitly tell the AI to remember the context of the conversation between the teacher and *other* students.
- When the server broadcasts `[Classroom] Name: "text"` to the peer students via the WebSocket, ensure the system prompt explicitly commands the AI to memorize these lines and optionally reference the peer by name in their next query (e.g., "Like Marcus just asked, why does...").

### 5. Whiteboard Detection Fix
Testing showed the AI students cannot detect changes made to the whiteboard.

#### [MODIFY] frontend/app.js / server.ts
- Investigate the `video_frame` broadcast. It is likely that only the camera feed (`#cameraFeed`) is being grabbed and drawn to the canvas, or the `whiteboardCanvas` is not being properly composited into the frame sent to Gemini when the whiteboard tool is active.
- Ensure that the Base64 image payload sent via `ws.send({ type: 'video_frame', base64: ... })` captures the *combined* state of the whiteboard canvas OR switches explicitly to sending the whiteboard canvas data url when the whiteboard is actively being drawn on.

### 6. Non-verbal Cues & Sounds of Agreement
The AI should understand "mhm", head nods, and head shakes as explicit communication.

#### [MODIFY] server.ts
- Update the system instructions (`getClassroomInstruction`, `getStudentInstruction`, `getClassroomStudentInstruction`, and `GESTURE_INSTRUCTION`) to explicitly tell the AI to treat "mhm" as a word of agreement.
- For video-enabled sessions, command the AI to watch the video frames closely for head nods (affirmation/agreement) and head shakes (disagreement/confusion). If it sees these gestures, it should treat them identically to the teacher speaking "yes" or "no" and respond accordingly without forcing the teacher to say the words out loud.

## Verification Plan

### Manual Verification
1. **Transcript Ordering:** Start a session, talk, let the student talk, then talk again quickly. Verify the transcript bubbles appear in strict chronological order and alternate perfectly without text getting squished into old bubbles.
2. **Classroom UI:** Start classroom mode on a small laptop screen/window. Verify orbs wrap successfully and are fully visible. Check the mic indicator reflects "on" accurately.
3. **Idle Timeout:** Start a session, wait exactly 2 minutes without making noise. Verify the countdown modal appears. Wait 30 seconds and verify the session auto-closes to the reflection screen.
4. **Peer Memory:** Start classroom mode, teach a concept, let one student ask a question, answer it, and see if the next student brings up the previous student's point.
5. **Whiteboard:** Open the whiteboard, draw a shape, ask the student what the shape is. Verify they can see the stroke updates.
