import path from "node:path";
import process from "node:process";
import ora from "ora";
import fs from "fs-extra";
import { detectProject } from "../core/detect.js";
import {
  enabledMcpTools,
  resolveArtifacts,
  resolveAiProviders,
  resolveBackend,
  resolveClaudeSettings,
  resolveProjectType,
  shouldCheckClaude,
  graphBackendRequiresClaude,
} from "../core/config.js";
import {
  ensureBlock,
  ensureIgnoreLines,
  type FileChange,
} from "../core/files.js";
import {
  hasClaudeCode,
  printClaudeInstallInstructions,
} from "../core/claude.js";
import {
  buildGraph,
  installOrUpdateGraphify,
  isGraphifyAvailable,
  runGraphifyClaudeInstall,
} from "../core/graphify.js";
import { ensureGraphifyIgnoreAssets, renderGraphOutcome } from "./graph.js";
import { enableFileLogging, logger } from "../core/logger.js";
import {
  ExitCode,
  type AiDevConfig,
  type ExitCodeValue,
  type InitOptions,
  type ProjectType,
} from "../types.js";
import {
  AI_DEV_MCP_END,
  AI_DEV_MCP_START,
  AI_DEV_SETUP_END,
  AI_DEV_SETUP_START,
  CLAUDE_MD_HEADER,
  CLAUDE_MD_MCP_BLOCK,
  CLAUDE_MD_SETUP_BLOCK,
} from "../templates/claudeMd.js";
import { AI_DEV_AGENTS_END, AI_DEV_AGENTS_START, AGENTS_MD_BLOCK, AGENTS_MD_HEADER } from "../templates/agentsMd.js";
import { buildCopilotInstructions, buildCursorRules, OPENCODE_JSONC } from "../templates/providerArtifacts.js";
import {
  AI_DEV_PROJECT_CONTEXT_END,
  AI_DEV_PROJECT_CONTEXT_START,
  detectProjectContext,
  renderProjectContextBlock,
} from "../core/projectContext.js";
import {
  CLAUDEIGNORE_LINES,
  GITIGNORE_LINES,
  IGNORE_SECTION_HEADER,
} from "../templates/ignores.js";

/** Optional config context passed from the CLI layer. */
export interface InitContext {
  config?: AiDevConfig;
  projectTypeFlag?: ProjectType;
}

function describeChange(change: FileChange, file: string): void {
  if (change === "created") logger.success(`Created ${file}`);
  else if (change === "updated") logger.success(`Updated ${file}`);
  else logger.detail(`${file} already configured`);
}

/**
 * Bootstrap the current project for Claude Code + Graphify (+ optional MCP).
 */
