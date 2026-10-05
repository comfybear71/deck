import { describe, expect, it } from "vitest";
import {
  castKindFrom,
  castKindPersist,
  parseCastKind,
  subjectWordForCastKind,
} from "./castKind";

describe("castKind", () => {
  it("reads kind, falling back to isAnimal", () => {
    expect(castKindFrom({ kind: "object" })).toBe("object");
    expect(castKindFrom({ kind: "animal" })).toBe("animal");
    expect(castKindFrom({ isAnimal: true })).toBe("animal");
    expect(castKindFrom({})).toBe("person");
    expect(castKindFrom({ kind: "person", isAnimal: true })).toBe("person");
  });

  it("persists animals with the old isAnimal flag for older builds", () => {
    expect(castKindPersist("animal")).toEqual({ kind: "animal", isAnimal: true });
    expect(castKindPersist("object")).toEqual({ kind: "object" });
    expect(castKindPersist("person")).toEqual({ kind: "person" });
  });

  it("maps kind to prompt subject words", () => {
    expect(subjectWordForCastKind("animal")).toBe("animal");
    expect(subjectWordForCastKind("object")).toBe("object");
    expect(subjectWordForCastKind("person", "character")).toBe("character");
    expect(parseCastKind("OBJECT")).toBe("object");
    expect(parseCastKind("nope")).toBe("person");
  });
});
