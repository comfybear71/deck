# AGENTS.md — Deck / Skidmarks brief for cloud agents

Read this before touching anything in this repo. This is the fast
orientation doc — the specific traps and locks that have already cost
real debugging cycles, not a full spec. `README.md` is the exhaustive
doc (in particular its "Skidmarks node (vibe director)" section); when
this file and the README disagree, the README is more likely to be
current for fine detail, but **fix the disagreement rather than
silently trusting one over the other** — both are meant to describe the
same real code.

If something you're about to do contradicts a specific line below,
stop and say so rather than silently doing it anyway — and if this file
looks visibly stale against the actual code, flag that too instead of
treating it as gospel.

## What this repo is

"The Tab — French Deck" is a glanceable cost scoreboard plus a graph of
sibling projects (Budju, Propfolio, **Skidmarks**, AIG!itch). Skidmarks
is the one sibling project with real, growing functionality living
directly in this repo (everything else is seed data + a thin stub).
Everything in this file is about Skidmarks unless said otherwise.

## North star — where Skidmarks is headed

- **Today**: only the **Music video** flow is wired
  (`SKIDMARKS_PROJECT_KINDS` in `lib/skidmarks.ts` — `music-video:
  enabled: true`). Pick a band → cast members → attach an MP3 → tag each
  clip's plate(s) + shot prompt, all on one continuous scroll.
- **Next**: **Sunnybank** is a second landing tile that already renders
  (per the locked mockup) but is inert — `enabled: false`, no flow
  behind it yet. Don't build it speculatively; when it's asked for, it
  should follow the same wizard shape the Music-video flow already
  established, not a new pattern.
- **Eventually**: the same wizard shape (project type → cast → attach
  media → clip timeline → plate/shot prompts → opt-in render) is meant
  to generalize to **any media project type**, not just music videos.
  Music video and Sunnybank are the first two proofs of that shape, not
  the ceiling of it.
- **Resolve (DaVinci Resolve) is, and stays, the actual fine-cut/edit
  tool.** Skidmarks is a front hand for prepping shots/plates/clips —
  never a video editor replacement, never an in-app timeline/stitch
  tool. In-app stitching is explicitly optional / not required for v1.
  If a task asks you to build real video editing (trimming, transitions,
  multi-track audio mixing) inside this app, that's a scope question to
  raise, not a default to build toward.

## Platform target: iPhone Safari, first and mostly only

Skidmarks is a mobile-first, phone-in-hand tool. Nearly every
touch/gesture/scroll fix already in this codebase was chasing a **real**
iOS Safari bug, not a hypothetical one — e.g. `touch-pan-x` vs.
`touch-none` on the plate strip (blocking the wrong gesture broke
horizontal scroll), portaling the plate lightbox to `document.body`
(iOS Safari stacking-context bug), long-press-to-clear timing tuned
against real thumb behavior. See `components/SkidmarksClipStub.tsx`'s
doc comments for specifics.

**If you touch any Skidmarks UI, verify it in Safari on an iPhone (or
iPhone simulator) before calling it done.** Passing in desktop Chrome
tells you very little here — this codebase's actual bug history is
almost entirely iOS-Safari-specific quirks that desktop browsers don't
reproduce. The one deliberate exception is `GraphBoard` (the
`~768px+` freeform board, `hooks/useIsLargeScreen.ts`) — that's a
large-screen/iPad layout for the **graph** specifically, not for
Skidmarks' own wizard flow, which stays phone-first everywhere else.

## Wired vs. stub — the current state, don't guess

| Piece | Status | Where |
|---|---|---|
| Word-level transcription (lyrics timing) | **Real** — ElevenLabs Scribe only, no other provider | `app/api/skidmarks/transcribe/route.ts` |
| Energy heuristic (vocal/instrumental fallback) | **Real**, client-side, no key needed | `lib/audioAnalysis.ts` |
| Plate *still* generation | **Real** — xAI Grok Imagine *image* API | `app/api/skidmarks/generate-still/route.ts`, `lib/plateGeneration.ts` |
| Multi-plate strip per clip (door → keyhole → Jack) | **Real**, persisted to `localStorage` | `lib/skidmarks.ts` (`SkidmarksClipSegment.plates`), `components/SkidmarksClipStub.tsx` |
| Per-clip opt-in *video* render | **Real** — xAI Grok Imagine *video* API, one clip at a time, explicit two-tap confirm, fixed 5s/480p cost cap, optional multi-line camera-motion field as the primary motion instruction | `app/api/skidmarks/generate-clip/route.ts`, `components/SkidmarksClipRender.tsx` |
| Render persistence | **Real** — a successful render is saved to durable Vercel Blob storage (not `localStorage`, not ephemeral React state), survives a refresh; download uses a numeric filename for Resolve, plus a "Download rendered clips" zip/sequential bundle across the whole timeline | `app/api/skidmarks/generate-clip/route.ts`, `app/api/skidmarks/clip-renders/route.ts`, `lib/clipRenderBlob.ts`, `lib/clipRenders.ts`, `lib/zipDownload.ts` |
| Whole-song **"Generate Clips"** button | **Stub, deliberately** — never auto-renders every clip in the song | `components/SkidmarksClipTimeline.tsx` |
| Voice, in-app stitch | Not built | — |
| Comfy MCP / Seedance / LTX | Not built — no key, no endpoint, no request shape anywhere in this repo | — |

