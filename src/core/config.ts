import path from "node:path";
import fs from "fs-extra";
import {
  AiDevConfigSchema,
  type AiDevConfig,
  type InitFlags,
  type InitOptions,
  type ProjectType,
} from "../types.js";
import { RECOMMENDED_MCP_TOOLS, type McpTool } from "./mcp.js";

/** Config file names searched (in order) when walking up from the cwd. */
export const CONFIG_FILENAMES = ["ai-dev.config.json", ".ai-dev.json"] as const;

/** Built-in defaults. These preserve v0.2.0 behavior when no config is present. */
export const CONFIG_DEFAULTS = {
  skipGraph: false,
  skipMcp: false,
  graphBackend: "claude-cli",
  claude: { updateClaudeMd: true, requireAuth: true },
  mcp: { context7: true, serena: true, playwright: true },
} as const;

/** Markers up to which config discovery walks (a project boundary). */
const ROOT_MARKERS = [
  ".git",
  "package.json",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "composer.json",
];

/** Error thrown for a present-but-invalid config file. */
export class ConfigError extends Error {
  constructor(
    message: string,
    readonly filePath: string,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Result of loading configuration. */
export interface LoadedConfig {
  config: AiDevConfig;
  /** Absolute path of the config file used, or null when none was found. */
  filePath: string | null;
  /** Non-fatal notices (e.g. unrecognized keys). */
  warnings: string[];
}

/**
 * Find the nearest config file, walking up from `startDir`. Stops at a project
 * root marker (so a config in a parent repo doesn't leak into an unrelated
 * project) or the filesystem root.
 */
export function findConfigFile(startDir: string): string | null {
  let dir = path.resolve(startDir);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(dir, name);
      if (fileExistsSync(candidate)) return candidate;
    }
    // Stop after checking a directory that is itself a project root.
    if (ROOT_MARKERS.some((m) => fileExistsSync(path.join(dir, m)))) {
      return null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function fileExistsSync(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * Load and validate configuration from the nearest config file.
 *
 * - No file found -> empty config, no error (defaults apply).
 * - Malformed JSON or schema violation -> throws ConfigError with a clear
 *   message so problems surface loudly rather than silently changing behavior.
 * - Unrecognized top-level keys -> kept as a warning (forgiving to forward
 *   config additions while still flagging likely typos).
 */
export async function loadConfig(cwd: string): Promise<LoadedConfig> {
  const filePath = findConfigFile(cwd);
  if (!filePath) return { config: {}, filePath: null, warnings: [] };

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    throw new ConfigError(
      `Could not read config: ${err instanceof Error ? err.message : String(err)}`,
      filePath,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(
      `Config is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      filePath,
    );
  }

  const result = AiDevConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const at = issue?.path.length ? ` at "${issue.path.join(".")}"` : "";
    throw new ConfigError(
      `Invalid config${at}: ${issue?.message ?? "schema validation failed"}`,
      filePath,
    );
  }

  const warnings: string[] = [];
  const known = new Set([
    "projectType",
    "skipGraph",
    "skipMcp",
    "graph",
    "claude",
    "mcp",
  ]);
  if (parsed && typeof parsed === "object") {
    for (const key of Object.keys(parsed as Record<string, unknown>)) {
      if (!known.has(key)) {
        warnings.push(`Unrecognized config key "${key}" (ignored).`);
      }
    }
  }

  return { config: result.data, filePath, warnings };
}

// --- Pure precedence resolvers (flag > config > default) -------------------

/** Merge CLI init flags over config over defaults. */
export function resolveInitOptions(
  flags: InitFlags,
  config: AiDevConfig,
): InitOptions {
  return {
    yes: flags.yes ?? false,
    force: flags.force ?? false,
    skipGraph: flags.skipGraph ?? config.skipGraph ?? CONFIG_DEFAULTS.skipGraph,
    skipMcp: flags.skipMcp ?? config.skipMcp ?? CONFIG_DEFAULTS.skipMcp,
  };
}

/** Resolve the Graphify extract backend. */
export function resolveBackend(
  flag: string | undefined,
  config: AiDevConfig,
): string {
  return flag ?? config.graph?.backend ?? CONFIG_DEFAULTS.graphBackend;
}

/** Resolve the effective project type (config override beats detection). */
export function resolveProjectType(
  detected: ProjectType,
  config: AiDevConfig,
  flag?: ProjectType,
): ProjectType {
  return flag ?? config.projectType ?? detected;
}

/** Map of which MCP tools are enabled (default: all). */
export function resolveMcpEnabled(
  config: AiDevConfig,
): Record<McpTool["key"], boolean> {
  return {
    context7: config.mcp?.context7 ?? CONFIG_DEFAULTS.mcp.context7,
    serena: config.mcp?.serena ?? CONFIG_DEFAULTS.mcp.serena,
    playwright: config.mcp?.playwright ?? CONFIG_DEFAULTS.mcp.playwright,
  };
}

/** The subset of recommended MCP tools enabled by config. */
export function enabledMcpTools(config: AiDevConfig): McpTool[] {
  const enabled = resolveMcpEnabled(config);
  return RECOMMENDED_MCP_TOOLS.filter((t) => enabled[t.key]);
}

/** Resolve the `claude` settings (updateClaudeMd, requireAuth). */
export function resolveClaudeSettings(config: AiDevConfig): {
  updateClaudeMd: boolean;
  requireAuth: boolean;
} {
  return {
    updateClaudeMd:
      config.claude?.updateClaudeMd ?? CONFIG_DEFAULTS.claude.updateClaudeMd,
    requireAuth: config.claude?.requireAuth ?? CONFIG_DEFAULTS.claude.requireAuth,
  };
}

/** Fully-populated, normalized view of a config (all defaults filled in). */
export interface NormalizedConfig {
  projectType?: ProjectType;
  skipGraph: boolean;
  skipMcp: boolean;
  graph: { backend: string };
  claude: { updateClaudeMd: boolean; requireAuth: boolean };
  mcp: { context7: boolean; serena: boolean; playwright: boolean };
}

/**
 * Merge a (possibly partial) config over the built-in defaults to produce a
 * complete, normalized object. `projectType` has no default (it is
 * auto-detected), so it is only present when explicitly set.
 */
export function normalizeConfig(config: AiDevConfig): NormalizedConfig {
  const normalized: NormalizedConfig = {
    skipGraph: config.skipGraph ?? CONFIG_DEFAULTS.skipGraph,
    skipMcp: config.skipMcp ?? CONFIG_DEFAULTS.skipMcp,
    graph: { backend: resolveBackend(undefined, config) },
    claude: resolveClaudeSettings(config),
    mcp: resolveMcpEnabled(config),
  };
  if (config.projectType) normalized.projectType = config.projectType;
  return normalized;
}

/** The default config object used to seed `ai-dev config init`. */
export function defaultConfigObject(): NormalizedConfig {
  return normalizeConfig({});
}

