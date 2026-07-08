import path from "node:path";
import process from "node:process";
import ora from "ora";
import { detectProject } from "../core/detect.js";
import {
  enabledMcpTools,
  resolveClaudeSettings,
  resolveProjectType,
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
  hasUv,
  installOrUpdateGraphify,
  isGraphifyAvailable,
  runGraphifyClaudeInstall,
} from "../core/graphify.js";
import { renderGraphOutcome } from "./graph.js";
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
  try {
    if (claudeSettings.updateClaudeMd) {
      const claudeMd = path.join(project.root, "CLAUDE.md");
      const claudeChange = await ensureBlock(
        claudeMd,
        AI_DEV_SETUP_START,
        CLAUDE_MD_SETUP_BLOCK,
        CLAUDE_MD_HEADER,
        AI_DEV_SETUP_END,
      );
      describeChange(claudeChange, "CLAUDE.md");
    } else {
      logger.detail("Skipping CLAUDE.md (claude.updateClaudeMd = false).");
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
  } catch (err) {
    failed = true;
    logger.error(
      `Failed writing project files: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Claude Code ----------------------------------------------------------
  logger.heading("Claude Code");
  const claudeAvailable = await hasClaudeCode();
  if (claudeAvailable) {
    logger.success("Claude Code CLI detected.");
  } else {
    printClaudeInstallInstructions();
  }

  // --- uv + graphify --------------------------------------------------------
  logger.heading("Graphify");
  const uvAvailable = await hasUv();
  if (!uvAvailable) {
    missingRequired = true;
    logger.error("uv is not installed — required to install graphifyy.");
    logger.next(
      "Install uv: https://docs.astral.sh/uv/getting-started/installation/",
    );
  } else {
    logger.success("uv detected.");
    const spinner = ora({ text: "Installing/updating graphifyy...", stream: process.stdout }).start();
    let installed = false;
    try {
      installed = await installOrUpdateGraphify();
    } catch {
      installed = false;
    }
    if (installed) spinner.succeed("graphifyy is installed.");
    else spinner.fail("Could not confirm graphifyy installation.");

    const graphifyReady = await isGraphifyAvailable();
    if (graphifyReady) {
      logger.success("graphify command is available.");
      // Integrate with Claude Code (best-effort). This rewrites CLAUDE.md, so
      // it is skipped when the user opted out of CLAUDE.md updates.
      if (claudeSettings.updateClaudeMd) {
        const integrated = await runGraphifyClaudeInstall(project.root);
        if (integrated) logger.success("Ran `graphify claude install`.");
        else logger.warn("`graphify claude install` did not complete cleanly.");
      } else {
        logger.detail(
          "Skipping `graphify claude install` (claude.updateClaudeMd = false).",
        );
      }
    } else {
      logger.warn("graphify command not found on PATH after install.");
      logger.detail(
        "On Windows, check %USERPROFILE%\\.local\\bin or %APPDATA%\\uv\\bin.",
      );
    }
  }

  // --- Graph build ----------------------------------------------------------
  if (options.skipGraph) {
    logger.heading("Graph");
    logger.detail("Skipping graph build (--skip-graph).");
  } else if (uvAvailable && (await isGraphifyAvailable())) {
    logger.heading("Building Graphify graph");
    const spinner = ora({ text: "Building graph...", stream: process.stdout }).start();
    try {
      const outcome = await buildGraph(project.root);
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
    if (!claudeSettings.updateClaudeMd) {
      logger.detail(
        "Skipping MCP guidance block in CLAUDE.md (claude.updateClaudeMd = false).",
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
    logger.warn("Setup finished, but a required dependency (uv) is missing.");
    return ExitCode.MissingDependency;
  }
  logger.success("Project is set up for AI development.");
  printInitNextSteps(options.skipGraph);
  return ExitCode.Success;
}

/**
 * Build the "next recommended commands" lines shown after a successful init.
 * Returned as an array so it can be asserted in tests.
 */
export function initNextStepsLines(skipGraph: boolean): string[] {
  const lines = [
    "",
    "Next recommended commands:",
    "1. Check setup:",
    "   ai-dev doctor",
    "",
    "2. Build the graph:",
    "   ai-dev graph rebuild",
    "",
    "3. Open Claude Code:",
    "   claude",
  ];
  if (skipGraph) {
    lines.push(
      "",
      "Graph build was skipped.",
      "Run this when ready:",
      "ai-dev graph rebuild",
    );
  }
  return lines;
}

function printInitNextSteps(skipGraph: boolean): void {
  for (const line of initNextStepsLines(skipGraph)) logger.info(line);
}
