"use client";

import { useMemo, useState } from "react";
import {
  buildClipGenerationRequest,
  CAMERA_HOLD_REQUIRED_MESSAGE,
  describeClipPayload,
  estimateClipRenderCostUsd,
  estimateH3ClipRenderCostUsd,
  estimateLtxClipRenderCostUsd,
  generateSkidmarksClip,
  MAX_MOTION_PROMPT_LENGTH,
  motionPromptMovesCamera,
} from "@/lib/clipGeneration";
import { buildClipRenderFilename } from "@/lib/clipRenderBlob";
import type { PersistedClipRender } from "@/lib/clipRenders";
import { getSkidmarksCharacterLock, resolvePlateReferenceDataUrl } from "@/lib/plateGeneration";
import type { SkidmarksClipSentPayload, SkidmarksInstrumentalVideoModel, SkidmarksMember } from "@/lib/skidmarks";

const PAYLOAD_PANEL_SEEN_KEY = "the-tab:skidmarks-payload-panel-seen";

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Audit Part 4's panel — every field the brief lists, from the record,
 * never from an assumption. His own text is highlighted; app text is
 * the dim remainder. */
function SentPayloadPanel({ payload }: { payload: SkidmarksClipSentPayload }) {
  const userIndex = payload.userText ? payload.prompt.indexOf(payload.userText) : -1;
  const before = userIndex > 0 ? payload.prompt.slice(0, userIndex) : "";
  const after = userIndex >= 0 ? payload.prompt.slice(userIndex + payload.userText.length) : payload.prompt;
  return (
    <div className="mt-2 flex flex-col gap-2 text-[11px] leading-relaxed">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-white/60">
        <dt className="text-white/40">Engine</dt>
        <dd>{payload.engine}</dd>
        <dt className="text-white/40">Duration</dt>
        <dd>{payload.durationSec}s (what the engine is asked for)</dd>
        <dt className="text-white/40">Start image</dt>
        <dd className="min-w-0">
          {payload.startImageUrl ? (
            <span className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- Blob/data URL thumbnail */}
              <img src={payload.startImageUrl} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
              <span className="truncate text-white/40">{payload.startImageUrl}</span>
            </span>
          ) : (
            <span className="text-rose-300/90">none yet</span>
          )}
        </dd>
        <dt className="text-white/40">End image</dt>
        <dd className="font-semibold text-white/70">NONE</dd>
        {typeof payload.audioStartSec === "number" && typeof payload.audioEndSec === "number" && (
          <>
            <dt className="text-white/40">Audio slice</dt>
            <dd>
              {formatClock(payload.audioStartSec)} \u2013 {formatClock(payload.audioEndSec)}
            </dd>
          </>
        )}
      </dl>
      <div>
        <p className="text-white/40">Positive prompt <span className="text-amber-200/80">(your text)</span> + <span className="text-white/35">(app text)</span></p>
        <p className="mt-1 whitespace-pre-wrap break-words">
          {userIndex >= 0 ? (
            <>
              <span className="text-white/35">{before}</span>
              <span className="text-amber-200/90">{payload.userText}</span>
              <span className="text-white/35">{after}</span>
            </>
          ) : (
            <span className="text-white/35">{payload.prompt}</span>
          )}
        </p>
      </div>
      <div>
        <p className="text-white/40">Negative prompt</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-white/35">{payload.negativePrompt || "(none for this engine)"}</p>
      </div>
    </div>
  );
}

