import { describe, expect, it } from "vitest";
import { parseSkillSource } from "../src/skills.js";

describe("skill manifest sources", () => {
  it("parses <owner>/<repo>/<path-to-skill>", () => {
    const parsed = parseSkillSource("mattpocock/skills/engineering/grill-with-docs");
    expect(parsed).toEqual({
      owner: "mattpocock",
      repo: "skills",
      path: "engineering/grill-with-docs",
      name: "grill-with-docs",
    });
  });

  it("rejects sources with fewer than three segments", () => {
    expect(() => parseSkillSource("mattpocock/skills")).toThrow("Invalid skill source");
    expect(() => parseSkillSource("")).toThrow("Invalid skill source");
  });
});
