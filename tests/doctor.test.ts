import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import {
  collectDoctorChecks,
  gatherDoctorFacts,
  factsToChecks,
  summarizeDoctor,
  claudeRows,
  type DoctorFacts,
} from "../src/commands/doctor.js";
import { ensureBlock, ensureIgnoreLines } from "../src/core/files.js";
import { AI_DEV_SETUP_START, CLAUDE_MD_SETUP_BLOCK } from "../src/templates/claudeMd.js";
import { CLAUDEIGNORE_LINES, GITIGNORE_LINES, GRAPHIFY_IGNORE_LINES } from "../src/templates/ignores.js";
import type { ClaudeStatus } from "../src/core/claude.js";
import { RECOMMENDED_MCP_TOOLS } from "../src/core/mcp.js";
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
    graphifyignoreOk: true,
    agentsMd: false,
    opencodeConfig: false,
    cursorRules: false,
    copilotInstructions: false,
    artifacts: { claudeMd: true, agentsMd: false, opencodeConfig: false, cursorRules: false, copilotInstructions: false },
    providers: [{ key: "claude", name: "Claude Code", command: "claude", artifactFiles: ["CLAUDE.md"], installHint: "", available: true, detail: "installed" }],
    mcpConfigured: { context7: true, serena: true, playwright: true },
    enabledMcp: RECOMMENDED_MCP_TOOLS,
    configPath: "/proj/ai-dev.config.json",
    needsClaude: true,
    graphBackend: "claude-cli",
    graphBuildEnabled: true,
    graphBackendNeedsClaude: true,
    requireAuth: true,
    updateClaudeMd: true,
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
    expect(byLabel(checks, ".graphifyignore entries")?.status).toBe("warn");

    await ensureIgnoreLines(path.join(tmp, ".gitignore"), GITIGNORE_LINES);
    await ensureIgnoreLines(path.join(tmp, ".claudeignore"), CLAUDEIGNORE_LINES);
    await ensureBlock(
      path.join(tmp, ".graphifyignore"),
      "# AI_DEV_GRAPHIFY_IGNORE_START",
      GRAPHIFY_IGNORE_LINES.join("\n"),
    );

    checks = await collectDoctorChecks(tmp);
    expect(byLabel(checks, ".gitignore entries")?.status).toBe("ok");
    expect(byLabel(checks, ".claudeignore entries")?.status).toBe("ok");
    expect(byLabel(checks, ".graphifyignore entries")?.status).toBe("ok");
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
  it("does not render Claude session warnings when Claude provider is disabled", () => {
    const checks = factsToChecks(
      healthyFacts({
        needsClaude: false,
        claude: readyClaude({ state: "session-limited", resetTime: "3:10pm" }),
        providers: [{ key: "opencode", name: "OpenCode", command: "opencode", artifactFiles: ["AGENTS.md", "opencode.jsonc"], installHint: "", available: true, detail: "1.17.15" }],
        artifacts: { claudeMd: false, agentsMd: true, opencodeConfig: true, cursorRules: false, copilotInstructions: false },
        updateClaudeMd: false,
      }),
    );
    expect(checks.find((c) => c.label === "Claude Code")?.detail).toContain("disabled by provider config");
    expect(checks.some((c) => c.label === "Claude Code session limit")).toBe(false);
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

describe("doctor honors config (project type + MCP toggles)", () => {
  let dtmp: string;
  beforeEach(async () => {
    dtmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-dev-doctor-cfg-"));
    await fs.writeJson(path.join(dtmp, "package.json"), { name: "d" });
  });
  afterEach(async () => {
    await fs.remove(dtmp);
  });

  it("applies projectType override and omits disabled MCP tools", async () => {
    const facts = await gatherDoctorFacts(dtmp, {
      claudeStatus: readyClaude(),
      config: { projectType: "Laravel", mcp: { serena: false } },
    });
    expect(facts.projectType).toBe("Laravel");
    expect(facts.enabledMcp.map((t) => t.key)).toEqual([
      "context7",
      "playwright",
    ]);

    const labels = factsToChecks(facts).map((c) => c.label);
    expect(labels).toContain("Context7 MCP");
    expect(labels).not.toContain("Serena MCP");
  });
});

describe("doctor config row", () => {
  it("shows ok when a config file is present", () => {
    const checks = factsToChecks(
      healthyFacts({ configPath: "/proj/ai-dev.config.json" }),
    );
    const row = checks.find((c) => c.label === "ai-dev config");
    expect(row?.status).toBe("ok");
    expect(row?.detail).toBe("ai-dev.config.json");
  });

  it("warns (optional) when no config file is present", () => {
    const checks = factsToChecks(healthyFacts({ configPath: null }));
    const row = checks.find((c) => c.label === "ai-dev config");
    expect(row?.status).toBe("warn");
    expect(row?.severity).toBe("optional");
    expect(row?.detail).toContain("using defaults");
  });
});

describe("requireAuth summary handling", () => {
  it("not-authenticated blocks readiness when requireAuth is true", () => {
    const s = summarizeDoctor(
      healthyFacts({
        claude: readyClaude({ state: "not-authenticated" }),
        requireAuth: true,
      }),
    );
    expect(s.state).toBe("incomplete-claude");
    expect(s.exitCode).toBe(ExitCode.SetupFailed);
  });

  it("not-authenticated is a warning (non-blocking) when requireAuth is false", () => {
    const s = summarizeDoctor(
      healthyFacts({
        claude: readyClaude({ state: "not-authenticated" }),
        requireAuth: false,
      }),
    );
    expect(s.state).toBe("ready-with-warnings");
    expect(s.exitCode).toBe(ExitCode.Success);
  });

  it("still-missing install stays blocking even with requireAuth false", () => {
    const s = summarizeDoctor(
      healthyFacts({
        claude: {
          state: "not-installed",
          installed: false,
          npmPackage: false,
          execInPath: false,
        },
        requireAuth: false,
      }),
    );
    expect(s.state).toBe("incomplete-claude");
  });

  it("claudeRows downgrades not-authenticated to warn when requireAuth is false", () => {
    const rows = claudeRows(readyClaude({ state: "not-authenticated" }), false);
    const authRow = rows.find((r) => r.label.includes("authentication"));
    expect(authRow?.status).toBe("warn");
  });
});
