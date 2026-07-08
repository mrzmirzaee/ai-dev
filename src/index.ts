import { Command } from "commander";
import process from "node:process";
import { initCommand } from "./commands/init.js";
import { doctorCommand } from "./commands/doctor.js";
import { updateCommand } from "./commands/update.js";
import {
  graphIgnoreAssetsCommand,
  graphRebuildCommand,
} from "./commands/graph.js";
import { mcpGuideCommand, mcpListCommand } from "./commands/mcp.js";
import {
  configInitCommand,
  configShowCommand,
} from "./commands/config.js";
import { ConfigError, loadConfig, resolveInitOptions } from "./core/config.js";
import { logger } from "./core/logger.js";
import { ExitCode, type InitOptions, type ProjectType } from "./types.js";

const VERSION = "0.3.0";

function finish(code: number): never {
  process.exit(code);
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("ai-dev")
    .description(
      "Bootstrap AI development tooling (Claude Code + Graphify + MCP) for any project.",
    )
    .version(VERSION, "-v, --version", "Print version");

  // init
  program
    .command("init")
    .description("Bootstrap the current project for AI development.")
    .option("-y, --yes", "Non-interactive mode; accept defaults.")
    .option("--skip-graph", "Skip building the Graphify graph.")
    .option("--skip-mcp", "Skip MCP guidance and config.")
    .option("--force", "Continue even if this folder is not a project root.")
    .option(
      "--project-type <type>",
      "Override project-type detection (e.g. Next.js, Vite, Node.js).",
    )
    .action(async (opts: Record<string, unknown>) => {
      let loaded: Awaited<ReturnType<typeof loadConfig>>;
      try {
        loaded = await loadConfig(process.cwd());
      } catch (err) {
        if (err instanceof ConfigError) {
          logger.error(`${err.message} (${err.filePath})`);
          finish(ExitCode.SetupFailed);
        }
        throw err;
      }
      for (const w of loaded.warnings) logger.warn(w);

      const options: InitOptions = resolveInitOptions(
        {
          yes: opts.yes as boolean | undefined,
          skipGraph: opts.skipGraph as boolean | undefined,
          skipMcp: opts.skipMcp as boolean | undefined,
          force: opts.force as boolean | undefined,
          projectType: opts.projectType as ProjectType | undefined,
        },
        loaded.config,
      );
      finish(
        await initCommand(options, process.cwd(), {
          config: loaded.config,
          projectTypeFlag: opts.projectType as ProjectType | undefined,
        }),
      );
    });

  // doctor
  program
    .command("doctor")
    .description("Check environment health.")
    .action(async () => {
      finish(await doctorCommand());
    });

  // update
  program
    .command("update")
    .description("Update installed AI dev tools.")
    .action(async () => {
      finish(await updateCommand());
    });

  // graph
  const graph = program
    .command("graph")
    .description("Manage the Graphify graph.");
  graph
    .command("rebuild")
    .description("Rebuild or refresh the Graphify graph.")
    .option(
      "--semantic <path>",
      "Build using a pre-computed semantic extraction JSON file.",
    )
    .option(
      "--backend <name>",
      "Backend for `graphify extract` (overrides config).",
    )
    .action(async (opts: { semantic?: string; backend?: string }) => {
      finish(
        await graphRebuildCommand({
          semantic: opts.semantic,
          backend: opts.backend,
        }),
      );
    });
  graph
    .command("ignore-assets")
    .description(
      "Write .graphifyignore code-only defaults (ignore docs/images/assets).",
    )
    .action(async () => {
      finish(await graphIgnoreAssetsCommand());
    });
  graph.action(() => {
    graph.help();
  });

  // config
  const config = program
    .command("config")
    .description("Manage ai-dev configuration.");
  config
    .command("init")
    .description("Write a starter ai-dev.config.json with current defaults.")
    .action(async () => {
      finish(await configInitCommand());
    });
  config
    .command("show")
    .description("Print the effective, normalized configuration and its source.")
    .action(async () => {
      finish(await configShowCommand());
    });
  config.action(() => {
    config.help();
  });

  // mcp
  const mcp = program.command("mcp").description("MCP tooling management.");
  mcp
    .command("list")
    .description("List recommended MCP tools.")
    .action(async () => {
      finish(await mcpListCommand());
    });
  mcp
    .command("guide")
    .description("Add the MCP guidance block to CLAUDE.md.")
    .action(async () => {
      finish(await mcpGuideCommand());
    });

  // Default: show help when `ai-dev mcp` invoked with no subcommand.
  mcp.action(() => {
    mcp.help();
  });

  await program.parseAsync(process.argv);

  // If no command was provided, show help.
  if (process.argv.slice(2).length === 0) {
    program.help();
  }
}

main().catch((err: unknown) => {
  logger.error(err instanceof Error ? err.message : String(err));
  finish(ExitCode.SetupFailed);
});
