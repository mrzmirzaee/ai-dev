import fs from "fs-extra";
import path from "node:path";
import { commandExists, resolveExecutable, run } from "./command.js";
import { logger } from "./logger.js";
import { expandWindowsEnv, isWindows } from "./platform.js";

export const CLAUDE_BIN = "claude";
export const CLAUDE_NPM_PACKAGE = "@anthropic-ai/claude-code";

/**
 * Distinct readiness states for the Claude Code CLI. These map directly to the
 * cases `doctor` and `graph rebuild` need to distinguish.
 */
export type ClaudeState =
  | "not-installed" // no executable, no npm package
  | "npm-only" // npm package present but executable not resolvable on PATH
  | "installed" // executable present; readiness unknown / other non-zero probe
  | "not-authenticated" // executable present, `claude -p` reports not logged in
  | "session-limited" // authenticated but hit the session limit
  | "incompatible" // executable present but incompatible with this OS
  | "ready"; // authenticated and `claude -p` succeeded

export interface ClaudeStatus {
  state: ClaudeState;
  /** Executable resolvable (PATH or known install dirs). */
  installed: boolean;
  /** `@anthropic-ai/claude-code` present in the global npm tree. */
  npmPackage: boolean;
  /** Executable resolvable specifically on PATH / known dirs. */
  execInPath: boolean;
  /** Resolved executable path, if found. */
  execPath?: string;
  /** Reset time parsed from a session-limit message, when present. */
  resetTime?: string;
  /** Short human-readable detail for display. */
  detail?: string;
  /** Short excerpt of probe output, for debugging. */
  raw?: string;
}

/**
 * Detect whether the Claude Code CLI executable exists (basic check kept for
 * callers that only need a boolean).
 */
export function hasClaudeCode(): Promise<boolean> {
  return commandExists(CLAUDE_BIN);
}

/**
 * Common Windows npm-global locations for the claude launcher. These are
 * checked in addition to PATH because Git Bash and PowerShell can expose
 * different PATHs.
 */
function windowsClaudeCandidates(): string[] {
  const files = ["claude.cmd", "claude", "claude.ps1"];
  const base = expandWindowsEnv("%APPDATA%\\npm");
  if (!base) return [];
  return files.map((f) => path.join(base, f));
}

/**
 * Resolve the claude executable path across PATH, uv/known dirs, and (on
 * Windows) the npm-global directory. Returns null when nothing is found.
 */
export async function resolveClaudeExecutable(): Promise<string | null> {
  const viaPath = await resolveExecutable(CLAUDE_BIN);
  if (viaPath) return viaPath;

  if (isWindows) {
    for (const candidate of windowsClaudeCandidates()) {
      try {
        if (await fs.pathExists(candidate)) return candidate;
      } catch {
        // keep probing
      }
    }
  }
  return null;
}

/**
 * Whether `@anthropic-ai/claude-code` is present in the global npm tree.
 * Uses `npm list -g --depth=0` and looks for the package name.
 */
export async function claudeNpmPackageInstalled(): Promise<boolean> {
  const res = await run("npm", ["list", "-g", "--depth=0"]);
  return res.stdout.includes(CLAUDE_NPM_PACKAGE);
}

/** Back-compat alias used by `update`. */
export function claudeInstalledViaNpm(): Promise<boolean> {
  return claudeNpmPackageInstalled();
}

/**
 * Pure interpretation of a `claude -p "ping"` probe. Separated from process
 * execution so the message-handling logic is trivially unit-testable.
 */
