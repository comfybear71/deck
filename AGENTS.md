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
| Multi-plate strip per clip (door → keyhole → Jack) | **Real**, persisted to `localStorage` (the existing session-state mirror — see the "no `localStorage`" note below for what's actually exempt from that) | `lib/skidmarks.ts` (`SkidmarksClipSegment.plates`), `components/SkidmarksClipStub.tsx` |
| Per-plate select + tick | **Real** — a small corner control on each filled plate tile (radio-style, one plate selected per clip at a time) plus a filled/empty tick for "already has a saved render"; see `lib/skidmarks.ts`'s `resolveSelectedPlateId` | `components/SkidmarksClipStub.tsx` |
| Per-plate opt-in *video* render | **Real** — xAI Grok Imagine *video* API, animates **the one selected plate's own still only** (not multi-reference continuity across the whole strip anymore), one plate at a time across the whole timeline, explicit two-tap confirm, real per-plate camera-motion text (`SkidmarksClipPlateSlot.motionPrompt`) | `app/api/skidmarks/generate-clip/route.ts`, `components/SkidmarksClipRender.tsx` |
| Per-plate render duration | **Real, auto-computed** — `segmentLengthSec / plateCount`, clamped to `[5, 15]`s (Grok's documented ceiling), no UI picker | `lib/clipGeneration.ts`'s `computePlateDurationSec` |
| Render persistence | **Real**, per-**plate** now (not per-clip — see the pathname migration note below) — saved to durable Vercel Blob storage, survives a refresh; download uses a numeric (lettered once a clip has >1 plate) filename for Resolve | `app/api/skidmarks/generate-clip/route.ts`, `app/api/skidmarks/clip-renders/route.ts`, `lib/clipRenderBlob.ts`, `lib/clipRenders.ts`, `lib/zipDownload.ts` |
| Rendered-clips shelf | **Real** — every rendered plate's player/download moved out from under the pink Render button into one page-bottom collapsible shelf, **default open**; "download all" zip/sequential-fallback lives here now | `components/SkidmarksRenderedClipsShelf.tsx`, `hooks/useSkidmarksClipRenders.ts` |
| MP3 audio → Vercel Blob | **Real** — the attached MP3's own audio bytes upload client-side-direct to Blob at attach time so **playback survives a refresh**, honestly labeled when unconfigured/failed | `lib/mp3Blob.ts`, `components/SkidmarksMp3Card.tsx` |
| Auto-plate from a short brief | **Real** — fills *empty* plate slots across the whole clip list with real xAI-generated stills off a small heuristic planner (never an LLM call against the brief), **then stops**; never overwrites a filled plate, never renders video | `lib/autoPlate.ts`, `components/SkidmarksAutoPlate.tsx` |
| Finished-song archive | **Real** — "Archive" snapshots the live band+mp3 (segments, plates, prompts, motion text) to Vercel Blob JSON + carries forward the mp3's own audio URL, lists in a page-bottom shelf, "Open in editor" restores it (auto-archiving whatever's currently live first), "Download project zip" bundles prompts/stills/renders/audio "as practical." No Neon — not patterned anywhere in this repo yet (see Env vars) | `lib/skidmarksArchive.ts`, `app/api/skidmarks/archive/route.ts`, `app/api/skidmarks/blob-upload/route.ts`, `components/SkidmarksArchiveShelf.tsx` |
| Whole-song **"Generate Clips"** button | **Stub, deliberately** — never auto-renders every clip in the song | `components/SkidmarksClipTimeline.tsx` |
| Voice, in-app stitch | Not built | — |
| Comfy MCP / Seedance / LTX | Not built — no key, no endpoint, no request shape anywhere in this repo | — |

**Never wire a whole-song / auto-fire-every-clip render.** That is the
one thing Stuart has repeatedly, explicitly ruled out on cost grounds.
If a future task asks for it, treat that as needing its own explicit
product sign-off, not something to build by extending the per-plate
render control. Auto-plate is the one adjacent thing that *is* wired to
fan out across the whole song — but only for cheap **stills**, and it
still stops cold before video; don't blur that line when extending
either feature.

**Persisted-render pathname is a breaking, per-plate scheme now**
(`lib/clipRenderBlob.ts`): `skidmarks/clip-renders/{segmentId}/{plateId}/
{filename}`, not the old `{segmentId}/{filename}`. This was a deliberate
migration for the per-plate-select rework — a render used to be "one per
clip," it's "one per plate" now. Any render already sitting in Blob
under the old 2-level path is simply orphaned (not deleted, just no
longer listed/linked) — flagging this explicitly rather than pretending
it was seamless.

**No `localStorage` for genuinely new durable state.** The existing
`lib/skidmarks.ts` session mirror (bands/session/segments/plates,
including plate stills as `data:` URLs) is still `localStorage`-backed
— that's pre-existing debt this PR didn't create or fix, and adding a
field to an existing plate/segment (`motionPrompt`, `selectedPlateId`)
follows that same existing pattern, not a new one. But the **archive of
record** for a finished song, and the MP3's own durable audio copy, are
both genuinely new durable state added in this pass — both go straight
to Vercel Blob (JSON metadata + JSON snapshot + media), never
`localStorage`, per the hard lock. Neon is still not patterned anywhere
in this repo (see Env vars) — when it lands, it should replace *all* of
this `localStorage` session state, not just the archive.

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
  without an explicit ask. **Two narrow exceptions, both added on an
  explicit ask**:
  1. A small bottom-right corner control on each *filled* plate tile
     (`components/SkidmarksClipStub.tsx`'s `SkidmarksPlateSelectControl`)
     — radio-style, picks which single plate the clip's one Render
     control animates next, and doubles as a filled/empty tick for
     "already has a saved render." Not a model/style picker — it never
     changes what gets generated, only which existing plate a render
     targets.
  2. `components/SkidmarksClipRender.tsx` has one small, optional,
     multi-line camera-motion field (a 2-row `<textarea>`, capped at
     `MAX_MOTION_PROMPT_LENGTH`, `lib/clipGeneration.ts`) that becomes
     the *primary* motion instruction sent to xAI's video call when
     filled in (`shotPrompt`/the plate still stay the visual
     description and reference image) — **per-plate now**
     (`SkidmarksClipPlateSlot.motionPrompt`, one stored value per
     plate, not per clip and not local component state), but still a
     single free-text field, not a camera-angle picker/menu; leaving it
     blank keeps the automatic push-in/zoom behavior. Stuart's stated
     reason for this one: #42's Render control had *no* motion
     instruction at all, which he found irrational enough not to press
     the button.
- **Render animates exactly one plate's own still now, never every
  plate on the strip at once.** The old build sent every filled plate as
  multi-reference continuity in a single xAI call; per Stuart's
  per-plate-select ask, continuity across a clip's several plates (door
  → keyhole → Jack) now comes from rendering each plate separately with
  its own motion, then editing them together in Resolve — not from one
  bigger, pricier xAI call. Don't quietly bring multi-reference
  continuity back into this control without an explicit ask; the
  underlying xAI route still generically supports it (any other caller
  could ask for 2–3 references), this feature's own UI just never does.
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
  needed. Auto-plate (below) fires several of these in a row, so it gets
  its own single lightweight confirm (a real count + rough dollar
  estimate) — not the two-tap video-grade confirm, but not a bare silent
  tap either.
- A plate *video* render is not cheap (xAI Grok Imagine video: $0.08/sec
  at 480p, $0.14 at 720p, $0.25 at 1080p, plus $0.01 per reference
  image) — **always** behind an explicit confirm that shows a real
  dollar estimate **and the real duration** (now variable per plate, see
  below — never a bare "tap and it fires" control, and never a vague
  "this costs money" line without the actual number.
- **Real, auto-computed per-plate duration** — `segmentLengthSec /
  plateCount`, clamped to `[MIN_CLIP_DURATION_SEC, MAX_CLIP_DURATION_SEC]`
  = `[5, 15]` seconds (Grok's documented ceiling), computed by
  `lib/clipGeneration.ts`'s `computePlateDurationSec`. This replaced the
  earlier flat, always-5s duration. **Still not a UI picker or an env
  var** — Stuart never gets a duration field to type into; the number is
  derived from the clip's own real length and plate count, shown to him
  read-only in the confirm step. If a future task asks for a manual
  override, that's a fresh, explicit, code-reviewed ask — this rework
  didn't add one.
- **Resolution stays hardcoded** at 480p (the cheapest documented tier)
  — same "not an env var, not a picker" lock as before this rework, only
  duration became real/variable.
- **One render at a time, enforced in code, across the whole song, not
  just the whole clip** (`SkidmarksClipTimeline`'s `renderingKey` lock,
  keyed by `${segmentId}:${plateId}` — a plate-level key now, since a
  render targets one specific plate). Not just a UI suggestion or a
  same-plate re-tap guard.
- **Never auto-fire a batch of paid *video* calls** (a whole song's worth
  of clips, a whole band's worth of looks, etc.) without an explicit,
  single, informed tap per unit of spend. Auto-plate is the one
  intentional exception to "never batch" for **stills** specifically —
  see the Auto-plate entry in "Wired vs. stub" — and it still never
  batches video.
- If you're not sure whether something costs money, treat it like it
  does — verify against the provider's real pricing before shipping,
  don't assume a "generate" button is free just because a sibling one
  (like the still-image one) happens to be cheap.
- Persisting a render to Vercel Blob is a **storage** cost, not a
  per-tap xAI spend risk — a handful of few-megabyte MP4s is well
  within Vercel Blob's free-tier storage, and each **plate** only ever
  keeps its *one* latest render (overwritten on re-render, see
  `lib/clipRenderBlob.ts`), so this doesn't grow unbounded the way a
  history of every past take would. The same "storage cost, not spend
  risk" reasoning applies to the MP3 audio upload and the archive
  snapshot/index — none of these need their own confirm step; the
  confirm step still gates the real cost (the xAI call itself), not any
  save that follows it.

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
- `BLOB_READ_WRITE_TOKEN` — required for **every** durable Vercel Blob
  write this feature makes, which as of this pass is more than just clip
  renders:
  - Persisting a successful clip render (`app/api/skidmarks/generate-
    clip/route.ts`, `app/api/skidmarks/clip-renders/route.ts`) — one
    per plate now, see the pathname migration note above.
  - The attached MP3's own audio bytes, so playback survives a refresh
    (`lib/mp3Blob.ts`, via the shared client-upload token route
    `app/api/skidmarks/blob-upload/route.ts`).
  - A finished song's full archive snapshot and the shared archive
    index (`lib/skidmarksArchive.ts`, `app/api/skidmarks/archive/
    route.ts`, also via `app/api/skidmarks/blob-upload/route.ts`).
  Set automatically once a Blob store is connected to this Vercel
  project (Project Settings → Storage → connect/create a Blob store) —
  no manual value to paste in most cases. Missing/unconfigured never
  blocks or fails the thing it was going to save: a render Stuart
  already paid for is still returned and playable
  (`persisted: false`), MP3 playback still works from the local object
  URL for this session, and an unconfigured Archive tap fails with a
  real, honest message rather than silently discarding the song. This
  is the one env var this feature reads that isn't an AI provider key.
- **Two of `app/api/skidmarks/blob-upload/route.ts`'s client uploads
  (`lib/mp3Blob.ts`, `lib/skidmarksArchive.ts`) go straight from the
  browser to Blob storage, bypassing this app's own serverless
  function entirely** (`@vercel/blob/client`'s `upload()`) — deliberate,
  not an oversight: both payloads (a real song-length MP3, an archive
  snapshot with embedded plate stills) can exceed Vercel's hard
  ~4.5MB Function request-body cap (the same cap
  `lib/audioCompression.ts` already had to work around for the
  transcription upload). If you add a *new* Blob write for this
  feature and it could plausibly carry more than a few hundred KB,
  default to this same client-upload pattern rather than a normal JSON
  POST body.
- **No Neon/Postgres anywhere in this repo yet** — `@neondatabase/
  serverless`, `drizzle`, `prisma`, etc. are not dependencies, and no
  connection string env var is read anywhere. The archive of record
  (this pass) uses Vercel Blob JSON instead, explicitly as an interim
  answer — see the README's Skidmarks follow-up note for the intended
  eventual Neon migration, which should absorb the *entire*
  `lib/skidmarks.ts` session mirror, not just the archive.
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
