"use client";

import { formatShotCastNames } from "@/lib/shotCast";

/**
 * Who is in a shot, as small chips: "Stuie + Bloom" (2026-10-03, Stuart's
 * multi-cast spec). The same component on every genre's rows and tiles
 * (Sunnybank, Music video, Shorts). Only drawn when two or more people
 * are in the shot, so a one-person row looks exactly as it did. A person
 * with no Cast card picture is red, matching the row's own red note.
 */
export interface CastChipsProps {
  names: readonly string[];
  /** Names with no picture yet (drawn red). */
  missing?: readonly string[];
  className?: string;
}

export function CastChips({ names, missing = [], className = "" }: CastChipsProps) {
  if (names.length < 2) return null;
  const isMissing = (name: string) => missing.some((m) => m.toLowerCase() === name.toLowerCase());
  return (
    <span
      className={`inline-flex min-w-0 max-w-full flex-wrap items-center gap-0.5 ${className}`}
      aria-label={`In this shot: ${formatShotCastNames(names)}`}
      title={`In this shot: ${formatShotCastNames(names)}`}
    >
      {names.map((name, i) => (
        <span key={name} className="inline-flex items-center gap-0.5">
          {i > 0 && <span aria-hidden className="text-[9px] text-white/40">+</span>}
          <span
            className={`truncate rounded-md px-1 py-px text-[10px] leading-tight ${
              isMissing(name) ? "bg-red-500/20 text-red-300" : "bg-cyan-500/15 text-cyan-200"
            }`}
          >
            {name}
          </span>
        </span>
      ))}
    </span>
  );
}
