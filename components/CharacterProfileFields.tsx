"use client";

import { useState } from "react";
import {
  CHARACTER_PROFILE_BIO_MAX,
  CHARACTER_PROFILE_MIN_AGE,
  CHARACTER_PROFILE_PERSONALITY_MAX,
  characterProfileAgeProblem,
  type CharacterLoraEntry,
} from "@/lib/characterLoras";
import { characterProfile, setCharacterProfile } from "@/lib/characterEdits";
import type { RosterCharacter } from "@/lib/characterRoster";

/**
 * A Shorts character's optional profile (2026-09-30), on their open
 * panel: one folded line ("Profile · 24 · AI-generated"), tap to edit age
 * (21 or over), a short bio, a chat personality and the AI-generated
 * label (on unless unticked). Save writes it onto the character's own
 * card (`setCharacterProfile`, their `deck_items` row); Cancel leaves it.
 */
export function CharacterProfileFields({ char, entry }: { char: RosterCharacter; entry: CharacterLoraEntry | null }) {
  const saved = characterProfile(entry);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    age: saved.age ? String(saved.age) : "",
    bio: saved.bio ?? "",
    chatPersonality: saved.chatPersonality ?? "",
    aiGenerated: saved.aiGenerated,
  });
  const [error, setError] = useState<string | null>(null);
  const ageProblem = characterProfileAgeProblem(draft.age);

  const summary = [saved.age ? `${saved.age}` : null, saved.aiGenerated ? "AI-generated" : null].filter(Boolean).join(" · ");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft({
            age: saved.age ? String(saved.age) : "",
            bio: saved.bio ?? "",
            chatPersonality: saved.chatPersonality ?? "",
            aiGenerated: saved.aiGenerated,
          });
          setError(null);
          setOpen(true);
        }}
        className="mt-1 block max-w-full truncate text-left text-[11px] text-white/50 hover:text-white/80"
        aria-label={`Edit ${char.name}'s profile`}
      >
        Profile{summary ? ` · ${summary}` : ""}
        {saved.bio ? ` · ${saved.bio}` : ""} ›
      </button>
    );
  }

  const save = () => {
    const result = setCharacterProfile(char, draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setOpen(false);
  };

  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-lg border border-white/10 bg-black/30 p-2">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px] text-white/60">
          Age
          <input
            value={draft.age}
            onChange={(e) => setDraft((d) => ({ ...d, age: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) }))}
            inputMode="numeric"
            placeholder={`${CHARACTER_PROFILE_MIN_AGE}+`}
            aria-label={`${char.name}'s age`}
            aria-invalid={Boolean(ageProblem)}
            className="w-14 rounded-md border border-white/15 bg-black/40 px-2 py-1 text-xs text-white placeholder:text-white/30"
          />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-white/60">
          <input
            type="checkbox"
            checked={draft.aiGenerated}
            onChange={(e) => setDraft((d) => ({ ...d, aiGenerated: e.target.checked }))}
          />
          AI-generated
        </label>
      </div>
      {ageProblem && <p className="text-[11px] text-red-300">{ageProblem}</p>}
      <textarea
        value={draft.bio}
        onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
        rows={2}
        maxLength={CHARACTER_PROFILE_BIO_MAX}
        placeholder="Short bio"
        aria-label={`${char.name}'s bio`}
        className="rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-white placeholder:text-white/30"
      />
      <input
        value={draft.chatPersonality}
        onChange={(e) => setDraft((d) => ({ ...d, chatPersonality: e.target.value }))}
        maxLength={CHARACTER_PROFILE_PERSONALITY_MAX}
        placeholder="Chat personality, e.g. playful, teasing, short replies"
        aria-label={`${char.name}'s chat personality`}
        className="rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-white placeholder:text-white/30"
      />
      {error && <p className="text-[11px] text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={Boolean(ageProblem)}
          className="rounded-md bg-sky-500 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
        >
          Save
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 text-xs text-white/50 hover:text-white">
          Cancel
        </button>
      </div>
    </div>
  );
}
