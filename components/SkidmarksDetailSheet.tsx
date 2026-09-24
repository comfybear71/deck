"use client";

import { SkidmarksConfirmDialog } from "./SkidmarksConfirmDialog";
import { useEffect, useRef, useState } from "react";
import { useSkidmarksStudio } from "@/hooks/useSkidmarksStudio";
import { useSkidmarksClipRenders } from "@/hooks/useSkidmarksClipRenders";
import {
  buildGeneratedLook,
  computeSkidmarksArchiveFingerprint,
  flushSkidmarksSessionNow,
  isSkidmarksSessionAlreadyArchived,
  resolveChainedPlateTarget,
  loadSkidmarksSessionFromServerNow,
} from "@/lib/skidmarks";
import type { PersistedClipRender } from "@/lib/clipRenders";
import {
  archiveSkidmarksSession,
  fetchArchiveSnapshot,
  type SkidmarksArchivedSong,
} from "@/lib/skidmarksArchive";
import { SkidmarksLandingTiles } from "./SkidmarksLandingTiles";
import { SkidmarksBandPicker } from "./SkidmarksBandPicker";
import { SkidmarksMembersModule } from "./SkidmarksMembersModule";
import { SkidmarksGeneratePopup } from "./SkidmarksGeneratePopup";
import { SkidmarksMp3Card } from "./SkidmarksMp3Card";
import { SkidmarksClipTimeline } from "./SkidmarksClipTimeline";
import { SkidmarksScriptSequencePanel } from "./SkidmarksScriptSequencePanel";
import { SkidmarksRenderedClipsShelf } from "./SkidmarksRenderedClipsShelf";
import { SkidmarksArchiveShelf } from "./SkidmarksArchiveShelf";
import { SkidmarksSunnyBanksPanel } from "./SkidmarksSunnyBanksPanel";
import { useIsPcShell } from "@/hooks/useIsPcShell";
import { DeckPcRail, type DeckPcRailId } from "./DeckPcRail";
import { SkidmarksLibraryPage } from "./SkidmarksLibraryPage";
import { SkidmarksPcHome } from "./SkidmarksPcHome";

interface SkidmarksDetailSheetProps {
  onClose: () => void;
}

/**
 * Skidmarks' detail sheet — the locked Music-video director flow,
 * through the clip/segment timeline's plate-strip + shot-prompt tags,
 * the per-plate select/Render control, the page-bottom rendered-clips
 * shelf, and the finished-song archive shelf. **One continuous
 * scroll**: the landing's three project-type tiles stay put at the top,
 * each wizard step appends underneath the previous one, and the two
 * page-bottom shelves (rendered clips, then finished songs) sit at the
 * very end of that same scroll — there is no separate screen to
 * navigate to, and per AGENTS.md's "one live edit workspace on top"
 * lock, there is never a second, doubled MP3/plates UI: only the *top*
 * workspace is ever live-editable at once.
 *
 * **PC shell (≥1024px)**: left-rail layout (Home / Create / Library).
 * Create is a 2-column desk (Artist+MP3 | Script Sequence + timeline);
 * Finished Songs live in Library (shelf hidden on PC). Below 1024px the
 * phone sheet (`sm:max-w-md`) and bottom Finished Songs shelf stay as today.
 */
