"use client";

import { useEffect, useRef, useState } from "react";
import { useSkidmarksStudio } from "@/hooks/useSkidmarksStudio";
import { buildMockLook, EMPTY_SKIDMARKS_CHECKLIST } from "@/lib/skidmarks";
import { SkidmarksLandingTiles } from "./SkidmarksLandingTiles";
import { SkidmarksBandPicker } from "./SkidmarksBandPicker";
import { SkidmarksMembersModule } from "./SkidmarksMembersModule";
import { SkidmarksGeneratePopup } from "./SkidmarksGeneratePopup";
import { SkidmarksMp3Card } from "./SkidmarksMp3Card";
import { SkidmarksChecklistChips } from "./SkidmarksChecklistChips";

interface SkidmarksDetailSheetProps {
  onClose: () => void;
}

/**
 * Skidmarks' detail sheet — the locked Music-video director flow,
 * through the MP3 step only (plates/multi-angle/voice/animate/stitch are
 * explicitly out of scope for this build). **One continuous scroll**:
 * the landing's three project-type tiles stay put at the top, and each
 * step (choose a band → cast members → attach MP3) appends underneath
 * the previous one — there is no separate screen to navigate to. See the
 * README's "Skidmarks node (vibe director)" section for exactly what's
 * real (file pick, real audio duration/playback) vs. mocked (bands,
 * looks, the checklist's staged timers) in this build.
 */
export function SkidmarksDetailSheet({ onClose }: SkidmarksDetailSheetProps) {
  const {
    bands,
    session,
    selectProjectKind,
    selectBand,
    createBand,
    addMember,
    editCover,
    addLook,
    attachMp3,
    removeMp3,
    setMp3Duration,
  } = useSkidmarksStudio();

  const activeBand = bands.find((b) => b.id === session.bandId);
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  const openMember = activeBand?.members.find((m) => m.id === openMemberId);

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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
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
                  onEditCover={editCover}
                />
              </div>
            )}

            {activeBand && (
              <div ref={membersSectionRef}>
                <SkidmarksMembersModule
                  band={activeBand}
                  onOpenMember={setOpenMemberId}
                  onAddMember={() => addMember(activeBand.id)}
                />
              </div>
            )}

            {activeBand && (
              <div ref={mp3SectionRef} className="flex flex-col gap-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">
                  MP3 audio
                </p>
                <SkidmarksMp3Card
                  key={activeBand.id}
                  mp3={session.mp3}
                  onAttach={attachMp3}
                  onDurationResolved={setMp3Duration}
                  onRemove={removeMp3}
                />
                <SkidmarksChecklistChips
                  checklist={session.mp3?.checklist ?? EMPTY_SKIDMARKS_CHECKLIST}
                />
              </div>
            )}

            <p className="text-center text-[11px] leading-relaxed text-white/25">
              Front end only {"\u2014"} bands, looks, and the checklist above are
              mocked for this build. No real Comfy MCP / Seedance / LTX /
              ElevenLabs render happens from here, and plates + everything after
              MP3 come later.
            </p>
          </div>
        </div>
      </div>

      {activeBand && openMember && (
        <SkidmarksGeneratePopup
          member={openMember}
          onGenerate={handleGenerate}
          onClose={() => setOpenMemberId(null)}
        />
      )}
    </div>
  );
}