export async function initCommand(
  options: InitOptions,
  cwd = process.cwd(),
  context: InitContext = {},
): Promise<ExitCodeValue> {
  const config = context.config ?? {};
  const project = detectProject(cwd);
  const effectiveType = resolveProjectType(
    project.type,
    config,
    context.projectTypeFlag,
  );

  enableFileLogging(path.join(project.root, ".ai-dev-setup.log"));

  logger.heading("ai-dev init");
  logger.info(`Project root: ${project.root}`);
  logger.info(`Project type: ${effectiveType}`);
  if (effectiveType !== project.type) {
    logger.detail(`(detected ${project.type}, overridden by config/flag)`);
  }

  const projectContext = await detectProjectContext(project.root, effectiveType);
  const projectContextBlock = renderProjectContextBlock(projectContext);

  if (!project.isProjectRoot && !options.force) {
    logger.error(
      "This folder does not look like a project root (no package.json, .git, etc.).",
    );
    logger.next("Re-run with --force to proceed anyway.");
    return ExitCode.SetupFailed;
  }
  if (!project.isProjectRoot && options.force) {
    logger.warn("Proceeding despite no project root markers (--force).");
  }

  let missingRequired = false;
  let failed = false;

  // --- File setup (always safe, idempotent) ---------------------------------
  logger.heading("Configuring project files");
  const claudeSettings = resolveClaudeSettings(config);
  const artifacts = resolveArtifacts(config);
  const writeClaudeArtifacts = claudeSettings.updateClaudeMd && artifacts.claudeMd;
  try {
    if (writeClaudeArtifacts) {
      const claudeMd = path.join(project.root, "CLAUDE.md");
      const claudeChange = await ensureBlock(
        claudeMd,
        AI_DEV_SETUP_START,
        CLAUDE_MD_SETUP_BLOCK,
        CLAUDE_MD_HEADER,
        AI_DEV_SETUP_END,
      );
      describeChange(claudeChange, "CLAUDE.md");
      await ensureBlock(
        claudeMd,
        AI_DEV_PROJECT_CONTEXT_START,
        projectContextBlock,
        "",
        AI_DEV_PROJECT_CONTEXT_END,
      );
    } else {
      logger.detail(artifacts.claudeMd ? "Skipping CLAUDE.md (claude.updateClaudeMd = false)." : "Skipping CLAUDE.md (Claude provider/artifact disabled).");
    }

    if (artifacts.agentsMd) {
      const agentsPath = path.join(project.root, "AGENTS.md");
      const agentsChange = await ensureBlock(
        agentsPath,
        AI_DEV_AGENTS_START,
        AGENTS_MD_BLOCK,
        AGENTS_MD_HEADER,
        AI_DEV_AGENTS_END,
      );
      describeChange(agentsChange, "AGENTS.md");
      await ensureBlock(
        agentsPath,
        AI_DEV_PROJECT_CONTEXT_START,
        projectContextBlock,
        "",
        AI_DEV_PROJECT_CONTEXT_END,
      );
    }

    if (artifacts.opencodeConfig) {
      const opencodePath = path.join(project.root, "opencode.jsonc");
      if (!(await fs.pathExists(opencodePath))) {
        await fs.writeFile(opencodePath, OPENCODE_JSONC, "utf8");
        logger.success("Created opencode.jsonc");
      } else {
        logger.detail("opencode.jsonc already configured");
      }
    }

    if (artifacts.cursorRules) {
      const cursorRulePath = path.join(project.root, ".cursor", "rules", "ai-dev.mdc");
      if (!(await fs.pathExists(cursorRulePath))) {
        await fs.ensureDir(path.dirname(cursorRulePath));
        await fs.writeFile(cursorRulePath, buildCursorRules(projectContextBlock), "utf8");
        logger.success("Created .cursor/rules/ai-dev.mdc");
      } else {
        logger.detail(".cursor/rules/ai-dev.mdc already configured");
      }
    }

    if (artifacts.copilotInstructions) {
      const copilotPath = path.join(project.root, ".github", "copilot-instructions.md");
      if (!(await fs.pathExists(copilotPath))) {
        await fs.ensureDir(path.dirname(copilotPath));
        await fs.writeFile(copilotPath, buildCopilotInstructions(projectContextBlock), "utf8");
        logger.success("Created .github/copilot-instructions.md");
      } else {
        logger.detail(".github/copilot-instructions.md already configured");
      }
    }

    const gitignore = await ensureIgnoreLines(
      path.join(project.root, ".gitignore"),
      GITIGNORE_LINES,
      IGNORE_SECTION_HEADER,
    );
    describeChange(gitignore.change, ".gitignore");

    const claudeignore = await ensureIgnoreLines(
      path.join(project.root, ".claudeignore"),
      CLAUDEIGNORE_LINES,
      IGNORE_SECTION_HEADER,
    );
    describeChange(claudeignore.change, ".claudeignore");

    const graphifyignore = await ensureGraphifyIgnoreAssets(project.root);
    describeChange(graphifyignore, ".graphifyignore");
    logger.detail(
      ".graphifyignore keeps common public/assets/media folders out of the code graph.",
    );
  } catch (err) {
    failed = true;
    logger.error(
      `Failed writing project files: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Claude Code ----------------------------------------------------------
  const needsClaude = shouldCheckClaude(config);
  if (needsClaude) {
    logger.heading("Claude Code");
    const claudeAvailable = await hasClaudeCode();
    if (claudeAvailable) {
      logger.success("Claude Code CLI detected.");
    } else {
      printClaudeInstallInstructions();
    }
  } else {
    logger.heading("Claude Code");
    logger.detail("Skipping Claude Code check (Claude provider/backend disabled).");
  }

  // --- Graphify -------------------------------------------------------------
  logger.heading("Graphify");
  const spinner = ora({ text: "Installing/checking graphifyy...", stream: process.stdout }).start();
  let installed = false;
  try {
    installed = await installOrUpdateGraphify();
  } catch {
    installed = false;
  }
  if (installed) spinner.succeed("graphifyy is ready.");
  else spinner.fail("Could not confirm graphifyy installation.");

  const graphifyReady = await isGraphifyAvailable();
  if (graphifyReady) {
    logger.success("graphify command is available.");
    if (writeClaudeArtifacts) {
      const integrated = await runGraphifyClaudeInstall(project.root);
      if (integrated) logger.success("Ran `graphify claude install`.");
      else logger.warn("`graphify claude install` did not complete cleanly.");
    } else {
      logger.detail(
        artifacts.claudeMd ? "Skipping `graphify claude install` (claude.updateClaudeMd = false)." : "Skipping `graphify claude install` (Claude provider/artifact disabled).",
      );
    }
  } else {
    missingRequired = true;
    logger.warn("Graphify is not ready.");
    logger.next("Run `ai-dev deps install graphify` or install Python/uv/pipx, then retry.");
  }

  // --- Graph build ----------------------------------------------------------
  const graphBackend = resolveBackend(undefined, config);
  const graphBackendNeedsClaude = graphBackendRequiresClaude(config);
  if (options.skipGraph) {
    logger.heading("Graph");
    logger.detail("Skipping graph build (--skip-graph).");
  } else if (graphBackend === "none") {
    logger.heading("Graph");
    logger.detail("Skipping graph build (graph.backend = none).")
    logger.next("Run `ai-dev graph rebuild --code-only` when you want a code-only graph.");
  } else if (!needsClaude && graphBackendNeedsClaude) {
    logger.heading("Graph");
    logger.detail(
      "Skipping graph build (graph backend is claude-cli, but Claude provider is disabled).",
    );
    logger.next(
      "Set graph.backend to gemini/ollama/openai/anthropic, or run `ai-dev graph rebuild --code-only` when ready.",
    );
  } else if (await isGraphifyAvailable()) {
    logger.heading("Building Graphify graph");
    const spinner = ora({ text: "Building graph...", stream: process.stdout }).start();
    try {
      const outcome = await buildGraph(project.root, { backend: graphBackend });
      if (outcome.kind === "built") spinner.succeed("Graph built.");
      else if (outcome.kind === "instructions")
        spinner.info("Semantic extraction required.");
      else spinner.stop();
      // Show the same guidance as `graph rebuild`, but never fail init over a
      // graph issue — file setup already succeeded and is the essential part.
      renderGraphOutcome(outcome);
    } catch (err) {
      spinner.fail(
        `Graph build error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    logger.heading("Graph");
    logger.detail("Skipping graph build (graphify unavailable).");
  }

  // --- MCP guidance ---------------------------------------------------------
  if (options.skipMcp) {
    logger.heading("MCP");
    logger.detail("Skipping MCP guidance (--skip-mcp).");
  } else {
    logger.heading("MCP tools (recommended)");
    const tools = enabledMcpTools(config);
    if (tools.length === 0) {
      logger.detail("All MCP tools disabled in config.");
    }
    for (const tool of tools) {
      logger.info(`  • ${tool.name}: ${tool.purpose}`);
    }
    // Add optional MCP block to CLAUDE.md (idempotent) — unless CLAUDE.md
    // updates are disabled.
    if (!writeClaudeArtifacts) {
      logger.detail(
        artifacts.claudeMd ? "Skipping MCP guidance block in CLAUDE.md (claude.updateClaudeMd = false)." : "Skipping MCP guidance block in CLAUDE.md (Claude provider/artifact disabled).",
      );
    } else {
      try {
        const claudeMd = path.join(project.root, "CLAUDE.md");
        const change = await ensureBlock(
          claudeMd,
          AI_DEV_MCP_START,
          CLAUDE_MD_MCP_BLOCK,
          "",
          AI_DEV_MCP_END,
        );
        if (change !== "unchanged") {
          logger.success("Added MCP guidance block to CLAUDE.md.");
        }
      } catch {
        logger.warn("Could not add MCP guidance block to CLAUDE.md.");
      }
    }
    logger.next("Run `ai-dev mcp list` for setup commands.");
  }

  // --- Summary + exit code --------------------------------------------------
  logger.info("");
  if (failed) {
    logger.error("Setup completed with errors.");
    return ExitCode.SetupFailed;
  }
  if (missingRequired) {
    logger.warn("Setup finished, but Graphify is not ready.");
    return ExitCode.MissingDependency;
  }
  logger.success("Project is set up for AI development.");
  printInitNextSteps(options.skipGraph, config);
  return ExitCode.Success;
}

/**
 * Build the "next recommended commands" lines shown after a successful init.
 * Returned as an array so it can be asserted in tests.
 */
export function initNextStepsLines(skipGraph: boolean, config: AiDevConfig = {}): string[] {
  const providerCommands: Record<string, string> = {
    claude: "claude",
    opencode: "opencode",
    cursor: "cursor",
    copilot: "VS Code / Codespaces",
    codex: "your Codex-compatible agent",
    generic: "your AI coding agent",
  };
  const activeProviders = resolveAiProviders(config).providers;
  const providers = activeProviders.filter((key) => key in providerCommands);
  const tools = providers.length
    ? [...new Set(providers.map((key) => providerCommands[key]))].join(" / ")
    : "your AI coding tool";

  const lines = [
    "",
    "Next recommended commands:",
    "1. Check setup:",
    "   ai-dev doctor",
  ];

  if (!skipGraph) {
    lines.push("", "2. Rebuild the graph when needed:", "   ai-dev graph rebuild");
  }

  lines.push(
    "",
    `${skipGraph ? "2" : "3"}. Open your AI coding tool:`,
    `   ${tools}`,
  );

  if (skipGraph) {
    lines.push(
      "",
      "Graph build was skipped.",
      "Run this when ready:",
      "ai-dev graph rebuild --code-only",
    );
  }
  return lines;
}

function printInitNextSteps(skipGraph: boolean, config: AiDevConfig): void {
  for (const line of initNextStepsLines(skipGraph, config)) logger.info(line);
}
