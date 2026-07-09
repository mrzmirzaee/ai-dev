import { Command } from "commander";
import process from "node:process";
import { initCommand } from "./commands/init.js";
import { doctorCommand } from "./commands/doctor.js";
import { updateCommand } from "./commands/update.js";
import {
  graphIgnoreAssetsCommand,
  graphRebuildCommand,
  graphStatusCommand,
} from "./commands/graph.js";
import { mcpDoctorCommand, mcpGuideCommand, mcpInstallCommand, mcpListCommand } from "./commands/mcp.js";
import {
  configInitCommand,
  configShowCommand,
} from "./commands/config.js";
import { wizardCommand } from "./commands/wizard.js";
import { providerDoctorCommand, providerListCommand } from "./commands/providers.js";
import { contextCommand } from "./commands/context.js";
import { depsDoctorCommand, depsInstallCommand } from "./commands/deps.js";
import { setupCommand } from "./commands/setup.js";
import { statusCommand } from "./commands/status.js";
import { presetListCommand, presetShowCommand } from "./commands/presets.js";
import { cleanCommand } from "./commands/clean.js";
import { promptCommand } from "./commands/prompt.js";
import { upgradeCommand as upgradeProjectCommand } from "./commands/upgrade.js";
import { claudeDoctorCommand, claudeInitCommand } from "./commands/claudeCmd.js";
import { ConfigError, loadConfig, resolveInitOptions } from "./core/config.js";
import { logger } from "./core/logger.js";
import { ExitCode, type AiProvider, type InitOptions, type ProjectType } from "./types.js";

const VERSION = "3.0.0";