interface SkidmarksClipRenderProps {
  /** The clip's shared shot-prompt text — same field
   * `SkidmarksClipStub`'s textarea edits; this control reads it, it
   * doesn't add a second prompt field. */
  shotPrompt: string;
  bandName: string;
  /** The *selected* plate's still, and nothing else — `null` when no
   * plate on this clip is filled yet, in which case this component
   * renders nothing at all (see this module's doc comment). */
  plateStillDataUrl: string | null;
  /** This plate's own stored camera-motion text — lifted to the store
   * (`SkidmarksClipSegment.plates[].motionPrompt`) rather than local
   * component state, so switching which plate is selected doesn't lose
   * or mix up each plate's own motion direction. */
  motionPrompt: string;
  onSetMotionPrompt: (value: string) => void;
  /** What this plate's last render actually sent, if any — shown as
   * "What was sent" (audit Part 4). */
  lastSent?: SkidmarksClipSentPayload;
  /** Called with the exact payload right before the real render call. */
  onSent: (sent: SkidmarksClipSentPayload) => void;
  /** This plate's real, auto-computed render length — see
   * `lib/clipGeneration.ts`'s `computePlateDurationSec`/
   * `computeLtxPlateDurationSec`. */
  durationSec: number;
  /** `true` routes this render to Comfy Cloud's LTX-2.5 `AudioToVideo`
   * node instead of xAI Grok — the same `vocal` boolean
   * `SkidmarksClipStub` already derives from the clip's own label, not
   * a separate control. Drives the duration range, cost estimate, and
   * whether `mp3AudioUrl` is required before Render can even be
   * confirmed. See `lib/clipGeneration.ts`'s module doc comment. */
  vocal: boolean;
  /** Only meaningful when `vocal` is `false` — this clip's own resolved
   * H3/Grok choice (`lib/skidmarks.ts`'s `resolveInstrumentalVideoModel`,
   * already defaulted to `"h3"` by the caller — this component never
   * re-derives the default itself, it just renders whatever's given
   * and reports a change). Ignored on the Vocal path; that path always
   * means Comfy Cloud LTX, no switch. */
  instrumentalVideoModel: SkidmarksInstrumentalVideoModel;
  /** The H3/Grok switch inside the confirm step below — see this
   * component's doc comment. No-ops visually on the Vocal path (the
   * switch never renders there at all). */
  onSetInstrumentalVideoModel: (model: SkidmarksInstrumentalVideoModel) => void;
  /** The resolved vocalist for this clip's band, if any — forwarded to
   * `buildClipGenerationRequest` on the Vocal path only, so a locked
   * character's (Jack Ash today) hallmarks carry into the video prompt
   * the same way they already do for stills. */
  vocalist?: SkidmarksMember;
  /** The attached song's own durable Blob URL — required on the Vocal
   * path (Comfy Cloud slices a real window of it server-side); Render
   * stays disabled with an honest reason until it's set. Unused on the
   * Instrumental/Grok path. */
  mp3AudioUrl?: string;
  /** True when a *different* plate anywhere on this timeline is
   * currently rendering — Stuart's cost lock ("one render at a time"),
   * enforced across the whole timeline by `SkidmarksClipTimeline`, not
   * just within one clip's own panel. */
  locked: boolean;
  /** Report which plate is starting/finishing a render — lets the
   * timeline lock every *other* plate for "one render at a time"
   * without having to re-derive which plate is currently selected on
   * its own (see `components/SkidmarksClipTimeline.tsx`'s `renderKey`). */
  onRenderStart: (plateId: string) => void;
  onRenderEnd: (plateId: string) => void;
  segmentId: string;
  plateId: string;
  /** This plate's 0-based position within its own clip's strip, and
   * that strip's total slot count — used only to letter the persisted
   * filename once a clip has more than one plate. */
  plateIndex: number;
  plateCount: number;
  clipIndex: number;
  startSec: number;
  endSec: number;
  /** Whether this exact plate already has a saved render, from an
   * earlier session or an earlier tap — drives a tiny inline status
   * line only; the actual player/download now lives in
   * `SkidmarksRenderedClipsShelf`, not here (per the "declutter the
   * pink button" ask). */
  alreadyRendered: boolean;
  onPersisted: (render: PersistedClipRender) => void;
}

