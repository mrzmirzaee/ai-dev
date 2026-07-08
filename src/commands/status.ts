import process from "node:process";
import { gatherDoctorFacts, summarizeDoctor } from "./doctor.js";
import { ConfigError, loadConfig } from "../core/config.js";
import { logger } from "../core/logger.js";
import { ExitCode, type ExitCodeValue } from "../types.js";

export async function statusCommand(cwd = process.cwd()): Promise<ExitCodeValue> {
  logger.heading("ai-dev status");
  let config = {};
  let configPath: string | null = null;
  try {
    const loaded = await loadConfig(cwd);
    config = loaded.config;
    configPath = loaded.filePath;
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error(`${err.message} (${err.filePath})`);
      return ExitCode.SetupFailed;
    }
    throw err;
  }

  const facts = await gatherDoctorFacts(cwd, { config, configPath, probeMcp: true });
  const summary = summarizeDoctor(facts);
  const providerNames = facts.providers.map((p) => p.name).join(", ") || "none";
  const mcpReady = facts.enabledMcp.filter((tool) => facts.mcpConfigured[tool.key]).map((tool) => tool.name);

  logger.info(`Project: ${facts.projectType}`);
  logger.info(`Provider: ${providerNames}`);
  logger.info(`Claude: ${facts.needsClaude ? facts.claude.state : "disabled"}`);
  logger.info(`Graphify: ${facts.graphifyCmd ? "ready" : "missing"}`);
  logger.info(`Graph: ${facts.graphExists ? facts.graphPath ?? "built" : facts.graphBuildEnabled ? "not built" : "skipped"}`);
  logger.info(`MCP: ${mcpReady.length ? mcpReady.join(", ") : "none configured"}`);
  logger.info(`Config: ${facts.configPath ? "present" : "defaults"}`);
  logger.info(`Status: ${summary.lines[0] ?? summary.state}`);
  return summary.exitCode;
}
