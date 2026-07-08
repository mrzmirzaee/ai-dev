import { describe, it, expect } from "vitest";
import { initNextStepsLines } from "../src/commands/init.js";

describe("initNextStepsLines", () => {
  it("includes the three recommended commands", () => {
    const text = initNextStepsLines(false).join("\n");
    expect(text).toContain("Next recommended commands:");
    expect(text).toContain("ai-dev doctor");
    expect(text).toContain("ai-dev graph rebuild");
    expect(text).toContain("claude");
  });

  it("adds an explicit skipped-graph note when skipGraph is true", () => {
    const text = initNextStepsLines(true).join("\n");
    expect(text).toContain("Graph build was skipped.");
    expect(text).toContain("Run this when ready:");
  });

  it("omits the skipped-graph note when skipGraph is false", () => {
    const text = initNextStepsLines(false).join("\n");
    expect(text).not.toContain("Graph build was skipped.");
  });
});
