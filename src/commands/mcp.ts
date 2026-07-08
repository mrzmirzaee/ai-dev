import path from "node:path";
import process from "node:process";
import { detectProject } from "../core/detect.js";
import {
  ConfigError,
  enabledMcpTools,
  loadConfig,
} from "../core/config.js";
import { ensureBlock } from "../core/files.js";
import { logger } from "../core/logger.js";
import {
  getMcpTool,
  installMcpTool,
  listConfiguredMcpServers,
  type McpKey,
} from "../core/mcp.js";
import {
  AI_DEV_MCP_END,
  AI_DEV_MCP_START,
  CLAUDE_MD_MCP_BLOCK,
} from "../templates/claudeMd.js";
import { ExitCode, type ExitCodeValue } from "../types.js";

async function loadEnabledTools(cwd: string) {
  try {
    const { config } = await loadConfig(cwd);
    return enabledMcpTools(config);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error(`${err.message} (${err.filePath})`);
      return null;
    }
    throw err;
  }
}

/**
 * List recommended MCP tools with descriptions and install commands.
 * Honors the `mcp` toggles in config (disabled tools are omitted).
 */
export async function mcpListCommand(
  cwd = process.cwd(),
): Promise<ExitCodeValue> {
  logger.heading("Recommended MCP tools");

  const tools = await loadEnabledTools(cwd);
  if (!tools) return ExitCode.SetupFailed;

  if (tools.length === 0) {
    logger.detail("All MCP tools are disabled in config.");
    return ExitCode.Success;
  }

  for (const tool of tools) {
    logger.info("");
    logger.raw(`  ${tool.name}`);
    logger.detail(tool.purpose);
    logger.detail(`Install: ${tool.install}`);
  }
  logger.info("");
  logger.next(
    "Install one with `ai-dev mcp install <context7|serena|playwright>`.",
  );
  return ExitCode.Success;
}

/** Check configured MCP servers in Claude Code. */
export async function mcpDoctorCommand(
  cwd = process.cwd(),
): Promise<ExitCodeValue> {
  logger.heading("ai-dev mcp doctor");
  const tools = await loadEnabledTools(cwd);
  if (!tools) return ExitCode.SetupFailed;

  const list = await listConfiguredMcpServers();
  if (!list.ok) {
    logger.warn("Could not read Claude MCP server list.");
    logger.detail("Make sure Claude Code is installed and authenticated.");
    return ExitCode.SetupFailed;
  }

  for (const tool of tools) {
    logger.check(
      list.configured.has(tool.key) ? "ok" : "warn",
      `${tool.name}${tool.name.endsWith("MCP") ? "" : " MCP"}`,
      list.configured.has(tool.key) ? undefined : "not configured",
    );
  }
  return ExitCode.Success;
}

/** Install a recommended MCP server by key. */
export async function mcpInstallCommand(
  key: string,
  cwd = process.cwd(),
): Promise<ExitCodeValue> {
  logger.heading(`ai-dev mcp install ${key}`);
  const normalized = key.toLowerCase() as McpKey;
  const tool = getMcpTool(normalized);
  if (!tool) {
    logger.error(`Unknown MCP tool: ${key}`);
    logger.next("Run `ai-dev mcp list` to see supported tools.");
    return ExitCode.SetupFailed;
  }

  const tools = await loadEnabledTools(cwd);
  if (!tools) return ExitCode.SetupFailed;
  if (!tools.some((t) => t.key === tool.key)) {
    logger.warn(`${tool.name} is disabled in ai-dev config.`);
    logger.next("Enable it in ai-dev.config.json or remove the mcp toggle.");
    return ExitCode.SetupFailed;
  }

  logger.detail(tool.purpose);
  logger.detail(`Running: ${tool.install}`);
  const result = await installMcpTool(tool);
  if (result.ok) {
    logger.success(`${tool.name}${tool.name.endsWith("MCP") ? "" : " MCP"} installed.`);
    logger.next("Run `ai-dev mcp doctor` to verify MCP configuration.");
    return ExitCode.Success;
  }

  logger.commandFailure({
    command: tool.install,
    exitCode: result.exitCode,
    reason: `Could not install ${tool.name} MCP.`,
    stdout: result.stdout,
    stderr: result.stderr,
    nextAction: "Check Claude Code MCP support, then re-run the command.",
  });
  return ExitCode.SetupFailed;
}

/**
 * Add the optional MCP guidance block to CLAUDE.md (idempotent).
 */
export async function mcpGuideCommand(
  cwd = process.cwd(),
): Promise<ExitCodeValue> {
  const project = detectProject(cwd);
  const claudeMd = path.join(project.root, "CLAUDE.md");
  try {
    const change = await ensureBlock(
      claudeMd,
      AI_DEV_MCP_START,
      CLAUDE_MD_MCP_BLOCK,
      "",
      AI_DEV_MCP_END,
    );
    if (change === "unchanged") {
      logger.detail("MCP guidance already present in CLAUDE.md.");
    } else {
      logger.success(`MCP guidance block ${change} in CLAUDE.md.`);
    }
    return ExitCode.Success;
  } catch (err) {
    logger.error(
      `Could not update CLAUDE.md: ${err instanceof Error ? err.message : String(err)}`,
    );
    return ExitCode.SetupFailed;
  }
}
