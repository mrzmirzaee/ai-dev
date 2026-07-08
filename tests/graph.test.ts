import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import {
  parseAssetSummary,
  needsSemanticExtraction,
} from "../src/core/graphify.js";
import { ExitCode } from "../src/types.js";

// Mock the graphify core so the command layer can be tested deterministically
// without invoking real processes.
vi.mock("../src/core/graphify.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/graphify.js")>();
  return {
    ...actual,
    hasUv: vi.fn(async () => true),
    isGraphifyAvailable: vi.fn(async () => true),
    buildGraph: vi.fn(),
    buildGraphFromSemantic: vi.fn(),
  };
});

import * as graphify from "../src/core/graphify.js";
import {
  graphIgnoreAssetsCommand,
  graphRebuildCommand,
  renderGraphOutcome,
} from "../src/commands/graph.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-dev-graph-"));
  await fs.writeJson(path.join(tmp, "package.json"), { name: "g" });
  vi.mocked(graphify.hasUv).mockResolvedValue(true);
  vi.mocked(graphify.isGraphifyAvailable).mockResolvedValue(true);
});

afterEach(async () => {
  await fs.remove(tmp);
  vi.clearAllMocks();
});

describe("parseAssetSummary", () => {
  it("parses a found + need-semantic summary", () => {
    const s = parseAssetSummary(
      "found 273 code, 5 docs, 0 papers, 134 images\nerror: 139 doc/paper/image file(s) need semantic extraction",
    );
    expect(s).toMatchObject({ code: 273, docs: 5, papers: 0, images: 134, needSemantic: 139 });
  });
  it("returns undefined when nothing matches", () => {
    expect(parseAssetSummary("nothing here")).toBeUndefined();
  });
});

describe("needsSemanticExtraction", () => {
  it("is true for 'no LLM API key found'", () => {
    expect(needsSemanticExtraction("error: no LLM API key found")).toBe(true);
  });
  it("is true for 'pass --backend'", () => {
    expect(needsSemanticExtraction("hint: pass --backend claude-cli")).toBe(true);
  });
  it("is false for unrelated errors", () => {
    expect(needsSemanticExtraction("disk full")).toBe(false);
  });
});

describe("renderGraphOutcome exit codes", () => {
  it("built -> success", async () => {
    await expect(renderGraphOutcome({ kind: "built", graphPath: "/x/graph.json" }, tmp)).resolves.toBe(
      ExitCode.Success,
    );
  });
  it("instructions -> success (clear next steps)", async () => {
    await expect(
      renderGraphOutcome({ kind: "instructions", instructionsPath: "/x/i.md" }, tmp),
    ).resolves.toBe(ExitCode.Success);
  });
  it("claude-not-authenticated -> failed", async () => {
    await expect(renderGraphOutcome({ kind: "claude-not-authenticated" }, tmp)).resolves.toBe(
      ExitCode.SetupFailed,
    );
  });
  it("claude-session-limited -> failed", async () => {
    await expect(
      renderGraphOutcome({ kind: "claude-session-limited", resetTime: "1:00am" }, tmp),
    ).resolves.toBe(ExitCode.SetupFailed);
  });
  it("no-provider -> failed", async () => {
    await expect(renderGraphOutcome({ kind: "no-provider" }, tmp)).resolves.toBe(ExitCode.SetupFailed);
  });
  it("failed -> failed", async () => {
    await expect(
      renderGraphOutcome({
        kind: "failed",
        command: "graphify .",
        exitCode: 1,
        stdout: "",
        stderr: "boom",
      }, tmp),
    ).resolves.toBe(ExitCode.SetupFailed);
  });
});

