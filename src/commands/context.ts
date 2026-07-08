import process from "node:process";
import { detectProject } from "../core/detect.js";
import { loadConfig, resolveProjectType } from "../core/config.js";
import { detectProjectContext, renderProjectContextBlock } from "../core/projectContext.js";
import { logger } from "../core/logger.js";
import { ExitCode, type ExitCodeValue } from "../types.js";

export async function contextCommand(cwd = process.cwd()): Promise<ExitCodeValue> {
  const project = detectProject(cwd);
  const loaded = await loadConfig(project.root);
  const effectiveType = resolveProjectType(project.type, loaded.config);
  const context = await detectProjectContext(project.root, effectiveType);

  logger.heading("ai-dev context");
  logger.info(`Project root: ${project.root}`);
  logger.info(`Project type: ${effectiveType}`);
  logger.info("");
  logger.info(renderProjectContextBlock(context));
  return ExitCode.Success;
}
