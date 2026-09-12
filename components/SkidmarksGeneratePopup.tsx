"use client";

import { useCallback, useEffect, useState } from "react";
import { lookGradientClass, type SkidmarksLook, type SkidmarksMember } from "@/lib/skidmarks";

interface SkidmarksGeneratePopupProps {
  member: SkidmarksMember;
  onGenerate: (prompt: string, photoreal: number) => void;
  onRename: (name: string) => void;
  onClose: () => void;
}

const EMPTY_SLOT_COUNT = 3;
const DEFAULT_PHOTOREAL = 80;
/** Fake "rendering" pause so a tap doesn't just teleport a look into
 * existence — long enough to read as work happening, short enough not to
 * feel like a real render queue. No actual generation happens here. */
const GENERATE_DELAY_MS = 700;

function LookThumb({ look }: { look: SkidmarksLook }) {
  return (
    <div
      className={[
        "flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-gradient-to-br text-[10px] font-medium text-white/80 ring-1 ring-white/15",
        lookGradientClass(look.seed),
      ].join(" ")}
      title={look.prompt}
    >
      {look.photoreal}%
    </div>
  );
}

function EmptySlot() {
  return (
    <div
      aria-hidden
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-white/15 text-white/20"
    >
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M4 14.5 8 9l2.5 3L14 8l2 3v3.5H4Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <circle cx="7" cy="6.5" r="1.2" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </div>
  );
}

/**
 * Generate-artist popup — a simple centered modal, no side chrome. Looks
 * generated so far for *this one member* scroll horizontally across the
 * top (empty dashed slots before the first generate); below that, a name
 * field (this is how a blank "+ Add member" row gets a real name — see
 * `onRename`/`renameSkidmarksMember`), a prompt field, a Photoreal
 * 60–100% slider, and Generate/Cancel. Nothing here calls a real image
 * model — `buildMockLook` (via `onGenerate`) mints a deterministic
 * color-swatch stand-in. The name commits on blur, Cancel/X/Escape, and
 * right before Generate — so typing a name then generating (without ever
 * blurring the field) still saves it.
 */
export function SkidmarksGeneratePopup({
  member,
  onGenerate,
  onRename,
  onClose,
}: SkidmarksGeneratePopupProps) {
  const [name, setName] = useState(member.name);
  const [prompt, setPrompt] = useState("");
  const [photoreal, setPhotoreal] = useState(DEFAULT_PHOTOREAL);
  const [generating, setGenerating] = useState(false);

  const commitName = useCallback(() => {
    if (name.trim() !== member.name) onRename(name);
  }, [name, member.name, onRename]);

  const handleClose = useCallback(() => {
    commitName();
    onClose();
  }, [commitName, onClose]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleClose]);

  const handleGenerate = () => {
    if (generating) return;
    commitName();
    setGenerating(true);
    setTimeout(() => {
      onGenerate(prompt, photoreal);
      setGenerating(false);
      setPrompt("");
    }, GENERATE_DELAY_MS);
  };

  const hasLooks = member.looks.length > 0;
  const displayName = member.name.trim() || "New member";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={handleClose}
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Generate a look for ${displayName}`}
        className="relative z-10 w-full max-w-sm rounded-3xl border border-rose-400/25 bg-zinc-950 p-4 shadow-2xl animate-[sheet-in_0.18s_ease-out]"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-semibold text-white">
            Generate {"\u00b7"} {displayName}
          </h3>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
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

        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {hasLooks
            ? member.looks.map((look) => <LookThumb key={look.id} look={look} />)
            : Array.from({ length: EMPTY_SLOT_COUNT }).map((_, i) => (
                <EmptySlot key={i} />
              ))}
        </div>

        <label className="mt-4 block text-[11px] font-medium uppercase tracking-wide text-white/40">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          placeholder="Name this member"
          maxLength={40}
          autoFocus={!member.name.trim()}
          aria-label="Member name"
          className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-rose-400/40 focus:outline-none"
        />

        <label className="mt-3.5 block text-[11px] font-medium uppercase tracking-wide text-white/40">
          Prompt
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. chrome headphones, stage lights, leather jacket"
          rows={2}
          maxLength={240}
          autoFocus={Boolean(member.name.trim())}
          aria-label="Look prompt"
          className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-rose-400/40 focus:outline-none"
        />

        <div className="mt-3.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-white/40">
            <span>Photoreal</span>
            <span className="text-rose-300">{photoreal}%</span>
          </div>
          <input
            type="range"
            min={60}
            max={100}
            step={5}
            value={photoreal}
            onChange={(e) => setPhotoreal(Number(e.target.value))}
            aria-label="Photoreal percentage"
            className="w-full accent-rose-400"
          />
        </div>

        <div className="mt-4 flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="flex-1 rounded-full bg-rose-400 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-rose-300 active:bg-rose-400/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generating ? "Generating\u2026" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}
