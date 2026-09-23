"use client";

export type DeckPcRailId = "home" | "create" | "library";

interface DeckPcRailProps {
  active: DeckPcRailId;
  onSelect: (id: DeckPcRailId) => void;
  onClose: () => void;
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path
        d="M4.5 10.5 12 4l7.5 6.5V20a1 1 0 0 1-1 1h-4.25v-5.5h-4.5V21H5.5a1 1 0 0 1-1-1v-9.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.2 : 0}
      />
    </svg>
  );
}

function CreateIcon({ active }: { active: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {active && (
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
      )}
    </svg>
  );
}

function LibraryIcon({ active }: { active: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path
        d="M5 4.5h4.5v15H5zM10.5 4.5H15v15h-4.5zM16.5 6.5 20 5v13.5l-3.5 1.5V6.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.18 : 0}
      />
    </svg>
  );
}

const ITEMS: { id: DeckPcRailId; label: string; Icon: typeof HomeIcon }[] = [
  { id: "home", label: "Home", Icon: HomeIcon },
  { id: "create", label: "Create", Icon: CreateIcon },
  { id: "library", label: "Library", Icon: LibraryIcon },
];

/**
 * Left rail for the PC Skidmarks shell (≥1024px). Suno-like dark strip:
 * Home / Create / Library. Phone layouts never mount this.
 */
export function DeckPcRail({ active, onSelect, onClose }: DeckPcRailProps) {
  return (
    <nav
      aria-label="Deck"
      className="flex h-full w-56 shrink-0 flex-col border-r border-white/10 bg-zinc-950/95"
    >
      <div className="flex items-center gap-2 px-4 pb-3 pt-5">
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-400/15 text-sm font-semibold text-rose-300"
        >
          {"\u2665"}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">Deck</p>
          <p className="truncate text-[11px] text-white/40">Skidmarks</p>
        </div>
      </div>

      <ul className="flex flex-1 flex-col gap-1 px-2 py-2">
        {ITEMS.map(({ id, label, Icon }) => {
          const isActive = active === id;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onSelect(id)}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors",
                  isActive
                    ? "bg-white/[0.08] text-white"
                    : "text-white/55 hover:bg-white/[0.04] hover:text-white/85",
                ].join(" ")}
              >
                <span className={isActive ? "text-white" : "text-white/45"}>
                  <Icon active={isActive} />
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-white/10 p-3">
        <button
          type="button"
          onClick={onClose}
          className="flex w-full items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] font-medium text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white/85"
        >
          Back to map
        </button>
      </div>
    </nav>
  );
}
