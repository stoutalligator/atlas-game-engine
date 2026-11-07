import { describe, expect, it } from "vitest";
import { shareText } from "../core/share.js";

describe("shareText", () => {
  it("ends with a link to the game on Atlas", () => {
    const lines = shareText("cube-rush", "2026-02-11", ["🟩🟩"]).split("\n");
    expect(lines[0]).toMatch(/^ATLAS .+ #42$/);
    expect(lines.at(-2)).toBe("");
    expect(lines.at(-1)).toBe("https://study-atlas.com/games/cube-rush");
  });
});