function Spinner() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4 animate-spin text-white/80">
      <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.6" opacity="0.25" />
      <path d="M18.5 10a8.5 8.5 0 0 0-8.5-8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The real, opt-in per-plate clip *video* render control — see
 * `app/api/skidmarks/generate-clip/route.ts`'s module doc comment for
 * the full server-side contract of **all three** backends this now
 * calls: Comfy Cloud's LTX-2.5 `AudioToVideo` node
 * (`COMFY_CLOUD_API_KEY`, Vocal clips, unchanged, no switch), MiniMax
 * H3 (`MINIMAX_API_KEY`, Instrumental clips, the new default), or
 * xAI's Grok Imagine video API (`XAI_API_KEY`, Instrumental clips,
 * still fully wired one tap away). Vocal vs. Instrumental is chosen
 * automatically by this component's own `vocal` prop, same as before;
 * **H3 vs. Grok, on an Instrumental clip, is the one real switch this
 * component exposes** — a small two-way toggle rendered permanently
 * *beside* the Render button (never a persistent pill/badge on the
 * plate tile itself, per AGENTS.md's "no model picker" lock).
 * **Relocated 2026-09-14** on Stuart's direct follow-up: it originally
 * lived only inside the two-tap confirm step, which he reported as
 * effectively buried — "not buried only in a hard-to-find confirm...
 * prefer visible beside the button." It's the same field
 * (`SkidmarksClipSegment.instrumentalVideoModel`), just moved so it's
 * visible the moment the clip's expanded, not only after Render's
 * already been tapped once. On a **Vocal** clip the equivalent left-
 * hand control is a plain **LTX** label, not a switch — there's only
 * ever one real Vocal backend (Comfy Cloud's LTX 2.3 IA2V graph), and
 * this app never invents a fake second option just to mirror the
 * Instrumental switch's shape. Deliberately **not** the old whole-song
 * "Generate Clips" button (removed entirely, see
 * `SkidmarksClipTimeline`'s doc comment) — this animates exactly one
 * already-selected plate at a time. **One-tap Render (2026-09-14,
 * Stuart's direct ask)** — the old two-tap confirm step (a "Confirm —
 * real xAI video call, ~$0.4x" second button) is gone; tapping "Render
 * plate" starts the real, paid call immediately. Still disabled (never
 * a silent no-op) while `locked` or `missingAudio`, and still just one
 * render at a time across the whole timeline.
 *
 * **Vocal plates need real audio, not just a text prompt.** When
 * `vocal` is true, Render stays disabled (with an honest inline
 * reason, never a silent no-op) until `mp3AudioUrl` is set — Comfy
 * Cloud's LTX node is driven by a real slice of the attached song's
 * vocal performance, sliced server-side from that durable Blob URL
 * (`lib/mp3Slice.ts`); there's no automatic push-in/zoom fallback the
 * way the Instrumental/Grok path has.
 *
 * **Per-plate select rework**: this used to animate *every* plate on a
 * clip's strip at once (multi-reference continuity in one xAI call).
 * It now always animates just the one **selected** plate
 * (`lib/skidmarks.ts`'s `resolveSelectedPlateId`), using only that
 * plate's own still as the image-to-video source and only that plate's
 * own stored motion text — continuity across a clip's several plates
 * (door → keyhole → Jack) now comes from rendering each separately with
 * its own motion, then editing them together in Resolve. **Renders
 * nothing at all until the selected plate has a real still** — same
 * "no clutter before there's something to animate" rule as before, just
 * scoped to one plate now instead of the whole strip.
 *
 * **Real, auto-computed duration** — `durationSec` (`segmentLengthSec /
 * plateCount`, clamped to Grok's real 5–15s ceiling on an Instrumental
 * clip via `computePlateDurationSec`, or Comfy/LTX's real 5–15s
 * ceiling on a Vocal one via `computeLtxPlateDurationSec` — see
 * `lib/clipGeneration.ts`'s module doc comment's "History of this
 * ceiling" note for the full story) is shown,
 * alongside a real per-render dollar estimate for whichever backend
 * this render actually calls, in the confirm step; nothing here lets
 * Stuart type a duration in — it's derived, not a picker, per
 * AGENTS.md's "no duration/resolution knob in the UI" lock.
 *
 * **One-tap Render**: tapping "Render plate" fires the real request
 * immediately — no second confirm step. **One render at a time across
 * the whole timeline**: `locked` disables this control while any other
 * plate's render is in flight.
 *
 * **The result no longer renders inline here** — a successful render's
 * player/download link now lives in the page-bottom
 * `SkidmarksRenderedClipsShelf` (per the "declutter — move players off
 * the pink button" ask); this panel only shows a small "Rendered ✓"
 * status line, never a `<video>`.
 */
export function SkidmarksClipRender({
  shotPrompt,
  bandName,
  plateStillDataUrl,
  motionPrompt,
  onSetMotionPrompt,
  lastSent,
  onSent,
  durationSec,
  vocal,
  instrumentalVideoModel,
  onSetInstrumentalVideoModel,
  vocalist,
  mp3AudioUrl,
  locked,
  onRenderStart,
  onRenderEnd,
  segmentId,
  plateId,
  plateIndex,
  plateCount,
  clipIndex,
  startSec,
  endSec,
  alreadyRendered,
  onPersisted,
}: SkidmarksClipRenderProps) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** True only for the "xAI succeeded (Stuart was charged) but the save
   * step afterward failed" case — a real live-QA'd risk of a *silent*
   * paid loss if this ever looked like an ordinary dismissible error.
   * Drives a distinctly bordered/backgrounded alert box instead of the
   * plain text line every other error here uses, so a paid-but-unsaved
   * render is impossible to miss or mistake for a free validation
   * error. */
  const [paidButNotSaved, setPaidButNotSaved] = useState(false);
  const [justPersisted, setJustPersisted] = useState(false);
  /** Audit Part 4: "Do not send until he can open that once. After he
   * trusts it, collapse it." Once the payload panel has been opened on
   * this phone, Render is live and the panel starts collapsed. A
   * per-viewer convenience only, so `localStorage` is right for it;
   * every read/write is guarded (private mode, blocked storage). */
  const [payloadSeen, setPayloadSeen] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(PAYLOAD_PANEL_SEEN_KEY) === "1";
    } catch {
      return true; // no storage at all — never block Render on it
    }
  });
  const markPayloadSeen = () => {
    setPayloadSeen(true);
    try {
      window.localStorage.setItem(PAYLOAD_PANEL_SEEN_KEY, "1");
    } catch {
      // Private mode / storage blocked — the in-memory flag still unlocks Render.
    }
  };

  // Same builder the real render uses, on the same inputs — the preview
  // can't drift from what's sent. `plateStillDataUrl` is only carried,
  // never read, for the prompt text itself.
  const promptPreview = useMemo(() => {
    const request = buildClipGenerationRequest({
      shotPrompt,
      bandName,
      plateStillDataUrl: plateStillDataUrl ?? "",
      motionPrompt,
      durationSec,
      vocal,
      instrumentalVideoModel,
      vocalist,
      mp3AudioUrl,
    });
    return describeClipPayload(request, plateStillDataUrl ?? "", motionPrompt);
  }, [shotPrompt, bandName, plateStillDataUrl, motionPrompt, durationSec, vocal, instrumentalVideoModel, vocalist, mp3AudioUrl]);

  if (!plateStillDataUrl) return null;

  const estimatedCost = vocal
    ? estimateLtxClipRenderCostUsd(durationSec)
    : instrumentalVideoModel === "h3"
      ? estimateH3ClipRenderCostUsd(durationSec)
      : estimateClipRenderCostUsd(durationSec, 1);
  // Carried-forward directive: never let Render fire (even the
  // confirm step) on a Vocal plate with no real durable audio to
  // slice \u2014 an honest, disabled state instead of a request the
  // server would have to reject anyway.
  const missingAudio = vocal && !mp3AudioUrl;
  // Said up front, before the paid tap — `buildClipGenerationRequest`
  // makes the same call and swaps the motion note for a static camera
  // (audit Rule B: no zoom/push-in/orbit/pan while he sings).
  const cameraHoldRequired =
    vocal && !!vocalist && !!getSkidmarksCharacterLock(vocalist) && motionPromptMovesCamera(motionPrompt);

  const handleRender = async () => {
    if (locked || generating || missingAudio || !payloadSeen) return;
    const trimmedPrompt = shotPrompt.trim();
    if (!trimmedPrompt) {
      setError("Add a shot prompt first — Render needs something to go on.");
      return;
    }
    setGenerating(true);
    setError(null);
    setPaidButNotSaved(false);
    setJustPersisted(false);
    onRenderStart(plateId);
    try {
      // `plateStillDataUrl` is a real Blob URL as of 2026-09-14 (`lib/
      // plateStillBlob.ts`) rather than a base64 `data:` URL — this
      // route (like xAI's/Siray's) only accepts a real `data:` URL as a
      // reference image, so resolve it first (a fast no-op for a still
      // saved before that change, still a literal `data:` URL).
      const resolvedStillDataUrl = await resolvePlateReferenceDataUrl(plateStillDataUrl);
      const request = buildClipGenerationRequest({
        shotPrompt: trimmedPrompt,
        bandName,
        plateStillDataUrl: resolvedStillDataUrl,
        motionPrompt,
        durationSec,
        vocal,
        instrumentalVideoModel,
        vocalist,
        mp3AudioUrl,
        segmentId,
        plateId,
        plateIndex,
        plateCount,
        clipIndex,
        startSec,
        endSec,
      });
      // Audit Part 4: log exactly what is going out, on the plate, so a
      // finished clip can show "What was sent" and fifty-six renders
      // can be compared by start image. Recorded with the plate's own
      // URL (never the resolved bytes).
      onSent(describeClipPayload(request, plateStillDataUrl, motionPrompt));
      const outcome = await generateSkidmarksClip(request);
      if (outcome.ok) {
        if (outcome.persisted) {
          const filename = buildClipRenderFilename(
            clipIndex,
            startSec,
            endSec,
            plateCount > 1 ? plateIndex : undefined
          );
          onPersisted({
            segmentId,
            plateId,
            url: outcome.videoUrl,
            filename,
            clipIndex,
            startSec,
            endSec,
            ...(outcome.lastFrameUrl ? { lastFrameUrl: outcome.lastFrameUrl } : {}),
          });
          setJustPersisted(true);
        } else {
          // Real money was already spent on this render (xAI itself
          // succeeded) — this can never read like an ordinary, free
          // validation error. See `paidButNotSaved`'s doc comment.
          setPaidButNotSaved(true);
          setError(
            outcome.persistError
              ? `The render finished and you were charged (~$${estimatedCost.toFixed(2)}), but saving it failed: ${outcome.persistError} It won't show up in the shelf below or survive a refresh unless you try again.`
              : `The render finished and you were charged (~$${estimatedCost.toFixed(2)}), but it wasn't saved this time. It won't show up in the shelf below or survive a refresh.`
          );
        }
      } else {
        setError(outcome.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not render this plate.");
    } finally {
      setGenerating(false);
      onRenderEnd(plateId);
    }
  };

  const showsAsRendered = alreadyRendered || justPersisted;

  return (
    <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-white/35">
          Render — real, opt-in
        </span>
        {showsAsRendered && !generating && (
          <span className="text-[10px] font-medium text-emerald-300/80">
            {"\u2713"} Rendered — see below
          </span>
        )}
      </div>

      {!generating && (
        <textarea
          value={motionPrompt}
          onChange={(e) => onSetMotionPrompt(e.target.value)}
          placeholder="Camera motion for this plate (optional) — e.g. slow zoom into keyhole, mild pulse on door cracks"
          maxLength={MAX_MOTION_PROMPT_LENGTH}
          rows={2}
          aria-label="Camera motion for this plate"
          className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] leading-relaxed text-white placeholder:text-white/30 focus:border-rose-400/40 focus:outline-none"
        />
      )}

      {!generating && (
        <p className="-mt-1 text-right text-[10px] text-white/35" aria-live="polite">
          {motionPrompt.length}/{MAX_MOTION_PROMPT_LENGTH}
        </p>
      )}

      {!generating && cameraHoldRequired && (
        <p role="status" className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-[10px] leading-snug text-amber-100/90">
          {CAMERA_HOLD_REQUIRED_MESSAGE}
        </p>
      )}

      {!generating && (
        // Audit Part 4: the exact payload, from the same builder the
        // render uses. Open by default until it has been opened once on
        // this phone; Render stays disabled until then.
        <details
          open={!payloadSeen}
          onToggle={(e) => {
            if ((e.currentTarget as HTMLDetailsElement).open) markPayloadSeen();
          }}
          className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
        >
          <summary className="cursor-pointer select-none text-[11px] font-medium text-white/50">
            Prompt {promptPreview.engine} will get{payloadSeen ? "" : " — open this once before Render"}
          </summary>
          <SentPayloadPanel payload={promptPreview} />
        </details>
      )}

      {!generating && lastSent && (
        <details className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
          <summary className="cursor-pointer select-none text-[11px] font-medium text-white/50">
            What was sent — {lastSent.engine}, {new Date(lastSent.sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </summary>
          <SentPayloadPanel payload={lastSent} />
        </details>
      )}

      {!generating && (
        <div className="flex items-center justify-between gap-2">
          {vocal ? (
            // Vocal only ever has one real backend (Comfy Cloud LTX,
            // lip-sync) — a plain label, never a fake second option
            // just to mirror the Instrumental switch's shape. See this
            // component's doc comment.
            <span
              aria-label="Vocal render backend: LTX lip-sync"
              className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-center text-[11px] font-semibold text-white/70"
            >
              LTX
            </span>
          ) : (
            // Streamlined (2026-09-14, Stuart's direct "too big... nice
            // streamline buttons" ask, after the roomier 36px version
            // below) but deliberately stops at ~32px, not smaller — a
            // *different* PR (Cursor's, rejected — see AGENTS.md/this
            // file's git history) shrunk this same switch to 24px with a
            // 2px gap and Stuart hated the result just as much, on a
            // control that picks a paid video backend. `min-h-[32px]`
            // plus a real `gap-1.5` between the two buttons is the
            // narrower-but-still-safe middle Stuart actually wants — see
            // `components/SkidmarksClipStub.tsx`'s
            // `SkidmarksPlateSelectControl` doc comment for the original
            // ~40px touch-target lesson this is still respecting.
            <div
              role="group"
              aria-label="Instrumental render backend"
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.04] p-1 text-[11px] font-medium"
            >
              {(["h3", "grok"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onSetInstrumentalVideoModel(option)}
                  aria-pressed={instrumentalVideoModel === option}
                  className={[
                    "min-h-[32px] rounded-full px-3 py-1.5 transition-colors",
                    instrumentalVideoModel === option
                      ? "bg-rose-400 text-zinc-950"
                      : "text-white/50 hover:text-white/80",
                  ].join(" ")}
                >
                  {option === "h3" ? "H3" : "Grok"}
                </button>
              ))}
            </div>
          )}

          {/* One-tap Render (2026-09-14, Stuart's direct ask) — this
              used to be the first of a two-tap confirm ("Render plate"
              then "Confirm — real ... call, ~$X.XX"), now fires the real
              request immediately. "About half width" per Stuart's
              earlier explicit ask — the switch/pill to its left takes
              the rest of the row instead of this button spanning
              edge-to-edge. */}
          <button
            type="button"
            onClick={handleRender}
            disabled={locked || missingAudio || !payloadSeen}
            aria-disabled={locked || missingAudio || !payloadSeen}
            title={!payloadSeen ? "Open the \u201cPrompt … will get\u201d panel once first" : undefined}
            className={[
              "w-1/2 rounded-full px-3.5 py-2 text-center text-[12px] font-semibold transition-colors",
              locked || missingAudio || !payloadSeen
                ? "cursor-not-allowed bg-white/[0.04] text-white/30"
                : "bg-rose-400 text-zinc-950 hover:bg-rose-300 active:bg-rose-400/85",
            ].join(" ")}
          >
            {showsAsRendered ? "Render plate again" : "Render plate"}
          </button>
        </div>
      )}

      {generating && (
        <div className="flex items-center justify-center gap-2 rounded-full bg-white/[0.04] px-4 py-2.5 text-[12px] font-medium text-white/70">
          <Spinner />
          {"Rendering… this can take a minute or two."}
        </div>
      )}

      {locked && !generating && (
        <p className="text-[10px] leading-snug text-white/35">
          Only one plate renders at a time — finish the other one first.
        </p>
      )}

      {missingAudio && !locked && !generating && (
        <p className="text-[10px] leading-snug text-white/35">
          {"Waiting on the attached MP3\u2019s audio to finish uploading \u2014 this Vocal plate\u2019s render needs a real slice of the song, not just a text prompt."}
        </p>
      )}

      {error && paidButNotSaved && (
        <p
          role="alert"
          className="rounded-lg border border-rose-400/40 bg-rose-400/10 p-2 text-[11px] font-medium leading-snug text-rose-200"
        >
          {error}
        </p>
      )}
      {error && !paidButNotSaved && (
        <p role="alert" className="text-[11px] leading-snug text-rose-300/90">
          {error}
        </p>
      )}
    </div>
  );
}
