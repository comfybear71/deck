"use client";

import { useState } from "react";
import {
  MAX_AUTO_PLATE_BRIEF_LENGTH,
  estimateAutoPlateCostUsd,
  planAutoPlateFill,
} from "@/lib/autoPlate";
import {
  buildPlateGenerationRequest,
  buildSirayCharacterPrompt,
  generatePlateStill,
  generatePlateStillViaSiray,
  getSkidmarksCharacterLock,
  resolvePlateReferenceDataUrl,
  resolveVocalistForPrompt,
} from "@/lib/plateGeneration";
import { uploadSkidmarksPlateStill } from "@/lib/plateStillBlob";
import {
  flushSkidmarksSessionNow,
  getSkidmarksSnapshot,
  SKIDMARKS_SEGMENT_LABEL_META,
  type SkidmarksBand,
  type SkidmarksClipSegment,
  type SkidmarksPlateStill,
} from "@/lib/skidmarks";

interface SkidmarksAutoPlateProps {
  segments: SkidmarksClipSegment[];
  band: SkidmarksBand;
  /** The attached MP3's own filename — a fallback signal (alongside the
   * brief text) for whether Stuart's scripted concrete-opener idea
   * applies; see `lib/autoPlate.ts`'s `planAutoPlateFill`. */
  songTitleHint?: string;
  onSetClipPlateStill: (segmentId: string, plateId: string, still: SkidmarksPlateStill | null) => void;
}

function Spinner() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 animate-spin text-white/80">
      <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.6" opacity="0.25" />
      <path d="M18.5 10a8.5 8.5 0 0 0-8.5-8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The slim "short brief + Auto-plate" control — see `lib/autoPlate.ts`'s
 * module doc comment for the full planning contract (pure heuristics,
 * never an LLM call against the brief, the one scripted door → keyhole
 * → Jack exception). This component owns only the *execution* half:
 * running `planAutoPlateFill`'s output through the exact same real
 * still-generation path (`lib/plateGeneration.ts`) a manual "type a shot
 * prompt, tap Generate" pass already uses, one plate at a time, in strip
 * order (so the scripted opener's "continue from the plate before it"
 * targets can reference a still this same run just produced).
 *
 * **Then stops** — no auto video render, ever; each plate this fills is
 * still just a still Stuart can inspect/enlarge/reject/regenerate
 * exactly like a manually generated one. **Cost-aware**: a plain tap
 * only reveals a count + a rough dollar estimate; a second tap actually
 * runs it, with a real "Generating N of M…" progress line while it
 * does, and an honest summary (including any real failures — e.g. no
 * `XAI_API_KEY` configured) once it's done. **Never overwrites a filled
 * plate** — `planAutoPlateFill` only ever plans for slots that are
 * still empty at the moment "Auto-plate" is tapped.
 */
