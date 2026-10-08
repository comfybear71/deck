# Stage — director board

Phase 1 of the `/stage-lab` sandbox is built. **Nothing in Sunny Banks, Skidmarks, Music video, or Shorts changes.** Stage does not live inside those screens. Merging it in is a later decision, and only after Stuart has used the sandbox and said yes.

Related work already in flight (do not duplicate): [PR #261](https://github.com/comfybear71/deck/pull/261) (script-box place, scene bars, `#N` badges, Chain no longer copies Cast, `[Duration: Ns]` + length picker). Stage builds on that shape later. It does not patch those files now.

---

## For Stuart (plain English)

You asked to work like a director: see the actors, the set, what they do, what they say, the camera, the length, then a still you can approve before paying for video.

**Stage lab** is a separate test page, not a new mode of Shorts or Sunny Banks. After this lands you open it yourself at **`/stage-lab`**. There is no button for it on the four genre screens, on purpose — tapping around an episode cannot wander into it, and tapping around Stage cannot rewrite an episode.

On the lab you:

1. Pick the **set** (a Location picture).
2. Tap who is **on stage** (Arthur, Dennis, Mira, Pip, House on Deliciae — no droid). Only people you tick are in the shot. House is an Object, not a made-up human face, and needs no Cast picture. Names in an action sentence do not secretly add extra bodies.
3. Give each ticked actor their **action**. Give the speaker their **line** (blank = silent).
4. Pick **camera move** and **framing**, and **how long**.
5. Choose **start**: a fresh plate from the real Cast + Location pictures, or **chain** from a previous shot’s last frame (chain only copies the picture, never who is in the shot).
6. **See a still first.** Approve it. **Render** that one shot is Phase 2 on this page (button shows the dollar amount, stays disabled). Never a batch, never a surprise.

The long God Script box stays the way episodes work today. Stage can **show** the same shot as God Script text (export / import later). Old episodes keep opening as they do now.

**Phase 1** is this sandbox only. Your current episodes are not the guinea pig. If the lab is wrong, it is wrong in the lab.

---

## 1. What already exists (reuse, don’t rebuild)

| Piece | Where it already lives | Stage’s job |
|---|---|---|
| Cast cards + pictures | `CharacterRosterGrid`, `lib/characterRoster.ts`, `lib/sunnyBanksVoices.ts` | Read-only copy of name, picture, kind, voice. Never edit a card from the lab. |
| Person / Animal / Object | `lib/castKind.ts` (Pip = Animal, House = Object) | Object/Animal never go down the LTX “human face talks” path. |
| Locations + stills | `LocationsRow`, `lib/sunnyBanksLocations.ts`, `lib/deckLocations.ts` | Read-only set picker. Honour “People already in this picture”. |
| Who is in a shot | `lib/shotCast.ts` `resolveShotCast` | **Do not use the “names in `[Action:]` auto-tick” path on Stage.** Stage’s ticks *are* the cast list (same as an explicit `[Cast: A, B]`). |
| Plate still (~$0.02 Grok / ~$0.04 Siray) | `generate-still`, `lib/sunnyBanksComposite.ts`, `lib/autoPlate.ts` `ESTIMATED_STILL_COST_USD` | Phase 1 Make plate on `/stage-lab` calls the real Grok still route. |
| Chain last frame → first | `lib/chainLastFrame.ts`, `lib/extractLastFrame.ts`, per-row **Chain from shot N** (PR #258 / #261) | Same rule: chain is a start frame, not a Cast copy. |
| Video engines | `lib/videoBackendRouting.ts` | Talking **person** → LTX. Silent → Grok (or H3 / Siray where that show already offers them). Object “voice” (House) → **not LTX**. |
| Length + cost | `lib/clipGeneration.ts` (`MIN/MAX_CLIP_DURATION_SEC` 5–15, `estimateRowVideoCostUsd`). PR #261 `[Duration: Ns]` | Same picker and same numbers on the Render button. |
| Camera / framing words | `lib/sirayPositions.ts` (`SIRAY_17_POSITIONS`: wide, MCU, CU, OTS, low…). `lib/clipGeneration.ts` `CAMERA_MOVE_RE` + “Camera holds” | Stage pickers **reuse these words**, not a new vocabulary. Talking person: force **Hold + MCU/CU**. |
| Gold Speak / Hold prompts | `buildSunnyBanksSpeakingPrompt` / `buildSunnyBanksHoldPrompt` / `buildLtxSpeakingCore` | Append camera + per-actor action after gold. Do not rewrite gold. |
| Shot tiles | `components/ShotGrid.tsx` (2-up grid) | Lab uses a **per-scene strip** (phone-first, same `w-44` / `h-28` / `touch-pan-x` idea as the Clips shelf), not the 2-up grid as the main board. |
| God Script → rows | `parseSunnyBanksScriptBlock` in `components/SkidmarksSunnyBanksPanel.tsx`; Music video: `lib/scriptSequence.ts` + `SkidmarksScriptSequencePanel` | Import/export only, later. Not the Stage working view. |
| Saving episodes | Neon session + `deck_items` via `lib/deckItemSync.ts` | **Lab never writes these.** Own store (below). |
| Confirm + one-at-a-time | Existing Render this / `runningKind` lock | Lab keeps one paid tap per shot, cost on the button. |

God Script pipeline today (unchanged):

1. Text in the Script card (`=== ACT/SCENE ===`, `[Location:]`, `[Character X:]`, `[Action:]`, `[Cast:]`, `Name: line` or `Name:` empty = silent).
2. `parseSunnyBanksScriptBlock` → chunks → numbered queue rows.
3. `resolveShotCast` decides who is in frame (this is where Action-text names get ticked — a real pain point).
4. Make plate composites Location + Cast pictures (`lib/sunnyBanksComposite.ts`).
5. Render this → `/api/skidmarks/sunnybank/generate-speak-beat` (or Music video `generate-clip`), engine from `pickRowVideoBackend`.

Stage does not hook that pipeline in Phase 1.

---

## 2. Shot card (data model)

One card = one shot. This is the lab’s source of truth.

```ts
type StageStartMode = "plate" | "chain";

type StageCameraMove =
  | "hold"        // static / camera holds
  | "push-in"     // zoom / push-in
  | "pull-back"
  | "pan"
  | "tracking"    // follow-behind
  | "dutch";      // tilt

type StageFraming =
  | "cu"          // close-up (Siray “Front CU” / mouth-on)
  | "mcu"         // medium close-up, chest-up, mouth readable
  | "medium"
  | "wide"
  | "ots"         // over-the-shoulder (Siray 16)
  | "low"
  | "high";

interface StageActor {
  id: string;           // Cast card id
  name: string;
  kind: "person" | "animal" | "object";
  pictureUrl: string | null;
  voiceId: string | null;
  present: boolean;     // ticked onto the stage
  action: string;       // what they do this shot
  look: string;         // optional look/pose override
}

interface StageShot {
  id: string;
  number: number;       // 1-based, same idea as God Script #N
  sceneId: string;
  sceneLabel: string;   // "ACT I — KITCHEN"
  locationId: string | null;
  actors: StageActor[];
  speakerId: string | null;  // who has the line; null = silent
  line: string;              // empty = silent
  cameraMove: StageCameraMove;
  framing: StageFraming;
  durationSec: number;       // clamped 5–15
  startMode: StageStartMode;
  chainFromNumber: number | null;
  plateUrl: string | null;
  plateStatus: "empty" | "making" | "ready" | "failed";
  approved: boolean;         // still signed off
  renderStatus: "idle" | "rendering" | "done" | "failed";
  renderUrl: string | null;
  videoBackend: "ltx" | "grok" | "h3" | "siray";
}
```

Rules baked into the card, not left as prompt folklore:

- **Present actors** = the only Cast pictures sent. Unticked = not in the request, even if named in the action text.
- **Speaker + non-empty line** + speaker `kind === "person"` + they have a voice → LTX, and the UI **locks** camera to `hold` and framing to `mcu` (or `cu`). Unlocking that is a later ask.
- **Object / Animal** never selects LTX, even with a line. House greets Arthur on **Grok** (picture of the speaker + optional muxed voice later). No lip-sync face is invented.
- **Chain** fills `plateUrl` from shot N’s last frame when that shot is done. It does not copy that shot’s actor ticks or location.
- **`approved`** is false until there is a still and Stuart taps Approve. Render stays disabled until then.
- Max 4 present actors (existing `MAX_SHOT_CAST` / xAI 5-image cap: 1 place + 4 people).

---

## 3. How a card becomes a prompt + pictures

Visible **prompt preview** on the card. Same string the engine would get.

**Images**

1. Start image: Location still if `startMode === "plate"`, or chained last frame if `chain`. Never a blank white canvas — refuse Make plate / Render if there is no Location picture (and no chain frame).
2. Then one Cast picture per **ticked** actor, in tick order, main picture only. Skip anyone without a picture and refuse with `missing_cast_picture` before billing (existing rule).
3. Location ticked “People already in this picture”: send the place only, no Cast overlay.

**Text** (gold stays gold)

- Talking person: `buildLtxSpeakingCore` / `buildSunnyBanksSpeakingPrompt` + per-actor action lines + locked “Camera holds. MCU, mouth readable.” + show style lock.
- Silent: `buildSunnyBanksHoldPrompt` with the shot’s `[Action:]`-equivalent (joined actor actions + camera move + framing). Do not add “holds their pose” when the action is a walk (existing 2026-10-01 rule).
- Object/Animal with a line: Grok motion prompt describes the **object** doing the action (House’s ring pulses). Never “a man speaks”. Subject word from `subjectWordForCastKind`.

**Engines** (existing `pickRowVideoBackend`, plus the object exception)

| Shot | Engine | Length |
|---|---|---|
| Person talks | LTX | Voice length; pad only if Duration tag is longer (PR #261) |
| Silent | Grok default (H3 / Siray only where that show already offers them) | Picker 5 / 8 / 10 / 12 / 15s |
| Object/Animal “talks” | Grok, not LTX | Picker; voice mux is a later slice if Stuart wants House’s line heard |

Cost on the button from `estimateRowVideoCostUsd` at that length. Make plate shows ~$0.02 / ~$0.04. Render never fires without Approve.

---

## 4. Round-trip with God Script (later, not Phase 1)

Old episodes must keep opening in today’s Script card. Stage must not require a migration.

**Export (card → text)** — same tags the parser already understands. No new tag that an old page would read aloud.

```
=== ACT I — SCENE 1 — KITCHEN ===
[Location: kitchen]
[Cast: House, Arthur]
[Character House: cyan to violet pulsing ring]
[Action: House greets Arthur from the wall speaker. Camera holds. Medium close-up.]
[Duration: 5s]
House: Good morning, Arthur.
```

Camera + framing fold into `[Action:]`. Length uses PR #261 `[Duration: Ns]`. Actors use `[Cast:]` so Action names cannot re-tick extras.

**Import (text → cards)** — `parseSunnyBanksScriptBlock`, then:

- Location / Duration / line / speaker as today.
- Present actors = `[Cast:]` if present, else speaker only. **Ignore `shot-text` name matches** on import into Stage so “Arthur walks to the table” does not add a second Arthur, and “House” in an action does not mint a person.
- Chain is not in the text; it stays a card toggle.

Phase 1 does **not** import live episodes. A later merge (after OK) can add “Open this episode on Stage” as an explicit tap.

---

## 5. Same UI later — four genres, one lab now

When (if) Stuart OKs a merge, the Shot card UI is shared. Each genre only supplies Cast, Locations, style lock, and which silent engines it offers. That is the same split `lib/studioGenre.ts` already uses.

Until then:

- `/stage-lab` is the only Stage UI.
- Sunny Banks / Skidmarks / Music video / Shorts **do not import it, link it, or save into it.**
- The lab may **read** Cast/Location lists (Phase 1) the same way the roster already does, as a snapshot, not as a live two-way bind to the open episode.

Music video remains the awkward sibling (song parts, not God Script rows). The lab can still stage a shot; wiring it onto Script Sequence is merge-time, not Phase 1.

---

## 6. Phased build

### Phase 1 — built (this PR)

**A standalone `/stage-lab` page.** Not linked from the graph, the four genre sheets, or any episode row.

- Read-only Cast + Locations from GET session + GET `deck_items` (**without writing**).
- Own storage: `lib/stageLabStore.ts`, key `the-tab:stage-lab-v1`. **Not** `lib/skidmarks.ts` `persist()`, **not** the Neon `skidmarks_sessions` episode JSON, **not** `deck_items`, **not** `SKIDMARKS_PROTECTED_STATE_KEYS`.
- Scene strip + shot cards: set, ticked actors + per-actor action, speaker/line, camera, framing, length 5–15s, fresh plate or chain, add/reorder/delete.
- **Make plate** is a real Grok still (~$0.02) via existing `generatePlateStill`. Prompt preview lists the exact prompt and reference images. Approve is per card.
- **Chain** pulls the previous shot’s rendered last frame only (no Cast copy). Blocked on a location change. If there is no previous render, the button explains that.
- **Render** is **Phase 2**: disabled, labelled, with the dollar estimate on the button. One-shot video through Grok/LTX is not wired in this PR so a genre render route is not forked. Never batch, never auto-render.
- Isolation tests: genre panels do not reference `/stage-lab`; the lab does not call episode save/delete.

### Phase 2 — only after Stuart uses the lab and says the board is right

- Real one-shot render from the lab (same backends, same keys, same cost rules, Approve + confirm).
- Object/Animal LTX skip live-tested on House.
- Talking-person Hold + MCU lock live-tested on a paid clip.
- God Script export of the lab scene (copy/paste), not a silent overwrite of an episode.

### Phase 3 — merge into genres, **only with an explicit OK**

- Optional “Open on Stage” from an episode. Default working view for episodes stays God Script until he says otherwise.
- Round-trip import so an old episode can be staged without data loss.
- Same card on all four genres.

Do not skip to Phase 3 because the mock looks ready.

---

## 7. iPhone Safari layout (lab and, later, the real card)

- Phone first (390px). No desktop-only board. (`GraphBoard` at 768px is the graph, not this.)
- **Scene label** sticky. **Storyboard** one horizontal `touch-pan-x` strip (`w-44` / `h-28` cards, same as the Clips shelf). Vertical page scroll is the card, not the strip.
- Open Shot card under the strip. One shot at a time. 16px fields (`script-box` / `-webkit-text-size-adjust: 100%`) so Safari does not zoom on focus.
- Buttons `rounded-md`, min ~36–40px hit target (not 24px). Status chips may stay round.
- Actor chips: tap to tick; a ticked chip expands **that actor’s** action field. Do not put four always-open textareas on a 390px screen.
- Camera move + framing: compact two-row pickers, not a buried confirm.
- Plate | chain: two buttons, chain labelled **Chain from shot N**.
- Prompt preview: default-closed `<details>` so it does not bury Approve.
- Approve (free) then Render (~$x.xx). Render disabled, never a silent no-op, until approved.
- No Full-screen God Script on this page in Phase 1. Export is a collapsed text block.

---

## 8. Cost safety

- Stills cheap, labelled. Video never auto, never a whole-scene fire from the lab.
- Render shows **engine + seconds + dollars** (`estimateRowVideoCostUsd`).
- One render at a time.
- Missing Cast picture / missing Location still / unapproved still: refuse before billing.
- Lab storage cannot clobber an episode. A bug in the lab must not be able to `persist()` the session.
- Paid routes still send `x-deck-build` / `stale_page` when the lab is allowed to bill (Phase 2).
- Phase 1 Make plate is a cheap Grok still (~$0.02). Video Render is disabled until Phase 2.

---

## 9. Decisions Stuart accepted (2026-10-08)

1. **House** is an Object. Silent **Grok** shot. Voice is added in Resolve. No audio mux on this page yet. House's Cast picture is the LoRA `referenceUrl` (wall speaker), same as the Shorts strip — empty `pictureUrls` on the extra must not read as "no picture". A Cast card that truly has no picture does not block Make plate. White-void is a missing Location picture.
2. **The serving droid has not been created.** The lab must not add, seed, or show a droid / Service droid card. Deliciae Cast is that project's own strip (Arthur, Dennis, Mira, Pip, House, plus any card already on it such as Grokbot).
3. **Chain across a location change is blocked** — the user gets a fresh plate instead.
4. **`/stage-lab` is hard-locked to Deliciae** (Shorts script episode, folder `deliciae`). No project picker. No episode/act chip row. Never enumerate or display another genre's episodes (no Baby Shower, Cornish Arsehole, Influencer Influx, …). Kitchen is `arthur_kitchen`. If that folder is missing: **Deliciae not found**, no fallback.
5. **It stays a separate page** (`/stage-lab`). No links from, and no writes into, Sunny Banks, Skidmarks, Music video, or Shorts. Own storage key only (`the-tab:stage-lab-v1`).

Length picker stays 5 / 8 / 10 / 12 / 15s. Merge into genres is still not this PR.

---

## 10. What this PR is

- This document, updated for the accepted decisions.
- A **real Phase 1 lab** at **`/stage-lab`**: saved Cast/Locations read-only, own shot storage, real Make plate, Approve, chain rules, iPhone layout. Render stays Phase 2 (disabled, honest label).
- Isolation tests. WebKit iPhone 13 screenshots in the PR body.

What this PR is not: a change to God Script parsing, Cast ticking, chain, duration, or any episode save path on the four genre screens.