export function SkidmarksDetailSheet({ onClose }: SkidmarksDetailSheetProps) {
  const {
    bands,
    session,
    sessionSync,
    selectProjectKind,
    selectBand,
    createBand,
    removeBand,
    addMember,
    removeMember,
    renameMember,
    setMemberLock,
    renameBand,
    setBandCoverImage,
    setMemberAvatarImage,
    addLook,
    attachMp3,
    removeMp3,
    setMp3Duration,
    setSegmentShotPrompt,
    setSegmentNegativePrompt,
    nudgeSegmentStart,
    nudgeSegmentEnd,
    setClipPlateStill,
    setScriptSequence,
    setScriptSequenceDraft,
    addClipPlate,
    removeClipPlate,
    selectClipPlate,
    setClipPlateMotionPrompt,
    setClipPlateLastSent,
    setClipInstrumentalModel,
    restoreArchivedSession,
    clearSessionAfterArchive,
    markSessionArchived,
  } = useSkidmarksStudio();

  const activeBand = bands.find((b) => b.id === session.bandId);
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  const openMember = activeBand?.members.find((m) => m.id === openMemberId);

  const { renders, addRender, removeRender } = useSkidmarksClipRenders(session.mp3?.segments ?? []);

  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveSuccessMessage, setArchiveSuccessMessage] = useState<string | null>(null);
  const [archiveRefreshToken, setArchiveRefreshToken] = useState(0);
  const isPcShell = useIsPcShell();
  const [pcRail, setPcRail] = useState<DeckPcRailId>("create");

  const bandSectionRef = useRef<HTMLDivElement | null>(null);
  const membersSectionRef = useRef<HTMLDivElement | null>(null);
  const mp3SectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !openMemberId) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, openMemberId]);

  // Each newly-appended step scrolls gently into view — same "the thread
  // grows, follow it down" feel the old chat build had, just for a
  // step-wizard instead of chat bubbles.
  useEffect(() => {
    if (session.projectKind === "music-video") {
      bandSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [session.projectKind]);
  useEffect(() => {
    if (session.bandId) {
      membersSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [session.bandId]);

  const handleGenerate = (prompt: string, photoreal: number, imageUrl: string) => {
    if (!activeBand || !openMember) return;
    addLook(activeBand.id, openMember.id, buildGeneratedLook(prompt, photoreal, imageUrl));
    // Also sets it as the member's real avatarImage — every other place
    // that reads a member's photo (the avatar ring, plate-generation
    // identity references, the archive export) only ever looks at
    // `avatarImage`, never `looks[]`. A freshly generated look should
    // act exactly like a freshly picked photo.
    setMemberAvatarImage(activeBand.id, openMember.id, imageUrl);
  };

  const handleRenameMember = (name: string) => {
    if (!activeBand || !openMember) return;
    renameMember(activeBand.id, openMember.id, name);
  };

  /**
   * Stuart's "last frame becomes the next clip's first frame" ask
   * (2026-09-14): once a render persists, grab that video's closing
   * frame (`lib/videoFrame.ts`) and drop it straight into the *next*
   * segment's first plate — but only when that plate is still genuinely
   * empty, so this never clobbers a still Stuart already picked or
   * generated there himself.
   *
   * **Was silent by design; isn't anymore** — a first version here
   * swallowed any failure with no visible sign at all, on the theory
   * that the chaining was a bonus riding on top of a render that
   * already genuinely succeeded. Stuart's own real report: it silently
   * did nothing on his iPhone, more than once, and there was no way for
   * either of us to tell why — "how do I know this is going to work?"
   * was a fair question with no honest answer available. `chainNote`
   * now reports the real outcome either way (success or the actual
   * failure message) via `SkidmarksClipTimeline`'s banner, same
   * "an honest error beats silence" rule this whole feature otherwise
   * follows everywhere else (plate stills, clip renders, transcription).
   */
  const [chainNote, setChainNote] = useState<{ ok: boolean; message: string } | null>(null);

  const handlePersisted = (render: PersistedClipRender) => {
    addRender(render);

    const target = resolveChainedPlateTarget(session.mp3?.segments ?? [], render.segmentId, render.plateId);
    if (!target) return;

    // Real reported disaster (2026-09-15): chaining every render's last
    // frame into the next compounded drift for a locked character when
    // the camera swung around/zoomed during the render itself. The
    // actual fix landed at that layer (`lib/clipGeneration.ts`'s camera-
    // motion rules — camera holds, no full-black frame), not in whether
    // to chain at all: Stuart's own manual testing (screenshotting each
    // render's last frame and re-uploading it by hand) chained
    // continuously with no reset and held up fine once those camera
    // fixes were in. Reverted 2026-09-16 (direct ask, backed by that
    // real evidence) to chain continuously here too, same as an
    // unlocked vocalist — no special-cased fallback to his reference
    // photo either, on the same direct instruction, same day: silently
    // swapping in a different photo he didn't choose when a capture
    // genuinely failed is "lazy," not a real fix. If the server can't
    // capture a last frame, this says so honestly, same for every
    // vocalist, locked or not — see `lib/scriptSequenceRunner.ts`'s
    // matching behavior in the batch "Generate & render all" path.

    // `render.lastFrameUrl` is already a durable Blob URL, extracted
    // server-side by ffmpeg (`app/api/skidmarks/generate-clip/route.ts`,
    // `lib/serverVideoFrame.ts`) right when the render itself was
    // persisted — no client-side capture (and no second upload) left to
    // do here anymore. See that module's doc comment for why this
    // replaced the old `<video>`+`<canvas>` capture, which failed live
    // three separate times on Stuart's iPhone.
    if (!render.lastFrameUrl) {
      setChainNote({
        ok: false,
        message: "Couldn't auto-fill the next clip's first plate: the server couldn't capture this render's last frame.",
      });
      return;
    }

    setClipPlateStill(target.segmentId, target.plateId, {
      dataUrl: render.lastFrameUrl,
      source: "chained",
      createdAt: Date.now(),
      ...(target.featuresLockedCharacter ? { featuresLockedCharacter: true } : {}),
    });
    flushSkidmarksSessionNow();
    setChainNote({ ok: true, message: "Filled the next clip's first plate from this one's last frame." });
  };

  /**
   * "Clear" tap on the green Saved banner (2026-09-17, Stuart's own
   * ask) — purely a local dismiss, never touches `sessionSync` itself
   * or the real save it's reporting. Keyed to the exact save it was
   * shown for (`sessionSync.lastSavedAt`, or the literal string
   * `"no-timestamp"` for the rare case a save landed with no timestamp)
   * so dismissing today's "Saved ✓ 10:53 am" can't also silently hide
   * a genuinely new save that lands later — the banner reappears the
   * moment `lastSavedAt` moves on.
   */
  const [dismissedSavedBannerFor, setDismissedSavedBannerFor] = useState<number | "no-timestamp" | null>(null);
  const savedBannerKey = sessionSync.lastSavedAt ?? "no-timestamp";
  const showSavedBanner = sessionSync.status === "synced" && dismissedSavedBannerFor !== savedBannerKey;

  /** One in-app confirm for the destructive taps that live at this
   * level (band trash, member trash). See `SkidmarksConfirmDialog`. */
  const [pendingConfirm, setPendingConfirm] = useState<{ title: string; body: string; confirmLabel: string; run: () => void } | null>(null);

  const handleRemoveBand = (bandId: string) => {
    const band = bands.find((b) => b.id === bandId);
    const isLive = bandId === activeBand?.id && !!session.mp3;
    setPendingConfirm({
      title: `Delete band ${band?.name?.trim() || "(unnamed)"}?`,
      body: isLive
        ? "This band is on your desk with a song. Deleting it removes the band AND that song from the desk. Songs already on the Finished Songs shelf are not touched. Tap Archive first if you want to keep this one."
        : "This removes the band and its members. Songs already on the Finished Songs shelf are not touched.",
      confirmLabel: "Delete band",
      run: () => performRemoveBand(bandId),
    });
  };

  const performRemoveBand = (bandId: string) => {
    if (bandId === activeBand?.id) setOpenMemberId(null);
    removeBand(bandId);
  };

  /**
   * "Archive" — the top workspace's own explicit "I'm done with this
   * song" action. Uploads the full band+mp3 snapshot and this song's
   * metadata (`lib/skidmarksArchive.ts`'s `archiveSkidmarksSession`,
   * carrying forward `renders.size` — every plate already known to
   * have a saved render, from the same map the shelf/tick marks above
   * already use), then clears the live workspace so it's immediately
   * ready for a new/different song. A failure leaves the live session
   * completely untouched — nothing here ever clears the workspace
   * before the snapshot is durably saved.
   */
  /**
   * Shared by "New" and picking a different band from the picker row —
   * archives whatever's currently live (if anything) before the switch
   * actually happens. Without this, `selectSkidmarksBand`/
   * `createSkidmarksBand` (`lib/skidmarks.ts`) reset `session.mp3`
   * straight to `null` and whatever song was in progress — segments,
   * plates, renders — was just gone, nowhere. Real reported ask
   * (2026-09-15): "when I create a new video that workspace should be
   * blank — they should only be the stuff that's in the archives," which
   * only holds if a switch actually puts the old stuff in the archives
   * first. Returns `false` (and leaves the live session untouched) on a
   * real archive failure, so the caller can bail out of the switch
   * instead of silently destroying work a failed save never actually
   * captured.
   */
  const archiveBeforeSwitch = async (): Promise<boolean> => {
    if (!activeBand || !session.mp3) return true;
    if (isSkidmarksSessionAlreadyArchived(activeBand, session.mp3, session.scriptSequenceDraft)) {
      // Byte-for-byte what's already on the Finished Songs shelf (a
      // checkpoint just saved, or a song opened from the shelf and not
      // touched since) — nothing to upload, and uploading anyway would
      // only list the same song twice. Safe to clear.
      clearSessionAfterArchive();
      return true;
    }
    setArchiving(true);
    setArchiveError(null);
    // `archiveSkidmarksSession` itself has no timeout (same as the
    // existing manual Archive button) — fine when Archive is a
    // deliberate, occasional tap, but "New" is something Stuart taps
    // constantly, so a slow/dead connection can't be allowed to leave
    // "New" hung forever. A stalled attempt still finishes in the
    // background (worst case: a late, harmless archived entry appears
    // on its own) — this race just stops it from blocking the switch.
    const timedOut = new Promise<{ ok: false; message: string }>((resolve) =>
      setTimeout(
        () => resolve({ ok: false, message: "Archiving is taking too long — check your connection and try again." }),
        15000
      )
    );
    const outcome = await Promise.race([
      archiveSkidmarksSession(activeBand, session.mp3, renders.size, session.scriptSequenceDraft),
      timedOut,
    ]);
    setArchiving(false);
    if (!outcome.ok) {
      setArchiveError(`${outcome.message} Your song is still here — nothing was cleared.`);
      return false;
    }
    clearSessionAfterArchive();
    setArchiveRefreshToken((t) => t + 1);
    return true;
  };

  /**
   * The manual "Archive" button — real, confirmed disaster (2026-09-16):
   * this used to just call `archiveBeforeSwitch`, which clears the live
   * workspace on any reported success. `archiveSkidmarksSession` itself
   * is two real network steps (upload the snapshot, then list it in the
   * index) — a snapshot can land safely in Blob while the index write
   * after it fails, races, or the tab dies mid-request, and if anything
   * in that gap made `outcome.ok` read true when the song wasn't
   * actually durably recoverable, the workspace got wiped for nothing.
   * Direct instruction after that: a deliberate tap of "Archive" is a
   * **checkpoint**, not a "start fresh" action — it saves a snapshot
   * and leaves the live session exactly as it was, full stop, success
   * or failure. Only the dedicated "start a new project" paths
   * (`archiveBeforeSwitch`, unchanged below — New, picking a different
   * band, opening a different archived song) still clear anything, and
   * only because clearing is the actual point of those actions.
   */
  const handleArchive = async () => {
    if (archiving || !activeBand || !session.mp3) return;
    setArchiveError(null);
    setArchiveSuccessMessage(null);
    if (isSkidmarksSessionAlreadyArchived(activeBand, session.mp3, session.scriptSequenceDraft)) {
      setArchiveSuccessMessage("Already on Finished Songs — nothing has changed since that checkpoint. Your desk is untouched.");
      return;
    }
    const { attachId } = session.mp3;
    const fingerprint = computeSkidmarksArchiveFingerprint(activeBand, session.mp3, session.scriptSequenceDraft);
    setArchiving(true);
    const outcome = await archiveSkidmarksSession(activeBand, session.mp3, renders.size, session.scriptSequenceDraft);
    setArchiving(false);
    if (!outcome.ok) {
      setArchiveError(`Archive failed — ${outcome.message}. Nothing was cleared; still working on this same project.`);
      return;
    }
    markSessionArchived(attachId, fingerprint);
    setArchiveRefreshToken((t) => t + 1);
    setArchiveSuccessMessage("Archive copy saved to Finished Songs. It is also still on your desk — keep working, or start a new project whenever you're ready.");
  };

  const handleSelectBand = async (bandId: string) => {
    // Re-tapping the tile that's already active used to still fire
    // `selectSkidmarksBand`, which unconditionally reset `session.mp3` to
    // `null` — a stray second tap on your own band silently wiped the
    // MP3 you'd just attached. Selecting a band you're already on is a
    // no-op, not a reset.
    if (bandId === activeBand?.id || archiving) return;
    if (!(await archiveBeforeSwitch())) return;
    selectBand(bandId);
  };

  const handleCreateBand = async () => {
    if (archiving) return;
    if (!(await archiveBeforeSwitch())) return;
    createBand();
  };

  /**
   * "Open in editor" on an archived song row. Per the "one live
   * workspace, never doubled" lock: if something's already live here,
   * it gets archived first (silently, same real snapshot-then-clear
   * path as a manual tap of Archive) so opening a different song can
   * never quietly discard whatever Stuart was working on. Throws on any
   * real failure — `SkidmarksArchiveShelf` catches it and shows the
   * real message on that row rather than this function swallowing it.
   */
  const handleOpenInEditor = async (song: SkidmarksArchivedSong) => {
    // Fetch the snapshot *before* touching the live desk: if the
    // download itself fails, nothing here has been archived or cleared
    // for nothing.
    const snapshotOutcome = await fetchArchiveSnapshot(song.snapshotUrl);
    if (!snapshotOutcome.ok) {
      throw new Error(snapshotOutcome.message);
    }
    if (activeBand && session.mp3 && !isSkidmarksSessionAlreadyArchived(activeBand, session.mp3, session.scriptSequenceDraft)) {
      const archiveOutcome = await archiveSkidmarksSession(
        activeBand,
        session.mp3,
        renders.size,
        session.scriptSequenceDraft
      );
      if (!archiveOutcome.ok) {
        throw new Error(`Couldn't archive the current song first \u2014 ${archiveOutcome.message}. Your desk was not touched.`);
      }
    }
    // The shelf row stays. Real, confirmed scare (2026-09-16): this used
    // to delete the row the moment the song was opened, so the only
    // durable copy of a song became the live session — and a failed
    // session save after that point looked like the song was gone
    // entirely. A checkpoint is a checkpoint; opening it is not
    // deleting it (audit test L3: "Archive does not mean delete").
    restoreArchivedSession(
      snapshotOutcome.snapshot.band,
      snapshotOutcome.snapshot.mp3,
      snapshotOutcome.snapshot.scriptSequenceDraft ?? null
    );
    setArchiveRefreshToken((t) => t + 1);
  };

  /** Library "Open in editor" — same restore path, then switch rail to Create. */
  const handleOpenInEditorFromLibrary = async (song: SkidmarksArchivedSong) => {
    await handleOpenInEditor(song);
    setPcRail("create");
  };

  const syncBanners = (
    <>
        {sessionSync.status === "loading" && (
          <p role="status" className="mx-4 mb-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] leading-snug text-white/60">
            Showing this phone{"\u2019"}s copy {"\u2014"} checking the server for anything newer{"\u2026"}
          </p>
        )}

        {showSavedBanner && (
          <p
            role="status"
            className="mx-4 mb-2 flex items-start justify-between gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1.5 text-[10px] leading-snug text-emerald-200/80"
          >
            <span>
              {sessionSync.lastSavedAt
                ? `Saved \u2713 ${new Date(sessionSync.lastSavedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} \u2014 safe to lock the phone or close Safari.`
                : "Saved \u2713 \u2014 this is the latest copy on the server."}
            </span>
            <button
              type="button"
              onClick={() => setDismissedSavedBannerFor(savedBannerKey)}
              aria-label="Dismiss saved notice"
              className="shrink-0 rounded-full p-0.5 text-emerald-200/70 transition-colors hover:bg-emerald-400/15 hover:text-emerald-100"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-3 w-3">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </p>
        )}

        {sessionSync.status === "saving" && (
          <p
            role="status"
            className="mx-4 mb-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] leading-snug text-white/60"
          >
            Saving{"\u2026"} hold on before refreshing.
          </p>
        )}

        {sessionSync.status === "conflict" && (
          <p
            role="alert"
            className="mx-4 mb-2 rounded-lg border border-amber-300/40 bg-amber-300/10 px-2.5 py-1.5 text-[10px] leading-snug text-amber-100/90"
          >
            NOT SAVED — a newer version was saved
            {sessionSync.remoteSavedAt
              ? ` elsewhere at ${new Date(sessionSync.remoteSavedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
              : " from another device"}
            , so this device will not write over it. Your edits here are safe on this phone and are not lost.
            Back up anything you changed here first, then load the newer copy.
            <button
              type="button"
              onClick={() => void loadSkidmarksSessionFromServerNow()}
              className="mt-1.5 block min-h-[40px] rounded-full bg-amber-300 px-3 text-[11px] font-semibold text-zinc-950"
            >
              Load the latest saved version
            </button>
          </p>
        )}

        {(sessionSync.status === "unconfigured" || sessionSync.status === "error") && (
          <p
            role="status"
            className="mx-4 mb-2 rounded-lg border border-rose-400/30 bg-rose-400/10 px-2.5 py-1.5 text-[10px] leading-snug text-rose-200/90"
          >
            {sessionSync.status === "unconfigured"
              ? "NOT SAVED \u2014 session storage isn\u2019t connected here. Your edits are safe on this phone but won\u2019t reach the server this time."
              : `NOT SAVED \u2014 ${sessionSync.error ?? "unknown reason"}. Your project is still safe on this phone. Retrying automatically \u2014 keep this tab open.`}
          </p>
        )}
    </>
  );

  const artistBlock = (label: string) => (
    <>
      <div ref={bandSectionRef}>
        <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-white/40">
          {label}
        </p>
        <SkidmarksBandPicker
          bands={bands}
          activeBandId={session.bandId}
          onSelectBand={handleSelectBand}
          onCreateBand={handleCreateBand}
          onSetCoverImage={setBandCoverImage}
          onRemoveBand={handleRemoveBand}
        />
      </div>

      {activeBand && (
        <div ref={membersSectionRef}>
          <SkidmarksMembersModule
            band={activeBand}
            onOpenMember={setOpenMemberId}
            onAddMember={() => addMember(activeBand.id)}
            onRemoveMember={(memberId) => {
              const member = activeBand.members.find((m) => m.id === memberId);
              setPendingConfirm({
                title: `Remove ${member?.name?.trim() || "this member"}?`,
                body: "Their photo, looks and lock card go with them. Clips already rendered stay on the shelf.",
                confirmLabel: "Remove member",
                run: () => removeMember(activeBand.id, memberId),
              });
            }}
            onSetMemberLock={(memberId, lock) => setMemberLock(activeBand.id, memberId, lock)}
            onSetMemberAvatarImage={(memberId, dataUrl) =>
              setMemberAvatarImage(activeBand.id, memberId, dataUrl)
            }
            onRenameBand={(name) => renameBand(activeBand.id, name)}
          />
        </div>
      )}
    </>
  );

  const mp3Block = activeBand ? (
    <div ref={mp3SectionRef} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">
          MP3 audio
        </p>
        {session.mp3 && (
          <button
            type="button"
            onClick={handleArchive}
            disabled={archiving}
            className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-white/70 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {archiving ? "Archiving\u2026" : "Archive"}
          </button>
        )}
      </div>
      <SkidmarksMp3Card
        key={activeBand.id}
        mp3={session.mp3}
        onAttach={attachMp3}
        onDurationResolved={setMp3Duration}
        onRemove={removeMp3}
      />
      {archiveError && (
        <p role="alert" className="text-[11px] leading-snug text-rose-300/90">
          {archiveError}
        </p>
      )}
      {archiveSuccessMessage && (
        <p role="status" className="text-[11px] leading-snug text-emerald-300/90">
          {archiveSuccessMessage}
        </p>
      )}
    </div>
  ) : null;

  const scriptBlock = activeBand ? (
    <SkidmarksScriptSequencePanel
      band={activeBand}
      hasMp3={!!session.mp3}
      realSegments={session.mp3?.segments ?? []}
      mp3AudioUrl={session.mp3?.audioUrl}
      renders={renders}
      scriptSequenceDraft={session.scriptSequenceDraft}
      onSetScriptSequenceDraft={setScriptSequenceDraft}
      onSetScriptSequence={setScriptSequence}
      onSetClipPlateStill={setClipPlateStill}
      onRecordRender={addRender}
    />
  ) : null;

  const timelineBlock =
    session.mp3 && activeBand ? (
      <SkidmarksClipTimeline
        segments={session.mp3.segments}
        segmentsSource={session.mp3.segmentsSource}
        analysisStatus={session.mp3.analysisStatus}
        analysisError={session.mp3.analysisError}
        transcriptionStatus={session.mp3.transcriptionStatus}
        transcriptionError={session.mp3.transcriptionError}
        transcriptionProvider={session.mp3.transcriptionProvider}
        band={activeBand}
        mp3FileName={session.mp3.fileName}
        mp3AudioUrl={session.mp3.audioUrl}
        renders={renders}
        onPersisted={handlePersisted}
        onSetSegmentShotPrompt={setSegmentShotPrompt}
        onSetSegmentNegativePrompt={setSegmentNegativePrompt}
        onNudgeSegmentStart={nudgeSegmentStart}
        onNudgeSegmentEnd={nudgeSegmentEnd}
        onSetClipPlateStill={setClipPlateStill}
        onAddClipPlate={addClipPlate}
        onRemoveClipPlate={removeClipPlate}
        onSelectClipPlate={selectClipPlate}
        onSetClipPlateMotionPrompt={setClipPlateMotionPrompt}
        onSetClipPlateLastSent={setClipPlateLastSent}
        onSetClipInstrumentalModel={setClipInstrumentalModel}
        chainNote={chainNote}
        onDismissChainNote={() => setChainNote(null)}
      />
    ) : null;

  const renderedBlock =
    session.mp3 && activeBand ? (
      <SkidmarksRenderedClipsShelf renders={renders} onRemoved={removeRender} />
    ) : null;

  /** Phone: single-column stack + Finished Songs shelf. PC: 2-col desk, no shelf. */
  const renderDeskBody = (layout: "phone" | "pc") => (
    <div className="flex flex-col gap-8 pt-2">
      <SkidmarksLandingTiles activeKind={session.projectKind} onSelect={selectProjectKind} />

      {session.projectKind === "sunnybank" && <SkidmarksSunnyBanksPanel />}

      {session.projectKind === "music-video" &&
        (layout === "pc" ? (
          <div className="grid grid-cols-2 items-start gap-10">
            <div className="flex min-w-0 flex-col gap-8">
              {artistBlock("Artist")}
              {mp3Block}
            </div>
            <div className="flex min-w-0 flex-col gap-8">
              {scriptBlock}
              {timelineBlock}
              {renderedBlock}
            </div>
          </div>
        ) : (
          <>
            {artistBlock("Choose a band")}
            {mp3Block}
            {scriptBlock}
            {timelineBlock}
            {renderedBlock}
            <SkidmarksArchiveShelf onOpenInEditor={handleOpenInEditor} refreshToken={archiveRefreshToken} />
          </>
        ))}
    </div>
  );

  const memberPopupAndConfirm = (
    <>
      {session.projectKind === "music-video" && activeBand && openMember && (
        <SkidmarksGeneratePopup
          member={openMember}
          bandName={activeBand.name}
          onGenerate={handleGenerate}
          onRename={handleRenameMember}
          onClose={() => setOpenMemberId(null)}
        />
      )}
      <SkidmarksConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ""}
        body={pendingConfirm?.body ?? ""}
        confirmLabel={pendingConfirm?.confirmLabel ?? "Delete"}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          const action = pendingConfirm;
          setPendingConfirm(null);
          action?.run();
        }}
      />
    </>
  );

  // PC shell (≥1024px): left rail + wide main. Phone/tablet keeps the sheet.
  if (isPcShell) {
    return (
      <div className="fixed inset-0 z-50 flex bg-zinc-950" role="dialog" aria-modal="true" aria-label="Deck — Skidmarks">
        <DeckPcRail active={pcRail} onSelect={setPcRail} onClose={onClose} />
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-5 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-white">
                {pcRail === "home" ? "Home" : pcRail === "library" ? "Library" : "Create"}
              </h2>
              <p className="truncate text-[11px] text-white/40">
                {pcRail === "create" ? "Skidmarks desk — full width" : "Deck PC shell"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {pcRail === "create" && syncBanners}

          <div className="flex-1 overflow-y-auto">
            {pcRail === "home" && (
              <SkidmarksPcHome
                onGoCreate={() => setPcRail("create")}
                onGoLibrary={() => setPcRail("library")}
              />
            )}
            {pcRail === "create" && (
              <div className="w-full px-8 pb-8">
                {renderDeskBody("pc")}
              </div>
            )}
            {pcRail === "library" && (
              <SkidmarksLibraryPage
                onOpenInEditor={handleOpenInEditorFromLibrary}
                refreshToken={archiveRefreshToken}
                onArchiveMutated={() => setArchiveRefreshToken((n) => n + 1)}
              />
            )}
          </div>
        </div>
        {memberPopupAndConfirm}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/90 backdrop-blur-md"
      />

      <div
        className={[
          "relative z-10 flex h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-zinc-950 shadow-2xl",
          "sm:h-auto sm:max-h-[85vh] sm:max-w-md sm:rounded-3xl",
          "animate-[sheet-in_0.22s_ease-out]",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label="Skidmarks — vibe director"
      >
        <div className="flex items-center justify-between gap-2 p-4 pb-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-400/15 text-sm font-semibold text-rose-300"
            >
              {"\u2665"}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-white">Skidmarks</h2>
              <p className="truncate text-[11px] text-rose-300/80">Vibe director</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {syncBanners}

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {renderDeskBody("phone")}
        </div>
      </div>

      {memberPopupAndConfirm}
    </div>
  );
}
