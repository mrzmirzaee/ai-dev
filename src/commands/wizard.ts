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
import { ExitCode, type AiDevConfig, type ExitCodeValue, type ProjectType } from "../types.js";

const PROJECT_TYPES: ProjectType[] = [
  "Next.js",
  "NestJS",
  "React",
  "Vite",
  "Node.js",
  "Python",
  "Laravel",
  "PHP",
  "Unknown",
];

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

  const answers = await prompts(
    [
      {
        type: "select",
        name: "projectType",
        message: "Project type",
        choices: PROJECT_TYPES.map((value) => ({ title: value, value })),
        initial: Math.max(0, PROJECT_TYPES.indexOf(existing.projectType ?? project.type)),
      },
      {
        type: "confirm",
        name: "updateClaudeMd",
        message: "Create/update CLAUDE.md and install Graphify Claude hooks?",
        initial: current.claude.updateClaudeMd,
      },
      {
        type: "confirm",
        name: "requireAuth",
        message: "Require Claude authentication for doctor readiness?",
        initial: current.claude.requireAuth,
      },
      {
        type: "confirm",
        name: "buildGraph",
        message: "Build Graphify graph during init?",
        initial: !current.skipGraph,
      },
      {
        type: "select",
        name: "backend",
        message: "Graphify semantic backend",
        choices: ["claude-cli", "anthropic", "openai", "gemini", "ollama"].map((value) => ({ title: value, value })),
        initial: ["claude-cli", "anthropic", "openai", "gemini", "ollama"].indexOf(current.graph.backend),
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
    projectType: answers.projectType,
    skipGraph: !answers.buildGraph,
    skipMcp: selected.size === 0,
    graph: { backend: answers.backend },
    claude: {
      updateClaudeMd: answers.updateClaudeMd,
      requireAuth: answers.requireAuth,
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
    { config, projectTypeFlag: answers.projectType },
  );
}