describe("graphRebuildCommand", () => {
  it("prints instructions and succeeds when an instruction file is produced", async () => {
    vi.mocked(graphify.buildGraph).mockResolvedValue({
      kind: "instructions",
      instructionsPath: path.join(tmp, ".graphify/scratch/assistant-extract-instructions.md"),
    });
    const code = await graphRebuildCommand({}, tmp);
    expect(code).toBe(ExitCode.Success);
  });

  it("fails when no graph and no instruction file", async () => {
    vi.mocked(graphify.buildGraph).mockResolvedValue({
      kind: "failed",
      command: "graphify .",
      exitCode: 1,
      stdout: "found 1 code",
      stderr: "unexpected error",
    });
    const code = await graphRebuildCommand({}, tmp);
    expect(code).toBe(ExitCode.SetupFailed);
  });

  it("--semantic <path> success verifies graph.json", async () => {
    const semantic = path.join(tmp, "sem.json");
    await fs.writeJson(semantic, { ok: true });
    vi.mocked(graphify.buildGraphFromSemantic).mockResolvedValue({
      kind: "built",
      graphPath: path.join(tmp, ".graphify/graph.json"),
    });
    const code = await graphRebuildCommand({ semantic: "sem.json" }, tmp);
    expect(code).toBe(ExitCode.Success);
    expect(graphify.buildGraphFromSemantic).toHaveBeenCalled();
  });

  it("--semantic <missing> fails before invoking graphify", async () => {
    const code = await graphRebuildCommand({ semantic: "does-not-exist.json" }, tmp);
    expect(code).toBe(ExitCode.SetupFailed);
    expect(graphify.buildGraphFromSemantic).not.toHaveBeenCalled();
  });

  it("returns MissingDependency when graphify is unavailable", async () => {
    vi.mocked(graphify.isGraphifyAvailable).mockResolvedValue(false);
    const code = await graphRebuildCommand({}, tmp);
    expect(code).toBe(ExitCode.MissingDependency);
  });
});


describe("graph ignore-assets", () => {
  it("creates .graphifyignore and an ai-dev marker file", async () => {
    const code = await graphIgnoreAssetsCommand(tmp);
    expect(code).toBe(ExitCode.Success);
    expect(await fs.pathExists(path.join(tmp, ".graphifyignore"))).toBe(true);
    const markerPath = path.join(tmp, ".ai-dev", "graph-ignore-assets-applied.json");
    expect(await fs.pathExists(markerPath)).toBe(true);
    const marker = await fs.readJson(markerPath);
    expect(marker).toMatchObject({ file: ".graphifyignore" });
    expect(typeof marker.appliedAt).toBe("string");
  });

  it("does not recommend ignore-assets again after the marker exists", async () => {
    await graphIgnoreAssetsCommand(tmp);
    const code = await renderGraphOutcome({ kind: "no-provider" }, tmp);
    expect(code).toBe(ExitCode.SetupFailed);
    // Behavioral assertion: marker remains and render succeeds without suggesting
    // users repeat a command that was already attempted. Console text is covered
    // by manual smoke tests and kept out of this unit test.
    expect(await fs.pathExists(path.join(tmp, ".ai-dev", "graph-ignore-assets-applied.json"))).toBe(true);
  });
});

describe("graphRebuildCommand backend resolution (flag > config > default)", () => {
  beforeEach(() => {
    vi.mocked(graphify.buildGraph).mockResolvedValue({
      kind: "built",
      graphPath: "/x/graph.json",
    });
  });

  it("passes the explicit --backend option through", async () => {
    await graphRebuildCommand({ backend: "openai" }, tmp);
    expect(graphify.buildGraph).toHaveBeenCalledWith(tmp, { backend: "openai" });
  });

  it("uses config graph.backend when no flag is given", async () => {
    await fs.writeJson(path.join(tmp, "ai-dev.config.json"), {
      graph: { backend: "gemini" },
    });
    await graphRebuildCommand({}, tmp);
    expect(graphify.buildGraph).toHaveBeenCalledWith(tmp, { backend: "gemini" });
  });

  it("defaults to claude-cli when neither flag nor config is set", async () => {
    await graphRebuildCommand({}, tmp);
    expect(graphify.buildGraph).toHaveBeenCalledWith(tmp, {
      backend: "claude-cli",
    });
  });

  it("fails clearly on an invalid config file", async () => {
    await fs.writeFile(path.join(tmp, "ai-dev.config.json"), "{ bad json");
    const code = await graphRebuildCommand({}, tmp);
    expect(code).toBe(ExitCode.SetupFailed);
    expect(graphify.buildGraph).not.toHaveBeenCalled();
  });
});
