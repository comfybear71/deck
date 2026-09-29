"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AUTO_PICTURE_TARGET,
  CHARACTER_LORA_ESTIMATED_COST_USD,
  CHARACTER_LORA_MAX_IMAGES,
  CHARACTER_LORA_RECOMMENDED,
  buildCharacterLoraEntry,
  comfyImportedName,
  comfyPromptSnippet,
  formatCostUsd,
  hfResolveLink,
  loraFileNames,
  nextTrainingVersion,
  trainBlocker,
  type CharacterTrainingStyle,
  trainBlockerMessage,
  type CharacterLoraEntry,
} from "@/lib/characterLoras";
import { startCharacterTraining } from "@/lib/characterAutoLora";
import { uploadSkidmarksMemberPhoto } from "@/lib/memberPhotoBlob";
import { buildCharacterRoster, type RosterGroup } from "@/lib/characterRoster";
import { CharacterRosterGrid } from "./CharacterRosterGrid";
import {
  flushSkidmarksSessionNow,
  getCharacterLorasState,
  getSkidmarksSnapshot,
  patchCharacterLoras,
  readImageFileAsDataUrl,
  subscribeSkidmarks,
} from "@/lib/skidmarks";

/**
 * Characters (2026-09-29) — the screen behind the fifth landing tile.
 * One card per character: training pictures, a made-up-adult tick, and
 * a two-tap **Train LoRA** button with its price on it. While Replicate
 * trains, the card checks in every 20 seconds; when it's done the server
 * has already put the Comfy-ready files in the private Hugging Face repo,
 * and the card shows the two links to paste into Comfy Cloud's Import
 * box plus the prompt words that switch the character on.
 * See `lib/characterLoras.ts` for the whole chain.
 */

const TRAINING_PICTURE_MAX_DIMENSION = 1600;
const POLL_EVERY_MS = 20_000;
const SUBJECT_WORDS = ["woman", "man", "person", "character", "animal"];
const STYLE_OPTIONS: { value: CharacterTrainingStyle; label: string }[] = [
  { value: "photo", label: "Real-looking face" },
  { value: "cartoon", label: "Cartoon" },
  { value: "faceless", label: "Face hidden" },
  { value: "render3d", label: "3D cartoon" },
];

type Busy = { id: string; kind: "upload" | "train" | "check" } | null;

