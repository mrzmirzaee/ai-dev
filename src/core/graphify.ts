import fs from "fs-extra";
import path from "node:path";
import { commandExists, resolveExecutable, run } from "./command.js";
import { uvBinDirs } from "./platform.js";
import { logger } from "./logger.js";

/**
 * Package name is `graphifyy`; the executable it installs is `graphify`.
 */
export const GRAPHIFY_PACKAGE = "graphifyy";
export const GRAPHIFY_BIN = "graphify";

/** Relative path where Graphify may write assistant extraction instructions. */
export const EXTRACT_INSTRUCTIONS_REL = path.join(
  ".graphify",
  "scratch",
  "assistant-extract-instructions.md",
);

/** Is `uv` available on PATH or in a known install directory? */
export async function hasUv(): Promise<boolean> {
  if (await commandExists("uv")) return true;
  return (await resolveExecutable("uv")) !== null;
}

export async function resolveUv(): Promise<string | null> {
  return (await resolveExecutable("uv")) ?? ((await commandExists("uv")) ? "uv" : null);
}

/** Add common uv bin directories to PATH for the current process. */
export function refreshUvPath(): void {
  const delimiter = process.platform === "win32" ? ";" : ":";
  const existing = new Set((process.env.PATH ?? "").split(delimiter).filter(Boolean));
  for (const dir of uvBinDirs()) {
    if (!existing.has(dir)) {
      process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ""}`;
      existing.add(dir);
    }
  }
}

/** Install uv using the official Astral standalone installer. */
export async function installUv(): Promise<boolean> {
  if (await hasUv()) return true;
  logger.detail("Installing uv...");
  const res = process.platform === "win32"
    ? await run("powershell", ["-ExecutionPolicy", "ByPass", "-c", "irm https://astral.sh/uv/install.ps1 | iex"])
    : await run("sh", ["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"]);
  if (!res.ok) {
    if (res.stderr) logger.detail(res.stderr.split(/\r?\n/)[0] ?? "");
    return false;
  }
  refreshUvPath();
  return hasUv();
}

/** Ensure uv is available, installing it when missing. */
export async function ensureUv(): Promise<boolean> {
  if (await hasUv()) return true;
  const installed = await installUv();
  if (installed) logger.success("uv installed.");
  return installed;
}

/**
 * Install or upgrade graphifyy via uv. Tries upgrade first when already
 * installed, otherwise installs. Returns whether the tool ended up available.
 */
export async function installOrUpdateGraphify(): Promise<boolean> {
  // `uv tool upgrade` fails cleanly if not installed, so try install first
  // when the executable is missing, upgrade when present.
  const uv = (await resolveUv()) ?? "uv";
  const already = await isGraphifyAvailable();

  if (already) {
    logger.detail(`Upgrading ${GRAPHIFY_PACKAGE}...`);
    const up = await run(uv, ["tool", "upgrade", GRAPHIFY_PACKAGE]);
    if (up.ok) return true;
    logger.detail("Upgrade reported an issue; attempting install.");
  } else {
    logger.detail(`Installing ${GRAPHIFY_PACKAGE}...`);
  }

  const install = await run(uv, ["tool", "install", GRAPHIFY_PACKAGE]);
  if (!install.ok && install.stderr) {
    logger.detail(install.stderr.split(/\r?\n/)[0] ?? "");
  }
  return isGraphifyAvailable();
}

/**
 * Whether the `graphify` executable is resolvable (PATH or known uv dirs).
 */
export async function isGraphifyAvailable(): Promise<boolean> {
  if (await commandExists(GRAPHIFY_BIN)) return true;
  if ((await resolveExecutable(GRAPHIFY_BIN)) !== null) return true;
  const uv = await resolveUv();
  if (!uv) return false;
  const probe = await run(uv, ["x", "--from", GRAPHIFY_PACKAGE, GRAPHIFY_BIN, "--help"]);
  return probe.ok;
}

/**
 * Resolve the graphify executable path, or null if not found.
 */
export function resolveGraphify(): Promise<string | null> {
  return resolveExecutable(GRAPHIFY_BIN);
}

export async function graphifyCommand(): Promise<{ command: string; argsPrefix: string[] }> {
  const resolved = await resolveGraphify();
  if (resolved) return { command: resolved, argsPrefix: [] };
  if (await commandExists(GRAPHIFY_BIN)) return { command: GRAPHIFY_BIN, argsPrefix: [] };
  const uv = (await resolveUv()) ?? "uv";
  return { command: uv, argsPrefix: ["x", "--from", GRAPHIFY_PACKAGE, GRAPHIFY_BIN] };
}

/**
 * Run `graphify claude install` in the project root, integrating Graphify with
 * Claude Code. Returns success.
 */
export async function runGraphifyClaudeInstall(cwd: string): Promise<boolean> {
  const graphify = await graphifyCommand();
  const res = await run(graphify.command, [...graphify.argsPrefix, "claude", "install"], { cwd });
  if (!res.ok && res.stderr) logger.detail(res.stderr.split(/\r?\n/)[0] ?? "");
  return res.ok;
}

/** Candidate locations for the built graph, tolerant across Graphify versions.
 *
 * When Graphify is run against a subdirectory (for example `graphify src` for
 * code-only builds), some versions write output under that target directory
 * instead of the project root. Keep both root-level and target-level candidates
 * so a successful command is not reported as a failure just because graph.json
 * landed in `src/graphify-out/graph.json`.
 */
export function graphJsonCandidates(cwd: string, target = "."): string[] {
  const candidates = [
    path.join(cwd, ".graphify", "graph.json"),
    path.join(cwd, "graphify-out", "graph.json"),
  ];

  if (target && target !== ".") {
    const targetRoot = path.isAbsolute(target) ? target : path.join(cwd, target);
    candidates.push(
      path.join(targetRoot, ".graphify", "graph.json"),
      path.join(targetRoot, "graphify-out", "graph.json"),
    );
  }

  return candidates;
}

/** Return the first existing graph.json path, or null. */
export async function findGraphJson(cwd: string, target = "."): Promise<string | null> {
  for (const candidate of graphJsonCandidates(cwd, target)) {
    if (await fs.pathExists(candidate)) return candidate;
  }
  return null;
}


/** Return the first existing graph.json across root and common code-only targets. */
export async function findAnyGraphJson(cwd: string): Promise<string | null> {
  const targets = [".", "src", "app", "pages", "components", "lib", "server", "api", "src/main/kotlin", "src/main/java", "app/src/main/kotlin", "app/src/main/java", "src/commonMain/kotlin", "shared/src/commonMain/kotlin", "composeApp/src/commonMain/kotlin", "routes", "database/migrations"];
  for (const target of targets) {
    const found = await findGraphJson(cwd, target);
    if (found) return found;
  }
  return null;
}

/** Candidate locations for the assistant extraction-instructions file. */
export function instructionCandidates(cwd: string): string[] {
  return [
    path.join(cwd, EXTRACT_INSTRUCTIONS_REL),
    path.join(cwd, "graphify-out", "scratch", "assistant-extract-instructions.md"),
  ];
}

/** Return the first existing instructions file path, or null. */
export async function findInstructionsFile(cwd: string): Promise<string | null> {
  for (const candidate of instructionCandidates(cwd)) {
    if (await fs.pathExists(candidate)) return candidate;
  }
  return null;
}

/** Summary of file counts Graphify reports, used for asset guidance. */
export interface AssetSummary {
  code: number;
  docs: number;
  papers: number;
  images: number;
  /** doc/paper/image files that need semantic extraction, if reported. */
  needSemantic?: number;
}

/**
 * Parse a Graphify scan summary such as:
 *   "found 273 code, 5 docs, 0 papers, 134 images"
 *   "139 doc/paper/image file(s) need semantic extraction"
 */
export function parseAssetSummary(text: string): AssetSummary | undefined {
  const found = text.match(
    /found\s+(\d+)\s+code,\s+(\d+)\s+docs?,\s+(\d+)\s+papers?,\s+(\d+)\s+images?/i,
  );
  const need = text.match(
    /(\d+)\s+doc\/paper\/image\s+file\(s\)\s+need\s+semantic\s+extraction/i,
  );
  if (!found && !need) return undefined;
  const summary: AssetSummary = {
    code: found ? Number(found[1]) : 0,
    docs: found ? Number(found[2]) : 0,
    papers: found ? Number(found[3]) : 0,
    images: found ? Number(found[4]) : 0,
  };
  if (need) summary.needSemantic = Number(need[1]);
  return summary;
}

/** True when a Graphify failure indicates semantic extraction is required. */
export function needsSemanticExtraction(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("no llm api key found") ||
    lower.includes("need semantic extraction") ||
    lower.includes("semantic extraction") ||
    lower.includes("pass --backend")
  );
}

/** Outcome of a graph build attempt. Callers render user-facing guidance. */
export type GraphOutcome =
  | { kind: "built"; graphPath: string; assets?: AssetSummary }
  | { kind: "instructions"; instructionsPath: string; assets?: AssetSummary }
  | { kind: "claude-not-authenticated"; assets?: AssetSummary }
  | { kind: "claude-session-limited"; resetTime?: string; assets?: AssetSummary }
  | { kind: "claude-incompatible"; assets?: AssetSummary }
  | { kind: "no-provider"; assets?: AssetSummary }
  | {
      kind: "failed";
      command: string;
      exitCode?: number;
      stdout: string;
      stderr: string;
      assets?: AssetSummary;
    };

/** Detect Claude CLI error signals inside Graphify output. */
function detectClaudeErrors(
  text: string,
): Pick<GraphOutcome, "kind"> & { resetTime?: string } | null {
  const lower = text.toLowerCase();
  if (lower.includes("not compatible with the version of windows")) {
    return { kind: "claude-incompatible" };
  }
  if (lower.includes("session limit") || lower.includes("hit your session")) {
    const m = text.match(
      /reset[a-z]*\b[^0-9]{0,20}(\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?)/i,
    );
    return {
      kind: "claude-session-limited",
      resetTime: m
        ? m[1].replace(/\s+/g, "").toLowerCase().replace(/[.,;:]+$/, "")
        : undefined,
    };
  }
  if (lower.includes("not logged in") || lower.includes("please log in")) {
    return { kind: "claude-not-authenticated" };
  }
  return null;
}

/**
 * Build the Graphify graph for `cwd`.
 *
 * Strategy (per real-world behavior):
 *   1. `graphify .`
 *   2. If a graph.json now exists -> success.
 *   3. If the failure indicates semantic extraction is required, run
 *      `graphify extract . --backend claude-cli`, then check, in order:
 *        a. graph.json exists          -> built
 *        b. instructions file exists   -> instructions (clear next steps)
 *        c. Claude CLI error signals   -> not-authenticated / session-limited / incompatible
 *        d. "no LLM api key" original  -> no-provider
 *        e. otherwise                  -> failed (surface Graphify output)
 */
export interface BuildGraphOptions {
  /** Backend passed to `graphify extract` (default: "claude-cli"). */
  backend?: string;
  /** Target path passed to Graphify (default: "."). */
  target?: string;
}

export async function buildGraph(
  cwd: string,
  options: BuildGraphOptions = {},
): Promise<GraphOutcome> {
  const backend = options.backend ?? "claude-cli";
  const target = options.target ?? ".";
  const graphify = await graphifyCommand();

  const primary = await run(graphify.command, [...graphify.argsPrefix, target], { cwd });
  const primaryCombined = `${primary.stdout}\n${primary.stderr}`;
  const assets = parseAssetSummary(primaryCombined);

  const builtPath = await findGraphJson(cwd, target);
  if (builtPath) return { kind: "built", graphPath: builtPath, assets };

  if (!needsSemanticExtraction(primaryCombined)) {
    return {
      kind: "failed",
      command: `${GRAPHIFY_BIN} ${target}`,
      exitCode: primary.exitCode,
      stdout: primary.stdout,
      stderr: primary.stderr,
      assets,
    };
  }

  logger.detail("Primary build needs semantic extraction; running extract...");
  const extract = await run(graphify.command, [...graphify.argsPrefix, "extract", target, "--backend", backend], {
    cwd,
  });
  const extractCombined = `${extract.stdout}\n${extract.stderr}`;
  const combined = `${primaryCombined}\n${extractCombined}`;
  const assets2 = parseAssetSummary(combined) ?? assets;

  const builtAfter = await findGraphJson(cwd, target);
  if (builtAfter) return { kind: "built", graphPath: builtAfter, assets: assets2 };

  const instructions = await findInstructionsFile(cwd);
  if (instructions) {
    return { kind: "instructions", instructionsPath: instructions, assets: assets2 };
  }

  const claudeErr = detectClaudeErrors(combined);
  if (claudeErr) {
    if (claudeErr.kind === "claude-session-limited") {
      return {
        kind: "claude-session-limited",
        resetTime: claudeErr.resetTime,
        assets: assets2,
      };
    }
    if (claudeErr.kind === "claude-not-authenticated") {
      return { kind: "claude-not-authenticated", assets: assets2 };
    }
    if (claudeErr.kind === "claude-incompatible") {
      return { kind: "claude-incompatible", assets: assets2 };
    }
  }

  if (needsSemanticExtraction(primaryCombined) && /no llm api key/i.test(combined)) {
    return { kind: "no-provider", assets: assets2 };
  }

  return {
    kind: "failed",
    command: `${GRAPHIFY_BIN} extract ${target} --backend ${backend}`,
    exitCode: extract.exitCode,
    stdout: extract.stdout,
    stderr: extract.stderr,
    assets: assets2,
  };
}

/** Outcome of a semantic-file-driven build. */
export type SemanticOutcome =
  | { kind: "built"; graphPath: string }
  | {
      kind: "failed";
      command: string;
      exitCode?: number;
      stdout: string;
      stderr: string;
    };

/**
 * Build the graph from a pre-computed semantic extraction file:
 *   `graphify extract . --semantic <path>`
 * Then verify a graph.json exists.
 */
export async function buildGraphFromSemantic(
  cwd: string,
  semanticPath: string,
): Promise<SemanticOutcome> {
  const graphify = await graphifyCommand();
  const res = await run(graphify.command, [...graphify.argsPrefix, "extract", ".", "--semantic", semanticPath], {
    cwd,
  });

  const built = await findGraphJson(cwd);
  if (built) return { kind: "built", graphPath: built };

  return {
    kind: "failed",
    command: `${GRAPHIFY_BIN} extract . --semantic ${semanticPath}`,
    exitCode: res.exitCode,
    stdout: res.stdout,
    stderr: res.stderr,
  };
}
