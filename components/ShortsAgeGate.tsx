"use client";

import { flushSkidmarksSessionNow, patchAdultShorts } from "@/lib/skidmarks";

/**
 * Shorts' one-time 18+ confirm (2026-10-05: moved out of the old shot-card
 * editor, which Shorts no longer shows; every Shorts episode opens in the
 * script studio). Same words and the same saved tick as before.
 */
export function ShortsAgeGate() {
  return (
    <section className="rounded-2xl border border-red-400/30 bg-red-500/[0.04] p-5">
      <p className="text-sm font-semibold text-white">Shorts are 18+ only</p>
      <p className="mt-2 text-sm leading-relaxed text-white/60">
        Everything made here must show a made-up, AI-created adult who is clearly over 25 and isn&apos;t based on a real
        person&apos;s face or photo. Spicy and nudity are fine, but no sex acts. Every prompt gets those rules added
        automatically.
      </p>
      <button
        type="button"
        onClick={() => {
          patchAdultShorts((s) => ({ ...s, ageConfirmed: true }));
          flushSkidmarksSessionNow();
        }}
        className="mt-4 rounded-md bg-red-500/80 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
      >
        I&apos;m 18+, continue
      </button>
    </section>
  );
}
