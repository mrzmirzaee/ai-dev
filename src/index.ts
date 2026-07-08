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
import { logger } from "./core/logger.js";
import { ExitCode, type InitOptions } from "./types.js";

const VERSION = "0.1.0";

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
    .option("-y, --yes", "Non-interactive mode; accept defaults.", false)
    .option("--skip-graph", "Skip building the Graphify graph.", false)
    .option("--skip-mcp", "Skip MCP guidance and config.", false)
    .option("--force", "Continue even if this folder is not a project root.", false)
    .action(async (opts: Record<string, boolean>) => {
      const options: InitOptions = {
        yes: Boolean(opts.yes),
        skipGraph: Boolean(opts.skipGraph),
        skipMcp: Boolean(opts.skipMcp),
        force: Boolean(opts.force),
      };
      finish(await initCommand(options));
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
    .action(async (opts: { semantic?: string }) => {
      finish(await graphRebuildCommand({ semantic: opts.semantic }));
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

  // mcp
  const mcp = program.command("mcp").description("MCP tooling management.");
  mcp
    .command("list")
    .description("List recommended MCP tools.")
    .action(() => {
      finish(mcpListCommand());
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
