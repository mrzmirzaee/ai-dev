import path from "node:path";
import process from "node:process";
import { detectProject } from "../core/detect.js";
import { ensureBlock } from "../core/files.js";
import { logger } from "../core/logger.js";
import { RECOMMENDED_MCP_TOOLS } from "../core/mcp.js";
import {
  AI_DEV_MCP_END,
  AI_DEV_MCP_START,
  CLAUDE_MD_MCP_BLOCK,
} from "../templates/claudeMd.js";
import { ExitCode, type ExitCodeValue } from "../types.js";

/**
 * List recommended MCP tools with descriptions and install commands.
 */
export function mcpListCommand(): ExitCodeValue {
  logger.heading("Recommended MCP tools");
  for (const tool of RECOMMENDED_MCP_TOOLS) {
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