**Never wire a whole-song / auto-fire-every-clip render.** That is the
one thing Stuart has repeatedly, explicitly ruled out on cost grounds.
If a future task asks for it, treat that as needing its own explicit
product sign-off, not something to build by extending the per-clip
render control.

## Plating UX locks — don't reinvent these, don't add a picker

- An empty plate is **one dashed/dotted placeholder tile**. Never a
  location-card carousel, never a "pick a scene" grid — an earlier pass
  built exactly that and it was explicitly ripped out on live QA.
- **"+"** appends one more plate slot to *the same clip's* horizontal
  strip (door → keyhole → Jack, one clip, several plates) — never a
  second timeline row per beat. Capped at `MAX_PLATES_PER_CLIP` (6).
- **One shared `shotPrompt` textarea per clip**, covering every plate in
  that clip's strip — not one prompt field per plate. A per-plate prompt
  field has been considered and rejected as a second control repeating
  the same idea; don't re-add it without a fresh explicit ask.
- **No model picker, no pill/badge row** anywhere in the current UI.
  `SkidmarksModelId` (LTX/Grok/H3/Seedance, `lib/skidmarks.ts`) still
  exists in the data layer and still steers prompt phrasing under the
  hood, but there is no tap surface for it today — don't add one
  without an explicit ask. **One narrow exception, added on an
  explicit ask**: `components/SkidmarksClipRender.tsx` has one small,
  optional, multi-line camera-motion field (a 2-row `<textarea>`,
  capped at `MAX_MOTION_PROMPT_LENGTH`, `lib/clipGeneration.ts`) that
  becomes the *primary* motion instruction sent to xAI's video call
  when filled in (`shotPrompt`/the plate stills stay the visual
  description and reference images) — still a single free-text field,
  not a camera-angle picker/menu; leaving it blank keeps the original
  automatic push-in/zoom behavior. Stuart's stated reason for this one:
  #42's Render control had *no* motion instruction at all, which he
  found irrational enough not to press the button.
- Any **new** control (the render button included) has to survive the
  same test: is this the smallest possible surface, or is it turning
  into a button farm? Prefer reusing an existing field/gesture over
  adding a second one.

## Jack Ash's character lock (`lib/plateGeneration.ts`, `SKIDMARKS_CHARACTER_LOCKS`)

Jack Ash (member id `jack-ash-frontman`) is the one hand-authored locked
character in this build:

- Wide-brim **black fedora** + suit, desert-noir setting.
- Face **always** fully hidden in shadow — no eyes/brow/nose/cheeks/
  jawline ever lit or visible, even in close-up or backlit.
- Glowing **neon-blue lips** — the one feature that breaks through the
  shadow.
- His real reference photo (`public/skidmarks/jack-ash-reference.jpg`)
  is passed as an identity reference whenever he's actually in frame —
  on a **Vocal** clip (he auto-includes as the resolved vocalist), *and*
  on an **Instrumental/B-roll** clip when the shot prompt names him
  directly or the plate continues from one that did ("Use last plate").
  **Don't scope this to Vocal-only again** — an Instrumental-only gap
  here was a real reported bug (see `lib/plateGeneration.ts`'s module
  doc comment and git history for the exact repro).
- This is a small, hand-authored allowlist, not inferred from anything.
  A new locked character needs the same explicit, hand-written
  hallmarks/negative-cues treatment — don't guess at a "look" for a
  character Stuart hasn't explicitly described.

## Prompt-length validation: user text only, never the injected framing

`MAX_PROMPT_LENGTH` (2000 chars — both `generate-still` and
`generate-clip` routes) applies **only to the user-authored
`shotPrompt`**, never to the auto-injected model-routing framing,
continuity/identity reference notes, or character-lock hallmarks/
negative cues appended on top of it before the actual call to xAI. A
locked character's hallmarks + negative cues alone run several hundred
characters — checking the full *merged* prompt against this cap already
produced one real reported bug (a ~400-character user prompt for a Jack
Ash plate with "Use last plate" checked rejected as "too long," even
though the merge itself is what pushed it over 2000, not anything
Stuart typed). If you touch `generate-still/route.ts`,
`generate-clip/route.ts`, `lib/plateGeneration.ts`, or
`lib/clipGeneration.ts`: keep `shotPrompt` (raw user text) and `prompt`
(the full merged string actually sent to xAI) as two separate fields on
the request, and validate length against `shotPrompt` only.

