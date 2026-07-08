import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import {
  collectDoctorChecks,
  summarizeDoctor,
  claudeRows,
  type DoctorFacts,
} from "../src/commands/doctor.js";
import { ensureBlock, ensureIgnoreLines } from "../src/core/files.js";
import { AI_DEV_SETUP_START, CLAUDE_MD_SETUP_BLOCK } from "../src/templates/claudeMd.js";
import { CLAUDEIGNORE_LINES, GITIGNORE_LINES } from "../src/templates/ignores.js";
import type { ClaudeStatus } from "../src/core/claude.js";
import { ExitCode } from "../src/types.js";

function readyClaude(overrides: Partial<ClaudeStatus> = {}): ClaudeStatus {
  return {
    state: "ready",
    installed: true,
    npmPackage: true,
    execInPath: true,
    ...overrides,
  };
}

function healthyFacts(overrides: Partial<DoctorFacts> = {}): DoctorFacts {
  return {
    nodeVersion: "v22.0.0",
    pnpm: true,
    uv: true,
    graphifyy: true,
    graphifyCmd: true,
    claude: readyClaude(),
    projectType: "Next.js",
    claudeMd: true,
    integration: true,
    graphExists: true,
    gitignoreOk: true,
    claudeignoreOk: true,
    mcpConfigured: { context7: true, serena: true, playwright: true },
    ...overrides,
  };
}

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-dev-doctor-"));
});

afterEach(async () => {
  await fs.remove(tmp);
});

function byLabel(checks: Awaited<ReturnType<typeof collectDoctorChecks>>, label: string) {
  return checks.find((c) => c.label === label);
}

describe("collectDoctorChecks", () => {
  it("always includes a Node.js check that passes", async () => {
    const checks = await collectDoctorChecks(tmp);
    const node = byLabel(checks, "Node.js");
    expect(node).toBeDefined();
    expect(node?.status).toBe("ok");
  });

  it("reports CLAUDE.md missing and then present", async () => {
    // package.json so the tmp dir is treated as project root
    await fs.writeJson(path.join(tmp, "package.json"), { name: "x" });

    let checks = await collectDoctorChecks(tmp);
    expect(byLabel(checks, "CLAUDE.md")?.status).toBe("warn");
    expect(byLabel(checks, "Graphify integration")?.status).toBe("warn");

    await ensureBlock(
      path.join(tmp, "CLAUDE.md"),
      AI_DEV_SETUP_START,
      CLAUDE_MD_SETUP_BLOCK,
      "# CLAUDE.md",
    );

    checks = await collectDoctorChecks(tmp);
    expect(byLabel(checks, "CLAUDE.md")?.status).toBe("ok");
    expect(byLabel(checks, "Graphify integration")?.status).toBe("ok");
  });

  it("reports ignore entries missing and then ok", async () => {
    await fs.writeJson(path.join(tmp, "package.json"), { name: "x" });

    let checks = await collectDoctorChecks(tmp);
    expect(byLabel(checks, ".gitignore entries")?.status).toBe("warn");
    expect(byLabel(checks, ".claudeignore entries")?.status).toBe("warn");

    await ensureIgnoreLines(path.join(tmp, ".gitignore"), GITIGNORE_LINES);
    await ensureIgnoreLines(path.join(tmp, ".claudeignore"), CLAUDEIGNORE_LINES);

    checks = await collectDoctorChecks(tmp);
    expect(byLabel(checks, ".gitignore entries")?.status).toBe("ok");
    expect(byLabel(checks, ".claudeignore entries")?.status).toBe("ok");
  });

  it("detects project type from package.json", async () => {
    await fs.writeJson(path.join(tmp, "package.json"), {
      dependencies: { next: "14.0.0" },
    });
    const checks = await collectDoctorChecks(tmp);
    expect(byLabel(checks, "Project type")?.detail).toBe("Next.js");
  });

  it("includes MCP checks for all recommended tools", async () => {
    const checks = await collectDoctorChecks(tmp);
    expect(byLabel(checks, "Context7 MCP")).toBeDefined();
    expect(byLabel(checks, "Serena MCP")).toBeDefined();
    expect(byLabel(checks, "Playwright MCP")).toBeDefined();
  });
});

describe("summarizeDoctor", () => {
  it("all healthy -> ready, exit 0", () => {
    const s = summarizeDoctor(healthyFacts());
    expect(s.state).toBe("ready");
    expect(s.exitCode).toBe(ExitCode.Success);
  });

  it("only MCPs missing -> ready-with-warnings, exit 0", () => {
    const s = summarizeDoctor(
      healthyFacts({ mcpConfigured: { context7: false, serena: false, playwright: false } }),
    );
    expect(s.state).toBe("ready-with-warnings");
    expect(s.exitCode).toBe(ExitCode.Success);
  });

  it("graph missing -> graph-missing with recommendation, exit 0", () => {
    const s = summarizeDoctor(healthyFacts({ graphExists: false }));
    expect(s.state).toBe("graph-missing");
    expect(s.lines.join(" ")).toContain("ai-dev graph rebuild");
    expect(s.exitCode).toBe(ExitCode.Success);
  });

  it("claude not authenticated -> incomplete-claude, exit 1", () => {
    const s = summarizeDoctor(
      healthyFacts({ claude: readyClaude({ state: "not-authenticated" }) }),
    );
    expect(s.state).toBe("incomplete-claude");
    expect(s.exitCode).toBe(ExitCode.SetupFailed);
  });

  it("claude npm-only -> incomplete-claude, exit 2 (missing dep)", () => {
    const s = summarizeDoctor(
      healthyFacts({
        claude: {
          state: "npm-only",
          installed: false,
          npmPackage: true,
          execInPath: false,
        },
      }),
    );
    expect(s.state).toBe("incomplete-claude");
    expect(s.exitCode).toBe(ExitCode.MissingDependency);
  });

  it("graphify missing -> incomplete-graphify, exit 2", () => {
    const s = summarizeDoctor(healthyFacts({ graphifyy: false }));
    expect(s.state).toBe("incomplete-graphify");
    expect(s.exitCode).toBe(ExitCode.MissingDependency);
  });

  it("session-limited still counts as ready (with warnings)", () => {
    const s = summarizeDoctor(
      healthyFacts({ claude: readyClaude({ state: "session-limited", resetTime: "1:00am" }) }),
    );
    expect(s.state).toBe("ready-with-warnings");
    expect(s.exitCode).toBe(ExitCode.Success);
  });
});

describe("claudeRows", () => {
  it("renders two rows for npm-only (package ok, exec fail)", () => {
    const rows = claudeRows({
      state: "npm-only",
      installed: false,
      npmPackage: true,
      execInPath: false,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("ok");
    expect(rows[1].status).toBe("fail");
  });

  it("renders installed + auth-ready for a ready CLI", () => {
    const rows = claudeRows(readyClaude());
    expect(rows[0].label).toContain("installed");
    expect(rows[0].status).toBe("ok");
    expect(rows[1].status).toBe("ok");
  });

  it("shows session limit row with reset time", () => {
    const rows = claudeRows(readyClaude({ state: "session-limited", resetTime: "12:10am" }));
    expect(rows[1].detail).toContain("12:10am");
  });
});
