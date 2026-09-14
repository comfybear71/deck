"use client";

import { useEffect, useRef, useState } from "react";
import { useSkidmarksStudio } from "@/hooks/useSkidmarksStudio";
import { useSkidmarksClipRenders } from "@/hooks/useSkidmarksClipRenders";
import { buildMockLook } from "@/lib/skidmarks";
import {
  archiveSkidmarksSession,
  fetchArchiveSnapshot,
  removeSkidmarksArchivedSong,
  type SkidmarksArchivedSong,
} from "@/lib/skidmarksArchive";
import { SkidmarksLandingTiles } from "./SkidmarksLandingTiles";
import { SkidmarksBandPicker } from "./SkidmarksBandPicker";
import { SkidmarksMembersModule } from "./SkidmarksMembersModule";
import { SkidmarksGeneratePopup } from "./SkidmarksGeneratePopup";
import { SkidmarksMp3Card } from "./SkidmarksMp3Card";
import { SkidmarksClipTimeline } from "./SkidmarksClipTimeline";
import { SkidmarksRenderedClipsShelf } from "./SkidmarksRenderedClipsShelf";
import { SkidmarksArchiveShelf } from "./SkidmarksArchiveShelf";

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
    renameBand,
    setBandCoverImage,
    setMemberAvatarImage,
    addLook,
    attachMp3,
    removeMp3,
    setMp3Duration,
    setSegmentShotPrompt,
    nudgeSegmentStart,
    nudgeSegmentEnd,
    setClipPlateStill,
    addClipPlate,
    removeClipPlate,
    selectClipPlate,
    setClipPlateMotionPrompt,
    setClipInstrumentalModel,
    restoreArchivedSession,
    clearSessionAfterArchive,
  } = useSkidmarksStudio();

  const activeBand = bands.find((b) => b.id === session.bandId);
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  const openMember = activeBand?.members.find((m) => m.id === openMemberId);

  const { renders, addRender, removeRender } = useSkidmarksClipRenders(session.mp3?.segments ?? []);

  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveRefreshToken, setArchiveRefreshToken] = useState(0);

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

  const handleGenerate = (prompt: string, photoreal: number) => {
    if (!activeBand || !openMember) return;
    addLook(activeBand.id, openMember.id, buildMockLook(prompt, photoreal));
  };

  const handleRenameMember = (name: string) => {
    if (!activeBand || !openMember) return;
    renameMember(activeBand.id, openMember.id, name);
  };

  const handleRemoveBand = (bandId: string) => {
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
  const handleArchive = async () => {
    if (!activeBand || !session.mp3 || archiving) return;
    setArchiving(true);
    setArchiveError(null);
    const outcome = await archiveSkidmarksSession(activeBand, session.mp3, renders.size);
    setArchiving(false);
    if (!outcome.ok) {
      setArchiveError(outcome.message);
      return;
    }
    clearSessionAfterArchive();
    setArchiveRefreshToken((t) => t + 1);
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
    if (activeBand && session.mp3) {
      const archiveOutcome = await archiveSkidmarksSession(activeBand, session.mp3, renders.size);
      if (!archiveOutcome.ok) {
        throw new Error(`Couldn't archive the current song first \u2014 ${archiveOutcome.message}`);
      }
      clearSessionAfterArchive();
    }

    const snapshotOutcome = await fetchArchiveSnapshot(song.snapshotUrl);
    if (!snapshotOutcome.ok) {
      throw new Error(snapshotOutcome.message);
    }
    restoreArchivedSession(snapshotOutcome.snapshot.band, snapshotOutcome.snapshot.mp3);
    await removeSkidmarksArchivedSong(song.id);
    setArchiveRefreshToken((t) => t + 1);
  };

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

        {sessionSync.status === "saving" && (
          // Real live bug (2026-09-14): this row used to show *nothing*
          // while a save was actually in flight \u2014 only once it had
          // already failed. A save can take a few real seconds (a
          // still's own Blob upload, then the session PUT, now with up
          // to ~30s of retry on a bad connection), and a refresh landing
          // anywhere in that silent window looked identical to a
          // perfectly safe one. This is the one moment it's genuinely
          // not safe to refresh \u2014 say so plainly instead of staying
          // quiet about it.
          <p
            role="status"
            className="mx-4 mb-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] leading-snug text-white/60"
          >
            Saving\u2026 hold on before refreshing.
          </p>
        )}

        {(sessionSync.status === "unconfigured" || sessionSync.status === "error") && (
          <p
            role="status"
            className="mx-4 mb-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-2.5 py-1.5 text-[10px] leading-snug text-amber-200/90"
          >
            {sessionSync.status === "unconfigured"
              ? "Session storage isn\u2019t connected here \u2014 your edits won\u2019t survive a refresh this time."
              : `Couldn\u2019t save your session just now \u2014 ${sessionSync.error ?? "unknown reason"}. Don\u2019t refresh until this clears \u2014 your next edit will try again.`}
          </p>
        )}

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          <div className="flex flex-col gap-8 pt-2">
            <SkidmarksLandingTiles
              activeKind={session.projectKind}
              onSelect={selectProjectKind}
            />

            {session.projectKind === "music-video" && (
              <div ref={bandSectionRef}>
                <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-white/40">
                  Choose a band
                </p>
                <SkidmarksBandPicker
                  bands={bands}
                  activeBandId={session.bandId}
                  onSelectBand={selectBand}
                  onCreateBand={createBand}
                  onSetCoverImage={setBandCoverImage}
                  onRemoveBand={handleRemoveBand}
                />
              </div>
            )}

            {activeBand && (
              <div ref={membersSectionRef}>
                <SkidmarksMembersModule
                  band={activeBand}
                  onOpenMember={setOpenMemberId}
                  onAddMember={() => addMember(activeBand.id)}
                  onRemoveMember={(memberId) => removeMember(activeBand.id, memberId)}
                  onSetMemberAvatarImage={(memberId, dataUrl) =>
                    setMemberAvatarImage(activeBand.id, memberId, dataUrl)
                  }
                  onRenameBand={(name) => renameBand(activeBand.id, name)}
                />
              </div>
            )}

            {activeBand && (
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
              </div>
            )}

            {session.mp3 && activeBand && (
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
                onPersisted={addRender}
                onSetSegmentShotPrompt={setSegmentShotPrompt}
                onNudgeSegmentStart={nudgeSegmentStart}
                onNudgeSegmentEnd={nudgeSegmentEnd}
                onSetClipPlateStill={setClipPlateStill}
                onAddClipPlate={addClipPlate}
                onRemoveClipPlate={removeClipPlate}
                onSelectClipPlate={selectClipPlate}
                onSetClipPlateMotionPrompt={setClipPlateMotionPrompt}
                onSetClipInstrumentalModel={setClipInstrumentalModel}
              />
            )}

            {session.mp3 && activeBand && (
              <SkidmarksRenderedClipsShelf renders={renders} onRemoved={removeRender} />
            )}

            <SkidmarksArchiveShelf onOpenInEditor={handleOpenInEditor} refreshToken={archiveRefreshToken} />
          </div>
        </div>
      </div>

      {activeBand && openMember && (
        <SkidmarksGeneratePopup
          member={openMember}
          onGenerate={handleGenerate}
          onRename={handleRenameMember}
          onClose={() => setOpenMemberId(null)}
        />
      )}
    </div>
  );
}