function finish(code: number): never {
  process.exit(code);
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("ai-dev")
    .description(
      "Bootstrap multi-agent AI development tooling (Claude Code, OpenCode, AGENTS.md, Graphify, MCP) for any project.",
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
    .option("--wizard", "Run the interactive setup wizard before init.")
    .option(
      "--project-type <type>",
      "Override project-type detection (e.g. Next.js, Vite, Node.js, Laravel, FastAPI, Android Kotlin, Kotlin Multiplatform).",
    )
    .action(async (opts: Record<string, unknown>) => {
      if (opts.wizard) {
        finish(await wizardCommand(process.cwd(), { force: opts.force as boolean | undefined }));
      }
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
    .option("--fix", "Apply safe, idempotent fixes for missing project setup files.")
    .action(async (opts: { fix?: boolean }) => {
      finish(await doctorCommand(process.cwd(), { fix: opts.fix }));
    });

  // wizard
  program
    .command("wizard")
    .description("Run the interactive AI development setup wizard.")
    .option("-y, --yes", "Non-interactive mode; write defaults and run init.")
    .option("--force", "Continue even if this folder is not a project root.")
    .action(async (opts: { yes?: boolean; force?: boolean }) => {
      finish(await wizardCommand(process.cwd(), opts));
    });


  // setup
  program
    .command("setup")
    .description("Run one-command project onboarding (init, dependency fixes, optional graph, final doctor).")
    .option("--provider <name>", "Provider preset: claude, opencode, codex, cursor, copilot, or generic")
    .option("--preset <name>", "Setup preset: chabok, claude, opencode, frontend, backend, mobile, or kmp")
    .option("-y, --yes", "Non-interactive mode; accept defaults.")
    .option("--force", "Continue even if this folder is not a project root.")
    .option("--skip-graph", "Skip graph build during setup.")
    .option("--code-only", "Build a code-only graph when graph build is enabled.")
    .option("--allow-dirty", "Allow setup with uncommitted git changes.")
    .option("--branch <name>", "Create and switch to a branch before setup.")
    .action(async (opts: { provider?: string; preset?: string; yes?: boolean; force?: boolean; skipGraph?: boolean; codeOnly?: boolean; allowDirty?: boolean; branch?: string }) => {
      finish(await setupCommand({
        provider: opts.provider as AiProvider | undefined,
        preset: opts.preset as any,
        yes: opts.yes,
        force: opts.force,
        skipGraph: opts.skipGraph,
        codeOnly: opts.codeOnly,
        allowDirty: opts.allowDirty,
        branch: opts.branch,
      }));
    });

  // status
  program
    .command("status")
    .description("Print a compact readiness summary for the current project.")
    .action(async () => {
      finish(await statusCommand(process.cwd()));
    });

  // presets
  const preset = program.command("preset").description("Manage setup presets.");
  preset.command("list").description("List available setup presets.").action(async () => {
    finish(await presetListCommand());
  });
  preset.command("show").argument("<name>", "Preset name").description("Show a preset configuration.").action(async (name: string) => {
    finish(await presetShowCommand(name));
  });
  preset.action(() => { preset.help(); });

  // claude
  const claude = program.command("claude").description("Claude Code focused setup and diagnostics.");
  claude.command("doctor").description("Check Claude Code readiness for this project.").action(async () => {
    finish(await claudeDoctorCommand());
  });
  claude.command("init").description("Initialize Claude Code artifacts for this project.").action(async () => {
    finish(await claudeInitCommand());
  });
  claude.action(() => { claude.help(); });

  // clean
  program.command("clean").description("Remove local ai-dev/Graphify generated cache files.").option("--dry-run", "Show what would be removed without deleting.").action(async (opts: { dryRun?: boolean }) => {
    finish(await cleanCommand({ dryRun: opts.dryRun }));
  });

  // upgrade project artifacts
  program.command("upgrade").description("Upgrade generated ai-dev blocks while preserving custom content.").action(async () => {
    finish(await upgradeProjectCommand());
  });

  // prompt
  program.command("prompt").argument("[kind]", "Prompt kind: bugfix, feature, refactor, review", "default").description("Print a reusable Claude task prompt.").action(async (kind: string) => {
    finish(await promptCommand(kind));
  });

  // deps
  const deps = program.command("deps").description("Manage external dependencies used by ai-dev.");
  deps
    .command("doctor")
    .description("Check external dependency installers and Graphify availability.")
    .action(async () => {
      finish(await depsDoctorCommand());
    });
  deps
    .command("install")
    .argument("<tool>", "Dependency key: graphify")
    .description("Install an external dependency using the best available installer.")
    .action(async (tool: string) => {
      finish(await depsInstallCommand(tool));
    });
  deps.action(() => { deps.help(); });

  // context
  program
    .command("context")
    .description("Preview the project-aware guidance block generated for AI agents.")
    .action(async () => {
      finish(await contextCommand(process.cwd()));
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
    .option(
      "--code-only",
      "Build the graph from the detected code root only (for example src/) to avoid docs/assets.",
    )
    .option("--if-stale", "Only rebuild when graph metadata shows source files changed.")
    .action(async (opts: { semantic?: string; backend?: string; codeOnly?: boolean; ifStale?: boolean }) => {
      finish(
        await graphRebuildCommand({
          semantic: opts.semantic,
          backend: opts.backend,
          codeOnly: opts.codeOnly,
          ifStale: opts.ifStale,
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
  graph
    .command("status")
    .description("Check whether the current graph is fresh or stale.")
    .action(async () => {
      finish(await graphStatusCommand());
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

  // providers
  const provider = program.command("provider").description("AI coding provider management.");
  provider
    .command("list")
    .description("List supported AI coding providers and their artifacts.")
    .action(async () => {
      finish(await providerListCommand());
    });
  provider
    .command("doctor")
    .description("Check configured AI coding providers for this project.")
    .action(async () => {
      finish(await providerDoctorCommand());
    });
  provider.action(() => {
    provider.help();
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
    .command("doctor")
    .description("Check which recommended MCP servers are configured in Claude Code.")
    .action(async () => {
      finish(await mcpDoctorCommand());
    });
  mcp
    .command("install")
    .argument("<tool>", "MCP tool key: context7, serena, or playwright")
    .description("Install a recommended MCP server into Claude Code.")
    .action(async (tool: string) => {
      finish(await mcpInstallCommand(tool));
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