export function SkidmarksAutoPlate({ segments, band, songTitleHint, onSetClipPlateStill }: SkidmarksAutoPlateProps) {
  const [brief, setBrief] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  // Raw (possibly unresolved — a `data:` URL if Stuart uploaded a
  // photo, or a seeded relative path like Jack Ash's reference.jpg)
  // — only ever used here as a "does this band have a master still at
  // all" planning signal. `handleConfirm` below resolves it to a real
  // `data:` URL once, the same way it already resolves the xAI
  // identity reference, and that resolved value — not this raw one —
  // is what actually gets sent to Siray.
  const masterStillHint = resolveVocalistForPrompt(band.members)?.avatarImage;
  const targets = planAutoPlateFill(segments, brief, band.name, songTitleHint ?? "", masterStillHint);
  const estimatedCost = estimateAutoPlateCostUsd(targets);

  const handleTap = () => {
    if (running) return;
    setSummary(null);
    if (targets.length === 0) {
      setSummary("Nothing to fill \u2014 every plate already has a still.");
      return;
    }
    setConfirming(true);
  };

  const handleConfirm = async () => {
    setConfirming(false);
    setRunning(true);
    setProgress({ done: 0, total: targets.length });

    // Resolved once, up front, rather than per-target inside the loop
    // below — the same reference photo backs every target in one run
    // (xAI's identity reference *and* Siray's ref2i reference are the
    // same underlying still), so there's nothing to gain re-resolving
    // it target by target. An already-`data:` avatarImage resolves
    // instantly; a seeded relative path (Jack Ash's reference.jpg)
    // fetches once here.
    let vocalist = resolveVocalistForPrompt(band.members);
    if (vocalist?.avatarImage) {
      try {
        const identityDataUrl = await resolvePlateReferenceDataUrl(vocalist.avatarImage);
        vocalist = { ...vocalist, avatarImage: identityDataUrl };
      } catch {
        // Best-effort identity reference — a failure here shouldn't
        // block the still generation call itself, just drop the ref
        // (and, for a Siray target, fall through to the missing-ref
        // handling below, which no-ops that target honestly).
      }
    }

    const generatedStills = new Map<string, { dataUrl: string; featuresLockedCharacter?: boolean }>();
    let successCount = 0;
    // Tracked per engine, not globally: a run can mix the scripted
    // xAI-only opener with Siray-routed fills for everything else, and
    // one engine being unconfigured (or otherwise persistently broken)
    // says nothing about whether the other one would work.
    const stoppedEngines = new Set<"xai" | "siray">();
    const stopMessages: Partial<Record<"xai" | "siray", string>> = {};

    for (const target of targets) {
      const engine: "xai" | "siray" = target.siray ? "siray" : "xai";
      if (stoppedEngines.has(engine)) {
        setProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
        continue;
      }

      const segment = segments.find((s) => s.id === target.segmentId);
      const plateIndex = segment?.plates.findIndex((p) => p.id === target.plateId) ?? -1;
      if (!segment || plateIndex < 0) {
        setProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
        continue;
      }

      // This run's `targets` were planned once, up front, off the
      // `segments` snapshot at that moment — but this loop spans
      // several real network calls, real time Stuart could spend
      // manually filling a plate himself. Re-check the *live* store
      // (not this stale `segments` prop/closure) right before writing
      // back, so a plate he already filled mid-run can never be
      // silently overwritten by this same run's own later, now-stale
      // plan for that same slot.
      const livePlate = getSkidmarksSnapshot()
        .session.mp3?.segments.find((s) => s.id === target.segmentId)
        ?.plates.find((p) => p.id === target.plateId);
      if (livePlate?.still) {
        setProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
        continue;
      }

      let outcome: Awaited<ReturnType<typeof generatePlateStill>>;
      let featuresLockedCharacter: boolean | undefined;

      if (target.siray) {
        // Live-QA fix (2026-09-13): this used to send Siray nothing but
        // the bare camera-position sentence — "Siray's ref2i model
        // keeps the reference subject on its own" turned out false in
        // practice (Stuart's report: identity drifted to "some white
        // cunt," and every shot stared straight into the lens with
        // nothing telling it not to). `buildSirayCharacterPrompt` merges
        // the same hallmark/negative-cue lock text (including the
        // no-front-stare camera rule) `buildPlateGenerationRequest`
        // already gives the xAI path, whenever the resolved vocalist has
        // one — a no-op for a member with no explicit lock. A missing/
        // failed identity reference here means there's genuinely nothing
        // to send.
        if (!vocalist?.avatarImage) {
          setProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
          continue;
        }
        // Every Siray-routed still shows this resolved vocalist by
        // design (a new camera angle of the same master-still
        // character) — so whenever they carry an explicit character
        // lock, this still genuinely features them, the same fact
        // `buildPlateGenerationRequest.featuresLockedCharacter` records
        // for the xAI path. This used to stay `undefined` for every
        // Siray target, silently dropping the lock the moment a later
        // plate continued from it via "Use last plate".
        featuresLockedCharacter = Boolean(getSkidmarksCharacterLock(vocalist));
        const sirayPrompt = buildSirayCharacterPrompt(target.shotPrompt, vocalist);
        outcome = await generatePlateStillViaSiray(sirayPrompt, vocalist.avatarImage);
      } else {
        const vocal = SKIDMARKS_SEGMENT_LABEL_META[segment.label]?.vocal ?? false;
        const previousPlateId = plateIndex > 0 ? segment.plates[plateIndex - 1].id : undefined;
        const previousGeneratedThisRun = previousPlateId ? generatedStills.get(previousPlateId) : undefined;
        const previousPersistedStill = previousPlateId ? segment.plates[plateIndex - 1].still : undefined;
        // `previousGeneratedThisRun` always holds a real `data:` URL
        // (this run's own in-memory cache, never uploaded — see below);
        // `previousPersistedStill?.dataUrl` may be a real Blob URL as of
        // 2026-09-14 (`lib/plateStillBlob.ts`), so resolve either one the
        // same way `vocalist.avatarImage` already is above — a fast
        // no-op when it's already `data:`.
        const rawContinuityStillDataUrl = target.continueFromPreviousPlate
          ? (previousGeneratedThisRun?.dataUrl ?? previousPersistedStill?.dataUrl)
          : undefined;
        let continuityStillDataUrl: string | undefined;
        if (rawContinuityStillDataUrl) {
          try {
            continuityStillDataUrl = await resolvePlateReferenceDataUrl(rawContinuityStillDataUrl);
          } catch {
            // Best-effort, same spirit as the vocalist identity
            // resolution above — drop the continuity reference rather
            // than fail this whole target over it.
          }
        }
        // Live-QA fix: only carries the locked-character lock forward
        // when the plate actually continued from *itself* already
        // featured him — see `lib/skidmarks.ts`'s `SkidmarksPlateStill
        // .featuresLockedCharacter` doc comment. Prefers this same
        // run's freshly-generated fact over a persisted still's (a
        // target this run just filled in strip order, e.g. the
        // scripted opener's door plate feeding its keyhole plate) so
        // the chain stays correct within one Auto-plate pass, not just
        // across separate sessions.
        const continuityFeaturesLockedCharacter = target.continueFromPreviousPlate
          ? (previousGeneratedThisRun?.featuresLockedCharacter ?? previousPersistedStill?.featuresLockedCharacter)
          : undefined;

        const request = buildPlateGenerationRequest({
          shotPrompt: target.shotPrompt,
          vocal,
          model: segment.model,
          bandName: band.name,
          vocalist,
          continuityStillDataUrl,
          continuityFeaturesLockedCharacter,
        });
        featuresLockedCharacter = request.featuresLockedCharacter;
        outcome = await generatePlateStill(request);
      }

      if (outcome.ok) {
        // handleConfirm only ever runs from the Confirm button's onClick
        // (see this file's bottom), never during render; this timestamps
        // a still this exact tap just generated, same as the
        // pre-existing Date.now() calls elsewhere in this feature (e.g.
        // SkidmarksClipStub.tsx) that this same rule doesn't flag on a
        // simpler call shape.
        // eslint-disable-next-line react-hooks/purity
        const createdAt = Date.now();
        // The in-memory cache below keeps the raw `data:` URL (cheap —
        // this run's own later targets may need it back as real base64
        // for continuity, and re-fetching a just-uploaded Blob URL would
        // just be wasted round trips); only the *persisted* value
        // (written via `onSetClipPlateStill`, which ends up in the Neon
        // session PUT) needs to move to Blob — see
        // `lib/plateStillBlob.ts`'s module doc comment for why. Falls
        // back to keeping the still inline this session on a Blob
        // failure rather than losing a still Stuart just paid for.
        generatedStills.set(target.plateId, { dataUrl: outcome.dataUrl, featuresLockedCharacter });
        const uploadOutcome = await uploadSkidmarksPlateStill(outcome.dataUrl);
        onSetClipPlateStill(target.segmentId, target.plateId, {
          dataUrl: uploadOutcome.ok ? uploadOutcome.url : outcome.dataUrl,
          source: "generated",
          createdAt,
          featuresLockedCharacter,
        });
        // Real live bug (2026-09-14): Stuart ran Auto-plate, then did a
        // "cold restart" shortly after, and several real plates it just
        // filled were gone on reload — consistent with those writes
        // still sitting in the session's normal 600ms-debounced save
        // when his phone/Safari actually died. Flushing after *every*
        // plate this run fills (not just once at the end) means a run
        // interrupted partway through never loses more than the one
        // still that was still mid-flight — every plate already written
        // is already durably saved by the time the next one starts.
        flushSkidmarksSessionNow();
        successCount += 1;
      } else if (outcome.unconfigured) {
        // Every remaining target on *this* engine would fail the same
        // way — stop calling it honestly, but a target on the other
        // engine (the scripted opener alongside Siray fills, say)
        // still gets its own real attempt.
        stoppedEngines.add(engine);
        stopMessages[engine] = outcome.message;
      }
      // A real (non-unconfigured) failure for one still doesn't stop
      // the rest — a transient/upstream error on one shot shouldn't
      // block every other empty plate from getting filled.

      setProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
    }

    setRunning(false);
    setProgress(null);
    const stopReasons = (Object.entries(stopMessages) as [string, string][]).map(
      ([engine, message]) => `${engine === "siray" ? "Siray" : "xAI"} isn't set up here (${message})`
    );
    if (stopReasons.length > 0) {
      const filledPart =
        successCount > 0 ? `Filled ${successCount} still${successCount === 1 ? "" : "s"}; stopped` : "Stopped";
      setSummary(`${filledPart} \u2014 ${stopReasons.join("; ")}.`);
    } else {
      const failCount = targets.length - successCount;
      setSummary(
        failCount > 0
          ? `Filled ${successCount} of ${targets.length} empty plates \u2014 ${failCount} didn't generate; try Generate on those individually.`
          : `Filled ${successCount} empty plate${successCount === 1 ? "" : "s"}.`
      );
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <label htmlFor="auto-plate-brief" className="text-[10px] font-medium uppercase tracking-wide text-white/40">
        Auto-plate from a short brief
      </label>
      <div className="flex items-center gap-2">
        <input
          id="auto-plate-brief"
          type="text"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          maxLength={MAX_AUTO_PLATE_BRIEF_LENGTH}
          placeholder="e.g. door, keyhole, Jack, neon-blue"
          disabled={running}
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-[12px] text-white placeholder:text-white/30 focus:border-rose-400/40 focus:outline-none disabled:opacity-50"
        />
        {!confirming && (
          <button
            type="button"
            onClick={handleTap}
            disabled={running}
            className="shrink-0 rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-2 text-[12px] font-semibold text-white/85 transition-colors hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? "Working\u2026" : "Auto-plate"}
          </button>
        )}
      </div>

      {confirming && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 rounded-full bg-rose-400 px-3.5 py-2 text-center text-[12px] font-semibold text-zinc-950 transition-colors hover:bg-rose-300 active:bg-rose-400/85"
          >
            {`Confirm — generate ${targets.length} still${targets.length === 1 ? "" : "s"}, ~$${estimatedCost.toFixed(2)}`}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-[12px] font-medium text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white"
          >
            Cancel
          </button>
        </div>
      )}

      {running && progress && (
        <div className="flex items-center gap-2 text-[11px] text-white/60">
          <Spinner />
          {`Generating ${Math.min(progress.done + 1, progress.total)} of ${progress.total}\u2026`}
        </div>
      )}

      {summary && !running && (
        <p role="status" aria-live="polite" className="text-[11px] leading-snug text-white/50">
          {summary}
        </p>
      )}
    </div>
  );
}
