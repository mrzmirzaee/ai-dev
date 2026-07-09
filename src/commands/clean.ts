import path from "node:path";
import process from "node:process";
import fs from "fs-extra";
import { detectProject } from "../core/detect.js";
import { logger } from "../core/logger.js";
import { ExitCode, type ExitCodeValue } from "../types.js";

const CLEAN_TARGETS = [
  "graphify-out",
  "src/graphify-out",
  "app/graphify-out",
  ".graphify",
  ".ai-dev",
  ".ai-dev-setup.log",
  ".claude/settings.json",
];

export async function cleanCommand(opts: { dryRun?: boolean } = {}, cwd = process.cwd()): Promise<ExitCodeValue> {
  logger.heading(opts.dryRun ? "ai-dev clean --dry-run" : "ai-dev clean");
  const project = detectProject(cwd);
  const existing: string[] = [];
  for (const rel of CLEAN_TARGETS) {
    if (await fs.pathExists(path.join(project.root, rel))) existing.push(rel);
  }
  if (existing.length === 0) {
    logger.success("No ai-dev local/generated cache files found.");
    return ExitCode.Success;
  }
  if (opts.dryRun) {
    logger.info("Would remove:");
    for (const rel of existing) logger.info(`- ${rel}`);
    return ExitCode.Success;
  }
  for (const rel of existing) await fs.remove(path.join(project.root, rel));
  logger.success(`Removed ${existing.length} local/generated item(s).`);
  return ExitCode.Success;
}
