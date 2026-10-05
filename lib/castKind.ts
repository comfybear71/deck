/**
 * Cast kind (2026-10-05, Stuart): every Cast card is a Person, an Animal,
 * or an Object. Pip the robot dog is Animal; House the wall speaker is
 * Object. Prompts must not say "person" / "character" for Animal or Object.
 *
 * Backward compatible with the older `isAnimal?: boolean` flag: true →
 * animal; missing → person. New saves write both `kind` and (for animals
 * only) `isAnimal: true` so older builds still read them.
 */

export type CastKind = "person" | "animal" | "object";

export const CAST_KINDS: readonly CastKind[] = ["person", "animal", "object"];

export const CAST_KIND_LABEL: Record<CastKind, string> = {
  person: "Person",
  animal: "Animal",
  object: "Object",
};

/** Read a stored kind, falling back to the older `isAnimal` flag. */
export function castKindFrom(value: { kind?: unknown; isAnimal?: unknown } | null | undefined): CastKind {
  const raw = typeof value?.kind === "string" ? value.kind.trim().toLowerCase() : "";
  if (raw === "animal" || raw === "object" || raw === "person") return raw;
  if (value?.isAnimal === true) return "animal";
  return "person";
}

/** Persist fields for a Cast/roster record. Animals keep `isAnimal: true`
 * for older builds; Person/Object clear it. */
export function castKindPersist(kind: CastKind): { kind: CastKind; isAnimal?: true } {
  // Animals keep `isAnimal: true` for older builds. Person/Object omit it so
  // a spread onto an old animal record needs an explicit delete (callers do that).
  return kind === "animal" ? { kind: "animal", isAnimal: true } : { kind };
}

/** Fields to write onto an existing cast/roster record (clears stale isAnimal). */
export function castKindPatch(kind: CastKind): { kind: CastKind; isAnimal?: true } {
  return castKindPersist(kind);
}

/** The word prompts and LoRA captions use for this kind. */
export function subjectWordForCastKind(kind: CastKind, personWord: "person" | "character" | "man" | "woman" = "person"): string {
  if (kind === "animal") return "animal";
  if (kind === "object") return "object";
  return personWord;
}

export function isCastKind(value: unknown): value is CastKind {
  return value === "person" || value === "animal" || value === "object";
}

/** Parse a UI/select value; anything unknown becomes person. */
export function parseCastKind(value: unknown): CastKind {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isCastKind(raw) ? raw : "person";
}
