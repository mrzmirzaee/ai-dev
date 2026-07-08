import path from "node:path";
import process from "node:process";
import fs from "fs-extra";
import ora from "ora";
import {
  buildGraph,
  buildGraphFromSemantic,
  isGraphifyAvailable,
  type AssetSummary,
  type GraphOutcome,
} from "../core/graphify.js";
import { detectProject } from "../core/detect.js";
import { ConfigError, loadConfig, resolveBackend } from "../core/config.js";
import { ensureBlock } from "../core/files.js";
import { enableFileLogging, logger } from "../core/logger.js";
import {
  GRAPHIFY_IGNORE_BLOCK,
  GRAPHIFY_IGNORE_END,
  GRAPHIFY_IGNORE_START,
} from "../templates/ignores.js";
import {
  ExitCode,
  type ExitCodeValue,
  type GraphRebuildOptions,
} from "../types.js";

const SEMANTIC_TARGET = ".graphify/.graphify_semantic.json";
const IGNORE_ASSETS_MARKER = path.join(".ai-dev", "graph-ignore-assets-applied.json");

async function hasIgnoreAssetsApplied(cwd: string): Promise<boolean> {
  return (
    (await fs.pathExists(path.join(cwd, IGNORE_ASSETS_MARKER))) &&
    (await fs.pathExists(path.join(cwd, ".graphifyignore")))
  );
}

async function writeIgnoreAssetsMarker(cwd: string): Promise<void> {
  const markerPath = path.join(cwd, IGNORE_ASSETS_MARKER);
  await fs.ensureDir(path.dirname(markerPath));
  await fs.writeJson(
    markerPath,
    {
      appliedAt: new Date().toISOString(),
      file: ".graphifyignore",
    },
    { spaces: 2 },
  );
}

/**
 * Ensure `.graphifyignore` has ai-dev's code-focused defaults and record that
 * asset ignore has been applied. Safe to call from init, doctor --fix, or the
 * explicit graph command.
 */
export async function ensureGraphifyIgnoreAssets(
  cwd: string,
): Promise<"created" | "updated" | "unchanged"> {
  const file = path.join(cwd, ".graphifyignore");
  const change = await ensureBlock(
    file,
    GRAPHIFY_IGNORE_START,
    GRAPHIFY_IGNORE_BLOCK,
    "",
    GRAPHIFY_IGNORE_END,
  );
  await writeIgnoreAssetsMarker(cwd);
  return change;
}

/** Show a note when a project has many assets/docs needing semantic extraction. */
function maybePrintAssetGuidance(
  assets?: AssetSummary,
  ignoreAssetsAlreadyApplied = false,
): void {
  if (!assets) return;
  const heavy = (assets.needSemantic ?? 0) > 0 || assets.images + assets.docs > 20;
  if (!heavy) return;

  logger.info("");
  logger.info(
    "This project contains many docs/images that require semantic extraction.",
  );
  logger.info("");

  if (ignoreAssetsAlreadyApplied) {
    logger.info(
      "Asset ignore was already applied, but Graphify still detects docs/images.",
    );
    logger.info(
      "Your Graphify version may not support .graphifyignore, or it may use a different ignore mechanism.",
    );
    logger.info("");
    logger.info("Options:");
    logger.info("1. Use a Graphify backend such as gemini, ollama, openai, anthropic, or claude-cli.");
    logger.info("2. Build a code-only graph:");
    logger.info("   ai-dev graph rebuild --code-only");
    return;
  }

  logger.info("You can either:");
  logger.info("1. Use a Graphify backend such as gemini, ollama, openai, anthropic, or claude-cli.");
  logger.info("2. Build a code-only graph:");
  logger.next("ai-dev graph rebuild --code-only");
  logger.info("3. Write asset ignores for future builds:");
  logger.next("ai-dev graph ignore-assets");
}

function printInstructionsBlock(instructionsPath: string): void {
  logger.info("");
  logger.info("Semantic extraction is required.");
  logger.info("");
  logger.info("Next step:");
  logger.info("1. Open Claude Code in this project:");
  logger.info("   claude");
  logger.info("");
  logger.info("2. Paste this instruction:");
  logger.info(
    `   Read ${toRel(instructionsPath)} and follow its instructions exactly.`,
  );
  logger.info("");
  logger.info("3. After Claude finishes, make sure this file exists:");
  logger.info(`   ${SEMANTIC_TARGET}`);
  logger.info("");
  logger.info("4. Then run:");
  logger.info(`   ai-dev graph rebuild --semantic ${SEMANTIC_TARGET}`);
}

function printSessionLimitBlock(resetTime?: string): void {
  logger.info("");
  logger.info("Claude Code is authenticated but currently session-limited.");
  logger.info("Graphify semantic extraction cannot continue right now.");
  if (resetTime) logger.detail(`Session resets around ${resetTime}.`);
  logger.info("Retry after the reset time shown by Claude, then run:");
  logger.info("");
  logger.info("ai-dev graph rebuild");
  logger.info("");
  logger.info("Or use another Graphify backend now, for example:");
  logger.info("ai-dev graph rebuild --backend gemini");
  logger.info("ai-dev graph rebuild --code-only");
}

