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
  resolveArtifacts,
  resolveAiProviders,
  resolveClaudeSettings,
  resolveProjectType,
  resolveInitOptions,
  shouldCheckClaude,
  resolveBackend,
  graphBackendRequiresClaude,
  isGraphBuildEnabled,
} from "../core/config.js";
import { initCommand } from "./init.js";
import { logger } from "../core/logger.js";
import { listConfiguredMcpServers, type McpTool } from "../core/mcp.js";
import { getProviderStatuses, type ProviderStatus } from "../core/providers.js";
import { AI_DEV_SETUP_END, AI_DEV_SETUP_START } from "../templates/claudeMd.js";
import { CLAUDEIGNORE_LINES, GITIGNORE_LINES, GRAPHIFY_IGNORE_LINES } from "../templates/ignores.js";
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
  graphifyignoreOk: boolean;
  agentsMd: boolean;
  opencodeConfig: boolean;
  cursorRules: boolean;
  copilotInstructions: boolean;
  artifacts: ReturnType<typeof resolveArtifacts>;
  providers: ProviderStatus[];
  mcpConfigured: Record<string, boolean>;
  /** MCP tools enabled by config (the ones doctor should report on). */
  enabledMcp: McpTool[];
  /** Path of the config file in use, or null when using defaults. */
  configPath: string | null;
  /** Whether Claude Code is required by active providers. */
  needsClaude: boolean;
  /** Resolved Graphify backend for doctor hints. */
  graphBackend: string;
  /** Whether graph build is enabled in effective config. */
  graphBuildEnabled: boolean;
  /** Whether the graph backend is Claude Code-specific. */
  graphBackendNeedsClaude: boolean;
  /** Whether Claude auth/session problems should block readiness. */
  requireAuth: boolean;
  /** Whether CLAUDE.md updates are enabled in config. */
  updateClaudeMd: boolean;
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
  /** Probe real MCP configuration. Runtime doctor enables this; unit tests keep it off. */
  probeMcp?: boolean;
  /** Optional MCP configuration override for tests. */
  mcpConfigured?: Record<string, boolean>;
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
  const agentsMdPath = path.join(project.root, "AGENTS.md");
  const opencodeConfigPath = path.join(project.root, "opencode.jsonc");
  const cursorRulesPath = path.join(project.root, ".cursor", "rules", "ai-dev.mdc");
  const copilotInstructionsPath = path.join(project.root, ".github", "copilot-instructions.md");
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
    graphifyignore,
    agentsMd,
    opencodeConfig,
    cursorRules,
    copilotInstructions,
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
    ignoreFileContainsAll(
      path.join(project.root, ".graphifyignore"),
      GRAPHIFY_IGNORE_LINES,
    ),
    fs.pathExists(agentsMdPath),
    fs.pathExists(opencodeConfigPath),
    fs.pathExists(cursorRulesPath),
    fs.pathExists(copilotInstructionsPath),
  ]);

  let graphifyy = false;
  if (uv) {
    const list = await run("uv", ["tool", "list"]);
    graphifyy = list.ok && /graphifyy/i.test(list.stdout);
  }

  const config = options.config ?? {};
  const enabledMcp = enabledMcpTools(config);
  const artifacts = resolveArtifacts(config);
  const providerConfig = resolveAiProviders(config);
  const providers = await getProviderStatuses(providerConfig.providers);

  const configPath =
    options.configPath !== undefined
      ? options.configPath
      : findConfigFile(project.root);
  let mcpConfigured: Record<string, boolean> = {};
  if (options.mcpConfigured) {
    mcpConfigured = options.mcpConfigured;
  } else if (options.probeMcp) {
    const list = await listConfiguredMcpServers();
    for (const tool of enabledMcp) mcpConfigured[tool.key] = list.configured.has(tool.key);
  } else {
    for (const tool of enabledMcp) mcpConfigured[tool.key] = false;
  }

  const { requireAuth, updateClaudeMd } = resolveClaudeSettings(config);
  const needsClaude = shouldCheckClaude(config);
  const graphBackend = resolveBackend(undefined, config);
  const graphBuildEnabled = isGraphBuildEnabled(config);
  const graphBackendNeedsClaude = graphBackendRequiresClaude(config);

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
    graphifyignoreOk: graphifyignore.ok,
    agentsMd,
    opencodeConfig,
    cursorRules,
    copilotInstructions,
    artifacts,
    providers,
    mcpConfigured,
    enabledMcp,
    configPath,
    needsClaude,
    graphBackend,
    graphBuildEnabled,
    graphBackendNeedsClaude,
    requireAuth,
    updateClaudeMd,
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

  if (facts.needsClaude) {
    checks.push(...claudeRows(facts.claude, facts.requireAuth));
  } else {
    checks.push(row("Claude Code", "ok", "optional", "disabled by provider config"));
  }

  checks.push(
    row(
      "Project type",
      facts.projectType === "Unknown" ? "warn" : "ok",
      "optional",
      facts.projectType,
    ),
  );
  for (const provider of facts.providers) {
    checks.push(row(`AI provider: ${provider.name}`, provider.available ? "ok" : "warn", "optional", provider.available ? provider.detail : provider.detail ?? provider.installHint));
  }

  if (!facts.needsClaude && facts.graphBuildEnabled && facts.graphBackendNeedsClaude) {
    checks.push(
      row(
        "Graphify backend",
        "warn",
        "optional",
        "claude-cli selected while Claude provider is disabled; init will skip graph build unless another backend is configured",
      ),
    );
  }

  if (!facts.updateClaudeMd) {
    checks.push(row("CLAUDE.md", "ok", "optional", "disabled by config"));
    checks.push(
      row("Graphify integration", "ok", "optional", "disabled by config"),
    );
  } else {
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
  }
  checks.push(
    row(
      "Graphify graph",
      facts.graphExists || !facts.graphBuildEnabled ? "ok" : "warn",
      facts.graphBuildEnabled ? "important" : "optional",
      facts.graphExists
        ? undefined
        : facts.graphBuildEnabled
          ? "not built"
          : "skipped by config",
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
      ".graphifyignore entries",
      facts.graphifyignoreOk ? "ok" : "warn",
      "important",
      facts.graphifyignoreOk
        ? undefined
        : "missing code-only asset ignore entries",
    ),
  );

  if (facts.artifacts.agentsMd) checks.push(row("AGENTS.md", facts.agentsMd ? "ok" : "warn", "important", facts.agentsMd ? undefined : "missing"));
  if (facts.artifacts.opencodeConfig) checks.push(row("opencode.jsonc", facts.opencodeConfig ? "ok" : "warn", "important", facts.opencodeConfig ? undefined : "missing"));
  if (facts.artifacts.cursorRules) checks.push(row("Cursor rules", facts.cursorRules ? "ok" : "warn", "optional", facts.cursorRules ? undefined : "missing"));
  if (facts.artifacts.copilotInstructions) checks.push(row("Copilot instructions", facts.copilotInstructions ? "ok" : "warn", "optional", facts.copilotInstructions ? undefined : "missing"));

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
  if (facts.needsClaude && !claudeInstalled) {
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
  if (facts.needsClaude && !claudeReady) {
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
  if (facts.graphBuildEnabled && !facts.graphExists) {
    return {
      state: "graph-missing",
      lines: [
        "Ready for setup, but Graphify graph is not built.",
        "Recommendation: run ai-dev graph rebuild --code-only or choose a Graphify backend such as gemini/ollama.",
      ],
      exitCode: ExitCode.Success,
    };
  }

  const anyWarn =
    (facts.updateClaudeMd && !facts.claudeMd) ||
    (facts.updateClaudeMd && !facts.integration) ||
    !facts.gitignoreOk ||
    !facts.claudeignoreOk ||
    !facts.graphifyignoreOk ||
    (facts.artifacts.agentsMd && !facts.agentsMd) ||
    (facts.artifacts.opencodeConfig && !facts.opencodeConfig) ||
    (facts.artifacts.cursorRules && !facts.cursorRules) ||
    (facts.artifacts.copilotInstructions && !facts.copilotInstructions) ||
    (facts.needsClaude && facts.claude.state === "session-limited") ||
    (facts.needsClaude && authIssueTolerated) ||
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
export interface DoctorCommandOptions { fix?: boolean }

export async function doctorCommand(
  cwd = process.cwd(),
  options: DoctorCommandOptions = {},
): Promise<ExitCodeValue> {
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
    probeMcp: true,
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
  if (options.fix) {
    logger.info("");
    logger.heading("doctor --fix");
    logger.detail("Running safe, idempotent project setup fixes.");
    return initCommand(
      resolveInitOptions({ yes: true, skipGraph: true, force: true }, config),
      cwd,
      { config },
    );
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
