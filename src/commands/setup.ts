import process from "node:process";
import { ConfigError, loadConfig, resolveInitOptions } from "../core/config.js";
import { logger } from "../core/logger.js";
import { ExitCode, type AiDevConfig, type AiProvider, type ExitCodeValue } from "../types.js";
import { initCommand } from "./init.js";
import { doctorCommand } from "./doctor.js";
import { graphRebuildCommand } from "./graph.js";

export interface SetupCommandOptions {
  provider?: AiProvider;
  yes?: boolean;
  force?: boolean;
  skipGraph?: boolean;
  codeOnly?: boolean;
}

function withProvider(config: AiDevConfig, provider?: AiProvider): AiDevConfig {
  if (!provider) return config;
  return {
    ...config,
    ai: {
      ...config.ai,
      providers: [provider],
      primary: provider,
    },
  };
}

export async function setupCommand(
  opts: SetupCommandOptions = {},
  cwd = process.cwd(),
): Promise<ExitCodeValue> {
  logger.heading("ai-dev setup");
  let loaded: Awaited<ReturnType<typeof loadConfig>>;
  try {
    loaded = await loadConfig(cwd);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error(`${err.message} (${err.filePath})`);
      return ExitCode.SetupFailed;
    }
    throw err;
  }

  const config = withProvider(loaded.config, opts.provider);
  if (opts.provider) logger.detail(`Provider preset: ${opts.provider}`);

  const initResult = await initCommand(
    resolveInitOptions({ yes: opts.yes ?? true, force: opts.force ?? true, skipGraph: opts.skipGraph ?? true }, config),
    cwd,
    { config },
  );
  if (initResult !== ExitCode.Success && initResult !== ExitCode.MissingDependency) return initResult;

  if (!opts.skipGraph) {
    const graphResult = await graphRebuildCommand({ codeOnly: opts.codeOnly ?? true }, cwd);
    if (graphResult !== ExitCode.Success) logger.warn("Graph build did not complete; continuing to final doctor check.");
  }

  return doctorCommand(cwd);
}
