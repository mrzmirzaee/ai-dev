import path from "node:path";
import process from "node:process";
import fs from "fs-extra";
import { commandExists, run } from "../core/command.js";
import { detectProject } from "../core/detect.js";
import {
  fileContainsMarker,
  ignoreFileContainsAll,
} from "../core/files.js";
import {
  getClaudeStatus,
  type ClaudeState,
  type ClaudeStatus,
} from "../core/claude.js";
import { findGraphJson, hasUv, isGraphifyAvailable } from "../core/graphify.js";
import {
  ConfigError,
  enabledMcpTools,
  findConfigFile,
  loadConfig,
  resolveClaudeSettings,
  resolveProjectType,
} from "../core/config.js";
import { logger } from "../core/logger.js";
import { type McpTool } from "../core/mcp.js";
import { AI_DEV_SETUP_END, AI_DEV_SETUP_START } from "../templates/claudeMd.js";
import { CLAUDEIGNORE_LINES, GITIGNORE_LINES } from "../templates/ignores.js";
import {
  ExitCode,
  type AiDevConfig,
  type CheckResult,
  type CheckSeverity,
  type ExitCodeValue,
  type ProjectType,
} from "../types.js";

/** Facts gathered by doctor; both the rows and the summary derive from these. */
export interface DoctorFacts {
  nodeVersion: string;
  pnpm: boolean;
  uv: boolean;
  graphifyy: boolean;
  graphifyCmd: boolean;
  claude: ClaudeStatus;
  projectType: ProjectType;
  claudeMd: boolean;
  integration: boolean;
  graphExists: boolean;
  gitignoreOk: boolean;
  claudeignoreOk: boolean;
  mcpConfigured: Record<string, boolean>;
  /** MCP tools enabled by config (the ones doctor should report on). */
  enabledMcp: McpTool[];
  /** Path of the config file in use, or null when using defaults. */
  configPath: string | null;
  /** Whether Claude auth/session problems should block readiness. */
  requireAuth: boolean;
}

function row(
  label: string,
  status: CheckResult["status"],
  severity: CheckSeverity,
  detail?: string,
): CheckResult {
  return { label, status, severity, detail };
}

function defaultTestClaudeStatus(): ClaudeStatus {
  return {
    state: "ready",
    installed: true,
    npmPackage: true,
    execInPath: true,
    execPath: "claude",
    detail: "test stub",
  };
}

export interface GatherDoctorFactsOptions {
  /**
   * Optional Claude status override for tests. Runtime doctor should omit this
   * so it performs the real `claude -p "ping"` readiness probe.
   */
  claudeStatus?: ClaudeStatus | (() => ClaudeStatus | Promise<ClaudeStatus>);
  /** Loaded config used for project-type override and MCP toggles. */
  config?: AiDevConfig;
  /** Config file path (from the loader); resolved via discovery when omitted. */
  configPath?: string | null;
}

/** Map a Claude state to the two readiness rows doctor should display. */
export function claudeRows(
  status: ClaudeStatus,
  requireAuth = true,
): CheckResult[] {
  const rows: CheckResult[] = [];

  if (status.state === "npm-only") {
    rows.push(row("Claude Code package installed", "ok", "important"));
    rows.push(
      row(
        "Claude Code executable available in PATH",
        "fail",
        "critical",
        "npm package present but not on PATH",
      ),
    );
    return rows;
  }

  if (!status.installed) {
    rows.push(
      row("Claude Code CLI installed", "fail", "critical", "not installed"),
    );
    return rows;
  }

  rows.push(row("Claude Code CLI installed", "ok", "critical"));

  switch (status.state) {
    case "ready":
      rows.push(row("Claude Code authentication ready", "ok", "important"));
      break;
    case "session-limited":
      rows.push(
        row(
          "Claude Code session limit",
          "warn",
          "important",
          status.resetTime
            ? `session limit reached; resets ${status.resetTime}`
            : "session limit reached",
        ),
      );
      break;
    case "not-authenticated":
      rows.push(
        row(
          "Claude Code authentication",
          // requireAuth:false downgrades this to a warning (non-blocking),
          // while keeping the row so the user still sees Claude isn't ready
          // for Graphify semantic extraction.
          requireAuth ? "fail" : "warn",
          "important",
          requireAuth
            ? "not authenticated; run `claude` or `claude login`"
            : "not authenticated (requireAuth=false); Graphify semantic extraction unavailable until you log in",
        ),
      );
      break;
    case "incompatible":
      rows.push(
        row(
          "Claude Code binary",
          "fail",
          "important",
          "incompatible with this system; reinstall via winget",
        ),
      );
      break;
    default:
      rows.push(
        row(
          "Claude Code readiness",
          "warn",
          "important",
          status.detail ?? "readiness could not be confirmed",
        ),
      );
  }
  return rows;
}

