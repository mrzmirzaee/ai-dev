import path from "node:path";
import process from "node:process";
import prompts from "prompts";
import fs from "fs-extra";
import { detectProject } from "../core/detect.js";
import {
  CONFIG_FILENAMES,
  ConfigError,
  defaultConfigObject,
  loadConfig,
  normalizeConfig,
  resolveInitOptions,
} from "../core/config.js";
import { initCommand } from "./init.js";
import { logger } from "../core/logger.js";
import { ExitCode, PROJECT_TYPES, type AiDevConfig, type AiProvider, type ExitCodeValue } from "../types.js";

export interface WizardOptions {
  yes?: boolean;
  force?: boolean;
}

function configPathFor(root: string): string {
  return path.join(root, CONFIG_FILENAMES[0]);
}

/** Interactive setup wizard for a release-ready first-run experience. */
export async function wizardCommand(
  cwd = process.cwd(),
  options: WizardOptions = {},
): Promise<ExitCodeValue> {
  logger.heading("ai-dev wizard");
  const project = detectProject(cwd);
  logger.info(`Project root: ${project.root}`);
  logger.info(`Detected project type: ${project.type}`);

  let existing: AiDevConfig = {};
  let existingPath: string | null = null;
  try {
    const loaded = await loadConfig(project.root);
    existing = loaded.config;
    existingPath = loaded.filePath;
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error(`${err.message} (${err.filePath})`);
      return ExitCode.SetupFailed;
    }
    throw err;
  }

  const current = normalizeConfig(existing);

  if (options.yes) {
    logger.detail("Non-interactive mode: writing default config and running init.");
    const target = existingPath ?? configPathFor(project.root);
    if (!existingPath) await fs.writeJson(target, defaultConfigObject(), { spaces: 2 });
    return initCommand(
      resolveInitOptions({ yes: true, skipGraph: current.skipGraph, force: options.force }, existing),
      project.root,
      { config: existing },
    );
  }

  const baseAnswers = await prompts(
    [
      {
        type: "select",
        name: "projectType",
        message: "Project type",
        choices: PROJECT_TYPES.map((value) => ({ title: value, value })),
        initial: Math.max(0, PROJECT_TYPES.indexOf(existing.projectType ?? project.type)),
      },
      {
        type: "multiselect",
        name: "providers",
        message: "AI coding tools to support",
        choices: [
          { title: "Claude Code", value: "claude", selected: current.ai.providers.includes("claude") },
          { title: "OpenCode", value: "opencode", selected: current.ai.providers.includes("opencode") },
          { title: "Codex / AGENTS.md", value: "codex", selected: current.ai.providers.includes("codex") },
          { title: "Cursor", value: "cursor", selected: current.ai.providers.includes("cursor") },
          { title: "GitHub Copilot", value: "copilot", selected: current.ai.providers.includes("copilot") },
          { title: "Generic AI Agent", value: "generic", selected: current.ai.providers.includes("generic") },
        ],
        hint: "Space to select, Enter to continue",
      },
    ],
    {
      onCancel: () => {
        logger.warn("Wizard cancelled.");
        return false;
      },
    },
  );

  if (!baseAnswers || Object.keys(baseAnswers).length === 0) return ExitCode.SetupFailed;

  const selectedProviders = new Set<string>(
    baseAnswers.providers?.length ? baseAnswers.providers : ["claude"],
  );
  const hasClaudeProvider = selectedProviders.has("claude");
  const defaultBuildGraph = hasClaudeProvider ? !current.skipGraph : false;
  const backendChoices = hasClaudeProvider
    ? ["claude-cli", "gemini", "ollama", "openai", "anthropic"]
    : ["none", "gemini", "ollama", "openai", "anthropic", "claude-cli"];
  const defaultBackend = hasClaudeProvider
    ? current.graph.backend
    : current.graph.backend === "claude-cli"
      ? "none"
      : current.graph.backend;

  const answers = await prompts(
    [
      {
        type: hasClaudeProvider ? "confirm" : null,
        name: "updateClaudeMd",
        message: "Create/update CLAUDE.md and install Graphify Claude hooks?",
        initial: current.claude.updateClaudeMd,
      },
      {
        type: hasClaudeProvider ? "confirm" : null,
        name: "requireAuth",
        message: "Require Claude authentication for doctor readiness?",
        initial: current.claude.requireAuth,
      },
      {
        type: "confirm",
        name: "buildGraph",
        message: hasClaudeProvider
          ? "Build Graphify graph during init?"
          : "Build Graphify graph during init? (default off for non-Claude setups)",
        initial: defaultBuildGraph,
      },
      {
        type: (prev: boolean) => (prev ? "select" : null),
        name: "backend",
        message: "Graphify semantic backend (separate from your AI coding tool)",
        choices: backendChoices.map((value) => ({
          title:
            value === "none"
              ? "none / code-only later"
              : value === "gemini"
                ? "gemini - free tier available, requires GEMINI_API_KEY"
                : value === "ollama"
                  ? "ollama - free local backend"
                  : value === "claude-cli"
                    ? "claude-cli - uses Claude Code subscription"
                    : value,
          value,
        })),
        initial: Math.max(0, backendChoices.indexOf(defaultBackend)),
      },
      {
        type: "multiselect",
        name: "mcpTools",
        message: "Recommended MCP tools to enable",
        choices: [
          { title: "Context7", value: "context7", selected: current.mcp.context7 },
          { title: "Serena", value: "serena", selected: current.mcp.serena },
          { title: "Playwright MCP", value: "playwright", selected: current.mcp.playwright },
        ],
        hint: "Space to select, Enter to continue",
      },
      {
        type: "confirm",
        name: "runInit",
        message: "Run ai-dev init now?",
        initial: true,
      },
    ],
    {
      onCancel: () => {
        logger.warn("Wizard cancelled.");
        return false;
      },
    },
  );

  if (!answers || Object.keys(answers).length === 0) return ExitCode.SetupFailed;

  const selected = new Set<string>(answers.mcpTools ?? []);
  const config: AiDevConfig = {
    projectType: baseAnswers.projectType,
    skipGraph: !answers.buildGraph,
    skipMcp: selected.size === 0,
    ai: {
      providers: Array.from(selectedProviders) as AiProvider[],
      primary: (selectedProviders.has("claude") ? "claude" : Array.from(selectedProviders)[0]) as AiProvider,
    },
    artifacts: {
      claudeMd: selectedProviders.has("claude"),
      agentsMd: ["opencode", "codex", "generic"].some((provider) => selectedProviders.has(provider)),
      opencodeConfig: selectedProviders.has("opencode"),
      cursorRules: selectedProviders.has("cursor"),
      copilotInstructions: selectedProviders.has("copilot"),
    },
    graph: { backend: answers.backend ?? defaultBackend },
    claude: {
      updateClaudeMd: hasClaudeProvider ? answers.updateClaudeMd : false,
      requireAuth: hasClaudeProvider ? answers.requireAuth : false,
    },
    mcp: {
      context7: selected.has("context7"),
      serena: selected.has("serena"),
      playwright: selected.has("playwright"),
    },
  };

  const target = existingPath ?? configPathFor(project.root);
  await fs.writeJson(target, normalizeConfig(config), { spaces: 2 });
  logger.success(`${existingPath ? "Updated" : "Created"} ${path.basename(target)}`);
  logger.detail(target);

  if (!answers.runInit) {
    logger.next("Run `ai-dev init` when ready.");
    return ExitCode.Success;
  }

  return initCommand(
    resolveInitOptions({ yes: true, force: options.force }, config),
    project.root,
    { config, projectTypeFlag: baseAnswers.projectType },
  );
}
