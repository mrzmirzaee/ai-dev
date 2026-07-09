import process from "node:process";
import { doctorCommand } from "./doctor.js";
import { initCommand } from "./init.js";
import { loadConfig, resolveInitOptions } from "../core/config.js";
import { mergeConfigs } from "../core/presets.js";
import { logger } from "../core/logger.js";
import { type ExitCodeValue } from "../types.js";

export async function claudeDoctorCommand(cwd = process.cwd()): Promise<ExitCodeValue> {
  logger.heading("ai-dev claude doctor");
  return doctorCommand(cwd);
}

export async function claudeInitCommand(cwd = process.cwd()): Promise<ExitCodeValue> {
  logger.heading("ai-dev claude init");
  const loaded = await loadConfig(cwd);
  const config = mergeConfigs(loaded.config, {
    ai: { providers: ["claude"], primary: "claude" },
    artifacts: { claudeMd: true },
    claude: { updateClaudeMd: true, requireAuth: true },
  });
  return initCommand(resolveInitOptions({ yes: true, skipGraph: true, force: true }, config), cwd, { config });
}