/** Gather all doctor facts (runs real checks). */
export async function gatherDoctorFacts(
  cwd: string,
  options: GatherDoctorFactsOptions = {},
): Promise<DoctorFacts> {
  const project = detectProject(cwd);
  const claudeMdPath = path.join(project.root, "CLAUDE.md");
  const claudeStatusPromise =
    typeof options.claudeStatus === "function"
      ? Promise.resolve(options.claudeStatus())
      : Promise.resolve(options.claudeStatus ?? undefined);

  const [
    pnpm,
    uv,
    graphifyCmd,
    claude,
    claudeMd,
    integrationStart,
    integrationEnd,
    graphPath,
    gitignore,
    claudeignore,
  ] = await Promise.all([
    commandExists("pnpm"),
    hasUv(),
    isGraphifyAvailable(),
    claudeStatusPromise.then((status) => status ?? getClaudeStatus()),
    fs.pathExists(claudeMdPath),
    fileContainsMarker(claudeMdPath, AI_DEV_SETUP_START),
    fileContainsMarker(claudeMdPath, AI_DEV_SETUP_END),
    findGraphJson(project.root),
    ignoreFileContainsAll(
      path.join(project.root, ".gitignore"),
      GITIGNORE_LINES,
    ),
    ignoreFileContainsAll(
      path.join(project.root, ".claudeignore"),
      CLAUDEIGNORE_LINES,
    ),
  ]);

  let graphifyy = false;
  if (uv) {
    const list = await run("uv", ["tool", "list"]);
    graphifyy = list.ok && /graphifyy/i.test(list.stdout);
  }

  const config = options.config ?? {};
  const enabledMcp = enabledMcpTools(config);
  const mcpConfigured: Record<string, boolean> = {};
  for (const tool of enabledMcp) mcpConfigured[tool.key] = false;

  const configPath =
    options.configPath !== undefined
      ? options.configPath
      : findConfigFile(project.root);
  const { requireAuth } = resolveClaudeSettings(config);

  return {
    nodeVersion: process.version,
    pnpm,
    uv,
    graphifyy,
    graphifyCmd,
    claude,
    projectType: resolveProjectType(project.type, config),
    claudeMd,
    integration: integrationStart || integrationEnd,
    graphExists: graphPath !== null,
    gitignoreOk: gitignore.ok,
    claudeignoreOk: claudeignore.ok,
    mcpConfigured,
    enabledMcp,
    configPath,
    requireAuth,
  };
}

/** Turn facts into the ordered list of display rows. */
export function factsToChecks(facts: DoctorFacts): CheckResult[] {
  const checks: CheckResult[] = [];

  checks.push(row("Node.js", "ok", "critical", facts.nodeVersion));
  checks.push(
    row("pnpm", facts.pnpm ? "ok" : "warn", "optional", facts.pnpm ? undefined : "not installed"),
  );
  checks.push(
    row("uv", facts.uv ? "ok" : "fail", "critical", facts.uv ? undefined : "required for graphifyy"),
  );
  checks.push(
    row(
      "graphifyy",
      facts.graphifyy ? "ok" : "fail",
      "critical",
      facts.graphifyy ? undefined : "not installed",
    ),
  );
  checks.push(
    row(
      "graphify command",
      facts.graphifyCmd ? "ok" : "fail",
      "critical",
      facts.graphifyCmd ? undefined : "not on PATH",
    ),
  );

  checks.push(...claudeRows(facts.claude, facts.requireAuth));

  checks.push(
    row(
      "Project type",
      facts.projectType === "Unknown" ? "warn" : "ok",
      "optional",
      facts.projectType,
    ),
  );
  checks.push(
    row(
      "CLAUDE.md",
      facts.claudeMd ? "ok" : "warn",
      "important",
      facts.claudeMd ? undefined : "missing (run `ai-dev init`)",
    ),
  );
  checks.push(
    row(
      "Graphify integration",
      facts.integration ? "ok" : "warn",
      "important",
      facts.integration ? undefined : "block missing from CLAUDE.md",
    ),
  );
  checks.push(
    row(
      "Graphify graph",
      facts.graphExists ? "ok" : "warn",
      "important",
      facts.graphExists ? undefined : "not built",
    ),
  );
  checks.push(
    row(
      ".gitignore entries",
      facts.gitignoreOk ? "ok" : "warn",
      "important",
      facts.gitignoreOk ? undefined : "missing entries",
    ),
  );
  checks.push(
    row(
      ".claudeignore entries",
      facts.claudeignoreOk ? "ok" : "warn",
      "important",
      facts.claudeignoreOk ? undefined : "missing entries",
    ),
  );

  checks.push(
    row(
      "ai-dev config",
      facts.configPath ? "ok" : "warn",
      "optional",
      facts.configPath
        ? path.basename(facts.configPath)
        : "missing, using defaults",
    ),
  );

  for (const tool of facts.enabledMcp) {
    const label = tool.name.endsWith("MCP") ? tool.name : `${tool.name} MCP`;
    const configured = facts.mcpConfigured[tool.key];
    checks.push(
      row(label, configured ? "ok" : "warn", "optional", configured ? undefined : "not configured"),
    );
  }

  return checks;
}

export type DoctorSummaryState =
  | "ready"
  | "ready-with-warnings"
  | "graph-missing"
  | "incomplete-claude"
  | "incomplete-graphify"
  | "incomplete";

