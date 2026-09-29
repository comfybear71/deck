"use client";

import { SKIDMARKS_PROJECT_KINDS, type SkidmarksProjectKind } from "@/lib/skidmarks";

interface SkidmarksLandingTilesProps {
  activeKind: SkidmarksProjectKind | null;
  onSelect: (kind: SkidmarksProjectKind) => void;
}

function TileIcon({ icon }: { icon: "note" | "tire" | "sun" | "adult" | "face" }) {
  if (icon === "face") {
    return (
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <circle cx="10" cy="7" r="3.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3.75 17c.8-3.1 3.2-4.75 6.25-4.75S15.45 13.9 16.25 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (icon === "adult") {
    return (
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-5 w-5">
        <rect x="2.5" y="4.5" width="15" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
        <text x="10" y="12.6" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="currentColor">18+</text>
      </svg>
    );
  }
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
  "adult-shorts": {
    ring: "border-red-400/40 hover:border-red-400/60",
    icon: "text-red-300",
    label: "text-white",
  },
  characters: {
    ring: "border-sky-400/40 hover:border-sky-400/60",
    icon: "text-sky-300",
    label: "text-white",
  },
};

/**
 * Landing — the one horizontal row of four compact project-type tiles
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
      <div className="grid grid-cols-4 gap-2">
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
                "flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl border bg-white/[0.02] px-1 py-4 text-center transition-colors",
                // Real reported gap (2026-09-15): every tile used to show
                // its own accent-colored ring *all the time*, active or
                // not — the only difference for "selected" was a barely-
                // visible background tint, which read on a real phone as
                // "Music video and Sunnybank are both on." An inactive
                // tile now gets a plain neutral border regardless of its
                // own accent color; only the genuinely active one gets
                // its accent ring + a visibly brighter background, so
                // there's exactly one obvious answer to "which is on."
                active ? `${accent.ring} bg-white/[0.08]` : "border-white/10 hover:border-white/20",
                k.enabled ? "cursor-pointer" : "cursor-not-allowed opacity-50",
              ].join(" ")}
            >
              <span className={active ? accent.icon : "text-white/40"}>
                <TileIcon icon={k.icon} />
              </span>
              <span className={`text-xs font-medium leading-tight ${active ? accent.label : "text-white/50"}`}>{k.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
