"use client";

export interface ActionChipItem {
  id: string;
  label: string;
  /** Label shown while `pending` — defaults to `${label}…`. */
  pendingLabel?: string;
  onSelect: () => void;
  disabled?: boolean;
  pending?: boolean;
}

interface ActionChipsProps {
  items: ActionChipItem[];
}

/**
 * Generic row of small pill action buttons — deliberately dumb (no
 * fetch/clipboard logic, no built-in feedback state) so it can sit under
 * any graph node's detail sheet. Propfolio's is the first caller
 * (`PropfolioDetailSheet`); a future Budju panel can reuse it with its own
 * `items` without any changes here. Callers own what each chip does and
 * how they surface the result (see `PropfolioDetailSheet`'s feedback line).
 */
export function ActionChips({ items }: ActionChipsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={item.onSelect}
          disabled={item.disabled || item.pending}
          className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white active:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {item.pending ? item.pendingLabel ?? `${item.label}\u2026` : item.label}
        </button>
      ))}
    </div>
  );
}
