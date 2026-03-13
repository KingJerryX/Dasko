# Goal Description

The project currently has three issues:
1. **Reflection Screen Disappears Immediately**: The reflection screen briefly appears and then disappears back to the setup screen.
2. **Missing Presentation Skills**: The user wants the reflection to give specific feedback on their presentation skills (clarity, pacing, confidence, etc.).
3. **Transcript Ordering Bug**: The transcript currently misorders the user's speech relative to the student's lines. Since transcript text chunks arrive over a WebSocket linearly, if the user speaks after the student, their speech is appended to their first speech bubble instead of creating a new one below the student's.

This plan fixes these bugs.

## Proposed Changes

### Frontend
Summary: Fix WebSocket [onclose](file:///Users/aimahossen/Dasko/server.ts#866-870), add presentation skills UI, and fix transcript ordering.

#### [MODIFY] frontend/app.js
- In [disconnect(keepScreen)](file:///Users/aimahossen/Dasko/frontend/app.js#996-1024), set `ws.onclose = null` right before `ws.close()` to prevent the double-disconnect loop.
- Update [showReflection(data)](file:///Users/aimahossen/Dasko/frontend/app.js#966-995) to populate `data.presentationSkills` into the new `reflectionSkills` element.
- When processing WebSocket message `teacher_transcript`, close and clear any `currentStudentEntry` before updating the teacher's text.
- When processing WebSocket message `transcript`, close and clear any `currentTeacherEntry` before updating the student's text. This forces a new transcript bubble chronologically when the speaker switches.

#### [MODIFY] frontend/index.html
- In the `#reflection-screen` section, modify the layout or add a 5th card specifically for **Presentation Skills** (with `id="reflectionSkills"`).

---

### Backend
Summary: Update the LLM schema and instruction for generating the reflection to include presentation skills feedback.

#### [MODIFY] server.ts
- Provide the `presentationSkills` key instruction in the LLM system prompt in [generateReflection()](file:///Users/aimahossen/Dasko/server.ts#288-339).
- Define it as `1-2 bullet points giving feedback specifically on their speaking and presentation delivery (pacing, clarity, confidence)`.
- Update the default fallback JSON to include `presentationSkills: []`.

## Verification Plan
### Automated/Code Verification
- Inspect the modified [disconnect()](file:///Users/aimahossen/Dasko/frontend/app.js#996-1024) to ensure `ws.onclose = null` is present.
- Inspect the WS handler message loop to verify `currentTeacherEntry` clears `currentStudentEntry` and vice versa.

### Manual Verification
- Start the server (`npm run dev`) and visit the Dasko app.
- Trigger a quick teaching session, ensure the transcript updates sequentially.
- End the session, and wait for the reflection.
- Verify that the reflection screen *stays* on screen.
- Verify that the new "Presentation Skills" card is visible and populated.
