import process from "node:process";
import { ConfigError, loadConfig, resolveInitOptions } from "../core/config.js";
import { logger } from "../core/logger.js";
import { ExitCode, type AiProvider, type ExitCodeValue } from "../types.js";
import { initCommand } from "./init.js";
import { doctorCommand } from "./doctor.js";
import { graphRebuildCommand } from "./graph.js";
import { createBranch, isWorkingTreeDirty } from "../core/git.js";
import { getPreset, mergeConfigs, providerToPreset, type PresetName } from "../core/presets.js";

export interface SetupCommandOptions {
  provider?: AiProvider;
  preset?: PresetName;
  yes?: boolean;
  force?: boolean;
  skipGraph?: boolean;
  codeOnly?: boolean;
  allowDirty?: boolean;
  branch?: string;
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

  if (opts.branch) {
    const branch = await createBranch(cwd, opts.branch);
    if (branch.ok) logger.success(`Created and switched to branch ${opts.branch}.`);
    else logger.warn(`Could not create branch ${opts.branch}: ${branch.detail ?? "unknown git error"}`);
  }

  if (!opts.allowDirty && await isWorkingTreeDirty(cwd)) {
    logger.warn("Working tree has uncommitted changes.");
    logger.next("Commit/stash first, pass --allow-dirty, or use --branch chore/setup-ai-dev.");
    return ExitCode.SetupFailed;
  }

  let config = loaded.config;
  if (opts.preset) {
    const preset = getPreset(opts.preset);
    if (!preset) {
      logger.error(`Unknown preset: ${opts.preset}`);
      logger.next("Run `ai-dev preset list`.");
      return ExitCode.SetupFailed;
    }
    logger.detail(`Preset: ${preset.name}`);
    config = mergeConfigs(config, preset.config);
  }
  if (opts.provider) {
    logger.detail(`Provider preset: ${opts.provider}`);
    config = mergeConfigs(config, providerToPreset(opts.provider));
  }

  const initResult = await initCommand(
    resolveInitOptions({ yes: opts.yes ?? true, force: opts.force ?? true, skipGraph: opts.skipGraph ?? true }, config),
    cwd,
    { config },
  );
  if (initResult !== ExitCode.Success && initResult !== ExitCode.MissingDependency) return initResult;

  if (!opts.skipGraph) {
    const graphResult = await graphRebuildCommand({ codeOnly: opts.codeOnly ?? true, ifStale: true }, cwd);
    if (graphResult !== ExitCode.Success) logger.warn("Graph build did not complete; continuing to final doctor check.");
  }

  return doctorCommand(cwd);
}
