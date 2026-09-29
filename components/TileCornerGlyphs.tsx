/**
 * The small line icons drawn inside the round corner buttons on a
 * square picker tile (Music video's "Choose a band" albums, Sunny
 * Banks' EPISODES cards), so both rows look and work the same.
 */

export function EditGlyph({ icon = "pencil" }: { icon?: "pencil" | "camera" }) {
  if (icon === "camera") {
    return (
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3 w-3">
        <path
          d="M4 7.5h2l1-1.5h6l1 1.5h2v8H4v-8Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="11.5" r="2" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3 w-3">
      <path
        d="M13.5 3.5 16 6l-8.5 8.5-3 1 1-3L13.5 3.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TrashGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3 w-3">
      <path
        d="M5 5.5h10M8.25 5.5v-1a1 1 0 0 1 1-1h1.5a1 1 0 0 1 1 1v1M6.25 5.5l.5 9a1 1 0 0 0 1 .95h4.5a1 1 0 0 0 1-.95l.5-9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DownloadGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3 w-3">
      <path
        d="M10 3.5v9M6.5 9 10 12.5 13.5 9M4.5 15.5h11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Shape of a round corner button on a tile (`h-6 w-6`). Colour classes
 * (normally `bg-black/50 text-white/80`) are added by the caller so a
 * state like "tap again to delete" can swap them cleanly. */
export const TILE_CORNER_BUTTON_CLASS =
  "absolute flex h-6 w-6 touch-manipulation items-center justify-center rounded-full backdrop-blur-sm transition-colors hover:text-white disabled:opacity-60";
