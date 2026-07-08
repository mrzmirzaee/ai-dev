import process from "node:process";
import ora from "ora";
import {
  hasUv,
  installOrUpdateGraphify,
  isGraphifyAvailable,
  resolvePipx,
  resolvePython,
  resolvePythonInstaller,
} from "../core/graphify.js";
import { logger } from "../core/logger.js";
import { ExitCode, type ExitCodeValue } from "../types.js";

export async function depsDoctorCommand(): Promise<ExitCodeValue> {
  logger.heading("ai-dev deps doctor");
  const [uv, pipx, python, graphify] = await Promise.all([
    hasUv(),
    resolvePipx(),
    resolvePython(),
    isGraphifyAvailable(),
  ]);
  const installer = await resolvePythonInstaller();

  logger.check(uv ? "ok" : "warn", "uv", uv ? "available" : "not installed; optional");
  logger.check(pipx ? "ok" : "warn", "pipx", pipx ?? "not installed; optional");
  logger.check(python ? "ok" : "warn", "Python", python ?? "not found");
  logger.check(installer.installer === "none" ? "warn" : "ok", "Best installer", installer.detail);
  logger.check(graphify ? "ok" : "fail", "Graphify", graphify ? "graphify command available" : "not installed");

  if (!graphify) {
    logger.info("");
    logger.next("Run: ai-dev deps install graphify");
    return ExitCode.MissingDependency;
  }
  return ExitCode.Success;
}

export async function depsInstallCommand(tool: string): Promise<ExitCodeValue> {
  logger.heading(`ai-dev deps install ${tool}`);
  if (!['graphify', 'graphifyy'].includes(tool.toLowerCase())) {
    logger.error(`Unknown dependency: ${tool}`);
    logger.next("Supported: graphify");
    return ExitCode.SetupFailed;
  }

  if (await isGraphifyAvailable()) {
    logger.success("Graphify is already available.");
    return ExitCode.Success;
  }

  const installer = await resolvePythonInstaller();
  logger.detail(`Selected installer: ${installer.detail}`);
  if (installer.installer === "none") {
    logger.warn("No uv, pipx, or Python/pip installer found. ai-dev will try to bootstrap uv.");
  }

  const spinner = ora({ text: "Installing graphifyy...", stream: process.stdout }).start();
  const ok = await installOrUpdateGraphify();
  if (ok) {
    spinner.succeed("Graphify installed.");
    logger.success("graphify command is available.");
    return ExitCode.Success;
  }

  spinner.fail("Could not install Graphify automatically.");
  logger.next(
    process.platform === "win32"
      ? "Install uv manually: powershell -ExecutionPolicy ByPass -c \"irm https://astral.sh/uv/install.ps1 | iex\""
      : "Install uv manually: curl -LsSf https://astral.sh/uv/install.sh | sh",
  );
  logger.next("Then run: ai-dev deps install graphify");
  return ExitCode.MissingDependency;
}
