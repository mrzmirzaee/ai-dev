import process from "node:process";
import ora from "ora";
import { run } from "../core/command.js";
import { claudeInstalledViaNpm } from "../core/claude.js";
import { GRAPHIFY_PACKAGE, hasUv } from "../core/graphify.js";
import { logger } from "../core/logger.js";
import { isWindows } from "../core/platform.js";
import { ExitCode, type ExitCodeValue } from "../types.js";

/**
 * Update installed AI dev tools.
 */
export async function updateCommand(): Promise<ExitCodeValue> {
  logger.heading("ai-dev update");

  let missingRequired = false;

  // graphifyy via uv
  if (!(await hasUv())) {
    missingRequired = true;
    logger.error("uv is not installed — cannot update graphifyy.");
  } else {
    const spinner = ora({
      text: `Upgrading ${GRAPHIFY_PACKAGE}...`,
      stream: process.stdout,
    }).start();
    const res = await run("uv", ["tool", "upgrade", GRAPHIFY_PACKAGE]);
    if (res.ok) spinner.succeed(`${GRAPHIFY_PACKAGE} is up to date.`);
    else spinner.warn(`Could not upgrade ${GRAPHIFY_PACKAGE}.`);
  }

  // Claude Code via npm (only if installed that way)
  if (await claudeInstalledViaNpm()) {
    const spinner = ora({
      text: "Updating Claude Code (npm global)...",
      stream: process.stdout,
    }).start();
    const res = await run("npm", ["update", "-g", "@anthropic-ai/claude-code"]);
    if (res.ok) spinner.succeed("Claude Code updated.");
    else spinner.warn("Could not update Claude Code via npm.");
  } else {
    logger.detail("Claude Code not installed via npm; skipping npm update.");
    if (isWindows) {
      logger.next("For winget installs, run: winget upgrade Anthropic.ClaudeCode");
    } else {
      logger.detail(
        "On Windows with a winget install: winget upgrade Anthropic.ClaudeCode",
      );
    }
  }

  logger.info("");
  if (missingRequired) return ExitCode.MissingDependency;
  logger.success("Update complete.");
  return ExitCode.Success;
}
