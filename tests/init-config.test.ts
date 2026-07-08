import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";

// Keep init network-free and deterministic by mocking the graphify core.
vi.mock("../src/core/graphify.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/core/graphify.js")>();
  return {
    ...actual,
    hasUv: vi.fn(async () => true),
    isGraphifyAvailable: vi.fn(async () => true),
    installOrUpdateGraphify: vi.fn(async () => true),
    runGraphifyClaudeInstall: vi.fn(async () => true),
    buildGraph: vi.fn(async () => ({
      kind: "built",
      graphPath: "/x/graph.json",
    })),
  };
});

import { initCommand } from "../src/commands/init.js";
import * as graphify from "../src/core/graphify.js";
import { ExitCode } from "../src/types.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-dev-initcfg-"));
  await fs.writeJson(path.join(tmp, "package.json"), { name: "i" });
  const silence = (() => true) as never;
  vi.spyOn(process.stdout, "write").mockImplementation(silence);
  vi.spyOn(process.stderr, "write").mockImplementation(silence);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await fs.remove(tmp);
});

const opts = { yes: true, skipGraph: true, skipMcp: false, force: true };

describe("init honors claude.updateClaudeMd", () => {
  it("does NOT create CLAUDE.md when updateClaudeMd is false", async () => {
    const code = await initCommand(opts, tmp, {
      config: { claude: { updateClaudeMd: false } },
    });
    expect(code).toBe(ExitCode.Success);
    expect(await fs.pathExists(path.join(tmp, "CLAUDE.md"))).toBe(false);
    // ignore files are still written
    expect(await fs.pathExists(path.join(tmp, ".gitignore"))).toBe(true);
    expect(await fs.pathExists(path.join(tmp, ".claudeignore"))).toBe(true);
    // and the CLAUDE.md-rewriting graphify step is skipped
    expect(graphify.runGraphifyClaudeInstall).not.toHaveBeenCalled();
  });

  it("creates CLAUDE.md by default (updateClaudeMd true)", async () => {
    const code = await initCommand(opts, tmp, {
      config: { claude: { updateClaudeMd: true } },
    });
    expect(code).toBe(ExitCode.Success);
    expect(await fs.pathExists(path.join(tmp, "CLAUDE.md"))).toBe(true);
    const body = await fs.readFile(path.join(tmp, "CLAUDE.md"), "utf8");
    // MCP guidance block present when CLAUDE.md updates are enabled
    expect(body).toContain("AI_DEV_MCP_START");
  });
});
