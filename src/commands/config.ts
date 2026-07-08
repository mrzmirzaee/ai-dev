import path from "node:path";
import process from "node:process";
import fs from "fs-extra";
import { detectProject } from "../core/detect.js";
import {
  CONFIG_FILENAMES,
  ConfigError,
  defaultConfigObject,
  loadConfig,
  normalizeConfig,
} from "../core/config.js";
import { logger } from "../core/logger.js";
import { ExitCode, type ExitCodeValue } from "../types.js";

const PRIMARY_CONFIG = "ai-dev.config.json";

/**
 * `ai-dev config init` — write a starter `ai-dev.config.json` with the current
 * defaults. Never overwrites an existing config file (either supported name).
 */
export async function configInitCommand(
  cwd = process.cwd(),
): Promise<ExitCodeValue> {
  logger.heading("ai-dev config init");
  const project = detectProject(cwd);

  // Refuse to clobber any existing supported config file.
  for (const name of CONFIG_FILENAMES) {
    const existing = path.join(project.root, name);
    if (await fs.pathExists(existing)) {
      logger.warn(`Config already exists: ${existing}`);
      return ExitCode.Success;
    }
  }

  const target = path.join(project.root, PRIMARY_CONFIG);
  try {
    await fs.writeFile(
      target,
      `${JSON.stringify(defaultConfigObject(), null, 2)}\n`,
      "utf8",
    );
    logger.success(`Created ${PRIMARY_CONFIG}`);
    logger.detail(target);
    return ExitCode.Success;
  } catch (err) {
    logger.error(
      `Could not write ${PRIMARY_CONFIG}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return ExitCode.SetupFailed;
  }
}

/**
 * `ai-dev config show` — print the effective, normalized config and its source.
 */
export async function configShowCommand(
  cwd = process.cwd(),
): Promise<ExitCodeValue> {
  logger.heading("ai-dev config show");

  let loaded;
  try {
    loaded = await loadConfig(cwd);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error(`${err.message} (${err.filePath})`);
      return ExitCode.SetupFailed;
    }
    throw err;
  }

  for (const w of loaded.warnings) logger.warn(w);

  if (!loaded.filePath) {
    logger.info("No config file found. Using defaults.");
  }

  const effective = normalizeConfig(loaded.config);
  logger.raw(JSON.stringify(effective, null, 2));
  logger.info("");
  logger.info(
    `Source: ${loaded.filePath ? path.basename(loaded.filePath) : "defaults"}`,
  );
  return ExitCode.Success;
}
