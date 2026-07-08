import { execa, type Options, type Result } from "execa";
import fs from "fs-extra";
import path from "node:path";
import { executableNames, isWindows, uvBinDirs } from "./platform.js";

export interface RunResult {
  ok: boolean;
  exitCode: number | undefined;
  stdout: string;
  stderr: string;
}

/**
 * Run a command, capturing output. Never throws for a non-zero exit; instead
 * returns a structured result so callers can decide how to react.
 */
export async function run(
  command: string,
  args: string[] = [],
  options: Options = {},
): Promise<RunResult> {
  try {
    const result = (await execa(command, args, {
      reject: false,
      ...options,
    })) as Result;
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: typeof result.stderr === "string" ? result.stderr : "",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, exitCode: undefined, stdout: "", stderr: message };
  }
}

/**
 * Determine whether a command is resolvable on PATH, probing Windows wrapper
 * extensions. Uses `where` on Windows and `which` elsewhere. Falls back to a
 * `--version` probe if the lookup tool itself is unavailable.
 */
export async function commandExists(command: string): Promise<boolean> {
  const names = executableNames(command);
  const locator = isWindows ? "where" : "which";

  for (const name of names) {
    const res = await run(locator, [name]);
    if (res.ok && res.stdout.trim().length > 0) return true;
  }

  // Fallback: some environments lack `where`/`which`. Probe `--version`.
  for (const name of names) {
    const res = await run(name, ["--version"]);
    if (res.ok) return true;
  }
  return false;
}

/**
 * Resolve the absolute path to an executable, first via PATH then via known
 * uv install directories (important on Windows where uv's bin dir is often
 * not on PATH inside fresh shells). Returns null when nothing is found.
 */
export async function resolveExecutable(
  command: string,
): Promise<string | null> {
  const names = executableNames(command);
  const locator = isWindows ? "where" : "which";

  for (const name of names) {
    const res = await run(locator, [name]);
    if (res.ok && res.stdout.trim().length > 0) {
      return res.stdout.trim().split(/\r?\n/)[0];
    }
  }

  // Probe known uv bin directories directly.
  for (const dir of uvBinDirs()) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (await fs.pathExists(candidate)) return candidate;
      } catch {
        // ignore and keep probing
      }
    }
  }
  return null;
}
