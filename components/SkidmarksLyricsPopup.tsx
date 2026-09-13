"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SkidmarksTranscriptionStatus } from "@/lib/skidmarks";
import type { SkidmarksTranscribedWord } from "@/lib/transcription";

interface SkidmarksLyricsPopupProps {
  words?: SkidmarksTranscribedWord[];
  transcriptionStatus: SkidmarksTranscriptionStatus;
  transcriptionError?: string;
  onClose: () => void;
}

function CloseIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3 w-3">
      <rect x="7" y="7" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M4.5 12.5v-7A1 1 0 0 1 5.5 4.5h7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3 w-3">
      <path
        d="M4.5 10.5 8 14l7.5-8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Long enough to read as real confirmation, short enough to not linger
 * once Stuart's moved on \u2014 same order of magnitude as the plate
 * Render control's own "Rendered \u2713" style feedback. */
const COPY_FEEDBACK_MS = 1800;

/** Plain-language, honest reason to show instead of lyric text when
 * there's genuinely nothing real to show yet \u2014 mirrors the same
 * `transcriptionStatus` honesty the old Lyrics/Timing/Ready chip used,
 * just as prose here instead of a chip color. Real, non-empty `words`
 * are shown regardless of status (including `"sparse"` \u2014
 * `lib/skidmarks.ts`'s doc comment on `SkidmarksMp3Attachment.words`
 * notes these are kept even for a sparse result), so this only fires
 * when there truly are no words to show. */
function emptyStateMessage(
  transcriptionStatus: SkidmarksTranscriptionStatus,
  transcriptionError?: string
): string {
  switch (transcriptionStatus) {
    case "checking":
      return "Transcribing this song\u2026 lyrics will show up here once it finishes.";
    case "unconfigured":
      return "Lyrics transcription isn\u2019t set up on this deployment.";
    case "failed":
      return transcriptionError ? `Transcription failed \u2014 ${transcriptionError}` : "Transcription failed.";
    case "sparse":
      return (
        transcriptionError ??
        "Transcription came back too sparse to trust \u2014 no real lyric text to show."
      );
    case "done":
    default:
      return "No words came back for this track.";
  }
}

/**
 * The small, honest replacement for the old green Lyrics/Timing/Ready
 * chip row's one useful payload: the actual transcribed words, opened
 * from the compact "Lyrics" button inside `SkidmarksMp3Card`. Reads
 * straight off `SkidmarksMp3Attachment.words` (`lib/transcription.ts`'s
 * `SkidmarksTranscribedWord[]`, real per-word ElevenLabs Scribe output
 * once it lands) \u2014 no separate fetch, no new persisted state, this
 * is state Neon already carries as part of the mp3 attachment.
 *
 * **Portaled to `document.body`**, same reason as
 * `SkidmarksClipStub.tsx`'s plate lightbox: this can be opened from
 * deep inside `SkidmarksDetailSheet`'s own `overflow-y-auto` scroll
 * body, and a `position: fixed` element nested inside a scrolling
 * ancestor doesn't reliably escape it on iOS Safari.
 *
 * Copy uses `navigator.clipboard.writeText` \u2014 supported on iOS
 * Safari 13.4+, so this is safe for Stuart's actual phone-in-hand
 * target. A failure (e.g. no clipboard permission) surfaces as a real,
 * honest inline message rather than a silent no-op.
 */
export function SkidmarksLyricsPopup({
  words,
  transcriptionStatus,
  transcriptionError,
  onClose,
}: SkidmarksLyricsPopupProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const lyricsText = (words ?? [])
    .map((w) => w.word.trim())
    .filter(Boolean)
    .join(" ");
  const hasLyrics = lyricsText.length > 0;

  const handleCopy = async () => {
    if (!hasLyrics) return;
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(lyricsText);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : "Couldn\u2019t copy \u2014 try selecting the text instead.");
    }
  };

  // Only ever mounted client-side from a click handler (see
  // `SkidmarksMp3Card`) \u2014 never during SSR \u2014 so `document.body`
  // is always available here.
  return createPortal(
    <div className="fixed inset-0 z-[999] flex items-end justify-center p-4 sm:items-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/80" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Lyrics"
        className="relative z-10 flex max-h-[75vh] w-full max-w-sm flex-col rounded-2xl border border-white/10 bg-zinc-950 p-4 animate-[sheet-in_0.18s_ease-out]"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">Lyrics</h3>
          <div className="flex shrink-0 items-center gap-1.5">
            {hasLyrics && (
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy lyrics to clipboard"
                className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? "Copied" : "Copy"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="mt-3 flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
          {hasLyrics ? (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-white/85">{lyricsText}</p>
          ) : (
            <p className="text-[12px] leading-relaxed text-white/40">
              {emptyStateMessage(transcriptionStatus, transcriptionError)}
            </p>
          )}
        </div>

        {copyError && (
          <p role="alert" className="mt-2 text-[11px] leading-snug text-rose-300/90">
            {copyError}
          </p>
        )}
      </div>
    </div>,
    document.body
  );
}