function printNotAuthenticatedBlock(): void {
  logger.info("");
  logger.info("Claude Code is installed but not authenticated.");
  logger.info("Run:");
  logger.info("");
  logger.info("claude");
  logger.info("");
  logger.info("or:");
  logger.info("");
  logger.info("claude login");
  logger.info("");
  logger.info("Then retry:");
  logger.info("");
  logger.info("ai-dev graph rebuild");
}

function printIncompatibleBlock(): void {
  logger.info("");
  logger.info("The Claude Code binary is not compatible with this system.");
  logger.info("Reinstall it via winget:");
  logger.info("");
  logger.info("npm uninstall -g @anthropic-ai/claude-code");
  logger.info("winget install Anthropic.ClaudeCode --source winget");
}

async function printNoProviderBlock(cwd: string, ignoreAssetsAlreadyApplied = false): Promise<void> {
  logger.info("");
  logger.info(
    "Graphify needs semantic extraction for docs/images, but no Graphify backend is available.",
  );
  logger.info("");
  logger.info(
    "OpenCode/Codex/Cursor/Copilot are AI coding tools; Graphify semantic extraction needs a supported backend such as gemini, ollama, openai, anthropic, or claude-cli.",
  );
  logger.info("");

  if (ignoreAssetsAlreadyApplied) {
    logger.info(
      "Asset ignore was already applied, but this Graphify version still detects docs/images.",
    );
    logger.info("Your Graphify version may not support .graphifyignore.");
    logger.info("");
  }

  await printGraphBackendOptions(cwd, true);
}

function toRel(p: string): string {
  const rel = path.relative(process.cwd(), p);
  return rel && !rel.startsWith("..") ? rel : p;
}


export async function detectCodeOnlyTarget(root: string): Promise<string> {
  const preferred = [
    "shared/src/commonMain/kotlin",
    "composeApp/src/commonMain/kotlin",
    "src/commonMain/kotlin",
    "app/src/main/kotlin",
    "app/src/main/java",
    "src/main/kotlin",
    "src/main/java",
    "src",
    "app",
    "pages",
    "components",
    "lib",
    "server",
    "api",
    "routes",
    "database/migrations",
  ];
  for (const dir of preferred) {
    if (await fs.pathExists(path.join(root, dir))) return dir;
  }
  return ".";
}

async function selectedProviderLabels(cwd: string): Promise<string[]> {
  try {
    const { config } = await loadConfig(cwd);
    const providers = config.ai?.providers?.length ? config.ai.providers : ["claude"];
    const labels: Record<string, string> = {
      claude: "Claude Code",
      opencode: "OpenCode",
      codex: "Codex / AGENTS.md",
      cursor: "Cursor",
      copilot: "GitHub Copilot",
      generic: "Generic AI Agent",
    };
    return providers.map((p) => labels[p] ?? p);
  } catch {
    return [];
  }
}

async function printGraphBackendOptions(cwd: string, includeClaude = false): Promise<void> {
  const labels = await selectedProviderLabels(cwd);
  if (labels.length) {
    logger.info(`Selected AI coding provider(s): ${labels.join(", ")}.`);
    logger.info("AI coding providers are separate from Graphify semantic extraction backends.");
    logger.info("");
  }
  logger.info("Recommended options:");
  logger.info("1. Gemini API free tier:");
  logger.info("   set GEMINI_API_KEY");
  logger.info("   ai-dev graph rebuild --backend gemini");
  logger.info("");
  logger.info("2. Ollama local backend:");
  logger.info("   install Ollama and pull a model");
  logger.info("   ai-dev graph rebuild --backend ollama");
  logger.info("");
  logger.info("3. Code-only graph (avoids public/assets/docs):");
  logger.info("   ai-dev graph rebuild --code-only");
  if (includeClaude) {
    logger.info("");
    logger.info("4. Claude Code subscription backend:");
    logger.info("   claude");
    logger.info("   ai-dev graph rebuild --backend claude-cli");
  }
}

/**
 * Render a graph build outcome to the console and return the exit code.
 * Exported for testing the branch-to-exit-code mapping.
 */
export async function renderGraphOutcome(
  outcome: GraphOutcome,
  cwd = process.cwd(),
): Promise<ExitCodeValue> {
  const ignoreAssetsAlreadyApplied = await hasIgnoreAssetsApplied(cwd);
  switch (outcome.kind) {
    case "built":
      logger.success(`Graph built (${toRel(outcome.graphPath)}).`);
      return ExitCode.Success;

    case "instructions":
      logger.raw(""); // spacing
      printInstructionsBlock(outcome.instructionsPath);
      return ExitCode.Success;

    case "claude-not-authenticated":
      printNotAuthenticatedBlock();
      return ExitCode.SetupFailed;

    case "claude-session-limited":
      printSessionLimitBlock(outcome.resetTime);
      return ExitCode.SetupFailed;

    case "claude-incompatible":
      printIncompatibleBlock();
      return ExitCode.SetupFailed;

    case "no-provider":
      await printNoProviderBlock(cwd, ignoreAssetsAlreadyApplied);
      return ExitCode.SetupFailed;

    case "failed":
      logger.commandFailure({
        command: outcome.command,
        exitCode: outcome.exitCode,
        reason: "Graph build failed.",
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        nextAction: "Review the output above, then re-run `ai-dev graph rebuild`.",
      });
      maybePrintAssetGuidance(outcome.assets, ignoreAssetsAlreadyApplied);
      return ExitCode.SetupFailed;
  }
}

