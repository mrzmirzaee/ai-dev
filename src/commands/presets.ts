import { PRESETS, getPreset } from "../core/presets.js";
import { logger } from "../core/logger.js";
import { ExitCode, type ExitCodeValue } from "../types.js";

export async function presetListCommand(): Promise<ExitCodeValue> {
  logger.heading("ai-dev preset list");
  for (const preset of PRESETS) logger.info(`${preset.name} — ${preset.description}`);
  return ExitCode.Success;
}

export async function presetShowCommand(name: string): Promise<ExitCodeValue> {
  logger.heading(`ai-dev preset show ${name}`);
  const preset = getPreset(name);
  if (!preset) {
    logger.error(`Unknown preset: ${name}`);
    logger.next("Run `ai-dev preset list`.");
    return ExitCode.SetupFailed;
  }
  logger.info(preset.description);
  logger.raw(JSON.stringify(preset.config, null, 2));
  return ExitCode.Success;
}
