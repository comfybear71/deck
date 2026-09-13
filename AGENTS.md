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
against real thumb behavior, the per-plate select control's real hit
target being widened to ~40px (a live-QA'd real gap: the ~20px visible
dot alone was under Apple's ~44pt HIG touch-target minimum, sitting
right at the tile's own extreme corner — a thumb that missed by a few
px fell through to the tile underneath, opening the enlarge lightbox on
a short miss or firing the tile's own press-and-hold-clear timer on a
miss held a beat too long). See `components/SkidmarksClipStub.tsx`'s
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
| Multi-plate strip per clip (door → keyhole → Jack) | **Real**, persisted to **Neon** now (one session row per studio owner — see the "no `localStorage`" note below) | `lib/skidmarks.ts` (`SkidmarksClipSegment.plates`), `lib/skidmarksSession-server.ts`, `components/SkidmarksClipStub.tsx` |
| Per-plate select + tick | **Real** — a small corner control on each filled plate tile (radio-style, one plate selected per clip at a time) plus a filled/empty tick for "already has a saved render"; see `lib/skidmarks.ts`'s `resolveSelectedPlateId` | `components/SkidmarksClipStub.tsx` |
| Per-plate opt-in *video* render | **Real, three backends now, routed by Vocal vs. Instrumental, plus a real H3/Grok switch on Instrumental — no persistent picker.** Vocal clips → **Comfy Cloud running the full LTX 2.3 IA2V graph** (`workflow/LTX_2.3_IA2V_Cloud.json`, `COMFY_CLOUD_API_KEY`), driven by a real frame-sliced (`lib/mp3Slice.ts`) window of the attached song's own vocal audio (`mp3.audioUrl`), 5–30s — no switch. This path used to call Comfy's hosted `LtxApi25AudioToVideo` partner node; that never survived a real call (see `lib/comfyCloud.ts`'s module doc comment) and the graph the original Skidmarks repo actually renders with replaced it. Instrumental/B-roll clips → **MiniMax H3** (`MINIMAX_API_KEY`, optional `MINIMAX_GROUP_ID`) **by default** (Stuart's 2026-09-13 "H3 please, for this smoke" lock, superseding the older "never auto-assign H3" *still-image* cost lock below — the two are separate fields, see `SkidmarksInstrumentalVideoModel`'s doc comment), 5–15s, first-frame (optionally first+last-frame) image-to-video; **xAI Grok Imagine video** stays fully wired one tap away, same 5–15s range — a small H3/Grok switch lives *inside* the existing two-tap Render confirm, added on Stuart's own explicit ask ("a single H3 \| Grok choice inside the existing two-tap Render confirm"), persisted per clip (`SkidmarksClipSegment.instrumentalVideoModel`). Either way: animates **the one selected plate's own still only**, one plate at a time across the whole timeline, explicit two-tap confirm, real per-plate camera-motion text (`SkidmarksClipPlateSlot.motionPrompt`). **Honesty note**: neither the Comfy/LTX nor the MiniMax H3 path is live-verified in this sandbox (no `COMFY_CLOUD_API_KEY`/`MINIMAX_API_KEY` available here) — see `lib/comfyCloud.ts`'s and `lib/minimaxH3.ts`'s own module doc comments. Both are ported from the original Skidmarks repo's own real clients rather than invented, but **a passing test suite is not proof either renders**: the only proof for LTX is Stuart tapping Vocal Render on his iPhone after a deploy and a shelf clip playing. | `app/api/skidmarks/generate-clip/route.ts`, `lib/comfyCloud.ts`, `lib/minimaxH3.ts`, `lib/mp3Slice.ts`, `lib/clipGeneration.ts`, `lib/skidmarks.ts`, `components/SkidmarksClipRender.tsx` |
| Per-plate render duration | **Real, auto-computed** — `segmentLengthSec / plateCount`, clamped to `[5, 15]`s (Grok's documented ceiling), no UI picker | `lib/clipGeneration.ts`'s `computePlateDurationSec` |
| Render persistence | **Real**, per-**plate** now (not per-clip — see the pathname migration note below) — saved to durable Vercel Blob storage, survives a refresh; download uses a numeric (lettered once a clip has >1 plate) filename for Resolve. **Exactly one render per `(segmentId, plateId)` is an enforced invariant, not just a convention** — see the "exactly-one-render" note below | `app/api/skidmarks/generate-clip/route.ts`, `app/api/skidmarks/clip-renders/route.ts`, `lib/clipRenderBlob.ts`, `lib/clipRenders.ts`, `lib/zipDownload.ts` |
| Rendered-clips shelf | **Real** — every rendered plate's player/download moved out from under the pink Render button into one page-bottom collapsible shelf, **default open**, cards laid out in one `overflow-x-auto` horizontal strip (not a vertical stack) so a phone with several renders doesn't turn into one huge scroll; "download all" zip/sequential-fallback stays reachable underneath the strip. Each card has an explicit small **Download** pill (same `rounded-full` shape/size as Remove, tiny download icon — still the existing `buildForceDownloadUrl`/Blob `?download=1` mechanism and numeric/lettered filename, never the native `<video>` share/⋯ menu) plus a **Remove** control — deletes that plate's persisted Blob render(s) and clears its tick, never touches the plate's still/shot/motion prompts (those are separate, `localStorage`-only state) | `components/SkidmarksRenderedClipsShelf.tsx`, `hooks/useSkidmarksClipRenders.ts`, `lib/clipRenders.ts`'s `deletePersistedClipRender`/`buildForceDownloadUrl` |
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

**"Exactly one render per `(segmentId, plateId)`" is an enforced
invariant, not just an `allowOverwrite: true` convention** — a real
live-QA'd gap: `{filename}` bakes in `clipIndex`/`startSec`/`endSec`/a
plate-count-dependent letter suffix (`buildClipRenderFilename`), none of
which are guaranteed stable between two renders of what Stuart still
considers "the same plate" (the timeline reordering, a plate added to/
removed from the same clip's strip in between) — so `allowOverwrite`
alone could leave a *second*, differently-named blob sitting under the
same plate's own prefix instead of genuinely replacing the first,
showing up as a ghost/duplicate entry in the shelf, or as "I paid for a
re-render and the old clip is still there." Two layers now guard against
this: (1) `app/api/skidmarks/generate-clip/route.ts`'s
`pruneStaleRendersForPlate` deletes every *other* blob under
`buildClipRenderPlatePrefix(segmentId, plateId)` right after a
successful `put()` (best-effort — a failed prune doesn't fail the
render Stuart already paid for); (2) `app/api/skidmarks/clip-renders/
route.ts`'s `GET` defensively de-dupes by picking the blob with the
latest `uploadedAt` per plate, in case a prune ever didn't run. If you
touch either route or `lib/clipRenderBlob.ts`, keep both layers —
neither alone is a hard guarantee.

**A paid render's success must never be silently invisible.** If xAI's
call itself succeeds (money spent) but the *save* step afterward fails,
`components/SkidmarksClipRender.tsx` shows a distinctly bordered/
backgrounded alert (not the same plain text line as an ordinary
validation error) stating plainly that the render finished, that Stuart
was charged, and that it won't show up in the shelf or survive a
refresh — never just a quiet "Rendered ✓" tick with nothing to actually
show for it.

**No `localStorage` anywhere for Skidmarks studio state — the whole
`lib/skidmarks.ts` session mirror (bands/session/segments/plates,
selections, prompts, motion text) now lives in Neon, not
`localStorage`.** This is a hard, repeated Stuart lock ("never
localStorage for studio state of record"), and the literal fix for a
real bug: the old `localStorage` mirror raced with itself across phone
storage/tab-suspend behavior and silently wiped tagged plates/prompts.
`cachedState` is still the synchronous in-memory value every mutator
reads/writes (`useSyncExternalStore` needs a synchronous snapshot, and
a network call can't be one), but its *durable* copy is now a single
Neon row (`lib/skidmarksSession-server.ts`, one fixed single-tenant
`owner_id` — this app has no auth system), read via one `GET /api/
skidmarks/session` per page load and written via a debounced,
serialized `PUT` after every local mutation — see `lib/skidmarks.ts`'s
"Neon-backed session persistence" doc comment for the exact hydrate/
push implementation and its two race guards. `localStorage` is fully
gone from this file; grep it and the only remaining `localStorage`
matches in this whole file are comments describing what used to be
there or unrelated field-shape docs. Media (MP3 audio, clip renders,
archive snapshots — plate stills are still `data:` URLs inside the
Neon row for now, not yet Blob-backed) still goes straight to Vercel
Blob, unchanged by this migration; see Env vars below for
`DATABASE_URL`.

**The `localStorage` quota machinery is gone — Neon replaced it.**
Historical context, because the bug it chased was real: a clip's own
timing stayed correct (small, persisted early) while its plates
reverted to empty dashed placeholders — `persist()` used to swallow a
failed `localStorage.setItem` completely silently, so nothing past the
point iOS Safari's tight per-origin quota was hit had actually reached
disk. Two fixes landed for that, and **only one of them survives**:

1. **Kept, and still load-bearing**: an *uploaded* plate still already
   went through `readImageFileAsDataUrl`'s downscale pass, but a
   *generated* still (`generatePlateStill`) was persisted straight off
   xAI's raw response with no size cap at all — it's downscaled the
   same way via `downscaleDataUrlImage` (1024px ceiling) right where
   `SkidmarksClipStub`'s Generate flow receives it. Don't remove this
   on the grounds that the quota is gone: plate stills still travel as
   base64 `data:` URLs *inside* the Neon row, so the cap is what keeps
   that row — and every `PUT` carrying it — a sane size over a phone
   connection.
2. **Deleted**: `describeSkidmarksPersistFailure`,
   `getSkidmarksPersistFailure`, `getSkidmarksStorageWarning`,
   `exceedsSkidmarksStorageWarningThreshold`, `lastPersistFailure`,
   `lastPersistWarning`, `STORAGE_SIZE_WARNING_BYTES`,
   `STORAGE_SIZE_WARNING_MESSAGE`, their two `useSyncExternalStore`
   subscriptions in `useSkidmarksStudio`, and their four `describe`
   blocks. `persist()` no longer writes to `localStorage` at all, so
   none of that code could ever fire again — leaving it in would have
   shipped UI structurally incapable of showing.

The need it served is met by `SkidmarksSessionSyncState` instead:
`"error"` carries Neon's own failure reason verbatim, `"unconfigured"`
says plainly that edits won't survive a refresh. Same "a save that
didn't happen must never look like a success" principle, reporting on
the store that actually exists. **If the sheet shows "Session storage
isn't connected here", `DATABASE_URL` is not reaching that deployment
— that banner is the honest signal working, not a bug.**

Also kept from that same pass, and neither one was `localStorage`-
specific: the `setSkidmarksMp3Duration` clobber guard, and
`SkidmarksAutoPlate`'s execution loop re-checking the *live* store (not
its own stale, planned-up-front `segments` snapshot) immediately before
writing each still back, so a plate Stuart fills manually mid-run can't
be silently overwritten by that same run's now-stale plan.

**Follow-up on that same report**: Stuart confirmed the wipe cleared
`shotPrompt` (and the plate stills) together, not stills alone — i.e.
a whole clip's tagged state, not one field. Re-verified directly
against the merged code (not memory) that this doesn't point at a gap
in `hasSkidmarksUserContent` itself — it does check
`s.shotPrompt.trim().length > 0`, correctly, and all three real
`buildDefaultSegment`-based rebuild call sites
(`applySkidmarksAnalysisResult`, `applySkidmarksTranscriptionResult`,
`setSkidmarksMp3Duration`) are already gated by it. Grepped the whole
repo for every other write to `.plates`/`.shotPrompt` — every setter
(`setSkidmarksClipPlateStill`, `setSkidmarksSegmentShotPrompt`,
`addSkidmarksClipPlate`, `removeSkidmarksClipPlate`,
`setSkidmarksClipPlateMotionPrompt`) goes through `updateSkidmarksSegment`,
scoped to one matching segment id, never a sibling; the rendered-clips
shelf's "Remove" only ever touches its own local render-tracking Map,
never `lib/skidmarks.ts` state; archive restore only replaces the live
session after an explicit "Open in editor" tap on one specific row.
No fourth rebuild path was found. The actual "other path" that blanks
a whole clip's tagged state as a unit **without** going through any
`applySkidmarks*Result` function is exactly the `persist()` gap above:
one `localStorage.setItem` call writes the *entire* state as a single
JSON blob, so a shot prompt typed and several stills generated after
the last successful write are all lost together the moment a later
reload rehydrates from that older, smaller snapshot — this is silent
data loss from a failed write, not a rebuild function replacing
anything. **That whole failure mode is now structural history**: the
state of record is one Neon row written by a debounced, serialized
`PUT`, not a single `localStorage.setItem` blob, so there is no quota
left to silently lose a write to. The proactive 3MB warning layer that
was added on top of the downscale fix has been deleted with the rest of
the quota machinery (see above).

**A slow real API result must never silently overwrite already-tagged
plates/prompts, or land on a different attach than the one it was for.**
Real live-QA'd bug, reported right after #49 merged: "all Vocal plates
disappeared except the first one" / clip 1 "resolved back to an older
clip." Root cause was two gaps in `lib/skidmarks.ts`, both pre-existing
(not introduced by #49 itself — #49 just happened to be the deploy
Stuart was on when he hit them):
1. `applySkidmarksAnalysisResult`/`applySkidmarksTranscriptionResult`
   (the two async "a real signal just resolved" callbacks
   `useSkidmarksStudio.attachMp3` kicks off) used to unconditionally
   rebuild the *entire* `segments` array from scratch — fresh ids, one
   blank plate each — the moment either landed. Correct the first time
   (nothing's tagged yet), but the energy heuristic resolves
   client-side-fast while real transcription is a genuine network
   round-trip against a whole song; there was nothing stopping Stuart
   from already tagging a door → keyhole → Jack strip on the fast
   heuristic's timeline before the slower "more correct" transcription
   landed and silently discarded all of it. Fixed via
   `hasSkidmarksUserContent` — both functions now check whether the
   *current* segments already have real content (any filled plate, a
   shot prompt, an extra "+" slot, a plate selection, a manual model
   pick) before rebuilding, and skip the rebuild entirely if so (still
   recording `analysisStatus`/`transcriptionStatus`/`segmentsSource`
   honestly either way — the chips never lie about whether a real
   signal landed).
2. Every one of those same resolve callbacks, plus
   `setSkidmarksMp3AudioUrl`/`mark*Failed`/`mark*Unconfigured`, only
   ever no-op'd on `!mp3` (the mp3 was cleared) — nothing checked
   whether the *live* mp3 was still the same attach the promise was
   originally for. `useSkidmarksStudio`'s own `analysisTokenRef` guard
   is a `useRef` scoped to the `SkidmarksDetailSheet` component
   instance, which fully unmounts whenever the sheet closes
   (`GraphView`'s `{openNode && ... && <SkidmarksDetailSheet />}`) — a
   promise still in flight from *before* that unmount keeps running,
   and its `.then()` closure checks itself against its own now-orphaned
   ref object (never invalidated by the unmount), so it could still
   land on whatever's live after a reopen or a fresh attach. Fixed by
   giving every `SkidmarksMp3Attachment` its own stable `attachId`
   (minted once in `createMp3Attachment`, backfilled by `normalizeState`
   for an older stored session) and having the store itself — not just
   the component ref — re-check it against `session.mp3.attachId`
   before applying anything. This is the durable guarantee now; the
   component-side ref check is kept only as a cheap early bail.

If you touch `applySkidmarksAnalysisResult`,
`applySkidmarksTranscriptionResult`, any of the other `mp3`-scoped
resolve/mark functions in `lib/skidmarks.ts`, or `useSkidmarksStudio
.attachMp3`, keep both guards — `attachId` alone doesn't protect
already-tagged content on the *same* attach, and
`hasSkidmarksUserContent` alone doesn't protect against a stale
promise for a *different*, since-replaced attach.

**That fix missed one more `mp3`-scoped resolve callback:
`setSkidmarksMp3Duration`** — real live-QA'd regression, reported after
#51+#53 had already landed: "clip 1 lost again," same symptom as the
bug above. This one's driven by the `<audio>` element's own
`loadedmetadata` probe (`SkidmarksMp3Card`), not analysis/
transcription, and it had neither guard — it unconditionally rebuilt
`segments` via `buildDemoSegments(durationSec)` whenever
`durationSec === null && segmentsSource === "seed-fallback"`. iOS
Safari can defer `loadedmetadata` well past attach (its power-saving
media policy can hold it until Stuart actually taps Play), leaving a
real window to have already tagged a clip on the seed-fallback timeline
before this fires. Now takes `attachId` and checks
`hasSkidmarksUserContent` exactly like the other two. If you add a
*fourth* `mp3`-scoped resolve path later, give it both guards too —
this file's real bug history is now three-for-three on "the first
fix's shape was right, a sibling callback just didn't get it yet."

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
  exists in the data layer and still steers *still-image* prompt
  phrasing under the hood, but there is no tap surface for it today —
  don't add one without an explicit ask. **Three narrow exceptions, all
  added on an explicit ask**:
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
  3. **`components/SkidmarksClipRender.tsx`'s H3/Grok switch** (added
     2026-09-13, Stuart's explicit ask, this exact shape: "a single H3
     \| Grok choice inside the existing two-tap Render confirm") — two
     small buttons that appear *only inside the confirm step*, only on
     an Instrumental clip, picking which real video backend the *next*
     tap of Confirm calls. Backed by its own dedicated field
     (`SkidmarksClipSegment.instrumentalVideoModel`,
     `lib/skidmarks.ts`'s `SkidmarksInstrumentalVideoModel`/
     `resolveInstrumentalVideoModel`/
     `setSkidmarksSegmentInstrumentalVideoModel`) — deliberately
     **not** the still-image `SkidmarksModelId`/`model` field above;
     reusing that field would have silently changed every fresh
     Instrumental clip's still-image framing hint
     (`lib/plateGeneration.ts`'s `routingFramingHint`) as a side effect
     of a video-backend default. Don't widen this into a third/fourth
     option (Seedance, LTX) or move it onto the plate tile itself
     without a fresh explicit ask — it stays exactly the two real
     backends this route actually calls for Instrumental, in exactly
     this one spot.
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
  directly or the plate continues from **a plate that itself already
  featured him** ("Use last plate", gated on the *source* still's own
  resolved fact — `lib/skidmarks.ts`'s `SkidmarksPlateStill
  .featuresLockedCharacter` — not on "any continuity image exists at
  all"). **Don't scope this to Vocal-only again** — an Instrumental-only
  gap here was a real reported bug (see `lib/plateGeneration.ts`'s
  module doc comment and git history for the exact repro).
  **Don't widen the continuity signal back to "any continuity image"
  either** — a second real reported bug: the door → keyhole → Jack
  sequence's *keyhole* plate (empty of people, prompt never names him)
  continued from the *door* plate (also empty of people) via "Use last
  plate," and the old, cruder signal wrongly injected his silhouette/
  neon lips into that person-less shot purely because the band happens
  to be Jack Ash and *some* continuity reference was attached. The lock
  only ever carries forward along a continuity chain that actually
  featured him — never onto a door/keyhole/generic-B-roll plate just
  because it continues from *something*.
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
- A plate *video* render is not cheap — **always** behind an explicit
  confirm that shows a real dollar estimate **and the real duration**
  (per-plate, see below) for *whichever backend the confirm actually
  targets* — never a bare "tap and it fires" control, and never a vague
  "this costs money" line without the actual number. Real published
  per-second rates, by backend:
  - **xAI Grok Imagine video** (Instrumental, the fallback/switch-to
    option): $0.08/sec at 480p, $0.14 at 720p, $0.25 at 1080p, plus
    $0.01 per reference image. This app only ever requests 480p.
  - **MiniMax H3** (Instrumental, the default as of 2026-09-13):
    $0.08/sec at 768P, $0.13/sec at 2K, first 5 reference images free
    ($0.04 each past that — this feature never sends more than 2).
    This app only ever requests 768P.
  - **Comfy Cloud, LTX 2.3 IA2V graph** (Vocal): the confirm step
    estimates $0.13/sec, Lightricks' own published LTX direct-API rate,
    with no per-reference-image surcharge. **This is a stand-in, not a
    verified bill** — the graph runs on Comfy Cloud's own GPUs and is
    billed as Comfy Cloud compute/credits, not as an LTX API call. It's
    the most honest real number available without a key to check the
    credit burn against (`lib/clipGeneration.ts`'s
    `LTX_SECOND_RATE_USD` is the one place to correct it once
    Stuart's real statement says otherwise).
- **Real, auto-computed per-plate duration** — `segmentLengthSec /
  plateCount`, clamped to `[MIN_CLIP_DURATION_SEC, MAX_CLIP_DURATION_SEC]`
  = `[5, 15]` seconds for both Instrumental backends (Grok's documented
  ceiling; MiniMax H3's own real ceiling is `[4, 15]`, looser, so this
  app's existing Grok range already sits safely inside it — no separate
  H3 duration bounds needed), or `[5, 30]` for Vocal/Comfy-LTX,
  computed by `lib/clipGeneration.ts`'s `computePlateDurationSec`/
  `computeLtxPlateDurationSec`. **The Vocal ceiling was `20`, briefly,
  and is `30` now.** The `20` was real, but it belonged to the hosted
  `LtxApi25AudioToVideo` partner node, which genuinely hard-rejects
  driving audio outside `2-20s` in its own `execute()`. It was never a
  cap on Stuart's actual workflow (many real ~30s LTX renders on his own
  Comfy Cloud account) because that workflow never used that node. The
  Vocal path now submits the LTX 2.3 IA2V graph, where duration is an
  ordinary graph input (node `340:331`) with no such ceiling, so `30`
  simply matches his demonstrated usage. **A raw `segmentLengthSec /
  plateCount` past either ceiling must never throw — it always clamps**,
  and the confirm step always shows that *clamped* number, never the
  raw pre-clamp one. A second, related real bug (also fixed in the same
  pass): frame-aligned audio slicing (`lib/mp3Slice.ts`'s
  `sliceMp3ToTimeRange`) always rounds **outward** to fully cover the
  requested window, so a plate clamped to *exactly* the ceiling could
  still get sliced a hair past it — Stuart hit this live at the old 20s
  ceiling, when the partner node really did reject it (`"This plate's audio slice is 20.0s"`, rejected, even though
  the request had already been correctly clamped to 20). Fixed by
  passing the ceiling into `sliceMp3ToTimeRange` as its own
  `maxDurationSec`, which now trims whole frames off the *end* of an
  over-long slice instead of erroring — `app/api/skidmarks/generate-
  clip/route.ts`'s Vocal branch has no upper-bound rejection at all
  anymore, only a floor check for genuinely too-little-audio-left. If
  you touch `computePlateDurationSec`/`computeLtxPlateDurationSec`,
  `sliceMp3ToTimeRange`, or the Vocal branch of `generate-clip/
  route.ts`, keep both fixes — the clamp prevents an unreasonable
  *request*, the trim prevents a reasonable one from failing on
  rounding alone. **Still not a UI picker or an env var** — Stuart never
  gets a duration field to type into; the number is derived from the
  clip's own real length and plate count, shown to him read-only in the
  confirm step. If a future task asks for a manual override, that's a
  fresh, explicit, code-reviewed ask — this rework
  didn't add one.
- **Resolution stays hardcoded** per backend (480p for Grok, 768P for
  MiniMax H3; on the Vocal/LTX path the equivalent lock is the verified
  `workflow/LTX_2.3_IA2V_Cloud.json` template itself, submitted
  unmodified apart from five patched node inputs) — same "not an env
  var, not a picker" lock across all three.
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

- `XAI_API_KEY` — required for plate-still generation
  (`app/api/skidmarks/generate-still/route.ts`) and, on the
  Instrumental/B-roll clip-video render path, whenever it's switched to
  Grok (`app/api/skidmarks/generate-clip/route.ts`'s Grok branch). One
  key, both uses — no separate key per feature. Missing it never
  blocks a still-only session, and never blocks an Instrumental clip
  left on H3 (the default, see `MINIMAX_API_KEY` below) or a Vocal
  clip (Comfy LTX) — only an Instrumental render actually switched to
  Grok gets this key's own honest `missing_api_key` outcome.
- `XAI_IMAGE_MODEL` (optional) — overrides the default
  `grok-imagine-image-2.0` still-image model.
- `XAI_VIDEO_MODEL` (optional) — overrides the default
  `grok-imagine-video-1.5` video model. Only used for an Instrumental/
  B-roll clip actually switched to Grok (see `MINIMAX_API_KEY`/
  `COMFY_CLOUD_API_KEY` below for the other two backends).
- `MINIMAX_API_KEY` — required for **Instrumental/B-roll** clip video
  render on its *default* backend, MiniMax H3
  (`app/api/skidmarks/generate-clip/route.ts`'s H3 branch,
  `lib/minimaxH3.ts`). Pay-as-you-go, create at platform.minimax.io.
  Missing it never blocks a Vocal render (Comfy LTX) or an Instrumental
  clip switched to Grok (`XAI_API_KEY`, above) — only an Instrumental
  render actually left on H3 gets this key's own honest
  `missing_api_key` outcome, with the confirm-step switch right there
  to fall back to Grok in the meantime.
- `MINIMAX_GROUP_ID` (optional) — only some MiniMax accounts still ask
  for a `Group-Id` header; sent only when this is set. Confirmed
  against the original Skidmarks repo's own `.env.example`, not
  invented here — `HAILUO_API_KEY` (that repo's own fallback key name)
  is deliberately **not** reproduced in this app; `MINIMAX_API_KEY` is
  the one name this app checks.
- `COMFY_CLOUD_API_KEY` — required for **Vocal**/lip-sync clip video
  render only (`app/api/skidmarks/generate-clip/route.ts`'s Comfy/LTX
  branch, `lib/comfyCloud.ts`). Create at platform.comfy.org (an active
  Comfy Cloud subscription is required to run workflows via this API).
  Sent as the `X-API-Key` header only. It is **not** forwarded a second
  time in `extra_data.api_key_comfy_org` — that second copy is a Comfy
  *partner node* requirement, and the LTX 2.3 graph this app submits
  has no partner nodes.
  Missing it never blocks an Instrumental clip on either backend
  (H3/Grok, above) — only Vocal renders get this key's own honest
  `missing_api_key` outcome.
- `COMFY_URL` (optional) — leave unset/blank to use Comfy Cloud's own
  hosted endpoint (the common case); set it to point at a self-hosted/
  serverless ComfyUI instance instead.
- `COMFY_CLOUD_API_KEY`/`COMFY_URL` are the **only two** Comfy-related
  env vars — confirmed against the original Skidmarks repo's own
  `.env.example`, not invented here. No model-override var (the whole
  model/sampler/LoRA stack lives in the verified
  `workflow/LTX_2.3_IA2V_Cloud.json` template, imported as a TS JSON
  module — never read off disk with `fs`, which is fragile on Vercel)
  and no "workflow id"/deployment id var — this app submits the full
  workflow graph itself on each call (`POST /api/prompt`, body is just
  `{ prompt }`), unlike a deployment-id-based API. Job status is polled
  at `GET /api/jobs/{promptId}` — **plural `jobs`, not
  `/api/history/{id}`**, which is the local ComfyUI shape; there is no
  WebSocket anywhere in this path any more (a long-lived socket in a
  serverless function was never going to be reliable).
- **Never edit `workflow/LTX_2.3_IA2V_Cloud.json`.** It is copied
  byte-for-byte from the original Skidmarks repo and has 100+ real
  renders behind it. `lib/comfyCloud.ts`'s `buildLtx23Ia2vWorkflow`
  `structuredClone`s it per call and patches exactly five node inputs —
  `269` `image`, `276` `audio`, `340:319` `value` (prompt), `340:331`
  `value` (duration), `341` `filename_prefix` — and throws if any of
  those five is missing. Everything else (checkpoint, the `talkvid-3k`
  ID LoRA that holds a face through motion, samplers, VAE chain) stays
  untouched. Two things the original repo does that were deliberately
  **not** ported, both cheap to add if the first live render shows
  they're needed: it letterboxes the plate to 16:9 before upload
  (`letterboxPlateForCloudIa2v` — port it if heads get cropped or the
  shape is wrong), and it builds a specific Cloud IA2V prompt paragraph
  with a lip-sync lead line and a style lock (`buildCloudIa2vPrompt` —
  port it if lip-sync is worse than Skidmarks'). Deck sends the shot
  prompt as-is.
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
- `DATABASE_URL` (falls back to `DATABASE_URL_UNPOOLED`) — **Neon is
  now wired**, via `@neondatabase/serverless`'s HTTP driver
  (`lib/db.ts`). Backs the Skidmarks studio session store
  (`lib/skidmarksSession-server.ts`, `GET`/`PUT /api/skidmarks/
  session`) — one row, keyed by a fixed single-tenant
  `SKIDMARKS_STUDIO_OWNER_ID` (default `"stuart"`; this app has no auth
  system). Missing it never crashes — every route returns the same
  honest `configured: false` shape Blob routes already use, and
  `lib/skidmarks.ts`'s session-sync indicator shows "not saving here"
  instead of silently pretending edits are durable. The finished-song
  **archive** (`lib/skidmarksArchive.ts`) still uses Vercel Blob JSON,
  unchanged by this migration — only the live edit session moved to
  Neon.
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
