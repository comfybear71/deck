"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AUTO_PICTURE_TARGET,
  CHARACTER_LORA_ESTIMATED_COST_USD,
  CHARACTER_LORA_MIN_IMAGES,
  SIRAY_PICTURE_COST_USD,
  buildCharacterLoraEntry,
  formatCostUsd,
  type CharacterLoraEntry,
  type CharacterTrainingStyle,
} from "@/lib/characterLoras";
import {
  AutoLoraError,
  ensureTrainingPicture,
  makeSirayPicture,
  referenceDataUrlFor,
  startCharacterTraining,
} from "@/lib/characterAutoLora";
import {
  ROSTER_GROUPS,
  buildCharacterRoster,
  buildFacePrompt,
  buildTrainingPicturePrompts,
  entryForRosterCharacter,
  oneTapCost,
  startingPictures,
  type RosterCharacter,
} from "@/lib/characterRoster";
import {
  flushSkidmarksSessionNow,
  getCharacterLorasState,
  patchCharacterLoras,
  type SkidmarksState,
} from "@/lib/skidmarks";

/**
 * The thumbnail grid at the top of the Characters screen (2026-09-29):
 * every character Deck already knows, in three groups. Tap a face, tap
 * the confirm button, and the rest happens on its own — Siray makes
 * about 15 training pictures from that face, Replicate trains, and the
 * server converts and uploads the files (the card list below shows the
 * Comfy links once it's done). Progress is saved after every picture, so
 * closing the page just pauses it; it carries on next time this screen
 * opens.
 */

const SIRAY_AT_ONCE = 4;
/** Characters worked on at the same time when several are queued (Train everyone). */
const CHARACTERS_AT_ONCE = 2;
const MAX_FAILED_ROUNDS = 3;