function StatusChip({ entry }: { entry: CharacterLoraEntry }) {
  const map: Record<CharacterLoraEntry["status"], [string, string]> = {
    draft: ["Not trained", "border-white/15 text-white/50"],
    making: [
      `Making pictures ${entry.trainingImageUrls.length}/${entry.autoPictureTarget ?? "?"}`,
      "border-amber-400/40 text-amber-200",
    ],
    training: ["Training…", "border-amber-400/40 text-amber-200"],
    finishing: ["Saving…", "border-amber-400/40 text-amber-200"],
    ready: [entry.importedToComfy ? "Ready in Comfy" : "Trained", "border-emerald-400/40 text-emerald-200"],
    failed: ["Failed", "border-red-400/40 text-red-200"],
  };
  const [label, cls] = map[entry.status];
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wide text-white/40">{label}</p>
        <p className="truncate font-mono text-[11px] text-white/80" title={value}>
          {value}
        </p>
      </div>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked — the text is still selectable */
          }
        }}
        className="shrink-0 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/80 hover:border-white/30"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function CharacterLorasPanel({ group }: { group?: RosterGroup } = {}) {
  const snapshot = useSyncExternalStore(subscribeSkidmarks, getSkidmarksSnapshot, getSkidmarksSnapshot);
  const { characters } = getCharacterLorasState(snapshot);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [armedTrainId, setArmedTrainId] = useState<string | null>(null);
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const polling = useRef(false);
  const [open, setOpen] = useState(false);
  const roster = useMemo(() => buildCharacterRoster(snapshot), [snapshot]);

  const setError = (id: string, msg: string | null) =>
    setErrors((e) => {
      const next = { ...e };
      if (msg) next[id] = msg;
      else delete next[id];
      return next;
    });

  const patchEntry = (id: string, patch: Partial<CharacterLoraEntry>) =>
    patchCharacterLoras((s) => ({ characters: s.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  const addCharacter = () => {
    const name = newName.trim();
    if (!name) return;
    patchCharacterLoras((s) => ({
      characters: [...s.characters, buildCharacterLoraEntry(name, s.characters.map((c) => c.slug))],
    }));
    flushSkidmarksSessionNow();
    setNewName("");
  };

  const removeCharacter = (id: string) => {
    patchCharacterLoras((s) => ({ characters: s.characters.filter((c) => c.id !== id) }));
    flushSkidmarksSessionNow();
    setArmedDeleteId(null);
  };

  const addPictures = async (entry: CharacterLoraEntry, files: FileList | null) => {
    if (!files?.length || busy) return;
    setError(entry.id, null);
    setBusy({ id: entry.id, kind: "upload" });
    try {
      const room = CHARACTER_LORA_MAX_IMAGES - entry.trainingImageUrls.length;
      const picked = Array.from(files).slice(0, Math.max(0, room));
      const urls: string[] = [];
      for (const file of picked) {
        const dataUrl = await readImageFileAsDataUrl(file, TRAINING_PICTURE_MAX_DIMENSION, 0.9);
        const up = await uploadSkidmarksMemberPhoto(dataUrl);
        if (!up.ok) throw new Error(up.message || "A picture couldn't be uploaded.");
        urls.push(up.url);
      }
      patchCharacterLoras((s) => ({
        characters: s.characters.map((c) =>
          c.id === entry.id
            ? { ...c, trainingImageUrls: [...c.trainingImageUrls, ...urls].slice(0, CHARACTER_LORA_MAX_IMAGES) }
            : c,
        ),
      }));
      flushSkidmarksSessionNow();
    } catch (err) {
      setError(entry.id, err instanceof Error ? err.message : "Couldn't add those pictures.");
    } finally {
      setBusy(null);
      const input = fileRefs.current[entry.id];
      if (input) input.value = "";
    }
  };

  const removePicture = (entry: CharacterLoraEntry, index: number) => {
    patchEntry(entry.id, { trainingImageUrls: entry.trainingImageUrls.filter((_, i) => i !== index) });
    flushSkidmarksSessionNow();
  };

  const train = async (entry: CharacterLoraEntry) => {
    setArmedTrainId(null);
    const blocker = trainBlocker(entry);
    if (blocker) {
      setError(entry.id, trainBlockerMessage(blocker, entry));
      return;
    }
    setError(entry.id, null);
    setBusy({ id: entry.id, kind: "train" });
    try {
      patchEntry(entry.id, await startCharacterTraining(entry));
      flushSkidmarksSessionNow();
    } catch (err) {
      setError(entry.id, err instanceof Error ? err.message : "Training didn't start.");
    } finally {
      setBusy(null);
    }
  };

  const check = async (entry: CharacterLoraEntry, quiet = false) => {
    if (!entry.replicateTrainingId) return;
    if (!quiet) setBusy({ id: entry.id, kind: "check" });
    try {
      const res = await fetch("/api/skidmarks/character-lora/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trainingId: entry.replicateTrainingId,
          slug: entry.slug,
          version: entry.version,
          name: entry.name,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        state?: "training" | "ready" | "failed";
        error?: string;
        hfRepo?: string;
        loraFile?: string;
        embeddingFile?: string;
        costUsd?: number | null;
      };
      if (!res.ok) throw new Error(json.error || `Check failed (HTTP ${res.status}).`);
      if (json.state === "ready" && json.hfRepo && json.loraFile && json.embeddingFile) {
        patchEntry(entry.id, {
          status: "ready",
          hfRepo: json.hfRepo,
          loraFile: json.loraFile,
          embeddingFile: json.embeddingFile,
          costUsd: json.costUsd ?? null,
          trainedAt: new Date().toISOString(),
          error: null,
        });
        flushSkidmarksSessionNow();
      } else if (json.state === "failed") {
        patchEntry(entry.id, { status: "failed", error: json.error ?? "Training failed." });
        flushSkidmarksSessionNow();
      }
      setError(entry.id, null);
    } catch (err) {
      if (!quiet) setError(entry.id, err instanceof Error ? err.message : "Check failed.");
    } finally {
      if (!quiet) setBusy(null);
    }
  };

  // Check in on any training card every 20s while this screen is open.
  const trainingKey = characters
    .filter((c) => c.status === "training" || c.status === "finishing")
    .map((c) => `${c.id}:${c.replicateTrainingId}`)
    .join(",");
  useEffect(() => {
    if (!trainingKey) return;
    const tick = async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        for (const c of getCharacterLorasState().characters) {
          if (c.status === "training" || c.status === "finishing") await check(c, true);
        }
      } finally {
        polling.current = false;
      }
    };
    void tick();
    const t = setInterval(tick, POLL_EVERY_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainingKey]);

  /** One character's LoRA card: pictures, Train, and the Comfy links once trained. */
  const renderCard = (c: CharacterLoraEntry) => {
    const isBusy = busy?.id === c.id;
    const blocker = trainBlocker(c);
    const retrain = c.status === "ready" || c.status === "failed";
    const snippet = comfyPromptSnippet(c);
    const nextFiles = loraFileNames(c.slug, nextTrainingVersion(c));
    return (
      <div key={c.id} id={`clora-card-${c.id}`} className="scroll-mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-center gap-2">
          <input
            value={c.name}
            onChange={(e) => patchEntry(c.id, { name: e.target.value })}
            onBlur={() => flushSkidmarksSessionNow()}
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-white outline-none"
            aria-label="Character name"
          />
          <StatusChip entry={c} />
          <button
            type="button"
            onClick={() => (armedDeleteId === c.id ? removeCharacter(c.id) : setArmedDeleteId(c.id))}
            onBlur={() => setArmedDeleteId(null)}
            className="rounded-md px-1.5 text-sm text-red-300/80 hover:text-red-300"
            title="Remove this card (the files stay on Hugging Face)"
          >
            {armedDeleteId === c.id ? "Remove?" : "✕"}
          </button>
        </div>

        {c.status === "ready" && c.hfRepo && c.loraFile && c.embeddingFile && (
          <div className="mt-3 flex flex-col gap-2.5 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.04] p-3">
            <p className="text-xs text-white/70">
              Trained{c.costUsd != null ? ` for ${formatCostUsd(c.costUsd)}` : ""}. In Comfy Cloud open Models, then
              Model Library, then Import, and paste each link:
            </p>
            <CopyRow label="LoRA (type: loras)" value={hfResolveLink(c.hfRepo, c.loraFile)} />
            <CopyRow label="Trigger (type: embeddings)" value={hfResolveLink(c.hfRepo, c.embeddingFile)} />
            <p className="text-[11px] leading-relaxed text-white/50">
              Comfy needs your Hugging Face token under Settings, then Secrets, to fetch them. In a workflow, pick{" "}
              <span className="font-mono text-white/70">{comfyImportedName(c.hfRepo, c.loraFile)}</span> in Load
              LoRA and start the prompt with:
            </p>
            {snippet && <CopyRow label="Prompt start" value={snippet} />}
            <label className="flex items-center gap-2 text-xs text-white/70">
              <input
                type="checkbox"
                checked={c.importedToComfy}
                onChange={(e) => {
                  patchEntry(c.id, { importedToComfy: e.target.checked });
                  flushSkidmarksSessionNow();
                }}
              />
              I&apos;ve imported both into Comfy Cloud
            </label>
          </div>
        )}

        {(c.status === "training" || c.status === "finishing") && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-amber-400/20 bg-amber-500/[0.04] p-3">
            <p className="text-xs text-amber-100/80">
              Training on Replicate, usually about 5 minutes. This card checks every 20 seconds while it&apos;s open.
            </p>
            <button
              type="button"
              onClick={() => check(c)}
              disabled={isBusy}
              className="shrink-0 rounded-md border border-white/15 px-2.5 py-1 text-xs text-white/80 disabled:opacity-40"
            >
              {isBusy && busy?.kind === "check" ? "Checking…" : "Check now"}
            </button>
          </div>
        )}

        {c.status === "failed" && c.error && <p className="mt-3 text-xs text-red-300">{c.error}</p>}

        <div className="mt-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-white/50">
              Training pictures: {c.trainingImageUrls.length} (best {CHARACTER_LORA_RECOMMENDED})
            </p>
            <button
              type="button"
              onClick={() => fileRefs.current[c.id]?.click()}
              disabled={isBusy || c.trainingImageUrls.length >= CHARACTER_LORA_MAX_IMAGES}
              className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-white/80 hover:border-white/30 disabled:opacity-40"
            >
              {isBusy && busy?.kind === "upload" ? "Uploading…" : "Add pictures"}
            </button>
            <input
              ref={(el) => {
                fileRefs.current[c.id] = el;
              }}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => addPictures(c, e.target.files)}
            />
          </div>
          {c.trainingImageUrls.length > 0 && (
            <div className="mt-2 flex touch-pan-x gap-1.5 overflow-x-auto pb-1">
              {c.trainingImageUrls.map((u, i) => (
                <div key={`${u}-${i}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-white/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePicture(c, i)}
                    className="absolute right-0.5 top-0.5 rounded bg-black/70 px-1 text-[10px] text-red-300"
                    aria-label="Remove picture"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {c.status === "ready" && c.trainingImageUrls.length === 0 && (
            <p className="mt-1 text-[11px] text-white/35">Trained outside Deck, so no pictures are stored here.</p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-white/60">
            They&apos;re a
            <select
              value={c.subjectWord}
              onChange={(e) => {
                patchEntry(c.id, { subjectWord: e.target.value });
                flushSkidmarksSessionNow();
              }}
              className="rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-xs text-white"
            >
              {SUBJECT_WORDS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-white/60">
            Style
            <select
              value={c.trainingStyle}
              onChange={(e) => {
                patchEntry(c.id, { trainingStyle: e.target.value as CharacterTrainingStyle });
                flushSkidmarksSessionNow();
              }}
              className="rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-xs text-white"
            >
              {STYLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-white/60">
            <input
              type="checkbox"
              checked={c.fictionalAdultConfirmed}
              onChange={(e) => {
                patchEntry(c.id, { fictionalAdultConfirmed: e.target.checked });
                flushSkidmarksSessionNow();
              }}
            />
            Made up, clearly an adult, not a real person
          </label>
        </div>

        {c.status !== "making" && c.status !== "training" && c.status !== "finishing" && (
          <div className="mt-3">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                if (blocker) {
                  setError(c.id, trainBlockerMessage(blocker, c));
                  return;
                }
                if (armedTrainId === c.id) void train(c);
                else setArmedTrainId(c.id);
              }}
              onBlur={() => setArmedTrainId(null)}
              className={`rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-40 ${
                armedTrainId === c.id ? "bg-sky-500" : "bg-sky-500/60 hover:bg-sky-500/80"
              }`}
            >
              {isBusy && busy?.kind === "train"
                ? "Starting…"
                : armedTrainId === c.id
                  ? `Tap again to train (~${formatCostUsd(CHARACTER_LORA_ESTIMATED_COST_USD)})`
                  : `${retrain ? "Retrain" : "Train"} LoRA · ~${formatCostUsd(CHARACTER_LORA_ESTIMATED_COST_USD)}`}
            </button>
            {retrain && (
              <p className="mt-1 text-[11px] text-white/35">
                A retrain saves as {nextFiles.loraFile}, so the current version keeps working.
              </p>
            )}
          </div>
        )}

        {errors[c.id] && <p className="mt-2 text-xs text-red-300">{errors[c.id]}</p>}
      </div>
    );
  };

  if (group) {
    const groupChars = roster[group];
    const done = groupChars.filter((ch) => characters.find((e) => e.sourceKey === ch.sourceKey)?.status === "ready").length;
    return (
      <section className="rounded-2xl border border-white/10 bg-white/[0.02]">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold text-white">Characters</span>
          <span className="flex items-center gap-2 text-[11px] text-white/45">
            {groupChars.length === 0 ? "none yet" : `${done} of ${groupChars.length} trained`}
            <span aria-hidden className={`text-white/40 transition-transform ${open ? "rotate-90" : ""}`}>
              {"\u203a"}
            </span>
          </span>
        </button>
        {/* Kept mounted while folded so a running "Make pictures" keeps going. */}
        {(
          <div className={open ? "border-t border-white/10 px-4 pb-4 pt-3" : "hidden"}>
            <p className="mb-3 text-xs leading-relaxed text-white/55">
              Tap a face to train them: okay one clean picture, make pictures, check them, then Train. Everything for that
              character opens under their face.
            </p>
            <CharacterRosterGrid snapshot={snapshot} onlyGroup={group} renderEntryCard={renderCard} />
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-2xl border border-sky-400/25 bg-sky-500/[0.04] p-4">
        <p className="text-sm font-semibold text-white">Characters</p>
        <p className="mt-1.5 text-xs leading-relaxed text-white/60">
          Train a LoRA once per character so their face stays the same in every plate. Add {CHARACTER_LORA_RECOMMENDED}{" "}
          varied pictures of them (different angles, outfits and light), then tap Train. It takes about 5 minutes and
          costs about {formatCostUsd(CHARACTER_LORA_ESTIMATED_COST_USD)} on Replicate. The finished files go to your
          private Hugging Face repo, ready to import into Comfy Cloud. Made-up adult characters only, never a real
          person.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCharacter()}
            placeholder="New character name"
            className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
          />
          <button
            type="button"
            onClick={addCharacter}
            disabled={!newName.trim()}
            className="rounded-md bg-sky-500/80 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <p className="text-sm font-semibold text-white">Your cast</p>
        <p className="mb-3 mt-1 text-xs leading-relaxed text-white/55">
          Tap a face and okay one clean picture of them (arms down, empty hands). Then Make pictures: Siray draws{" "}
          {AUTO_PICTURE_TARGET} from the clean one. Tap any picture to see it big, remove bad ones, then tap Train. A tick
          means done.
        </p>
        <CharacterRosterGrid snapshot={snapshot} />
      </div>

      <p className="px-1 text-xs font-semibold uppercase tracking-wide text-white/50">LoRA cards</p>
      {characters.length === 0 && <p className="text-xs text-white/40">No characters yet.</p>}

      {characters.map(renderCard)}
    </section>
  );
}
