"use client";

import { useEffect, useRef, useState } from "react";
import {
  createMp3Attachment,
  formatDuration,
  waveformBars,
  type SkidmarksMp3Attachment,
} from "@/lib/skidmarks";

interface SkidmarksMp3CardProps {
  mp3: SkidmarksMp3Attachment | null;
  onAttach: (mp3: SkidmarksMp3Attachment) => void;
  onDurationResolved: (durationSec: number) => void;
  onRemove: () => void;
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
 * waveform, a real play/pause over the actual picked file (via an
 * `<audio>` element + object URL — not persisted across reload, since a
 * `File` can't round-trip through `localStorage`), the filename, and the
 * real probed duration once the browser resolves it.
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
    onAttach(createMp3Attachment(file.name, null));
  };

  const handleLoadedMetadata = () => {
    const duration = audioRef.current?.duration;
    if (duration && Number.isFinite(duration)) {
      onDurationResolved(duration);
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
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

  return (
    <div className="rounded-2xl border border-rose-400/30 bg-rose-400/[0.03] p-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!audioUrl}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-400 text-zinc-950 transition-colors hover:bg-rose-300 active:bg-rose-400/80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        <Waveform fileName={mp3.fileName} progress={progress} />

        <span className="shrink-0 text-xs font-medium tabular-nums text-white/60">
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

      <p className="mt-2 truncate text-[11px] text-white/40">{mp3.fileName}</p>

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            setProgress(0);
          }}
          className="hidden"
        />
      )}
    </div>
  );
}
