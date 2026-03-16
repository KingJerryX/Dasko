# Claude Memory

## Current Project: Ambient Commons

A beginner project inspired by Paul Roquet's "Ambient Media" book.

### Concept
A shared digital atmosphere that people collectively nurture through contribution and neglect—but damage through attention.

### Four Combined Ideas
1. **Anti-Attention Generator** - Content grows when you're not looking
2. **Ambient Contagion** - Users' environments influence each other
3. **Ambient Media Detector/Critique Tool** - Log ambient media you're subjected to, making invisible infrastructure visible
4. **Decay Aesthetic App** - Degrades with attention, heals with neglect

### How It Works
1. **Logging Layer**: Users log ambient media encountered in daily life (café playlists, store muzak, rain, train sounds)
2. **Contagion Layer**: Logged entries become seeds in a shared generative environment; others' contributions bleed into your space
3. **Anti-Attention Mechanic**: Atmosphere thrives on neglect; active attention causes decay/glitches; leaving lets it heal
4. **Collective Tension**: Everyone wants to experience it, but collective attention degrades it

### Development Plan
- Start with single-user web app
- Log ambient encounters
- Generate soundscape from logs
- Implement attention-decay mechanic
- Add social/contagion layer later

---

## Current Project: Don't Make Eye Contact

A focus app that uses fear and discomfort as motivation. Two eyes watch you while you work. Look at the screen and they escalate into something terrifying. Leave their sight and you fail. Stay visible but never look back.

### Technical Setup
- **Stack:** Swift / SwiftUI, Xcode, ARKit (not yet integrated)
- **Target:** iOS (iPhone 15 Pro Max), iPad later
- **Repo:** github.com/hossenaima/dont-make-eye-contact
- **Path:** ~/Desktop/dont-make-eye-contact
- **Device:** MacBook Pro M4, iPhone 15 Pro Max, iPad Air (future)
- **Experience:** Basic Python, learning Swift (first app)

### What's Built
- EyeView: almond shape, hatched pupil, eyebags, atmospheric glow, red tint, pupil drift
- GrainOverlay: film grain at 12 FPS
- EyeAnimationManager: 30-second escalation (5 phases — shrink, expand, widen+red, full red+drift, freeze, fail)
- Wall-clock timer at 30fps, fail state (eyes shut)
- Debug overlay with elapsed time and phase label
- Long-press gesture triggers escalation (temporary, replaced by ARKit later)

### What's Next
1. Searching state (eyes search when user leaves frame, 10s)
2. Recovery mechanic (gradual return at 2x cooldown)
3. ARKit face/gaze tracking
4. Session flow (home screen, duration selector, success/fail)
5. Onboarding, sound, haptics, stats, iCloud sync
6. App Store submission

### Design Decisions
- Indie horror aesthetic: procedural hatching, crosshatch, grain, Limbo-style glow
- Font: `.system(design: .monospaced)` — bold for numbers, medium for labels
- No tab bar — single screen, stats via corner overlay
- iCloud/CloudKit for sync (no accounts)

### Commit Convention
`type: Subject in sentence case`
Types: `init`, `feat`, `fix`, `refactor`, `style`, `docs`, `chore`, `test`
