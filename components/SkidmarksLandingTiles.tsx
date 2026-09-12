"use client";

import { SKIDMARKS_PROJECT_KINDS, type SkidmarksProjectKind } from "@/lib/skidmarks";

interface SkidmarksLandingTilesProps {
  activeKind: SkidmarksProjectKind | null;
  onSelect: (kind: SkidmarksProjectKind) => void;
}

function TileIcon({ icon }: { icon: "note" | "tire" | "sun" }) {
  if (icon === "note") {
    return (
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <path
          d="M8 14.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 0V5l6.5-1.3v7"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14.5 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    );
  }
  if (icon === "tire") {
    return (
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="10" cy="10" r="2.75" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 3v3.25M10 13.75V17M3 10h3.25M13.75 10H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-5 w-5">
      <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.6 4.6l1.4 1.4M14 14l1.4 1.4M15.4 4.6 14 6M6 14l-1.4 1.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

const KIND_ACCENT: Record<
  string,
  { ring: string; icon: string; label: string }
> = {
  "music-video": {
    ring: "border-fuchsia-400/40 hover:border-fuchsia-400/70",
    icon: "text-fuchsia-300",
    label: "text-white",
  },
  skidmarks: {
    ring: "border-rose-400/30 hover:border-rose-400/50",
    icon: "text-rose-300",
    label: "text-white/70",
  },
  sunnybank: {
    ring: "border-amber-400/30 hover:border-amber-400/50",
    icon: "text-amber-300",
    label: "text-white/70",
  },
};

/**
 * Landing — the one horizontal row of three compact project-type tiles
 * ("Start a project"). Only "Music video" (`enabled: true` in
 * `SKIDMARKS_PROJECT_KINDS`) actually continues the scroll below; the
 * other two render for visual completeness (matching the locked mockup)
 * but are inert — this build stops at Music video → MP3, per scope.
 */
export function SkidmarksLandingTiles({ activeKind, onSelect }: SkidmarksLandingTilesProps) {
  return (
    <div>
      <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-white/40">
        Start a project
      </p>
      <div className="grid grid-cols-3 gap-2.5">
        {SKIDMARKS_PROJECT_KINDS.map((k) => {
          const accent = KIND_ACCENT[k.kind];
          const active = activeKind === k.kind;
          return (
            <button
              key={k.kind}
              type="button"
              disabled={!k.enabled}
              onClick={() => k.enabled && onSelect(k.kind)}
              aria-pressed={active}
              aria-disabled={!k.enabled}
              title={k.enabled ? undefined : "Coming soon"}
              className={[
                "flex flex-col items-center justify-center gap-1.5 rounded-2xl border bg-white/[0.02] px-2 py-4 text-center transition-colors",
                accent.ring,
                active ? "bg-white/[0.05]" : "",
                k.enabled ? "cursor-pointer" : "cursor-not-allowed opacity-50",
              ].join(" ")}
            >
              <span className={accent.icon}>
                <TileIcon icon={k.icon} />
              </span>
              <span className={`text-xs font-medium ${accent.label}`}>{k.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