const STYLE_LABELS: Record<CharacterTrainingStyle, string> = {
  photo: "Real-looking face",
  cartoon: "Cartoon",
  faceless: "Face hidden",
};

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function patchEntry(id: string, patch: Partial<CharacterLoraEntry>) {
  patchCharacterLoras((s) => ({ characters: s.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
}

function findEntry(id: string): CharacterLoraEntry | null {
  return getCharacterLorasState().characters.find((c) => c.id === id) ?? null;
}

function Badge({ char, entry }: { char: RosterCharacter; entry: CharacterLoraEntry | null }) {
  if (char.blockedReason) return <span className="absolute right-1 top-1 rounded bg-black/70 px-1 text-[10px]">🔒</span>;
  if (!entry) return null;
  if (entry.status === "ready")
    return (
      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-white">
        ✓
      </span>
    );
  if (entry.status === "making" || entry.status === "training" || entry.status === "finishing")
    return (
      <span className="absolute right-1 top-1 rounded-full bg-amber-500/90 px-1.5 text-[10px] font-medium text-black">
        {entry.status === "making" ? `${entry.trainingImageUrls.length}/${entry.autoPictureTarget ?? AUTO_PICTURE_TARGET}` : "…"}
      </span>
    );
  if (entry.awaitingReview && entry.status === "draft")
    return (
      <span className="absolute right-1 top-1 rounded-full bg-sky-500 px-1.5 text-[10px] font-semibold text-white">Check</span>
    );
  if (entry.status === "failed")
    return <span className="absolute right-1 top-1 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">!</span>;
  return null;
}

export function CharacterRosterGrid({ snapshot }: { snapshot: SkidmarksState }) {
  const roster = useMemo(() => buildCharacterRoster(snapshot), [snapshot]);
  const { characters } = getCharacterLorasState(snapshot);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [styleOverride, setStyleOverride] = useState<Record<string, CharacterTrainingStyle>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<Record<string, string>>({});
  const [armedGroup, setArmedGroup] = useState<string | null>(null);
  const running = useRef(new Set<string>());
  const refCache = useRef(new Map<string, string>());

  const allChars = useMemo(() => ROSTER_GROUPS.flatMap((g) => roster[g.id]), [roster]);
  const charByKey = useMemo(() => new Map(allChars.map((c) => [c.sourceKey, c])), [allChars]);

  const fail = (id: string, msg: string) => {
    patchEntry(id, { status: "failed", error: msg, autoPictureTarget: null });
    flushSkidmarksSessionNow();
  };

  /** Makes pictures until the target, then starts training. Safe to call twice; the second call is ignored. */
  const runMaking = async (entryId: string) => {
    if (running.current.has(entryId)) return;
    running.current.add(entryId);
    let failedRounds = 0;
    try {
      for (;;) {
        const e = findEntry(entryId);
        if (!e || e.status !== "making") return;
        const char: Pick<RosterCharacter, "name" | "look" | "neverShow" | "style"> & Partial<RosterCharacter> =
          (e.sourceKey && charByKey.get(e.sourceKey)) || { name: e.name, look: "", neverShow: "", style: e.trainingStyle };
        const withStyle = { ...char, style: e.trainingStyle };

        if (e.trainingImageUrls.length === 0) {
          const starts =
            "sourceKey" in char && char.sourceKey
              ? startingPictures(char as RosterCharacter, e)
              : e.referenceUrl
                ? [e.referenceUrl]
                : [];
          const urls: string[] = [];
          for (const s of starts) {
            try {
              urls.push(await ensureTrainingPicture(s));
            } catch {
              /* skip a picture that won't load; Siray fills the gap */
            }
          }
          if (urls.length === 0) return fail(entryId, "Couldn't load their picture to start from.");
          patchEntry(entryId, { trainingImageUrls: urls, referenceUrl: e.referenceUrl ?? urls[0] });
          flushSkidmarksSessionNow();
          continue;
        }

        const target = e.autoPictureTarget ?? AUTO_PICTURE_TARGET;
        const have = e.trainingImageUrls.length;
        if (have >= target) {
          // Stop for a look. Training only starts from "Train on these".
          patchEntry(entryId, { status: "draft", awaitingReview: true, autoPictureTarget: null, error: null });
          flushSkidmarksSessionNow();
          return;
        }

        const refSrc = e.referenceUrl ?? e.trainingImageUrls[0];
        let refData = refCache.current.get(refSrc);
        if (!refData) {
          refData = await referenceDataUrlFor(refSrc);
          refCache.current.set(refSrc, refData);
        }
        const prompts = buildTrainingPicturePrompts(withStyle, Math.min(SIRAY_AT_ONCE, target - have), have);
        const results = await Promise.allSettled(prompts.map((p) => makeSirayPicture(p, refData!)));
        const made = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
        if (made.length > 0) {
          failedRounds = 0;
          patchCharacterLoras((s) => ({
            characters: s.characters.map((c) =>
              c.id === entryId ? { ...c, trainingImageUrls: [...c.trainingImageUrls, ...made].slice(0, target) } : c,
            ),
          }));
          flushSkidmarksSessionNow();
        } else {
          failedRounds++;
          const errors = results.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
          const permanent = errors.find((er) => er instanceof AutoLoraError && er.permanent);
          if (permanent || failedRounds >= MAX_FAILED_ROUNDS) {
            const first = (permanent ?? errors[0]) as Error | undefined;
            return fail(entryId, first?.message || "Siray kept failing, so this stopped. Tap to try again.");
          }
        }
      }
    } catch (err) {
      fail(entryId, err instanceof Error ? err.message : "Something went wrong. Tap to try again.");
    } finally {
      running.current.delete(entryId);
    }
  };

  /** Starts queued characters, a couple at a time, until none are left waiting. */
  const pump = () => {
    const waiting = getCharacterLorasState().characters.filter((c) => c.status === "making" && !running.current.has(c.id));
    for (const c of waiting) {
      if (running.current.size >= CHARACTERS_AT_ONCE) return;
      void runMaking(c.id).then(pump);
    }
  };

  // Carry on any run that was going when the page closed.
  const makingKey = characters
    .filter((c) => c.status === "making")
    .map((c) => c.id)
    .join(",");
  useEffect(() => {
    if (makingKey) pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [makingKey]);

  const styleFor = (char: RosterCharacter, entry: CharacterLoraEntry | null): CharacterTrainingStyle =>
    styleOverride[char.sourceKey] ?? entry?.trainingStyle ?? char.style;

  const ensureEntry = (char: RosterCharacter, style: CharacterTrainingStyle): CharacterLoraEntry => {
    const existing = entryForRosterCharacter(getCharacterLorasState().characters, char.sourceKey);
    if (existing) return existing;
    const created = buildCharacterLoraEntry(
      char.name,
      getCharacterLorasState().characters.map((c) => c.slug),
      new Date(),
      { sourceKey: char.sourceKey, trainingStyle: style, subjectWord: char.subjectWord },
    );
    patchCharacterLoras((s) => ({ characters: [...s.characters, created] }));
    return created;
  };

  const startOneTap = (char: RosterCharacter) => {
    const style = styleFor(char, entryForRosterCharacter(characters, char.sourceKey));
    const entry = ensureEntry(char, style);
    patchEntry(entry.id, {
      status: "making",
      trainingStyle: style,
      fictionalAdultConfirmed: true,
      error: null,
      awaitingReview: false,
      autoPictureTarget: Math.max(AUTO_PICTURE_TARGET, entry.trainingImageUrls.length),
    });
    flushSkidmarksSessionNow();
    pump();
  };

  /** Who "Train everyone" would start in a group, and what it costs. */
  const groupPlan = (list: RosterCharacter[]) => {
    const ready: RosterCharacter[] = [];
    let needFace = 0;
    let totalUsd = 0;
    for (const c of list) {
      if (c.blockedReason) continue;
      const entry = entryForRosterCharacter(characters, c.sourceKey);
      if (entry && ((entry.status !== "draft" && entry.status !== "failed") || entry.awaitingReview)) continue;
      if (!(entry?.referenceUrl ?? c.thumbUrl)) {
        needFace++;
        continue;
      }
      ready.push(c);
      const starting = entry && entry.trainingImageUrls.length > 0 ? entry.trainingImageUrls.length : startingPictures(c, entry).length;
      totalUsd += oneTapCost(starting).totalUsd;
    }
    return { ready, needFace, totalUsd: Math.round(totalUsd * 100) / 100 };
  };

  const trainChecked = async (char: RosterCharacter, entry: CharacterLoraEntry) => {
    setBusyKey(char.sourceKey);
    setMessage((m) => ({ ...m, [char.sourceKey]: "" }));
    try {
      const fresh = findEntry(entry.id) ?? entry;
      patchEntry(entry.id, await startCharacterTraining({ ...fresh, fictionalAdultConfirmed: true }));
      patchEntry(entry.id, { fictionalAdultConfirmed: true });
      flushSkidmarksSessionNow();
    } catch (err) {
      setMessage((m) => ({ ...m, [char.sourceKey]: err instanceof Error ? err.message : "Training didn't start." }));
    } finally {
      setBusyKey(null);
    }
  };

  const removeReviewPicture = (entry: CharacterLoraEntry, url: string) => {
    patchEntry(entry.id, { trainingImageUrls: entry.trainingImageUrls.filter((u) => u !== url) });
    flushSkidmarksSessionNow();
  };

  const makeFace = async (char: RosterCharacter) => {
    setBusyKey(char.sourceKey);
    setMessage((m) => ({ ...m, [char.sourceKey]: "" }));
    try {
      const style = styleFor(char, entryForRosterCharacter(characters, char.sourceKey));
      const entry = ensureEntry(char, style);
      const url = await makeSirayPicture(buildFacePrompt({ ...char, style }), null);
      patchEntry(entry.id, { referenceUrl: url, trainingImageUrls: [], status: "draft", error: null, trainingStyle: style });
      flushSkidmarksSessionNow();
    } catch (err) {
      setMessage((m) => ({ ...m, [char.sourceKey]: err instanceof Error ? err.message : "Siray couldn't make a face." }));
    } finally {
      setBusyKey(null);
    }
  };

  const selected = selectedKey ? charByKey.get(selectedKey) ?? null : null;

  const renderSelected = (char: RosterCharacter) => {
    const entry = entryForRosterCharacter(characters, char.sourceKey);
    const face = entry?.referenceUrl ?? char.thumbUrl;
    const style = styleFor(char, entry);
    const starting = entry && entry.trainingImageUrls.length > 0 ? entry.trainingImageUrls.length : startingPictures(char, entry).length;
    const cost = oneTapCost(starting);
    const busy = busyKey === char.sourceKey;
    const status = entry?.status;
    const canTrain = Boolean(face) && !char.blockedReason && status !== "making" && status !== "training" && status !== "finishing";

    return (
      <div className="col-span-full rounded-xl border border-sky-400/25 bg-black/30 p-3">
        <div className="flex items-start gap-3">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-white/5">
            {face ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={face} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg text-white/40">{initials(char.name)}</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold text-white">{char.name}</p>
              <button type="button" onClick={() => setSelectedKey(null)} className="text-xs text-white/40" aria-label="Close">
                ✕
              </button>
            </div>

            {char.blockedReason ? (
              <p className="mt-1 text-xs text-red-200/80">{char.blockedReason}</p>
            ) : status === "ready" ? (
              <div className="mt-1 flex flex-col gap-1.5">
                <p className="text-xs text-emerald-200/80">
                  Trained{entry?.importedToComfy ? " and imported into Comfy" : ""}. The Comfy import links are on their card
                  below.
                </p>
                <button
                  type="button"
                  onClick={() => document.getElementById(`clora-card-${entry!.id}`)?.scrollIntoView({ behavior: "smooth" })}
                  className="self-start rounded-md border border-white/15 px-2.5 py-1 text-xs text-white/80"
                >
                  Show card
                </button>
              </div>
            ) : entry?.awaitingReview && status === "draft" ? (
              <div className="mt-1 flex flex-col gap-2">
                <p className="text-xs text-white/60">
                  Siray made these. Remove any that don&apos;t look like {char.name} (wrong face, extra people, odd hands), then
                  train. Training is about {formatCostUsd(CHARACTER_LORA_ESTIMATED_COST_USD)}.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => trainChecked(char, entry)}
                    disabled={busy || entry.trainingImageUrls.length < CHARACTER_LORA_MIN_IMAGES}
                    className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    {busy ? "Starting…" : `Train on these ${entry.trainingImageUrls.length}`}
                  </button>
                  {entry.trainingImageUrls.length < AUTO_PICTURE_TARGET && (
                    <button
                      type="button"
                      onClick={() => startOneTap(char)}
                      disabled={busy}
                      className="rounded-md border border-white/20 px-3 py-1.5 text-xs text-white/85 disabled:opacity-40"
                    >
                      Make {AUTO_PICTURE_TARGET - entry.trainingImageUrls.length} more ·{" "}
                      {formatCostUsd((AUTO_PICTURE_TARGET - entry.trainingImageUrls.length) * SIRAY_PICTURE_COST_USD)}
                    </button>
                  )}
                </div>
                {entry.trainingImageUrls.length < CHARACTER_LORA_MIN_IMAGES && (
                  <p className="text-[11px] text-amber-200/80">Needs at least {CHARACTER_LORA_MIN_IMAGES} pictures to train.</p>
                )}
                {message[char.sourceKey] && <p className="text-xs text-red-300">{message[char.sourceKey]}</p>}
              </div>
            ) : status === "making" ? (
              <p className="mt-1 text-xs text-amber-100/80">
                Making training pictures with Siray: {entry!.trainingImageUrls.length} of{" "}
                {entry!.autoPictureTarget ?? AUTO_PICTURE_TARGET}. Training starts by itself after that. Keep this screen open,
                or come back later and it carries on.
              </p>
            ) : status === "training" || status === "finishing" ? (
              <p className="mt-1 text-xs text-amber-100/80">Training on Replicate, about 5 to 7 minutes. The tick appears when it&apos;s done.</p>
            ) : (
              <div className="mt-1 flex flex-col gap-2">
                {status === "failed" && entry?.error && <p className="text-xs text-red-300">{entry.error}</p>}
                {!face ? (
                  <>
                    <p className="text-xs text-white/60">
                      {char.name} doesn&apos;t have a picture yet. Siray can draw one from their description, then you decide
                      whether to train on it.
                    </p>
                    {char.look && <p className="line-clamp-2 text-[11px] italic text-white/40">{char.look}</p>}
                  </>
                ) : (
                  <p className="text-xs text-white/60">
                    Siray makes {cost.sirayPictures} more pictures of {char.name} from this one (
                    {formatCostUsd(cost.sirayPictures * SIRAY_PICTURE_COST_USD)}). You check them, then training is about{" "}
                    {formatCostUsd(CHARACTER_LORA_ESTIMATED_COST_USD)}. Tapping confirms {char.name} is made up, clearly an
                    adult, and not a real person.
                  </p>
                )}
                <label className="flex items-center gap-1.5 text-[11px] text-white/50">
                  Style
                  <select
                    value={style}
                    onChange={(e) => setStyleOverride((s) => ({ ...s, [char.sourceKey]: e.target.value as CharacterTrainingStyle }))}
                    className="rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-[11px] text-white"
                  >
                    {(Object.keys(STYLE_LABELS) as CharacterTrainingStyle[]).map((s) => (
                      <option key={s} value={s}>
                        {STYLE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  {canTrain && (
                    <button
                      type="button"
                      onClick={() => startOneTap(char)}
                      disabled={busy}
                      className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                    >
                      {status === "failed" ? "Try again" : "Make pictures"} · {formatCostUsd(cost.sirayPictures * SIRAY_PICTURE_COST_USD)}
                    </button>
                  )}
                  {!char.thumbUrl && (
                    <button
                      type="button"
                      onClick={() => makeFace(char)}
                      disabled={busy}
                      className="rounded-md border border-white/20 px-3 py-1.5 text-xs text-white/85 disabled:opacity-40"
                    >
                      {busy ? "Drawing…" : face ? "Try another face" : "Make a face"} · {formatCostUsd(SIRAY_PICTURE_COST_USD)}
                    </button>
                  )}
                </div>
                {message[char.sourceKey] && <p className="text-xs text-red-300">{message[char.sourceKey]}</p>}
              </div>
            )}
          </div>
        </div>
        {entry && entry.trainingImageUrls.length > 0 && (entry.awaitingReview || status === "making") && (
          <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {entry.trainingImageUrls.map((u) => (
              <div key={u} className="relative aspect-square overflow-hidden rounded-md bg-white/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" className="h-full w-full object-cover" />
                {entry.awaitingReview && status === "draft" && (
                  <button
                    type="button"
                    onClick={() => removeReviewPicture(entry, u)}
                    className="absolute right-0.5 top-0.5 rounded bg-black/75 px-1.5 text-[11px] text-red-300"
                    aria-label="Remove picture"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {ROSTER_GROUPS.map((g) => {
        const list = roster[g.id];
        const done = list.filter((c) => entryForRosterCharacter(characters, c.sourceKey)?.status === "ready").length;
        const plan = groupPlan(list);
        return (
          <div key={g.id}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/60">{g.label}</p>
              {list.length > 0 && (
                <div className="flex items-center gap-2">
                  <p className="text-[11px] text-white/35">
                    {done} of {list.length} trained
                  </p>
                  {plan.ready.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (armedGroup !== g.id) return setArmedGroup(g.id);
                        setArmedGroup(null);
                        for (const c of plan.ready) startOneTap(c);
                      }}
                      onBlur={() => setArmedGroup(null)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium text-white ${
                        armedGroup === g.id ? "bg-sky-500" : "bg-sky-500/50 hover:bg-sky-500/70"
                      }`}
                    >
                      {armedGroup === g.id
                        ? `Tap again: ${plan.ready.length} for ~${formatCostUsd(plan.totalUsd)}`
                        : "Make everyone's pictures"}
                    </button>
                  )}
                </div>
              )}
            </div>
            {armedGroup === g.id && (
              <p className="mb-2 text-[11px] leading-relaxed text-white/50">
                Makes pictures for {plan.ready.map((c) => c.name).join(", ")}, two at a time. Each one then waits for you to
                check the pictures and tap Train (that total includes training). Tapping again confirms they&apos;re all made up,
                clearly adults, and not real people.
                {plan.needFace > 0 && ` ${plan.needFace} without a picture ${plan.needFace === 1 ? "is" : "are"} skipped until you make and okay a face.`}
              </p>
            )}
            {list.length === 0 ? (
              <p className="text-[11px] text-white/35">
                {g.id === "skidmarks" ? "No cast yet. Add cast on the Skidmarks screen." : "No characters yet."}
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {list.map((c) => {
                  const entry = entryForRosterCharacter(characters, c.sourceKey);
                  const face = entry?.referenceUrl ?? c.thumbUrl;
                  const isSel = selectedKey === c.sourceKey;
                  return (
                    <button
                      key={c.sourceKey}
                      type="button"
                      onClick={() => setSelectedKey(isSel ? null : c.sourceKey)}
                      className={`flex min-w-0 flex-col items-center gap-1 rounded-lg p-1 text-left ${isSel ? "bg-sky-500/15" : ""}`}
                    >
                      <span
                        className={`relative block aspect-square w-full overflow-hidden rounded-lg bg-white/5 ${
                          c.blockedReason ? "opacity-40" : ""
                        } ${entry?.status === "ready" ? "ring-2 ring-emerald-400/70" : ""}`}
                      >
                        {face ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={face} alt="" className="h-full w-full object-cover object-top" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-sm text-white/40">{initials(c.name)}</span>
                        )}
                        <Badge char={c} entry={entry} />
                      </span>
                      <span className="w-full truncate text-center text-[11px] text-white/75">{c.name}</span>
                    </button>
                  );
                })}
                {selected && selected.group === g.id && renderSelected(selected)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