## Cost rules — read before wiring anything that calls a real API

- A plate *still* is cheap (roughly one to a few cents via xAI Grok
  Imagine) — fine to fire on a plain tap of "Generate," no confirm step
  needed.
- A clip *video* render is not cheap (xAI Grok Imagine video: $0.08/sec
  at 480p, $0.14 at 720p, $0.25 at 1080p, plus $0.01 per reference
  image) — **always** behind an explicit confirm that shows a real
  dollar estimate, never a bare "tap and it fires" control.
- **One render at a time, enforced in code**
  (`SkidmarksClipTimeline`'s `renderingSegmentId` lock), not just a UI
  suggestion or a same-clip re-tap guard.
- Fixed/hardcoded settings for a paid render (duration, resolution) are
  a deliberate, code-reviewed choice, not an env var and not a UI
  picker — don't let a duration/resolution knob sneak into the UI or
  into an env override without calling that out explicitly in the PR
  that adds it.
- **Never auto-fire a batch of paid calls** (a whole song's worth of
  clips, a whole band's worth of looks, etc.) without an explicit,
  single, informed tap per unit of spend.
- If you're not sure whether something costs money, treat it like it
  does — verify against the provider's real pricing before shipping,
  don't assume a "generate" button is free just because a sibling one
  (like the still-image one) happens to be cheap.
- Persisting a render to Vercel Blob is a **storage** cost, not a
  per-tap xAI spend risk — a handful of few-megabyte MP4s is well
  within Vercel Blob's free-tier storage, and each clip only ever keeps
  its *one* latest render (overwritten on re-render, see
  `lib/clipRenderBlob.ts`), so this doesn't grow unbounded the way a
  history of every past take would. Don't read this as a new cost lock
  needing its own confirm step — the confirm step still gates the real
  cost (the xAI render itself), not the save that follows it.

## Env vars this feature actually reads

- `XAI_API_KEY` — required for both plate-still generation
  (`app/api/skidmarks/generate-still/route.ts`) and clip-video render
  (`app/api/skidmarks/generate-clip/route.ts`). One key, two routes, no
  separate key per feature.
- `XAI_IMAGE_MODEL` (optional) — overrides the default
  `grok-imagine-image-2.0` still-image model.
- `XAI_VIDEO_MODEL` (optional) — overrides the default
  `grok-imagine-video-1.5` video model.
- `ELEVENLABS_API_KEY` (or `ELEVEN_LABS_API_KEY` as a fallback name) —
  required for real word-level transcription
  (`app/api/skidmarks/transcribe/route.ts`); missing it falls back to
  the client-side energy heuristic, honestly labeled, never silently.
- `BLOB_READ_WRITE_TOKEN` — required to persist a successful clip
  render to durable Vercel Blob storage (`app/api/skidmarks/generate-
  clip/route.ts`, `app/api/skidmarks/clip-renders/route.ts`). Set
  automatically once a Blob store is connected to this Vercel project
  (Project Settings → Storage → connect/create a Blob store) — no
  manual value to paste in most cases. Missing/unconfigured never
  blocks or fails a render: the render Stuart already paid for is
  still returned and playable, just honestly flagged as not saved
  (`persisted: false`) instead of implying durability that didn't
  happen. This is the one env var this feature reads that isn't an AI
  provider key.
- None of the above being unset should ever crash anything — every
  route returns an honest `missing_api_key`/`unconfigured` outcome
  instead. If you add a new real API call, match that shape.

## PR process

- Branch naming: `cursor/<descriptive-name>-<suffix>` (see `git log
  --all` for the existing pattern).
- PRs go against `master`. Default to ready-for-review, not draft,
  unless told otherwise.
- **Never merge a PR yourself.** Ship it open, ready for review — a
  human merges.
- Before calling a change done: `npm run lint`, `npm run test`
  (`vitest run`), and `npm run build` (`next build`) all have to
  actually pass, in the same session, with real output you looked at —
  not "should pass."
- One commit per logical change, not one giant squashed commit — keeps
  review (and any later `git bisect`) actually usable.
- For any change that calls a real paid API, the PR body must cover:
  which env var(s) it needs, what it costs per call/tap, and concrete
  QA steps that actually exercise it (not just "should work").
- Don't drive-by refactor unrelated code in the same PR — scope every
  change to exactly what was asked.
- Keep this file and README.md's "Skidmarks node" section accurate
  after any Skidmarks change that touches what's wired vs. stubbed,
  what a lock does, or what a control costs — update both, not just
  whichever you remembered first.