export interface DoctorSummary {
  state: DoctorSummaryState;
  lines: string[];
  exitCode: ExitCodeValue;
}

const CLAUDE_READY_STATES: ClaudeState[] = ["ready", "session-limited"];

/**
 * Derive the overall summary from facts. Pure, so tests can assert the exact
 * state for crafted inputs.
 */
export function summarizeDoctor(facts: DoctorFacts): DoctorSummary {
  const graphifyReady = facts.uv && facts.graphifyy && facts.graphifyCmd;
  const claudeInstalled =
    facts.claude.installed && facts.claude.state !== "npm-only";
  // With requireAuth:false, an authenticated-but-not-yet-logged-in state is a
  // warning rather than a blocker. session-limited is always non-blocking.
  const authIssueTolerated =
    !facts.requireAuth && facts.claude.state === "not-authenticated";
  const claudeReady =
    CLAUDE_READY_STATES.includes(facts.claude.state) || authIssueTolerated;

  // Critical dependency failures first.
  if (!facts.uv || !facts.graphifyy || !facts.graphifyCmd) {
    return {
      state: "incomplete-graphify",
      lines: ["Setup incomplete. Graphify is not ready."],
      exitCode: ExitCode.MissingDependency,
    };
  }
  if (!claudeInstalled) {
    return {
      state: "incomplete-claude",
      lines: [
        "Setup incomplete. Claude Code is not ready.",
        facts.claude.state === "npm-only"
          ? "The npm package is installed but the executable is not on PATH."
          : "Install it with `npm install -g @anthropic-ai/claude-code` or winget.",
      ],
      exitCode: ExitCode.MissingDependency,
    };
  }

  // Claude installed but not usable (auth / incompatible). Important, not a hard
  // missing-dependency, so exit 1.
  if (!claudeReady) {
    const extra =
      facts.claude.state === "not-authenticated"
        ? "Run `claude` or `claude login`, then re-run `ai-dev doctor`."
        : facts.claude.state === "incompatible"
          ? "Reinstall via winget (see `ai-dev graph rebuild` guidance)."
          : "Run `ai-dev graph rebuild` for details.";
    return {
      state: "incomplete-claude",
      lines: ["Setup incomplete. Claude Code is not ready.", extra],
      exitCode: ExitCode.SetupFailed,
    };
  }

  void graphifyReady; // already verified above

  // All critical + claude readiness pass. Now important/optional.
  if (!facts.graphExists) {
    return {
      state: "graph-missing",
      lines: [
        "Ready for setup, but Graphify graph is not built.",
        "Recommendation: run ai-dev graph rebuild",
      ],
      exitCode: ExitCode.Success,
    };
  }

  const anyWarn =
    !facts.claudeMd ||
    !facts.integration ||
    !facts.gitignoreOk ||
    !facts.claudeignoreOk ||
    facts.claude.state === "session-limited" ||
    authIssueTolerated ||
    Object.values(facts.mcpConfigured).some((v) => !v) ||
    !facts.pnpm;

  if (anyWarn) {
    return {
      state: "ready-with-warnings",
      lines: ["Ready with warnings."],
      exitCode: ExitCode.Success,
    };
  }

  return {
    state: "ready",
    lines: ["Ready. All checks passed."],
    exitCode: ExitCode.Success,
  };
}

/**
 * Run the doctor command: print all checks, then the summary, and return the
 * derived exit code.
 */
export async function doctorCommand(cwd = process.cwd()): Promise<ExitCodeValue> {
  logger.heading("ai-dev doctor");

  let config: AiDevConfig = {};
  let loadedConfigPath: string | null = null;
  try {
    const loaded = await loadConfig(cwd);
    config = loaded.config;
    loadedConfigPath = loaded.filePath;
    for (const w of loaded.warnings) logger.warn(w);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error(`${err.message} (${err.filePath})`);
      return ExitCode.SetupFailed;
    }
    throw err;
  }

  const facts = await gatherDoctorFacts(cwd, {
    config,
    configPath: loadedConfigPath,
  });
  const checks = factsToChecks(facts);

  for (const c of checks) logger.check(c.status, c.label, c.detail);

  const summary = summarizeDoctor(facts);
  logger.info("");
  for (const line of summary.lines) {
    if (summary.state === "ready" || summary.state === "ready-with-warnings") {
      logger.success(line);
    } else if (
      summary.state === "graph-missing" ||
      line.startsWith("Recommendation") ||
      line.startsWith("Run ") ||
      line.startsWith("Install ") ||
      line.startsWith("Reinstall ") ||
      line.startsWith("The npm")
    ) {
      logger.info(line);
    } else {
      logger.warn(line);
    }
  }
  return summary.exitCode;
}

/** Back-compat wrapper retained for existing tests. */
export async function collectDoctorChecks(
  cwd: string,
  options: GatherDoctorFactsOptions = { claudeStatus: defaultTestClaudeStatus },
): Promise<CheckResult[]> {
  const facts = await gatherDoctorFacts(cwd, options);
  return factsToChecks(facts);
}
