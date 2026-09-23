"use client";

interface SkidmarksPcHomeProps {
  onGoCreate: () => void;
  onGoLibrary: () => void;
}

/**
 * Minimal PC Home landing for the left-rail shell. Links into Create
 * (the existing Skidmarks desk) and Library (Finished Songs). No new
 * chrome Stuart stripped — just a quiet entry point.
 */
export function SkidmarksPcHome({ onGoCreate, onGoLibrary }: SkidmarksPcHomeProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Home</h1>
        <p className="max-w-xl text-sm leading-relaxed text-white/50">
          Deck on PC — Music video desk, Sunnybank, and your Finished Songs archive.
          Phone layout is unchanged under 1024px.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={onGoCreate}
          className="flex flex-col items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-5 text-left transition-colors hover:border-white/20 hover:bg-white/[0.06]"
        >
          <span className="text-xs font-medium uppercase tracking-wide text-rose-300/80">Create</span>
          <span className="text-base font-medium text-white">Open the desk</span>
          <span className="text-[13px] leading-snug text-white/40">
            Music video, Sunnybank, plates, Archive — the same workspace as on phone, full width.
          </span>
        </button>

        <button
          type="button"
          onClick={onGoLibrary}
          className="flex flex-col items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-5 text-left transition-colors hover:border-white/20 hover:bg-white/[0.06]"
        >
          <span className="text-xs font-medium uppercase tracking-wide text-fuchsia-300/80">Library</span>
          <span className="text-base font-medium text-white">Finished Songs</span>
          <span className="text-[13px] leading-snug text-white/40">
            Browse the archive list — Open in editor, Download zip, Delete.
          </span>
        </button>
      </div>
    </div>
  );
}
