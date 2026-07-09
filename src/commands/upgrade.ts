import process from "node:process";
import { ConfigError, loadConfig, resolveInitOptions } from "../core/config.js";
import { logger } from "../core/logger.js";
import { ExitCode, type ExitCodeValue } from "../types.js";
import { initCommand } from "./init.js";
import { doctorCommand } from "./doctor.js";

export async function upgradeCommand(cwd = process.cwd()): Promise<ExitCodeValue> {
  logger.heading("ai-dev upgrade");
  let loaded: Awaited<ReturnType<typeof loadConfig>>;
  try { loaded = await loadConfig(cwd); }
  catch (err) {
    if (err instanceof ConfigError) {
      logger.error(`${err.message} (${err.filePath})`);
      return ExitCode.SetupFailed;
    }
    throw err;
  }
  logger.detail("Refreshing generated ai-dev blocks while preserving custom content.");
  const result = await initCommand(resolveInitOptions({ yes: true, skipGraph: true, force: true }, loaded.config), cwd, { config: loaded.config });
  if (result !== ExitCode.Success && result !== ExitCode.MissingDependency) return result;
  return doctorCommand(cwd);
}
