"use client";

import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  getSkidmarksEpisodesState,
  getSkidmarksSnapshot,
  patchSkidmarksEpisodes,
  removeSkidmarksEpisode,
  subscribeSkidmarks,
} from "@/lib/skidmarks";
import {
  availableAntiheroes,
  buildStarterEpisode,
  episodeTotalSec,
  episodeWhereAntiheroDies,
  filledBeatCount,
  formatDuration,
  insertAtSelection,
  mintSkidmarksId,
  nextEpisodeTitle,
  SKIDMARKS_BEATS,
  SKIDMARKS_EPISODE_TARGET_MAX_SEC,
  SKIDMARKS_EPISODE_TARGET_MIN_SEC,
  tagBarEntries,
  type SkidmarksBeatId,
  type SkidmarksCastRole,
  type SkidmarksEpisode,
} from "@/lib/skidmarksEpisodes";

/**
 * Skidmarks episodes workspace (stage 1, 2026-09-27) — what the Skidmarks
 * landing tile opens. Four fixed tabs: Episodes, Cast, Plates, Library.
 * The episode editor lays out the nine-beat spine (plus intro/outro) as
 * cards, with a one-tap tag bar for `[Character: look]` / `[Location:]`.
 *
 * Stage 1 is scripts + cast names only. Nothing on this screen calls a
 * paid API. Locked faces/voices (stage 2), plates (stage 3) and the old
 * Skidmarks import come in later draft PRs.
 */

type Tab = "episodes" | "cast" | "plates" | "library";

const TABS: { id: Tab; label: string }[] = [
  { id: "episodes", label: "Episodes" },
  { id: "cast", label: "Cast" },
  { id: "plates", label: "Plates" },
  { id: "library", label: "Library" },
];

interface SkidmarksEpisodesPanelProps {
  onOpenLibrary?: () => void;
}

