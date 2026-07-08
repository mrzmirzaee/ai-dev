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
  AI_DEV_MCP_END,
  AI_DEV_MCP_START,
  CLAUDE_MD_MCP_BLOCK,
} from "../templates/claudeMd.js";
import { ExitCode, type ExitCodeValue } from "../types.js";

/**
 * List recommended MCP tools with descriptions and install commands.
 * Honors the `mcp` toggles in config (disabled tools are omitted).
 */
export async function mcpListCommand(
  cwd = process.cwd(),
): Promise<ExitCodeValue> {
  logger.heading("Recommended MCP tools");

  let tools;
  try {
    const { config } = await loadConfig(cwd);
    tools = enabledMcpTools(config);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error(`${err.message} (${err.filePath})`);
      return ExitCode.SetupFailed;
    }
    throw err;
  }

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
    "MCP servers are added to Claude Code with `claude mcp add ...` (shown above).",
  );
  return ExitCode.Success;
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
