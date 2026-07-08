import process from "node:process";
import { ConfigError, loadConfig, resolveAiProviders } from "../core/config.js";
import { AI_PROVIDERS, getProviderStatuses } from "../core/providers.js";
import { logger } from "../core/logger.js";
import { ExitCode, type ExitCodeValue } from "../types.js";

async function loadProviderKeys(cwd: string) {
  try {
    const { config } = await loadConfig(cwd);
    return resolveAiProviders(config).providers;
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error(`${err.message} (${err.filePath})`);
      return null;
    }
    throw err;
  }
}

export async function providerListCommand(): Promise<ExitCodeValue> {
  logger.heading("AI providers");
  for (const provider of AI_PROVIDERS) {
    logger.info("");
    logger.raw(`  ${provider.name} (${provider.key})`);
    logger.detail(`Artifacts: ${provider.artifactFiles.join(", ")}`);
    logger.detail(provider.installHint);
  }
  logger.info("");
  logger.next("Run `ai-dev wizard` to enable providers for this project.");
  return ExitCode.Success;
}

export async function providerDoctorCommand(cwd = process.cwd()): Promise<ExitCodeValue> {
  logger.heading("ai-dev provider doctor");
  const keys = await loadProviderKeys(cwd);
  if (!keys) return ExitCode.SetupFailed;
  const statuses = await getProviderStatuses(keys);
  for (const status of statuses) {
    logger.check(status.available ? "ok" : "warn", status.name, status.available ? status.detail : status.detail ?? status.installHint);
  }
  return ExitCode.Success;
}