export function SkidmarksEpisodesPanel({ onOpenLibrary }: SkidmarksEpisodesPanelProps) {
  const snapshot = useSyncExternalStore(subscribeSkidmarks, getSkidmarksSnapshot, getSkidmarksSnapshot);
  const state = getSkidmarksEpisodesState(snapshot);
  const [tab, setTab] = useState<Tab>("episodes");
  const [openEpisodeId, setOpenEpisodeId] = useState<string | null>(null);
  const openEpisode = state.episodes.find((e) => e.id === openEpisodeId) ?? null;

  if (openEpisode) {
    return <EpisodeEditor episode={openEpisode} onBack={() => setOpenEpisodeId(null)} />;
  }

  return (
    <section aria-label="Skidmarks episodes" className="flex flex-col gap-4">
      <div role="tablist" className="grid grid-cols-4 border-b border-white/10">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={[
              "-mb-px border-b-2 py-2.5 text-center text-[13px] transition-colors",
              tab === t.id ? "border-amber-400 font-semibold text-white" : "border-transparent text-white/50 hover:text-white/80",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "episodes" && <EpisodesTab onOpen={setOpenEpisodeId} />}
      {tab === "cast" && <CastTab />}
      {tab === "plates" && (
        <Placeholder
          title="Plates"
          body="Your plate collection comes in the next stage, including the images from the old Skidmarks app. Picking an existing plate will be free; making a new one will be a separate button."
        />
      )}
      {tab === "library" && (
        <div className="flex flex-col gap-3">
          <Placeholder
            title="Library"
            body="Finished episodes will show in Library's Episodes tab once rendering is wired up."
          />
          {onOpenLibrary && (
            <button
              type="button"
              onClick={onOpenLibrary}
              className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <span>Open Library</span>
              <span aria-hidden className="text-white/40">{"\u203a"}</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 px-4 py-6 text-center">
      <p className="text-sm font-semibold text-white/80">{title}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-white/50">{body}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function EpisodesTab({ onOpen }: { onOpen: (id: string) => void }) {
  const snapshot = useSyncExternalStore(subscribeSkidmarks, getSkidmarksSnapshot, getSkidmarksSnapshot);
  const state = getSkidmarksEpisodesState(snapshot);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const sorted = useMemo(() => [...state.episodes].sort((a, b) => b.updatedAt - a.updatedAt), [state.episodes]);

  const create = () => {
    const ep = buildStarterEpisode(nextEpisodeTitle(state.episodes));
    patchSkidmarksEpisodes((s) => ({ ...s, episodes: [...s.episodes, ep] }));
    onOpen(ep.id);
  };

  const remove = (id: string) => {
    removeSkidmarksEpisode(id);
    setConfirmDeleteId(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={create}
        className="rounded-xl bg-amber-400 py-3 text-center text-[15px] font-bold text-black transition-colors hover:bg-amber-300"
      >
        + New episode
      </button>
      <p className="-mt-1 text-center text-[11px] text-white/45">
        Starts from the template: 9 beats, intro and outro, and an opening plate line
      </p>

      {sorted.length === 0 && (
        <p className="py-6 text-center text-xs text-white/40">No episodes yet.</p>
      )}

      {sorted.map((ep) => {
        const antihero = state.cast.find((c) => c.id === ep.antiheroId);
        const filled = filledBeatCount(ep);
        return (
          <div key={ep.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] p-3">
            <button type="button" onClick={() => onOpen(ep.id)} className="flex min-w-0 flex-1 flex-col text-left">
              <span className="truncate text-sm font-semibold text-white">{ep.title}</span>
              <span className="mt-0.5 text-[11px] text-white/50">
                {filled}/9 beats written · {formatDuration(episodeTotalSec(ep))}
              </span>
              <span className="mt-1.5 flex flex-wrap gap-1">
                {antihero ? (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-200">
                    Antihero: {antihero.name}
                  </span>
                ) : (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">No antihero yet</span>
                )}
                {ep.castIds.length > 0 && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">
                    {ep.castIds.length} cast
                  </span>
                )}
              </span>
            </button>
            {confirmDeleteId === ep.id ? (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => remove(ep.id)}
                  className="rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-white/70"
                >
                  Keep
                </button>
              </div>
            ) : (
              <button
                type="button"
                aria-label={`Delete ${ep.title}`}
                onClick={() => setConfirmDeleteId(ep.id)}
                className="rounded-lg px-2 py-1 text-white/35 hover:text-red-300"
              >
                {"\u2715"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CastTab() {
  const snapshot = useSyncExternalStore(subscribeSkidmarks, getSkidmarksSnapshot, getSkidmarksSnapshot);
  const state = getSkidmarksEpisodesState(snapshot);
  const [filter, setFilter] = useState<"all" | "antihero" | "supporting" | "retired">("all");
  const [name, setName] = useState("");
  const [look, setLook] = useState("");
  const [role, setRole] = useState<SkidmarksCastRole>("antihero");
  const [confirmed, setConfirmed] = useState(false);
  const [adding, setAdding] = useState(false);

  const rows = state.cast.filter((c) => {
    const dies = episodeWhereAntiheroDies(c.id, state.episodes);
    if (filter === "antihero") return c.role === "antihero" && !dies;
    if (filter === "supporting") return c.role === "supporting";
    if (filter === "retired") return Boolean(dies);
    return true;
  });

  const canAdd = name.trim().length > 0 && confirmed;

  const add = () => {
    if (!canAdd) return;
    const member = {
      id: mintSkidmarksId("cast"),
      name: name.trim(),
      role,
      look: look.trim(),
      fictionalAdultConfirmed: true as const,
      createdAt: Date.now(),
    };
    patchSkidmarksEpisodes((s) => ({ ...s, cast: [...s.cast, member] }));
    setName("");
    setLook("");
    setConfirmed(false);
    setAdding(false);
  };

  const removeMember = (id: string) => {
    patchSkidmarksEpisodes((s) => ({ ...s, cast: s.cast.filter((c) => c.id !== id) }));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["all", "All"],
            ["antihero", "Antiheroes"],
            ["supporting", "Supporting"],
            ["retired", "Retired \u2620"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={[
              "rounded-full px-3 py-1 text-xs",
              filter === id ? "bg-white font-semibold text-black" : "bg-white/10 text-white/60",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {rows.length === 0 && !adding && (
        <p className="py-4 text-center text-xs text-white/40">No characters here yet.</p>
      )}

      {rows.map((c) => {
        const dies = episodeWhereAntiheroDies(c.id, state.episodes);
        const usedAsSupport = state.episodes.some((e) => e.castIds.includes(c.id));
        const inUse = Boolean(dies) || usedAsSupport;
        return (
          <div key={c.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] p-3">
            <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-white/10 text-lg font-bold text-white/60">
              {c.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{c.name}</p>
              <p className="mt-0.5 flex flex-wrap gap-1 text-[10px]">
                {c.role === "antihero" ? (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-200">Antihero</span>
                ) : (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/60">Supporting</span>
                )}
                {dies && (
                  <span className="rounded-full bg-red-900/60 px-2 py-0.5 text-red-200">{"\u2620"} {dies.title}</span>
                )}
              </p>
              {c.look && <p className="mt-1 truncate text-[11px] text-white/45">Look: {c.look}</p>}
            </div>
            {!inUse && (
              <button
                type="button"
                aria-label={`Remove ${c.name}`}
                onClick={() => removeMember(c.id)}
                className="rounded-lg px-2 py-1 text-white/35 hover:text-red-300"
              >
                {"\u2715"}
              </button>
            )}
          </div>
        );
      })}

      {adding ? (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Character name"
            className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30"
          />
          <input
            value={look}
            onChange={(e) => setLook(e.target.value)}
            placeholder="Default look, e.g. hi-vis, mullet, sunburn"
            className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30"
          />
          <div className="grid grid-cols-2 gap-1.5">
            {(["antihero", "supporting"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={[
                  "rounded-lg py-2 text-xs",
                  role === r ? "bg-white font-semibold text-black" : "bg-white/10 text-white/60",
                ].join(" ")}
              >
                {r === "antihero" ? "Antihero" : "Supporting"}
              </button>
            ))}
          </div>
          <label className="flex items-start gap-2 text-[11px] leading-snug text-white/60">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span>This character is made up and clearly an adult. They aren&apos;t based on a real person&apos;s face or name.</span>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canAdd}
              onClick={add}
              className="flex-1 rounded-lg bg-amber-400 py-2 text-sm font-semibold text-black disabled:opacity-40"
            >
              Add to cast
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-xl border border-dashed border-white/20 py-2.5 text-sm text-white/70 hover:border-white/40"
        >
          + Add character
        </button>
      )}
      <p className="text-[11px] leading-relaxed text-white/40">
        Faces and voices get locked to each character in the next stage. An antihero headlines one episode, dies in beat 8, then moves to Retired.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function EpisodeEditor({ episode, onBack }: { episode: SkidmarksEpisode; onBack: () => void }) {
  const snapshot = useSyncExternalStore(subscribeSkidmarks, getSkidmarksSnapshot, getSkidmarksSnapshot);
  const state = getSkidmarksEpisodesState(snapshot);
  const [openBeat, setOpenBeat] = useState<SkidmarksBeatId | null>("b1");
  const textareaRefs = useRef<Partial<Record<SkidmarksBeatId, HTMLTextAreaElement | null>>>({});
  // Caret to restore after a tag insert — applied in the same commit as the
  // new text, so typing straight after a tap lands in the right place.
  const pendingCaret = useRef<{ beat: SkidmarksBeatId; caret: number } | null>(null);
  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    if (!pending) return;
    pendingCaret.current = null;
    const target = textareaRefs.current[pending.beat];
    if (!target) return;
    target.focus();
    target.setSelectionRange(pending.caret, pending.caret);
  });

  const patchEpisode = (updater: (ep: SkidmarksEpisode) => SkidmarksEpisode) => {
    patchSkidmarksEpisodes((s) => ({
      ...s,
      episodes: s.episodes.map((e) => (e.id === episode.id ? { ...updater(e), updatedAt: Date.now() } : e)),
    }));
  };

  const setBeat = (id: SkidmarksBeatId, patch: Partial<{ script: string; durationSec: number }>) => {
    patchEpisode((ep) => ({ ...ep, beats: { ...ep.beats, [id]: { ...ep.beats[id], ...patch } } }));
  };

  const antiheroes = availableAntiheroes(state, episode.id);
  const supporting = state.cast.filter((c) => c.role === "supporting");
  const hasAntihero = Boolean(episode.antiheroId);
  const total = episodeTotalSec(episode);
  const inTarget = total >= SKIDMARKS_EPISODE_TARGET_MIN_SEC && total <= SKIDMARKS_EPISODE_TARGET_MAX_SEC;
  const tags = tagBarEntries(episode, state.cast, snapshot.locations);

  const insertTag = (text: string) => {
    if (!openBeat) return;
    const el = textareaRefs.current[openBeat];
    const value = episode.beats[openBeat].script;
    const start = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    const next = insertAtSelection(value, start, end, text);
    pendingCaret.current = { beat: openBeat, caret: next.caret };
    setBeat(openBeat, { script: next.value });
  };

  return (
    <section aria-label={`Edit ${episode.title}`} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to episodes"
          className="rounded-lg px-2 py-1 text-lg text-white/70 hover:text-white"
        >
          {"\u2039"}
        </button>
        <input
          value={episode.title}
          onChange={(e) => patchEpisode((ep) => ({ ...ep, title: e.target.value }))}
          aria-label="Episode title"
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1 py-1 text-base font-bold text-white focus:border-white/15 focus:bg-black/30"
        />
      </div>

      <div className="flex flex-col gap-2 rounded-2xl bg-white/[0.03] p-3">
        <label className="flex items-center gap-2 text-xs text-white/60">
          <span className="w-16 flex-none">Antihero</span>
          <select
            value={episode.antiheroId ?? ""}
            onChange={(e) =>
              patchEpisode((ep) => {
                const id = e.target.value || null;
                return { ...ep, antiheroId: id, castIds: ep.castIds.filter((c) => c !== id) };
              })
            }
            className={[
              "min-w-0 flex-1 rounded-lg border bg-black/40 px-2 py-1.5 text-sm",
              hasAntihero ? "border-white/10 text-white" : "border-amber-400/60 text-amber-200",
            ].join(" ")}
          >
            <option value="">{antiheroes.length ? "Required: pick one" : "Add an antihero in Cast first"}</option>
            {antiheroes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {supporting.length > 0 && (
          <div className="flex items-start gap-2 text-xs text-white/60">
            <span className="w-16 flex-none pt-1">Cast</span>
            <div className="flex flex-1 flex-wrap gap-1.5">
              {supporting.map((c) => {
                const on = episode.castIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      patchEpisode((ep) => ({
                        ...ep,
                        castIds: on ? ep.castIds.filter((x) => x !== c.id) : [...ep.castIds, c.id],
                      }))
                    }
                    className={[
                      "rounded-full px-2.5 py-1 text-[11px]",
                      on ? "bg-white font-semibold text-black" : "bg-white/10 text-white/60",
                    ].join(" ")}
                  >
                    {on ? "\u2713 " : "+ "}
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {!hasAntihero && (
        <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          Every episode needs exactly one antihero. Pick one above to start writing the beats.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {SKIDMARKS_BEATS.map((meta) => {
          const beat = episode.beats[meta.id];
          const open = openBeat === meta.id;
          const bar = meta.isDeath ? "border-l-red-500" : meta.isBookend ? "border-l-white/20" : "border-l-amber-400";
          const preview = beat.script.trim().split(/\r?\n/).slice(0, 2).join("\n");
          return (
            <div key={meta.id} className={`rounded-xl border-l-4 bg-white/[0.04] ${bar}`}>
              <button
                type="button"
                onClick={() => setOpenBeat(open ? null : meta.id)}
                aria-expanded={open}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
              >
                <span className="text-[13px] font-semibold text-white">
                  {meta.number !== null ? `${meta.number} · ` : ""}
                  {meta.label}
                  {meta.isDeath ? " \u2620" : ""}
                </span>
                <span className="text-xs tabular-nums text-white/60">{formatDuration(beat.durationSec)}</span>
              </button>
              {!open && (
                <p className="whitespace-pre-line px-3 pb-2.5 text-[11px] leading-snug text-white/45">
                  {preview || meta.hint}
                </p>
              )}
              {open && (
                <div className="flex flex-col gap-2 px-3 pb-3">
                  <p className="text-[11px] text-white/45">{meta.hint}</p>
                  <textarea
                    ref={(el) => {
                      textareaRefs.current[meta.id] = el;
                    }}
                    value={beat.script}
                    disabled={!hasAntihero && !meta.isBookend}
                    onChange={(e) => setBeat(meta.id, { script: e.target.value })}
                    rows={6}
                    placeholder={hasAntihero || meta.isBookend ? "Write this beat…" : "Pick an antihero first"}
                    className="w-full touch-pan-y resize-y rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-[13px] leading-relaxed text-white placeholder:text-white/25 disabled:opacity-50"
                  />
                  <div className="flex items-center gap-2 text-xs text-white/60">
                    <span>Length</span>
                    <button
                      type="button"
                      aria-label="10 seconds shorter"
                      onClick={() => setBeat(meta.id, { durationSec: Math.max(0, beat.durationSec - 10) })}
                      className="rounded-md bg-white/10 px-2.5 py-0.5"
                    >
                      {"\u2212"}
                    </button>
                    <span className="w-10 text-center tabular-nums text-white">{formatDuration(beat.durationSec)}</span>
                    <button
                      type="button"
                      aria-label="10 seconds longer"
                      onClick={() => setBeat(meta.id, { durationSec: beat.durationSec + 10 })}
                      className="rounded-md bg-white/10 px-2.5 py-0.5"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-0 z-30 -mx-1 rounded-t-xl border-t border-white/10 bg-[#0d0d10]/95 backdrop-blur">
        <p className={`px-4 py-1.5 text-[11px] ${inTarget ? "text-emerald-300" : "text-amber-200"}`}>
          Total {formatDuration(total)} (aim for 8:00 to 10:00). Nothing is spent on this screen.
        </p>
        <div className="flex gap-1.5 overflow-x-auto px-3 pb-[max(env(safe-area-inset-bottom),0.6rem)] pt-0.5 touch-pan-x touch-pan-y">
          {tags.map((t) => (
            <button
              key={t.label}
              type="button"
              disabled={!openBeat}
              // Keep the textarea focused (and the iPhone keyboard up) when a tag is tapped.
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertTag(t.insert)}
              className="flex-none rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-1.5 font-mono text-xs text-amber-200 disabled:opacity-40"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