/**
 * Rebuild or refresh the Graphify graph for the current project.
 */
export async function graphRebuildCommand(
  options: GraphRebuildOptions = {},
  cwd = process.cwd(),
): Promise<ExitCodeValue> {
  logger.heading("ai-dev graph rebuild");

  if (!(await isGraphifyAvailable())) {
    logger.error("graphify command not found.");
    logger.next("Run `ai-dev deps install graphify` or `ai-dev doctor --fix`, then retry.");
    return ExitCode.MissingDependency;
  }

  const project = detectProject(cwd);
  enableFileLogging(path.join(project.root, ".ai-dev-setup.log"));

  // Resolve the extract backend: explicit option > config file > default.
  let backend = options.backend;
  if (backend === undefined) {
    try {
      const { config } = await loadConfig(project.root);
      backend = resolveBackend(undefined, config);
    } catch (err) {
      if (err instanceof ConfigError) {
        logger.error(`${err.message} (${err.filePath})`);
        return ExitCode.SetupFailed;
      }
      throw err;
    }
  }

  // --- semantic-file-driven build -----------------------------------------
  if (options.semantic) {
    const semanticPath = path.isAbsolute(options.semantic)
      ? options.semantic
      : path.resolve(project.root, options.semantic);

    if (!(await fs.pathExists(semanticPath))) {
      logger.error(`Semantic file not found: ${options.semantic}`);
      logger.detail(`Looked for: ${semanticPath}`);
      logger.next(
        "Generate it via Claude Code first, then re-run with --semantic.",
      );
      return ExitCode.SetupFailed;
    }

    const spinner = ora({
      text: "Building graph from semantic file...",
      stream: process.stdout,
    }).start();
    const result = await buildGraphFromSemantic(project.root, semanticPath);
    if (result.kind === "built") {
      spinner.succeed(`Graph built successfully (${toRel(result.graphPath)}).`);
      return ExitCode.Success;
    }
    spinner.warn("Semantic extraction ran but no graph.json was produced.");
    logger.commandFailure({
      command: result.command,
      exitCode: result.exitCode,
      reason: "Graph was not produced from the semantic file.",
      stdout: result.stdout,
      stderr: result.stderr,
      nextAction: "Verify the semantic file, then re-run.",
    });
    return ExitCode.SetupFailed;
  }

  // --- standard build ------------------------------------------------------
  let target = ".";
  if (options.codeOnly) {
    target = await detectCodeOnlyTarget(project.root);
    logger.detail(`Code-only graph target: ${target}`);
  }

  if (backend === "none" && !options.codeOnly) {
    logger.error("Graph backend is set to none.");
    logger.next("Use `ai-dev graph rebuild --code-only` or pass `--backend gemini|ollama|openai|anthropic|claude-cli`.");
    return ExitCode.SetupFailed;
  }

  const spinner = ora({
    text: "Rebuilding graph...",
    stream: process.stdout,
  }).start();
  try {
    const outcome = await buildGraph(project.root, { backend, target });
    if (outcome.kind === "built") spinner.succeed("Graph rebuilt.");
    else if (outcome.kind === "instructions")
      spinner.info("Semantic extraction required.");
    else spinner.stop();
    return await renderGraphOutcome(outcome, project.root);
  } catch (err) {
    spinner.fail(
      `Graph rebuild error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return ExitCode.SetupFailed;
  }
}

/**
 * Create or update `.graphifyignore` with code-only defaults so Graphify can
 * build a graph without needing semantic extraction for assets/docs.
 *
 * Note: whether Graphify honors `.graphifyignore` depends on the installed
 * Graphify version; this command writes the file and says so plainly.
 */
export async function graphIgnoreAssetsCommand(
  cwd = process.cwd(),
): Promise<ExitCodeValue> {
  logger.heading("ai-dev graph ignore-assets");
  const project = detectProject(cwd);
  try {
    const change = await ensureGraphifyIgnoreAssets(project.root);
    if (change === "unchanged") {
      logger.detail(".graphifyignore already contains the code-only block.");
    } else {
      logger.success(`.graphifyignore ${change} with code-only defaults.`);
    }
    logger.detail("Note: Some Graphify versions may not read .graphifyignore.");
    logger.detail(
      "If rebuild still requires semantic extraction, use `ai-dev graph rebuild --code-only` or choose a Graphify backend such as gemini/ollama.",
    );
    logger.next("Then run: ai-dev graph rebuild --code-only");
    return ExitCode.Success;
  } catch (err) {
    logger.error(
      `Could not write .graphifyignore: ${err instanceof Error ? err.message : String(err)}`,
    );
    return ExitCode.SetupFailed;
  }
}
