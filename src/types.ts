import { z } from "zod";

/**
 * Supported / detectable project types.
 *
 * Keep this as the single source of truth for project type values used by:
 * - detector output
 * - config validation
 * - wizard choices
 * - CLI project-type overrides
 */
export type AiProvider = "claude" | "opencode" | "codex" | "cursor" | "copilot" | "generic";

export const PROJECT_TYPES = [
  "Next.js",
  "NestJS",
  "React",
  "Vite",
  "Node.js",
  "Python",
  "Django",
  "FastAPI",
  "Laravel",
  "Symfony",
  "PHP",
  "Kotlin",
  "Android Kotlin",
  "Kotlin Multiplatform",
  "Unknown",
] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number];

/**
 * Exit codes used across the CLI.
 *   0 -> success
 *   1 -> setup failed (an operation errored)
 *   2 -> missing required dependency
 */
export const ExitCode = {
  Success: 0,
  SetupFailed: 1,
  MissingDependency: 2,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Result of a single environment check (used by `doctor`).
 */
export type CheckStatus = "ok" | "warn" | "fail";

/** How important a check is to overall readiness. */
export type CheckSeverity = "critical" | "important" | "optional";

export interface CheckResult {
  label: string;
  status: CheckStatus;
  severity: CheckSeverity;
  detail?: string;
}

/**
 * Options shared by the `init` command.
 */
export interface InitOptions {
  yes: boolean;
  skipGraph: boolean;
  skipMcp: boolean;
  force: boolean;
}

/**
 * Options for `graph rebuild`.
 */
export interface GraphRebuildOptions {
  /** Path to a pre-computed semantic extraction JSON, if provided. */
  semantic?: string;
  /** Backend for `graphify extract` (resolved: flag > config > default). */
  backend?: string;
  /** Build only the detected code root (for example src/) to avoid docs/assets. */
  codeOnly?: boolean;
}

/**
 * Raw init flags as parsed from the CLI. `undefined` means "not passed", which
 * lets config values take effect; an explicit boolean always wins.
 */
export interface InitFlags {
  yes?: boolean;
  skipGraph?: boolean;
  skipMcp?: boolean;
  force?: boolean;
  projectType?: ProjectType;
}


const AiProviderEnum = z.enum([
  "claude",
  "opencode",
  "codex",
  "cursor",
  "copilot",
  "generic",
]);

const ArtifactConfigSchema = z.object({
  claudeMd: z.boolean().optional(),
  agentsMd: z.boolean().optional(),
  opencodeConfig: z.boolean().optional(),
  cursorRules: z.boolean().optional(),
  copilotInstructions: z.boolean().optional(),
}).optional();

/**
 * Zod schema for the optional `ai-dev.config.json` (or `.ai-dev.json`) config
 * file. Every key is optional; when a file is present it is validated so
 * configuration cannot silently drift into an invalid state.
 *
 * Precedence everywhere is: CLI flag > config file > built-in default.
 */
export const AiDevConfigSchema = z.object({
  projectType: z.enum(PROJECT_TYPES).optional(),
  skipGraph: z.boolean().optional(),
  skipMcp: z.boolean().optional(),
  ai: z
    .object({
      providers: z.array(AiProviderEnum).min(1).optional(),
      primary: AiProviderEnum.optional(),
    })
    .optional(),
  artifacts: ArtifactConfigSchema,
  graph: z
    .object({
      // Backend used for `graphify extract`. Kept as a permissive string so
      // new Graphify backends aren't rejected across versions.
      backend: z.string().min(1).optional(),
    })
    .optional(),
  claude: z
    .object({
      /** Whether `init` creates/updates CLAUDE.md (and its MCP block). */
      updateClaudeMd: z.boolean().optional(),
      /** Whether Claude auth/session problems block doctor readiness. */
      requireAuth: z.boolean().optional(),
    })
    .optional(),
  mcp: z
    .object({
      context7: z.boolean().optional(),
      serena: z.boolean().optional(),
      playwright: z.boolean().optional(),
    })
    .optional(),
});

export type AiDevConfig = z.infer<typeof AiDevConfigSchema>;

/**
 * Structured information about the detected project.
 */
export interface ProjectInfo {
  root: string;
  type: ProjectType;
  isProjectRoot: boolean;
}
