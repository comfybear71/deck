"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatDuration,
  waveformBars,
  type SkidmarksMp3Attachment,
} from "@/lib/skidmarks";
import { SkidmarksLyricsPopup } from "./SkidmarksLyricsPopup";

interface SkidmarksMp3CardProps {
  mp3: SkidmarksMp3Attachment | null;
  /** Raw picked file — the caller (`useSkidmarksStudio`) builds the
   * attachment record *and* kicks off real vocal/instrumental analysis
   * against this same file (see `analyzeVocalActivity`). */
  onAttach: (file: File) => void;
  /** `attachId` is this card's own live `mp3.attachId`, captured at the
   * moment `loadedmetadata` actually fires — see
   * `setSkidmarksMp3Duration`'s doc comment for why this guard matters:
   * a deferred/late metadata resolve (a real iOS Safari quirk) must
   * never land on a since-replaced attach. */
  onDurationResolved: (attachId: string, durationSec: number) => void;
  onRemove: () => void;
}

/** Picks the real audio source this card actually plays from: the
 * local, in-tab object URL takes priority whenever it exists (this
 * session's own picked `File`, no network round trip needed); once
 * that's gone (a page reload dropped the `File` — it never persists,
 * see this file's doc comment) but a durable Blob URL was uploaded at
 * attach time (`mp3.audioUrl`, see `lib/mp3Blob.ts`), that becomes the
 * fallback source instead of leaving playback dead after a refresh.
 * `undefined` when neither is available (no Blob store connected, the
 * upload failed, or this session hasn't attached anything real yet). */
function resolveAudioSrc(localObjectUrl: string | null, mp3: SkidmarksMp3Attachment | null): string | undefined {
  return localObjectUrl ?? mp3?.audioUrl ?? undefined;
}

const BAR_COUNT = 40;

function UploadIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-5 w-5">
      <path
        d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 14v1.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M6 4.5v11l9-5.5-9-5.5Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
      <rect x="5.5" y="4.5" width="3" height="11" rx="0.75" />
      <rect x="11.5" y="4.5" width="3" height="11" rx="0.75" />
    </svg>
  );
}

/** Small lined-text glyph \u2014 reads as "lyrics/text", not a document/
 * file icon (this never opens a file picker). */
function LyricsIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3 w-3">
      <path
        d="M4 5.5h9M4 10h12M4 14.5h7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Waveform({ fileName, progress }: { fileName: string; progress: number }) {
  const bars = waveformBars(fileName, BAR_COUNT);
  const clipRight = Math.max(0, Math.min(100, (1 - progress) * 100));
  return (
    <div className="relative h-7 flex-1">
      <div className="absolute inset-0 flex items-center gap-[2px]">
        {bars.map((h, i) => (
          <span
            key={i}
            className="flex-1 rounded-full bg-white/15"
            style={{ height: `${Math.round(h * 100)}%` }}
          />
        ))}
      </div>
      <div
        className="absolute inset-0 flex items-center gap-[2px] overflow-hidden"
        style={{ clipPath: `inset(0 ${clipRight}% 0 0)` }}
      >
        {bars.map((h, i) => (
          <span
            key={i}
            className="flex-1 rounded-full bg-rose-400"
            style={{ height: `${Math.round(h * 100)}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * MP3 card — attach an existing MP3 only (the song is made elsewhere;
 * this build never generates or edits audio). Same width/alignment as
 * the members module box above it. Once attached: a compact decorative
 * waveform (still just a filename-seeded stand-in, not derived from the
 * real audio), a real play/pause over the actual picked file (via an
 * `<audio>` element + object URL — the picked `File` itself still can't
 * round-trip through `localStorage`), the filename, and a real
 * `elapsed / duration` readout (`currentTimeSec`, driven by the
 * `<audio>` element's own `timeupdate` event via `handleTimeUpdate`) so
 * Stuart can see where playback actually is, not just the track's total
 * length — the elapsed half counts up live while playing and holds its
 * last value when paused mid-track, only resetting on attach/remove/end.
 * `onAttach` hands the raw `File` up to `useSkidmarksStudio`, which is
 * what actually kicks off real vocal/instrumental analysis against it —
 * see `lib/audioAnalysis.ts` — plus a real, durable upload of the audio
 * itself to Vercel Blob (`lib/mp3Blob.ts`) so **playback now survives a
 * refresh**: `resolveAudioSrc` below prefers this session's own local
 * object URL when it exists, and falls back to `mp3.audioUrl` (the
 * durable Blob URL) once the local `File`/object URL is gone.
 *
 * **Small "Lyrics" control** (2026-09-14, replacing the old green
 * Lyrics/Timing/Ready chip row Stuart asked removed \u2014 "Timing is
 * redundant, the waveform already shows time") \u2014 a small pill next
 * to the filename, opening `SkidmarksLyricsPopup` with whatever real
 * word-level transcription (`mp3.words`, `lib/transcription.ts`) has
 * landed for this attach, plus a copy-to-clipboard button. This is the
 * chip row's one real payload Stuart actually cared about (whether
 * useful lyric text exists), reachable directly instead of behind a
 * chip's color.
 */
export function SkidmarksMp3Card({
  mp3,
  onAttach,
  onDurationResolved,
  onRemove,
}: SkidmarksMp3CardProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [lyricsOpen, setLyricsOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setIsPlaying(false);
    setProgress(0);
    setCurrentTimeSec(0);
    onAttach(file);
  };

  const handleLoadedMetadata = () => {
    if (!mp3) return;
    const duration = audioRef.current?.duration;
    if (duration && Number.isFinite(duration)) {
      onDurationResolved(mp3.attachId, duration);
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTimeSec(audio.currentTime);
    if (!audio.duration) return;
    setProgress(audio.currentTime / audio.duration);
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {
        // Autoplay/codec issue — stay paused rather than throwing.
      });
    }
  };

  const handleRemove = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setProgress(0);
    setCurrentTimeSec(0);
    onRemove();
  };

  if (!mp3) {
    return (
      <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-dashed border-white/20 bg-white/[0.02] px-4 py-7 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] text-white/50">
          <UploadIcon />
        </span>
        <div>
          <p className="text-sm font-medium text-white/80">Attach MP3</p>
          <p className="mt-0.5 text-[11px] text-white/35">
            Pick a finished song {"\u2014"} made elsewhere, just attached here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-full bg-rose-400/15 px-4 py-1.5 text-xs font-medium text-rose-200 transition-colors hover:bg-rose-400/25 active:bg-rose-400/30"
        >
          Choose file{"\u2026"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp3,audio/mpeg,audio/mp3"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    );
  }

  const audioSrc = resolveAudioSrc(audioUrl, mp3);

  return (
    <div className="rounded-2xl border border-rose-400/30 bg-rose-400/[0.03] p-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!audioSrc}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-400 text-zinc-950 transition-colors hover:bg-rose-300 active:bg-rose-400/80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        <Waveform fileName={mp3.fileName} progress={progress} />

        <span
          aria-label={`${formatDuration(currentTimeSec)} elapsed of ${formatDuration(mp3.durationSec)}`}
          className="shrink-0 text-xs font-medium tabular-nums text-white/60"
        >
          <span className={isPlaying || currentTimeSec > 0 ? "text-rose-200" : undefined}>
            {formatDuration(currentTimeSec)}
          </span>
          <span className="text-white/30"> / </span>
          {formatDuration(mp3.durationSec)}
        </span>

        <button
          type="button"
          onClick={handleRemove}
          aria-label="Remove MP3"
          className="shrink-0 rounded-full p-1 text-white/30 transition-colors hover:bg-white/10 hover:text-white/70"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[11px] text-white/40">{mp3.fileName}</p>
        <button
          type="button"
          onClick={() => setLyricsOpen(true)}
          className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-white/50 transition-colors hover:bg-white/[0.07] hover:text-white/80"
        >
          <LyricsIcon />
          Lyrics
        </button>
      </div>
      {!audioUrl && mp3.audioUrl && (
        <p className="mt-1 text-[10px] leading-snug text-white/30">Playing from a saved copy after a refresh.</p>
      )}
      {!audioUrl && !mp3.audioUrl && mp3.audioPersistStatus === "failed" && (
        <p className="mt-1 text-[10px] leading-snug text-amber-200/70">
          {"Audio wasn\u2019t saved this time \u2014 it won\u2019t play after a refresh ("}
          {mp3.audioPersistError ?? "unknown reason"}
          {")."}
        </p>
      )}

      {audioSrc && (
        <audio
          ref={audioRef}
          src={audioSrc}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            setProgress(0);
            setCurrentTimeSec(0);
          }}
          className="hidden"
        />
      )}

      {lyricsOpen && (
        <SkidmarksLyricsPopup
          words={mp3.words}
          transcriptionStatus={mp3.transcriptionStatus}
          transcriptionError={mp3.transcriptionError}
          onClose={() => setLyricsOpen(false)}
        />
      )}
    </div>
  );
}
