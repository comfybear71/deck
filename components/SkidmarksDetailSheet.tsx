"use client";

import { useEffect, useRef, useState } from "react";
import { useSkidmarksStudio } from "@/hooks/useSkidmarksStudio";
import { useSkidmarksClipRenders } from "@/hooks/useSkidmarksClipRenders";
import { buildGeneratedLook, flushSkidmarksSessionNow, resolveChainedPlateTarget } from "@/lib/skidmarks";
import type { PersistedClipRender } from "@/lib/clipRenders";
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
import { SkidmarksScriptSequencePanel } from "./SkidmarksScriptSequencePanel";
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
    setScriptSequence,
    setScriptSequenceDraft,
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

            {activeBand && (
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
                onPersisted={handlePersisted}
                onSetSegmentShotPrompt={setSegmentShotPrompt}
                onNudgeSegmentStart={nudgeSegmentStart}
                onNudgeSegmentEnd={nudgeSegmentEnd}
                onSetClipPlateStill={setClipPlateStill}
                onAddClipPlate={addClipPlate}
                onRemoveClipPlate={removeClipPlate}
                onSelectClipPlate={selectClipPlate}
                onSetClipPlateMotionPrompt={setClipPlateMotionPrompt}
                onSetClipInstrumentalModel={setClipInstrumentalModel}
                chainNote={chainNote}
                onDismissChainNote={() => setChainNote(null)}
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
          bandName={activeBand.name}
          onGenerate={handleGenerate}
          onRename={handleRenameMember}
          onClose={() => setOpenMemberId(null)}
        />
      )}
    </div>
  );
}