export function interpretClaudeProbe(
  exitCode: number | undefined,
  stdout: string,
  stderr: string,
): Pick<ClaudeStatus, "state" | "resetTime" | "detail" | "raw"> {
  const combined = `${stdout}\n${stderr}`;
  const lower = combined.toLowerCase();
  const raw = firstMeaningfulLine(combined);

  // Order matters: check the most specific / most severe signals first.
  if (lower.includes("not compatible with the version of windows")) {
    return {
      state: "incompatible",
      detail: "binary incompatible with this Windows version",
      raw,
    };
  }
  if (lower.includes("session limit") || lower.includes("hit your session")) {
    const resetTime = parseResetTime(combined);
    return {
      state: "session-limited",
      resetTime,
      detail: resetTime
        ? `session limit reached; resets ${resetTime}`
        : "session limit reached",
      raw,
    };
  }
  if (lower.includes("not logged in") || lower.includes("please log in")) {
    return {
      state: "not-authenticated",
      detail: "installed but not authenticated",
      raw,
    };
  }
  if (exitCode === 0) {
    return { state: "ready", detail: "authenticated and ready", raw };
  }
  // Any other non-zero exit: installed but not confirmed ready.
  return {
    state: "installed",
    detail: raw ? `probe failed: ${raw}` : "probe returned a non-zero exit",
    raw,
  };
}

/** Dependencies injectable for testing getClaudeStatus without real processes. */
export interface ClaudeProbeDeps {
  resolveExe: () => Promise<string | null>;
  npmInstalled: () => Promise<boolean>;
  runProbe: (
    exe: string,
  ) => Promise<{ exitCode: number | undefined; stdout: string; stderr: string }>;
}

const defaultDeps: ClaudeProbeDeps = {
  resolveExe: resolveClaudeExecutable,
  npmInstalled: claudeNpmPackageInstalled,
  runProbe: async (exe) => {
    const res = await run(exe, ["-p", "ping"], { timeout: 60_000 });
    return { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr };
  },
};

/**
 * Full Claude readiness check: resolve the executable, consider the npm
 * package, and (when installed) run a lightweight `claude -p "ping"` probe.
 */
export async function getClaudeStatus(
  deps: Partial<ClaudeProbeDeps> = {},
): Promise<ClaudeStatus> {
  const d: ClaudeProbeDeps = { ...defaultDeps, ...deps };

  const execPath = await d.resolveExe();
  const npmPackage = await d.npmInstalled();
  const installed = execPath !== null;

  if (!installed) {
    if (npmPackage) {
      return {
        state: "npm-only",
        installed: false,
        npmPackage: true,
        execInPath: false,
        detail: "npm package installed but executable not on PATH",
      };
    }
    return {
      state: "not-installed",
      installed: false,
      npmPackage: false,
      execInPath: false,
      detail: "not installed",
    };
  }

  const probe = await d.runProbe(execPath);
  const interpreted = interpretClaudeProbe(
    probe.exitCode,
    probe.stdout,
    probe.stderr,
  );

  return {
    installed: true,
    npmPackage,
    execInPath: true,
    execPath,
    ...interpreted,
  };
}

/**
 * Print platform-appropriate instructions for installing Claude Code.
 */
export function printClaudeInstallInstructions(): void {
  logger.warn("Claude Code CLI was not found.");
  logger.info("Install it with one of:");
  if (isWindows) {
    logger.next("winget install Anthropic.ClaudeCode --source winget");
  }
  logger.next("npm install -g @anthropic-ai/claude-code");
  if (!isWindows) {
    logger.detail("(winget option is available on Windows.)");
  }
}

/** Extract a reset time such as "12:10am" from a session-limit message. */
export function parseResetTime(text: string): string | undefined {
  // Prefer a time that appears near the word "reset".
  const nearReset = text.match(
    /reset[a-z]*\b[^0-9]{0,20}(\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?)/i,
  );
  if (nearReset) return normalizeTime(nearReset[1]);
  const anyTime = text.match(/\b(\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?)/i);
  return anyTime ? normalizeTime(anyTime[1]) : undefined;
}

function normalizeTime(t: string): string {
  return t
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/[.,;:]+$/, "");
}

function firstMeaningfulLine(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length > 0) return t.length > 200 ? `${t.slice(0, 200)}…` : t;
  }
  return undefined;
}
